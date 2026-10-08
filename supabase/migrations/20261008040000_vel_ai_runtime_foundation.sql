-- Real execution foundation. Browser roles cannot reserve, settle, or raise budgets.
grant usage on schema private to service_role;
grant select on private.app_session_activity,auth.sessions to service_role;
create table public.ai_budget_accounts (
 id uuid primary key default gen_random_uuid(),
 scope text not null check(scope in ('admin_test','company_live')),
 company_id uuid references public.companies(id),
 limit_baisa numeric(18,6) not null check(limit_baisa>=0),
 spent_baisa numeric(18,6) not null default 0 check(spent_baisa>=0),
 held_baisa numeric(18,6) not null default 0 check(held_baisa>=0),
 enabled boolean not null default false,
 period_start date not null default date_trunc('month',now())::date,
 created_at timestamptz not null default now(),
 check((scope='admin_test' and company_id is null) or (scope='company_live' and company_id is not null))
);
create unique index ai_budget_admin_singleton on public.ai_budget_accounts(scope) where scope='admin_test';
create unique index ai_budget_company_unique on public.ai_budget_accounts(company_id,period_start) where scope='company_live';
insert into public.ai_budget_accounts(scope,limit_baisa,enabled) values('admin_test',1000,true);

create table public.ai_usage_ledger (
 id uuid primary key,
 budget_account_id uuid not null references public.ai_budget_accounts(id),
 company_id uuid not null references public.companies(id),
 actor_user_id uuid not null references auth.users(id),
 actor_session_id uuid not null,
 execution_id uuid not null,
 attempt integer not null check(attempt between 1 and 3),
 usage_mode text not null check(usage_mode in ('admin_test','company_live')),
 model_id text not null check(model_id in ('gpt-6-luna','gpt-6.1-sol','gemini-3.8-flash')),
 provider text not null check(provider in ('openai','google')),
 status text not null default 'reserved' check(status in ('reserved','running','success','rejected','incomplete','uncertain')),
 reserved_baisa numeric(18,6) not null check(reserved_baisa>0),
 cost_baisa numeric(18,6),cost_usd numeric(18,10),
 prompt_tokens integer,completion_tokens integer,cached_tokens integer,reasoning_tokens integer,
 request_id text,pricing_version text not null,pricing_snapshot jsonb not null,
 error_code text,latency_ms integer,
 created_at timestamptz not null default now(),finished_at timestamptz,
 unique(execution_id,attempt)
);
create index ai_usage_company_created on public.ai_usage_ledger(company_id,created_at desc);
alter table public.ai_budget_accounts enable row level security;
alter table public.ai_usage_ledger enable row level security;
revoke all on public.ai_budget_accounts,public.ai_usage_ledger from public,anon,authenticated;
grant select on public.ai_budget_accounts,public.ai_usage_ledger to authenticated;
grant all on public.ai_budget_accounts,public.ai_usage_ledger to service_role;
create policy ai_budget_read on public.ai_budget_accounts for select to authenticated using (
 public.is_platform_owner() or (scope='company_live' and exists(select 1 from public.company_members m where m.company_id=ai_budget_accounts.company_id and m.user_id=auth.uid() and m.status='active' and m.role='owner'))
);
create policy ai_usage_read on public.ai_usage_ledger for select to authenticated using (
 public.is_platform_owner() or (usage_mode='company_live' and exists(select 1 from public.company_members m where m.company_id=ai_usage_ledger.company_id and m.user_id=auth.uid() and m.status='active' and m.role='owner'))
);
create policy velora_active_session on public.ai_budget_accounts as restrictive for all to authenticated using(public.app_session_is_valid()) with check(public.app_session_is_valid());
create policy velora_active_session on public.ai_usage_ledger as restrictive for all to authenticated using(public.app_session_is_valid()) with check(public.app_session_is_valid());

