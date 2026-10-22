CREATE OR REPLACE FUNCTION private.ai_settle_admin(p_id uuid, p_status text, p_cost_usd numeric, p_cost_baisa numeric, p_usage jsonb, p_request_id text, p_error_code text, p_latency_ms integer, p_response_id text, p_actual_model_id text, p_require_provider_identity boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare entry public.ai_usage_ledger%rowtype;u jsonb;model_normalized text;
begin
 if p_status is null or p_status not in ('success','rejected','incomplete','uncertain')
 or p_latency_ms is null or p_latency_ms<0 then raise exception 'INVALID_SETTLEMENT';end if;
 u:=private.ai_validated_usage(p_usage,p_status,p_require_provider_identity);
 perform private.ai_validate_cost(p_status,p_cost_usd,p_cost_baisa);
 if length(p_request_id)>200 or length(p_response_id)>200 or length(p_actual_model_id)>100
 or (p_request_id is not null and length(btrim(p_request_id))=0)
 or (p_response_id is not null and length(btrim(p_response_id))=0)
 then raise exception 'INVALID_RESPONSE_METADATA';end if;
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found then raise exception 'RESERVATION_MISSING';end if;
 if entry.worker_job_id is not null or entry.usage_mode not in ('admin_test','setup_trial') then raise exception 'WORKER_CLAIM_REQUIRED';end if;
 perform 1 from public.ai_budget_accounts where id=entry.budget_account_id and scope='admin_test' and company_id is null for update;
 if not found then raise exception 'BUDGET_BINDING_REJECTED';end if;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if p_status in ('success','incomplete') and (p_require_provider_identity or p_actual_model_id is not null) then
  model_normalized:=case when entry.provider='google' then regexp_replace(coalesce(p_actual_model_id,''),'^models/','') else coalesce(p_actual_model_id,'') end;
  if model_normalized<>entry.model_id and not (
   (entry.provider='google' and model_normalized~('^'||replace(entry.model_id,'.','\.')||'-[0-9]{3}$'))
   or (entry.provider='openai' and model_normalized~('^'||replace(entry.model_id,'.','\.')||'-[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
  then raise exception 'PROVIDER_MODEL_MISMATCH';end if;
  if p_require_provider_identity and length(btrim(coalesce(p_request_id,p_response_id,'')))=0 then raise exception 'INVALID_RESPONSE_METADATA';end if;
 end if;
 if entry.status not in ('reserved','running') then
  return entry.reconciled_at is null and entry.status=p_status
   and entry.cost_usd is not distinct from p_cost_usd and entry.cost_baisa is not distinct from p_cost_baisa
   and entry.prompt_tokens is not distinct from (u->>'promptTokens')::integer
   and entry.completion_tokens is not distinct from (u->>'completionTokens')::integer
   and entry.cached_tokens is not distinct from (u->>'cachedTokens')::integer
   and entry.reasoning_tokens is not distinct from (u->>'reasoningTokens')::integer
   and entry.cache_write_tokens is not distinct from (u->>'cacheWriteTokens')::integer
   and entry.total_tokens is not distinct from (u->>'totalTokens')::integer
   and entry.request_id is not distinct from p_request_id and entry.response_id is not distinct from p_response_id
   and entry.actual_model_id is not distinct from p_actual_model_id
   and entry.error_code is not distinct from left(p_error_code,80) and entry.latency_ms=p_latency_ms;
 end if;
 if p_status in ('success','incomplete') and entry.status<>'running' then return false;end if;
 if p_status<>'uncertain' then
  update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
  enabled=enabled and spent_baisa+p_cost_baisa<=least(limit_baisa,1000) and p_cost_baisa<=entry.reserved_baisa where id=entry.budget_account_id;
 end if;
 update public.ai_usage_ledger set status=p_status,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
 prompt_tokens=(u->>'promptTokens')::integer,completion_tokens=(u->>'completionTokens')::integer,
 cached_tokens=(u->>'cachedTokens')::integer,reasoning_tokens=(u->>'reasoningTokens')::integer,
 cache_write_tokens=(u->>'cacheWriteTokens')::integer,total_tokens=(u->>'totalTokens')::integer,
 request_id=p_request_id,response_id=p_response_id,actual_model_id=p_actual_model_id,
 error_code=left(p_error_code,80),latency_ms=p_latency_ms,finished_at=clock_timestamp() where id=p_id;
 return true;
end;$function$;
