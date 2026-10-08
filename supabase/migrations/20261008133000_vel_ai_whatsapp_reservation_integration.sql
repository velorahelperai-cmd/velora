-- Forward-only D4 integration. No new budget/ledger, seeds, budget resets or rollout flags.
-- Dependencies: 20261008132000 job usage reservation + expected_automation_generation.
begin;
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
create function private.ai_lock_authorized_whatsapp_job(p_job_id uuid,p_claim_token uuid,p_generation integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype; c public.whatsapp_conversations%rowtype;
 cid uuid; conversation_id uuid; sub public.billing_subscriptions%rowtype; entitlement jsonb;
begin
 select job.company_id,m.conversation_id into cid,conversation_id
 from public.whatsapp_inbound_jobs job join public.whatsapp_messages m on m.id=job.message_id
 where job.id=p_job_id and m.company_id=job.company_id and m.wa_message_id=job.wa_message_id
   and m.direction='inbound' and m.sender='customer';
 if not found then return jsonb_build_object('ok',false,'code','ORIGINAL_INBOUND_REQUIRED'); end if;
 perform 1 from public.companies where id=cid and status<>'suspended' for no key update;
 if not found then return jsonb_build_object('ok',false,'code','COMPANY_UNAVAILABLE'); end if;
 select * into sub from public.billing_subscriptions where company_id=cid and environment='live' for no key update;
 if not found or sub.status not in ('active','cancel_at_period_end') or sub.paid_through is null
    or sub.paid_through<=clock_timestamp() or sub.plan_version_id is null
 then return jsonb_build_object('ok',false,'code','PAID_LIVE_SUBSCRIPTION_REQUIRED'); end if;
 entitlement:=public.billing_read_company_operational_entitlement(cid);
 if entitlement->>'ok' is distinct from 'true' or entitlement->>'active' is distinct from 'true'
   or entitlement->>'environment' is distinct from 'live'
   or (entitlement->>'plan_version_id')::uuid is distinct from sub.plan_version_id
   or (entitlement->>'paid_through')::timestamptz is distinct from sub.paid_through
 then return jsonb_build_object('ok',false,'code','PAID_LIVE_SUBSCRIPTION_REQUIRED'); end if;
 select * into c from public.whatsapp_conversations where id=conversation_id and company_id=cid for update;
 if not found then return jsonb_build_object('ok',false,'code','CONVERSATION_UNAVAILABLE'); end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id for update;
 if not found or j.company_id is distinct from cid or j.status<>'claimed' or j.claim_token is distinct from p_claim_token
    or p_claim_token is null or j.claim_expires_at is null or j.claim_expires_at<=clock_timestamp()
 then return jsonb_build_object('ok',false,'code','CLAIM_REJECTED'); end if;
 if not exists(select 1 from public.whatsapp_messages m where m.id=j.message_id and m.company_id=cid
   and m.conversation_id=c.id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer')
 then return jsonb_build_object('ok',false,'code','ORIGINAL_INBOUND_REQUIRED'); end if;
 if c.status<>'open' or not c.automation_allowed or j.expected_automation_generation is null
    or c.automation_generation is distinct from j.expected_automation_generation
    or (p_generation is not null and p_generation is distinct from j.expected_automation_generation)
 then return jsonb_build_object('ok',false,'code','AUTOMATION_CHANGED'); end if;
 if j.usage_status is distinct from 'reserved' or j.usage_subscription_id is distinct from sub.id
    or j.usage_period_start is distinct from (date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat')
 then return jsonb_build_object('ok',false,'code','USAGE_RESERVATION_REQUIRED'); end if;
 return jsonb_build_object('ok',true,'company_id',cid,'automation_generation',c.automation_generation);
end; $$;
revoke all on function private.ai_lock_authorized_whatsapp_job(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function private.ai_lock_authorized_whatsapp_job(uuid,uuid,integer) to service_role;

-- The generation's original source versions travel with its reservation/draft.
-- Recovery may revalidate this snapshot; it may never replace it with new knowledge.
create function private.ai_whatsapp_citations_current(p_company_id uuid,p_citations jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare x jsonb; k public.knowledge_sources%rowtype; version_value numeric;
begin
 if jsonb_typeof(p_citations) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_citations) not between 1 and 40 then return false; end if;
 for x in select value from jsonb_array_elements(p_citations) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'sourceId') is distinct from 'string'
   or jsonb_typeof(x->'contentVersion') is distinct from 'number' then return false; end if;
  version_value:=(x->>'contentVersion')::numeric;
  if version_value<1 or version_value>2147483647 or version_value<>trunc(version_value) then return false; end if;
  select * into k from public.knowledge_sources where id=(x->>'sourceId')::uuid and company_id=p_company_id for share;
  if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
   or k.content_version is distinct from version_value::integer or length(btrim(k.content))=0
   or (x ? 'title' and x->>'title' is distinct from k.title) then return false; end if;
 end loop;
 return (select count(distinct value->>'sourceId')=jsonb_array_length(p_citations) from jsonb_array_elements(p_citations));
 exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;
revoke all on function private.ai_whatsapp_citations_current(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.ai_whatsapp_citations_current(uuid,jsonb) to service_role;

create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare gate jsonb; budget public.ai_budget_accounts%rowtype; cid uuid; generation integer;
begin
 if p_id is null or p_attempt is null or p_attempt not between 1 and 3 or p_reserved_baisa is null
   or p_reserved_baisa<=0 or p_reserved_baisa>1000 or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
   or p_model_id is null or p_provider is null
   or not ((p_model_id='gemini-3.8-flash' and p_provider='google') or (p_model_id in ('gpt-6-luna','gpt-6.1-sol') and p_provider='openai'))
   or length(trim(coalesce(p_pricing_version,'')))=0 or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
   or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
 then raise exception 'INVALID_RESERVATION'; end if;
 gate:=private.ai_lock_authorized_whatsapp_job(p_job_id,p_claim_token);
 if gate->>'ok'<>'true' then return gate; end if;
 cid:=(gate->>'company_id')::uuid; generation:=(gate->>'automation_generation')::integer;
 if not private.ai_whatsapp_citations_current(cid,p_source_citations)
 then return jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED'); end if;
 select * into budget from public.ai_budget_accounts where scope='company_live' and company_id=cid
  and period_start=date_trunc('month',clock_timestamp())::date for update;
 if not found or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
 -- The original job is the logical execution. Changing a lease/generation cannot start it again.
 if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_job_id and attempt=p_attempt))
 then return jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST'); end if;
 if exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id and
   (automation_generation is distinct from generation or status<>'rejected' or cost_baisa is distinct from 0
    or cost_usd is distinct from 0 or error_code not in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404') or error_code is null))
 then return jsonb_build_object('ok',false,'code','PRIOR_ATTEMPT_NOT_RETRYABLE'); end if;
 if (select count(*) from public.ai_usage_ledger where worker_job_id=p_job_id and automation_generation=generation)<>p_attempt-1
   or (p_attempt>1 and not exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id
     and automation_generation=generation and attempt=p_attempt-1 and worker_claim_token=p_claim_token))
 then return jsonb_build_object('ok',false,'code','ATTEMPT_SEQUENCE_REJECTED'); end if;
 if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>budget.limit_baisa
 then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
 insert into public.ai_usage_ledger(id,budget_account_id,company_id,execution_id,attempt,usage_mode,model_id,provider,
   reserved_baisa,pricing_version,pricing_snapshot,worker_job_id,worker_claim_token,automation_generation,source_citations)
 values(p_id,budget.id,cid,p_job_id,p_attempt,'company_live',p_model_id,p_provider,p_reserved_baisa,
   p_pricing_version,p_pricing_snapshot,p_job_id,p_claim_token,generation,p_source_citations);
 update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
 return jsonb_build_object('ok',true,'id',p_id,'job_id',p_job_id,'company_id',cid,'automation_generation',generation,
   'remaining_baisa',budget.limit_baisa-budget.spent_baisa-budget.held_baisa-p_reserved_baisa);
end; $$;
revoke all on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) to service_role;

create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype; gate jsonb;
begin
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.worker_job_id is null or entry.worker_claim_token is distinct from p_claim_token
    or entry.status<>'reserved' then return false; end if;
 gate:=private.ai_lock_authorized_whatsapp_job(entry.worker_job_id,p_claim_token,entry.automation_generation);
 if gate->>'ok'<>'true' then return false; end if;
 if not private.ai_whatsapp_citations_current(entry.company_id,entry.source_citations) then return false; end if;
 perform 1 from public.ai_budget_accounts where id=entry.budget_account_id and enabled
  and scope='company_live' and company_id=entry.company_id
  and period_start=date_trunc('month',clock_timestamp())::date for update;
 if not found then return false; end if;
 update public.ai_usage_ledger set status='running' where id=p_id and status='reserved'
  and worker_claim_token=p_claim_token;
 return found;
end; $$;
revoke all on function public.ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_start_whatsapp_attempt(uuid,uuid) to service_role;

create function public.ai_settle_whatsapp_attempt(p_id uuid,p_claim_token uuid,p_status text,
 p_cost_usd numeric,p_cost_baisa numeric,p_usage jsonb,p_request_id text,p_response_id text,
 p_actual_model_id text,p_response_text text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype; u jsonb; model_normalized text;
begin
 if p_status is null or p_status not in ('success','rejected','incomplete','uncertain')
   or p_latency_ms is null or p_latency_ms<0 then raise exception 'INVALID_SETTLEMENT'; end if;
 u:=private.ai_validated_usage(p_usage,p_status,true);
 if p_status<>'uncertain' and (p_cost_baisa is null or p_cost_usd is null)
   or p_cost_baisa<0 or p_cost_usd<0
   or p_cost_baisa::text in ('NaN','Infinity','-Infinity') or p_cost_usd::text in ('NaN','Infinity','-Infinity')
 then raise exception 'INVALID_COST'; end if;
 if p_status='rejected' and (p_cost_baisa<>0 or p_cost_usd<>0) then raise exception 'INVALID_REJECTION_COST'; end if;
 if (p_status='success' and length(trim(coalesce(p_response_text,'')))=0)
   or (p_status<>'success' and p_response_text is not null) or length(p_response_text)>32000
   or length(p_request_id)>200 or length(p_response_id)>200 or length(p_actual_model_id)>100
 then raise exception 'INVALID_RESPONSE_METADATA'; end if;
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.worker_job_id is null or p_claim_token is null
    or entry.worker_claim_token is distinct from p_claim_token then return false; end if;
 -- Recording already-incurred cost does not need today's automation/lease authority.
 -- Original reservation capability only; stage/send independently require the current claim.
 perform 1 from public.whatsapp_inbound_jobs where id=entry.worker_job_id for update;
 perform 1 from public.ai_budget_accounts where id=entry.budget_account_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if p_status in ('success','incomplete') then
  model_normalized:=case when entry.provider='google' then regexp_replace(coalesce(p_actual_model_id,''),'^models/','')
    else coalesce(p_actual_model_id,'') end;
  if model_normalized<>entry.model_id and not (
    (entry.provider='google' and model_normalized~('^'||replace(entry.model_id,'.','\.')||'-[0-9]{3}$'))
    or (entry.provider='openai' and model_normalized~('^'||replace(entry.model_id,'.','\.')||'-[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
  then raise exception 'PROVIDER_MODEL_MISMATCH'; end if;
 end if;
 if entry.status not in ('reserved','running') then
  -- Identical retries acknowledge the first transaction without charging twice.
  return entry.status=p_status and entry.cost_usd is not distinct from p_cost_usd and entry.cost_baisa is not distinct from p_cost_baisa
   and entry.prompt_tokens is not distinct from (u->>'promptTokens')::integer
   and entry.completion_tokens is not distinct from (u->>'completionTokens')::integer
   and entry.cached_tokens is not distinct from (u->>'cachedTokens')::integer
   and entry.reasoning_tokens is not distinct from (u->>'reasoningTokens')::integer
   and entry.cache_write_tokens is not distinct from (u->>'cacheWriteTokens')::integer
   and entry.total_tokens is not distinct from (u->>'totalTokens')::integer
   and entry.request_id is not distinct from p_request_id and entry.response_id is not distinct from p_response_id
   and entry.actual_model_id is not distinct from p_actual_model_id and entry.response_text is not distinct from p_response_text
   and entry.error_code is not distinct from left(p_error_code,80) and entry.latency_ms=p_latency_ms;
 end if;
 if p_status in ('success','incomplete') and entry.status<>'running' then return false; end if;
 if p_status<>'uncertain' then
  update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
   enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa
  where id=entry.budget_account_id;
 end if;
 update public.ai_usage_ledger set status=p_status,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
  prompt_tokens=(u->>'promptTokens')::integer,completion_tokens=(u->>'completionTokens')::integer,
  cached_tokens=(u->>'cachedTokens')::integer,reasoning_tokens=(u->>'reasoningTokens')::integer,
  cache_write_tokens=(u->>'cacheWriteTokens')::integer,total_tokens=(u->>'totalTokens')::integer,
  request_id=p_request_id,response_id=p_response_id,actual_model_id=p_actual_model_id,response_text=p_response_text,
  error_code=left(p_error_code,80),latency_ms=p_latency_ms,finished_at=clock_timestamp() where id=p_id;
 return true;
end; $$;
revoke all on function public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ai_settle_whatsapp_attempt(uuid,uuid,text,numeric,numeric,jsonb,text,text,text,text,text,integer) to service_role;

-- Administrative callers retain their signature, owner/session checks and lifetime
-- singleton. The previously unused owner-session company_live branch stays disabled;
-- worker company_live authorization is exclusively the original-job RPC above.
create or replace function public.ai_reserve_attempt(p_id uuid,p_execution_id uuid,p_attempt integer,p_company_id uuid,
 p_actor_id uuid,p_session_id uuid,p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,
 p_pricing_snapshot jsonb,p_usage_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare budget public.ai_budget_accounts%rowtype;
begin
 if p_usage_mode is distinct from 'admin_test' then return jsonb_build_object('ok',false,'code','LIVE_AI_DISABLED'); end if;
 if p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000 or p_attempt not between 1 and 3
 then raise exception 'INVALID_RESERVATION'; end if;
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and role='owner' and status='active')
 then raise exception 'OWNER_REQUIRED'; end if;
 if not exists(select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
  where a.user_id=p_actor_id and a.session_id=p_session_id and a.expired_at is null
  and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours')
 then raise exception 'APP_SESSION_EXPIRED'; end if;
 if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended') then raise exception 'COMPANY_UNAVAILABLE'; end if;
 select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
 if not found or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
 if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_execution_id and attempt=p_attempt))
 then return jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST'); end if;
 if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000)
 then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
 insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,
  usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot)
 values(p_id,budget.id,p_company_id,p_actor_id,p_session_id,p_execution_id,p_attempt,p_usage_mode,p_model_id,p_provider,
  p_reserved_baisa,p_pricing_version,p_pricing_snapshot);
 update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
 return jsonb_build_object('ok',true,'id',p_id,'remaining_baisa',budget.limit_baisa-budget.spent_baisa-budget.held_baisa-p_reserved_baisa);
end; $$;
revoke all on function public.ai_reserve_attempt(uuid,uuid,integer,uuid,uuid,uuid,text,text,numeric,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_reserve_attempt(uuid,uuid,integer,uuid,uuid,uuid,text,text,numeric,text,jsonb,text) to service_role;

create or replace function public.ai_start_attempt(p_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype;
begin
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.status<>'reserved' or entry.usage_mode<>'admin_test' or entry.worker_job_id is not null then return false; end if;
 if not exists(select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
  where a.user_id=entry.actor_user_id and a.session_id=entry.actor_session_id and a.expired_at is null
  and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours') then return false; end if;
 if not exists(select 1 from public.platform_admins where user_id=entry.actor_user_id and role='owner' and status='active') then return false; end if;
 if not exists(select 1 from public.companies where id=entry.company_id and status<>'suspended') then return false; end if;
 if not exists(select 1 from public.ai_budget_accounts where id=entry.budget_account_id and enabled) then return false; end if;
 update public.ai_usage_ledger set status='running' where id=p_id and status='reserved';
 return found;
end; $$;
revoke all on function public.ai_start_attempt(uuid) from public,anon,authenticated;
grant execute on function public.ai_start_attempt(uuid) to service_role;

-- Preserve the administrative RPC argument/result contract while retaining all counters.
-- The owner-session RPC cannot be used to settle a worker-bound attempt.
create or replace function public.ai_settle_attempt(p_id uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_request_id text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype; budget_id uuid; u jsonb;
begin
 if p_status is null or p_status not in ('success','rejected','incomplete','uncertain')
   or p_latency_ms is null or p_latency_ms<0 then raise exception 'INVALID_SETTLEMENT'; end if;
 u:=private.ai_validated_usage(p_usage,p_status,false);
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found then raise exception 'RESERVATION_MISSING'; end if;
 if entry.worker_job_id is not null then raise exception 'WORKER_CLAIM_REQUIRED'; end if;
 budget_id:=entry.budget_account_id;
 perform 1 from public.ai_budget_accounts where id=budget_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if entry.status not in ('reserved','running') then return false; end if;
 if p_status<>'uncertain' and (p_cost_baisa is null or p_cost_usd is null)
   or p_cost_baisa<0 or p_cost_usd<0
   or p_cost_baisa::text in ('NaN','Infinity','-Infinity') or p_cost_usd::text in ('NaN','Infinity','-Infinity')
 then raise exception 'INVALID_COST'; end if;
 if p_status='rejected' and (p_cost_baisa<>0 or p_cost_usd<>0) then raise exception 'INVALID_REJECTION_COST'; end if;
 if p_status<>'uncertain' then
  update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
   enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa where id=budget_id;
 end if;
 update public.ai_usage_ledger set status=p_status,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
  prompt_tokens=(u->>'promptTokens')::integer,completion_tokens=(u->>'completionTokens')::integer,
  cached_tokens=(u->>'cachedTokens')::integer,reasoning_tokens=(u->>'reasoningTokens')::integer,
  cache_write_tokens=(u->>'cacheWriteTokens')::integer,total_tokens=(u->>'totalTokens')::integer,
  request_id=p_request_id,error_code=left(p_error_code,80),latency_ms=p_latency_ms,finished_at=clock_timestamp() where id=p_id;
 return true;
end; $$;
revoke all on function public.ai_settle_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer) from public,anon,authenticated;
grant execute on function public.ai_settle_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer) to service_role;

-- Evidence-only reconciliation retains the new counters too. It never manufactures
-- a usable response draft or permits automatic provider execution.
create or replace function public.ai_reconcile_attempt(p_id uuid,p_cost_usd numeric,p_cost_baisa numeric,
 p_usage jsonb,p_provider_reference text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype; budget_id uuid; u jsonb; outcome text;
begin
 if p_cost_usd is null or p_cost_baisa is null or p_cost_usd<0 or p_cost_baisa<0
  or p_cost_usd::text in ('NaN','Infinity','-Infinity') or p_cost_baisa::text in ('NaN','Infinity','-Infinity')
  or length(trim(coalesce(p_provider_reference,'')))<5 then raise exception 'RECONCILIATION_EVIDENCE_REQUIRED'; end if;
 outcome:=case when p_cost_baisa=0 then 'rejected' else 'incomplete' end;
 u:=private.ai_validated_usage(p_usage,outcome,false);
 select budget_account_id into budget_id from public.ai_usage_ledger where id=p_id;
 if not found then raise exception 'RESERVATION_MISSING'; end if;
 perform 1 from public.ai_budget_accounts where id=budget_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if entry.reconciled_at is not null or entry.status not in ('uncertain','reserved','running') then return false; end if;
 if entry.status in ('reserved','running') and entry.created_at>clock_timestamp()-interval '5 minutes'
 then raise exception 'REQUEST_STILL_IN_FLIGHT'; end if;
 update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
  enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa where id=budget_id;
 update public.ai_usage_ledger set status=outcome,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
  prompt_tokens=(u->>'promptTokens')::integer,completion_tokens=(u->>'completionTokens')::integer,
  cached_tokens=(u->>'cachedTokens')::integer,reasoning_tokens=(u->>'reasoningTokens')::integer,
  cache_write_tokens=(u->>'cacheWriteTokens')::integer,total_tokens=(u->>'totalTokens')::integer,
  reconciled_at=clock_timestamp(),reconciliation_evidence=left(p_provider_reference,200),finished_at=clock_timestamp()
 where id=p_id;
 return true;
end; $$;
revoke all on function public.ai_reconcile_attempt(uuid,numeric,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_reconcile_attempt(uuid,numeric,numeric,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