create function public.ai_reserve_attempt(p_id uuid,p_execution_id uuid,p_attempt integer,p_company_id uuid,p_actor_id uuid,p_session_id uuid,p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_usage_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare budget public.ai_budget_accounts%rowtype;
begin
 if p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000 or p_attempt not between 1 and 3 then raise exception 'INVALID_RESERVATION';end if;
 if p_usage_mode='admin_test' then
  if not exists(select 1 from public.platform_admins where user_id=p_actor_id and role='owner' and status='active') then raise exception 'OWNER_REQUIRED';end if;
 elsif p_usage_mode='company_live' then
  if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=p_actor_id and role='owner' and status='active') then raise exception 'COMPANY_OWNER_REQUIRED';end if;
 else raise exception 'INVALID_USAGE_MODE';end if;
 if not exists(select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id where a.user_id=p_actor_id and a.session_id=p_session_id and a.expired_at is null and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours') then raise exception 'APP_SESSION_EXPIRED';end if;
 if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended') then raise exception 'COMPANY_UNAVAILABLE';end if;
 select * into budget from public.ai_budget_accounts where scope=p_usage_mode and (
  (p_usage_mode='admin_test' and company_id is null) or
  (p_usage_mode='company_live' and company_id=p_company_id and period_start=date_trunc('month',clock_timestamp())::date)
 ) for update;
 if not found or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED');end if;
 if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_execution_id and attempt=p_attempt)) then return jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST');end if;
 if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>budget.limit_baisa then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED');end if;
 insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot)
 values(p_id,budget.id,p_company_id,p_actor_id,p_session_id,p_execution_id,p_attempt,p_usage_mode,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot);
 update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
 return jsonb_build_object('ok',true,'id',p_id,'remaining_baisa',budget.limit_baisa-budget.spent_baisa-budget.held_baisa-p_reserved_baisa);
