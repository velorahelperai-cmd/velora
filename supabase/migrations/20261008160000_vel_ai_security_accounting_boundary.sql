-- Forward-only AI accounting boundary. Preserve the existing budget and ledger;
-- no counters, prices, owner identity, customer rollout flags, or history reset.
begin;

-- Service clients must use atomic RPCs, not overwrite lifetime money/evidence.
revoke all on public.ai_budget_accounts,public.ai_usage_ledger from service_role;
grant select on public.ai_budget_accounts,public.ai_usage_ledger to service_role;
alter table public.ai_budget_accounts add constraint ai_budget_finite_accounting check (
 limit_baisa::text not in ('NaN','Infinity','-Infinity')
 and spent_baisa::text not in ('NaN','Infinity','-Infinity')
 and held_baisa::text not in ('NaN','Infinity','-Infinity'));

create or replace function public.ai_reserve_attempt(p_id uuid,p_execution_id uuid,p_attempt integer,p_company_id uuid,
 p_actor_id uuid,p_session_id uuid,p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,
 p_pricing_snapshot jsonb,p_usage_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare budget public.ai_budget_accounts%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_usage_mode is distinct from 'admin_test' then return jsonb_build_object('ok',false,'code','LIVE_AI_DISABLED');end if;
 if p_id is null or p_execution_id is null or p_attempt is null or p_attempt not between 1 and 3
 or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
 or p_reserved_baisa::text in ('NaN','Infinity','-Infinity') or p_model_id is null or p_provider is null
 or not ((p_model_id='gemini-3.8-flash' and p_provider='google') or (p_model_id in ('gpt-6-luna','gpt-6.1-sol') and p_provider='openai'))
 or length(btrim(coalesce(p_pricing_version,'')))=0 or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
 or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
 then raise exception 'INVALID_RESERVATION';end if;
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and role='owner' and status='active') then raise exception 'OWNER_REQUIRED';end if;
 if not exists(select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
 where a.user_id=p_actor_id and a.session_id=p_session_id and a.expired_at is null
 and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours') then raise exception 'APP_SESSION_EXPIRED';end if;
 if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended') then raise exception 'COMPANY_UNAVAILABLE';end if;
 select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
 if not found or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED');end if;
 if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_execution_id and attempt=p_attempt))
 then return jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST');end if;
 if exists(select 1 from public.ai_usage_ledger where execution_id=p_execution_id and
 (usage_mode is distinct from 'admin_test' or worker_job_id is not null or company_id is distinct from p_company_id
 or actor_user_id is distinct from p_actor_id or actor_session_id is distinct from p_session_id))
 then return jsonb_build_object('ok',false,'code','EXECUTION_BINDING_REJECTED');end if;
 if exists(select 1 from public.ai_usage_ledger where execution_id=p_execution_id and
 (status<>'rejected' or cost_baisa is distinct from 0 or cost_usd is distinct from 0
 or error_code is null or error_code not in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404')))
 then return jsonb_build_object('ok',false,'code','PRIOR_ATTEMPT_NOT_RETRYABLE');end if;
 if (select count(*) from public.ai_usage_ledger where execution_id=p_execution_id)<>p_attempt-1
 or (p_attempt>1 and not exists(select 1 from public.ai_usage_ledger where execution_id=p_execution_id and attempt=p_attempt-1))
 then return jsonb_build_object('ok',false,'code','ATTEMPT_SEQUENCE_REJECTED');end if;
 if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000)
 then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED');end if;
 insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,
 usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot)
 values(p_id,budget.id,p_company_id,p_actor_id,p_session_id,p_execution_id,p_attempt,p_usage_mode,p_model_id,p_provider,
 p_reserved_baisa,p_pricing_version,p_pricing_snapshot);
 update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
 return jsonb_build_object('ok',true,'id',p_id,'remaining_baisa',budget.limit_baisa-budget.spent_baisa-budget.held_baisa-p_reserved_baisa);
