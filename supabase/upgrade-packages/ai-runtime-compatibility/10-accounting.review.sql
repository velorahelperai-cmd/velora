-- Additive accounting compatibility against the installed fixed-ack baseline.
-- Canonical sources: 20261008133000 (ledger/usage) and 20261008160000 (security).
-- No counters, histories, identities, tariffs or rollout flags are reset.
begin;
set local role postgres;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path='';
-- Policy/column permission preflight; fail closed on widening or drift.
DO $ai_policy_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH targets AS (SELECT c.oid,n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))), policies AS (SELECT t.name,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM targets t JOIN pg_policy p ON p.polrelid=t.oid), column_acl AS (SELECT t.name,a.attname,coalesce(r.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee) SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(policies) ORDER BY name,polname) FROM policies),'column_acl',(SELECT jsonb_agg(to_jsonb(column_acl) ORDER BY name,attname,grantee,privilege_type,is_grantable) FROM column_acl))) q(data)) IS DISTINCT FROM 'a9f1ce104cf2e74d869ae582dbacc13a' THEN RAISE EXCEPTION 'AI_COMPAT_POLICY_PREFLIGHT_DRIFT';END IF;END $ai_policy_guard$;
-- Exact structural preflight; no data or credentials included.
DO $ai_compat_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH fn AS (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job','ai_admin_snapshot','ai_answer_profile_binding_guard','ai_budget_account_binding','ai_budget_period','ai_budget_policy_immutable','ai_lock_authorized_whatsapp_job','ai_reconcile_attempt','ai_reserve_attempt','ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_admin','ai_settle_admin_attempt','ai_settle_attempt','ai_settle_whatsapp_attempt','ai_start_attempt','ai_start_whatsapp_attempt','ai_usage_ledger_guard_binding','ai_validate_cost','ai_validated_usage','ai_whatsapp_citations_current','billing_bind_ai_budget_draft','billing_load_worker_frame','claim_whatsapp_inbound_job','wa_noura_authority','wa_noura_binding_immutable','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel))) q(data)) IS DISTINCT FROM 'd264324249abb9fe7ede0cbbba346f7a' THEN RAISE EXCEPTION 'AI_COMPAT_PREFLIGHT_DRIFT';END IF;END $ai_compat_guard$;

alter table public.ai_budget_accounts add constraint ai_admin_lifetime_cap
  check (scope <> 'admin_test' or limit_baisa <= 1000);

alter table public.ai_usage_ledger
  alter column actor_user_id drop not null,
  alter column actor_session_id drop not null,
  add column worker_job_id uuid references public.whatsapp_inbound_jobs(id) on delete restrict,
  add column worker_claim_token uuid,
  add column automation_generation integer,
  add column cache_write_tokens integer,
  add column total_tokens integer,
  add column response_id text,
  add column actual_model_id text,
  add column response_text text,
  add column source_citations jsonb;

alter table public.ai_usage_ledger add constraint ai_attempt_authorization_binding check (
  (worker_job_id is null and worker_claim_token is null and automation_generation is null
   and actor_user_id is not null and actor_session_id is not null)
  or (worker_job_id is not null and worker_claim_token is not null and automation_generation >= 0
      and automation_generation is not null and usage_mode='company_live'
      and actor_user_id is null and actor_session_id is null
      and case when jsonb_typeof(source_citations)='array' then jsonb_array_length(source_citations) between 1 and 40 else false end)
);
alter table public.ai_usage_ledger add constraint ai_attempt_provider_model_pair check (
  (model_id='gemini-3.8-flash' and provider='google')
  or (model_id in ('gpt-6-luna','gpt-6.1-sol') and provider='openai')
);
alter table public.ai_usage_ledger add constraint ai_attempt_usage_valid check (
  reserved_baisa::text not in ('NaN','Infinity','-Infinity')
  and (cost_baisa is null or (cost_baisa>=0 and cost_baisa::text not in ('NaN','Infinity','-Infinity')))
  and (cost_usd is null or (cost_usd>=0 and cost_usd::text not in ('NaN','Infinity','-Infinity')))
  and (prompt_tokens is null or prompt_tokens >= 0) and (completion_tokens is null or completion_tokens >= 0)
  and (cached_tokens is null or cached_tokens >= 0) and (cache_write_tokens is null or cache_write_tokens >= 0)
  and (reasoning_tokens is null or reasoning_tokens >= 0) and (total_tokens is null or total_tokens >= 0)
  and (latency_ms is null or latency_ms >= 0)
  and (prompt_tokens is null or cached_tokens is null or cached_tokens::bigint+coalesce(cache_write_tokens,0) <= prompt_tokens)
  and (completion_tokens is null or reasoning_tokens is null or reasoning_tokens <= completion_tokens)
  and (total_tokens is null or (prompt_tokens is not null and completion_tokens is not null
       and total_tokens::bigint=prompt_tokens::bigint+completion_tokens::bigint))
  and (response_text is null or (worker_job_id is not null and status='success' and length(trim(response_text))>0))
  and (worker_job_id is null or status<>'success' or response_text is not null)
);
create unique index ai_worker_job_generation_attempt on public.ai_usage_ledger(worker_job_id,automation_generation,attempt)
  where worker_job_id is not null;