end;$$;
revoke all on function public.ai_reserve_attempt(uuid,uuid,integer,uuid,uuid,uuid,text,text,numeric,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_reserve_attempt(uuid,uuid,integer,uuid,uuid,uuid,text,text,numeric,text,jsonb,text) to service_role;

create function public.ai_start_attempt(p_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype;
begin
 select * into entry from public.ai_usage_ledger where id=p_id;
 if not found or entry.status<>'reserved' then return false;end if;
 if not exists(select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id where a.user_id=entry.actor_user_id and a.session_id=entry.actor_session_id and a.expired_at is null and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours') then return false;end if;
 if entry.usage_mode='admin_test' and not exists(select 1 from public.platform_admins where user_id=entry.actor_user_id and role='owner' and status='active') then return false;end if;
 if entry.usage_mode='company_live' and not exists(select 1 from public.company_members where company_id=entry.company_id and user_id=entry.actor_user_id and role='owner' and status='active') then return false;end if;
 if not exists(select 1 from public.companies where id=entry.company_id and status<>'suspended') then return false;end if;
 if not exists(select 1 from public.ai_budget_accounts where id=entry.budget_account_id and enabled) then return false;end if;
 update public.ai_usage_ledger set status='running' where id=p_id and status='reserved';
 return found;
end;$$;
revoke all on function public.ai_start_attempt(uuid) from public,anon,authenticated;
grant execute on function public.ai_start_attempt(uuid) to service_role;

create function public.ai_settle_attempt(p_id uuid,p_status text,p_cost_usd numeric,p_cost_baisa numeric,p_usage jsonb,p_request_id text,p_error_code text,p_latency_ms integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype;budget_id uuid;
begin
 if p_status not in ('success','rejected','incomplete','uncertain') then raise exception 'INVALID_STATUS';end if;
 select budget_account_id into budget_id from public.ai_usage_ledger where id=p_id;
 if not found then raise exception 'RESERVATION_MISSING';end if;
 -- Same lock order as reservation; serialize settlement against other reservations.
 perform 1 from public.ai_budget_accounts where id=budget_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if entry.status not in ('reserved','running') then return false;end if;
 if p_status<>'uncertain' and (p_cost_baisa is null or p_cost_usd is null or p_cost_baisa<0 or p_cost_usd<0) then raise exception 'INVALID_COST';end if;
 if p_status='rejected' and (p_cost_baisa<>0 or p_cost_usd<>0) then raise exception 'INVALID_REJECTION_COST';end if;
 if p_status<>'uncertain' then
  update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
   enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa where id=budget_id;
 end if;
 update public.ai_usage_ledger set status=p_status,cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
 prompt_tokens=(p_usage->>'promptTokens')::integer,completion_tokens=(p_usage->>'completionTokens')::integer,
 cached_tokens=(p_usage->>'cachedTokens')::integer,reasoning_tokens=(p_usage->>'reasoningTokens')::integer,
 request_id=p_request_id,error_code=left(p_error_code,80),latency_ms=p_latency_ms,finished_at=clock_timestamp() where id=p_id;
 return true;
end;$$;
revoke all on function public.ai_settle_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer) from public,anon,authenticated;
grant execute on function public.ai_settle_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer) to service_role;
alter table public.ai_usage_ledger add column reconciled_at timestamptz,add column reconciliation_evidence text;
-- Explicit server/operator reconciliation after consulting provider usage. No
-- timeout releases funds automatically and browser roles cannot invoke this.
create function public.ai_reconcile_attempt(p_id uuid,p_cost_usd numeric,p_cost_baisa numeric,p_usage jsonb,p_provider_reference text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.ai_usage_ledger%rowtype;budget_id uuid;
begin
 if p_cost_usd is null or p_cost_baisa is null or p_cost_usd<0 or p_cost_baisa<0 or length(trim(coalesce(p_provider_reference,'')))<5 then raise exception 'RECONCILIATION_EVIDENCE_REQUIRED';end if;
 select budget_account_id into budget_id from public.ai_usage_ledger where id=p_id;
 if not found then raise exception 'RESERVATION_MISSING';end if;
 perform 1 from public.ai_budget_accounts where id=budget_id for update;
 select * into entry from public.ai_usage_ledger where id=p_id for update;
 if entry.reconciled_at is not null or entry.status not in ('uncertain','reserved','running') then return false;end if;
 if entry.status in ('reserved','running') and entry.created_at>clock_timestamp()-interval '5 minutes' then raise exception 'REQUEST_STILL_IN_FLIGHT';end if;
 update public.ai_budget_accounts set held_baisa=held_baisa-entry.reserved_baisa,spent_baisa=spent_baisa+p_cost_baisa,
 enabled=enabled and spent_baisa+p_cost_baisa<=limit_baisa and p_cost_baisa<=entry.reserved_baisa where id=budget_id;
 update public.ai_usage_ledger set cost_usd=p_cost_usd,cost_baisa=p_cost_baisa,
 prompt_tokens=(p_usage->>'promptTokens')::integer,completion_tokens=(p_usage->>'completionTokens')::integer,
 cached_tokens=(p_usage->>'cachedTokens')::integer,reasoning_tokens=(p_usage->>'reasoningTokens')::integer,
 status=case when p_cost_baisa=0 then 'rejected' else 'incomplete' end,
 reconciled_at=clock_timestamp(),reconciliation_evidence=left(p_provider_reference,200),finished_at=clock_timestamp() where id=p_id;
 return true;
end;$$;
revoke all on function public.ai_reconcile_attempt(uuid,numeric,numeric,jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_reconcile_attempt(uuid,numeric,numeric,jsonb,text) to service_role;
create function public.ai_admin_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'budget',(select to_jsonb(b) from public.ai_budget_accounts b where scope='admin_test'),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',display_name,'status',status) order by display_name) from public.companies),'[]'::jsonb),
 'models',coalesce((select jsonb_agg(to_jsonb(m)) from (select model_id,count(*) as attempts,count(*) filter(where status='success') as succeeded,coalesce(sum(cost_baisa),0) as cost_baisa from public.ai_usage_ledger where usage_mode='admin_test' group by model_id) m),'[]'::jsonb),
 'recent',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from (select id,company_id,model_id,status,cost_baisa,cost_usd,reserved_baisa,prompt_tokens,completion_tokens,cached_tokens,reasoning_tokens,error_code,request_id,latency_ms,created_at from public.ai_usage_ledger where usage_mode='admin_test' order by created_at desc limit 30) r),'[]'::jsonb)
 );
$$;
revoke all on function public.ai_admin_snapshot() from public,anon,authenticated;
grant execute on function public.ai_admin_snapshot() to service_role;
notify pgrst,'reload schema';