end;$$;

create or replace function public.ai_start_attempt(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype;budget public.ai_budget_accounts%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.status<>'reserved' or entry.usage_mode<>'admin_test' or entry.worker_job_id is not null then return false;end if;
 -- Reserve, start, settle and reconcile take the shared budget lock before entry.
 select * into budget from public.ai_budget_accounts where id=entry.budget_account_id for update;
 if not found or not budget.enabled or budget.scope<>'admin_test' or budget.company_id is not null
 or budget.spent_baisa+budget.held_baisa>least(budget.limit_baisa,1000) then return false;end if;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if entry.status<>'reserved' then return false;end if;
 if not exists(select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
 where a.user_id=entry.actor_user_id and a.session_id=entry.actor_session_id and a.expired_at is null
 and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours') then return false;end if;
 if not exists(select 1 from public.platform_admins where user_id=entry.actor_user_id and role='owner' and status='active') then return false;end if;
 if not exists(select 1 from public.companies where id=entry.company_id and status<>'suspended') then return false;end if;
 update public.ai_usage_ledger set status='running' where id=p_id and status='reserved';
 return found;
end;$$;

create function private.ai_validate_cost(p_status text,p_cost_usd numeric,p_cost_baisa numeric) returns void
language plpgsql immutable security invoker set search_path='' as $$begin
 if p_status='uncertain' then
  if p_cost_usd is not null or p_cost_baisa is not null then raise exception 'INVALID_COST';end if;
 elsif p_cost_usd is null or p_cost_baisa is null or p_cost_usd<0 or p_cost_baisa<0
 or p_cost_usd::text in ('NaN','Infinity','-Infinity') or p_cost_baisa::text in ('NaN','Infinity','-Infinity')
 or (p_cost_usd=0) is distinct from (p_cost_baisa=0) then raise exception 'INVALID_COST';
 end if;
 if p_status='rejected' and (p_cost_usd<>0 or p_cost_baisa<>0) then raise exception 'INVALID_REJECTION_COST';end if;
end;$$;

-- Both administrative APIs use one transaction. The legacy API preserves optional
-- provider identity; the current runtime must provide actual model and request evidence.
create function private.ai_settle_admin(p_id uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_request_id text,p_error_code text,p_latency_ms integer,p_response_id text,p_actual_model_id text,
 p_require_provider_identity boolean) returns boolean language plpgsql security invoker set search_path='' as $$
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
 if entry.worker_job_id is not null or entry.usage_mode<>'admin_test' then raise exception 'WORKER_CLAIM_REQUIRED';end if;
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
end;$$;

create function public.ai_settle_admin_attempt(p_id uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_request_id text,p_error_code text,p_latency_ms integer,p_response_id text,p_actual_model_id text)
returns boolean language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 return private.ai_settle_admin(p_id,p_status,p_cost_usd,p_cost_baisa,p_usage,p_request_id,p_error_code,p_latency_ms,p_response_id,p_actual_model_id,true);
end;$$;
create or replace function public.ai_settle_attempt(p_id uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_request_id text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 return private.ai_settle_admin(p_id,p_status,p_cost_usd,p_cost_baisa,p_usage,p_request_id,p_error_code,p_latency_ms,null,null,false);
end;$$;

-- Reservation/start already have guarded definer wrappers for window, plan/persona
-- and joint capacity. Keep that chain intact; wrap only the remaining invoker write.
alter function public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) set schema private;
alter function private.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) rename to ai_settle_whatsapp_pre_security;
create function public.ai_settle_whatsapp_attempt(p_id uuid,p_claim_token uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_request_id text,p_response_id text,p_actual_model_id text,p_response_text text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 perform private.ai_validate_cost(p_status,p_cost_usd,p_cost_baisa);
 return private.ai_settle_whatsapp_pre_security(p_id,p_claim_token,p_status,p_cost_usd,p_cost_baisa,p_usage,p_request_id,p_response_id,
 p_actual_model_id,p_response_text,p_error_code,p_latency_ms);
end;$$;

create or replace function public.ai_reconcile_attempt(p_id uuid,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_provider_reference text)
returns boolean language plpgsql security definer set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype;u jsonb;outcome text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if length(btrim(coalesce(p_provider_reference,'')))<5 or length(p_provider_reference)>200 then raise exception 'RECONCILIATION_EVIDENCE_REQUIRED';end if;
 perform private.ai_validate_cost('incomplete',p_cost_usd,p_cost_baisa);
 outcome:=case when p_cost_baisa=0 then 'rejected' else 'incomplete' end;
 u:=private.ai_validated_usage(p_usage,outcome,false);
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found then raise exception 'RESERVATION_MISSING';end if;
 -- Match worker settlement order, while allowing cost recovery after lease expiry.
 if entry.worker_job_id is not null then perform 1 from public.whatsapp_inbound_jobs where id=entry.worker_job_id for update;end if;
 perform 1 from public.ai_budget_accounts where id=entry.budget_account_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if entry.reconciled_at is not null then
  return entry.status=outcome and entry.cost_usd is not distinct from p_cost_usd and entry.cost_baisa is not distinct from p_cost_baisa
   and entry.prompt_tokens is not distinct from (u->>'promptTokens')::integer
   and entry.completion_tokens is not distinct from (u->>'completionTokens')::integer
   and entry.cached_tokens is not distinct from (u->>'cachedTokens')::integer
   and entry.reasoning_tokens is not distinct from (u->>'reasoningTokens')::integer
   and entry.cache_write_tokens is not distinct from (u->>'cacheWriteTokens')::integer
   and entry.total_tokens is not distinct from (u->>'totalTokens')::integer
   and entry.reconciliation_evidence is not distinct from p_provider_reference;
 end if;
 if entry.status not in ('uncertain','reserved','running') then return false;end if;
 if entry.status in ('reserved','running') and entry.created_at>clock_timestamp()-interval '5 minutes' then raise exception 'REQUEST_STILL_IN_FLIGHT';end if;
 update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
 enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa where id=entry.budget_account_id;
 update public.ai_usage_ledger set status=outcome,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
 prompt_tokens=(u->>'promptTokens')::integer,completion_tokens=(u->>'completionTokens')::integer,
 cached_tokens=(u->>'cachedTokens')::integer,reasoning_tokens=(u->>'reasoningTokens')::integer,
 cache_write_tokens=(u->>'cacheWriteTokens')::integer,total_tokens=(u->>'totalTokens')::integer,
 reconciled_at=clock_timestamp(),reconciliation_evidence=p_provider_reference,finished_at=clock_timestamp() where id=p_id;
 return true;
end;$$;

create or replace function public.ai_admin_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 return jsonb_build_object(
 'budget',(select to_jsonb(b) from public.ai_budget_accounts b where scope='admin_test'),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',display_name,'status',status) order by display_name) from public.companies),'[]'::jsonb),
 'models',coalesce((select jsonb_agg(to_jsonb(m)) from (select model_id,count(*) as attempts,count(*) filter(where status='success') as succeeded,
  coalesce(sum(cost_baisa),0) as cost_baisa from public.ai_usage_ledger where usage_mode='admin_test' group by model_id) m),'[]'::jsonb),
 'recent',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from (select id,company_id,model_id,status,cost_baisa,cost_usd,reserved_baisa,
  prompt_tokens,completion_tokens,cached_tokens,reasoning_tokens,cache_write_tokens,total_tokens,error_code,request_id,response_id,actual_model_id,
  latency_ms,created_at,reconciled_at,reconciliation_evidence from public.ai_usage_ledger where usage_mode='admin_test' order by created_at desc limit 30) r),'[]'::jsonb));
end;$$;

do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_settle_admin_attempt',
 'ai_settle_whatsapp_attempt','ai_reconcile_attempt','ai_admin_snapshot') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname like 'ai\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;