-- The original reservation is immutable even to later service writes. Settlement
-- updates outcome/actual usage only; it cannot replace the claim capability or payer.
create function private.ai_usage_ledger_guard_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if row(new.id,new.budget_account_id,new.company_id,new.actor_user_id,new.actor_session_id,new.execution_id,new.attempt,
  new.usage_mode,new.model_id,new.provider,new.reserved_baisa,new.pricing_version,new.pricing_snapshot,
  new.worker_job_id,new.worker_claim_token,new.automation_generation,new.created_at,new.source_citations)
 is distinct from row(old.id,old.budget_account_id,old.company_id,old.actor_user_id,old.actor_session_id,old.execution_id,old.attempt,
  old.usage_mode,old.model_id,old.provider,old.reserved_baisa,old.pricing_version,old.pricing_snapshot,
  old.worker_job_id,old.worker_claim_token,old.automation_generation,old.created_at,old.source_citations)
 then raise exception 'AI_ATTEMPT_BINDING_IMMUTABLE' using errcode='23514'; end if;
 return new;
end; $$;
revoke all on function private.ai_usage_ledger_guard_binding() from public,anon,authenticated;
grant execute on function private.ai_usage_ledger_guard_binding() to service_role;
create trigger ai_usage_ledger_guard_binding before update on public.ai_usage_ledger
 for each row execute function private.ai_usage_ledger_guard_binding();

-- A capability must never inherit the former whole-table authenticated SELECT.
revoke select on public.ai_usage_ledger from authenticated;
grant select(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,
  model_id,provider,status,reserved_baisa,cost_baisa,cost_usd,prompt_tokens,completion_tokens,cached_tokens,
  reasoning_tokens,request_id,pricing_version,pricing_snapshot,error_code,latency_ms,created_at,finished_at,
  reconciled_at,reconciliation_evidence,worker_job_id,automation_generation,cache_write_tokens,total_tokens,
  response_id,actual_model_id,source_citations) on public.ai_usage_ledger to authenticated;

-- Validate counters before storing or releasing money. Legacy administrative callers
-- may omit newly added cache-write/total counts; worker known-usage settlement may not.
create function private.ai_validated_usage(p_usage jsonb,p_status text,p_worker boolean default false)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare k text; u jsonb:=coalesce(p_usage,'{}'::jsonb); n numeric; pt bigint; ct bigint;
begin
 if jsonb_typeof(u)<>'object' then raise exception 'INVALID_PROVIDER_USAGE'; end if;
 if u='{}'::jsonb and p_status in ('rejected','uncertain') then return u; end if;
 foreach k in array array['promptTokens','completionTokens','cachedTokens','reasoningTokens','cacheWriteTokens','totalTokens'] loop
  if not u ? k and not p_worker and k in ('cacheWriteTokens','totalTokens') then continue; end if;
  if not u ? k or jsonb_typeof(u->k)<>'number' then raise exception 'INVALID_PROVIDER_USAGE'; end if;
  n:=(u->>k)::numeric;
  if n<0 or n>2147483647 or n<>trunc(n) then raise exception 'INVALID_PROVIDER_USAGE'; end if;
 end loop;
 if p_status='uncertain' and not (u ? 'promptTokens' and u ? 'completionTokens' and u ? 'cachedTokens' and u ? 'reasoningTokens')
 then raise exception 'INVALID_PROVIDER_USAGE'; end if;
 pt:=(u->>'promptTokens')::bigint; ct:=(u->>'completionTokens')::bigint;
 if pt+ct>2147483647 or (u ? 'totalTokens' and (u->>'totalTokens')::bigint<>pt+ct)
    or (u->>'cachedTokens')::bigint+coalesce((u->>'cacheWriteTokens')::bigint,0)>pt
    or (u->>'reasoningTokens')::bigint>ct then raise exception 'INVALID_PROVIDER_USAGE'; end if;
 if p_status='rejected' and pt+ct<>0 then raise exception 'INVALID_REJECTION_USAGE'; end if;
 return u||jsonb_build_object('cacheWriteTokens',coalesce((u->>'cacheWriteTokens')::bigint,0),'totalTokens',pt+ct);
end; $$;
revoke all on function private.ai_validated_usage(jsonb,text,boolean) from public,anon,authenticated;
grant execute on function private.ai_validated_usage(jsonb,text,boolean) to service_role;

-- Locks are shared with quota/stage: company -> subscription -> conversation -> job.
-- Every identity below is read from the original stored inbound, never a caller company.
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
 if entry.worker_job_id is not null then
  perform 1 from public.companies where id=entry.company_id for no key update;
  perform 1 from public.whatsapp_inbound_jobs where id=entry.worker_job_id for update;
 end if;
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
 where n.nspname='private' and p.proname in ('ai_usage_ledger_guard_binding','ai_validated_usage','ai_validate_cost','ai_settle_admin') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end;$$;
notify pgrst,'reload schema';

-- Policy/column permission postflight; fail closed on widening or drift.
DO $ai_policy_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH targets AS (SELECT c.oid,n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))), policies AS (SELECT t.name,p.polname,p.polcmd,p.polpermissive,(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM targets t JOIN pg_policy p ON p.polrelid=t.oid), column_acl AS (SELECT t.name,a.attname,coalesce(r.rolname,'PUBLIC') grantee,x.privilege_type,x.is_grantable FROM targets t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee) SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(policies) ORDER BY name,polname) FROM policies),'column_acl',(SELECT jsonb_agg(to_jsonb(column_acl) ORDER BY name,attname,grantee,privilege_type,is_grantable) FROM column_acl))) q(data)) IS DISTINCT FROM '66e21932eaa60c5e4f0e6417694f8c6c' THEN RAISE EXCEPTION 'AI_COMPAT_POLICY_POSTFLIGHT_DRIFT';END IF;END $ai_policy_guard$;
-- Exact structural postflight; no data or credentials included.
DO $ai_compat_guard$ BEGIN IF (SELECT md5(data::text) FROM (WITH fn AS (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.proconfig config,md5(replace(p.prosrc,chr(13),'')) body_md5,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.proname IN ('ai_reserve_attempt','ai_start_attempt','ai_settle_attempt','ai_reconcile_attempt','ai_admin_snapshot','wa_worker_lock','wa_worker_month','whatsapp_job_service_window','whatsapp_service_window','billing_service_catalog_owner','billing_service_receipt_eligible','billing_financial_receipt_immutability','billing_service_immutable','billing_read_company_operational_entitlement','claim_whatsapp_inbound_job','ai_admin_snapshot','ai_answer_profile_binding_guard','ai_budget_account_binding','ai_budget_period','ai_budget_policy_immutable','ai_lock_authorized_whatsapp_job','ai_reconcile_attempt','ai_reserve_attempt','ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_capacity_cost_attempt','ai_reserve_whatsapp_profile_attempt','ai_settle_admin','ai_settle_admin_attempt','ai_settle_attempt','ai_settle_whatsapp_attempt','ai_start_attempt','ai_start_whatsapp_attempt','ai_usage_ledger_guard_binding','ai_validate_cost','ai_validated_usage','ai_whatsapp_citations_current','billing_bind_ai_budget_draft','billing_load_worker_frame','claim_whatsapp_inbound_job','wa_noura_authority','wa_noura_binding_immutable','wa_worker_citations','whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','whatsapp_claim_assistant_job_send','whatsapp_claim_inbound_batch','whatsapp_heartbeat_inbound_job','whatsapp_read_answer_profile','whatsapp_repair_accepted_jobs','whatsapp_reserve_job_usage','whatsapp_retrieve_approved_knowledge','whatsapp_retry_inbound_job','whatsapp_stage_job_reply')
), rel AS (
 SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
 (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) constraints,
 (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid=c.oid) indexes,
 (SELECT jsonb_agg(jsonb_build_array(tgname,tgenabled::text,pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname,c.relname) IN (('public','ai_budget_accounts'),('public','ai_usage_ledger'),('public','whatsapp_inbound_jobs'),('public','knowledge_sources'),('public','billing_subscriptions'),('public','billing_plan_versions'),('public','billing_catalog_revision'),('private','billing_service_grants'),('private','billing_service_offers'),('private','billing_service_order_offers'),('private','ai_plan_budget_policies'))
)
SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(fn) ORDER BY signature) FROM fn),'relations',(SELECT jsonb_agg(to_jsonb(rel) ORDER BY name) FROM rel))) q(data)) IS DISTINCT FROM '69675d2900be23e06a1735da88e17e20' THEN RAISE EXCEPTION 'AI_COMPAT_POSTFLIGHT_DRIFT';END IF;END $ai_compat_guard$;
commit;
