-- Candidate only: bind the existing internal cost ledger to the native paid
-- reply entitlement. Customer-facing capacity remains counted in replies.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';

-- Keep this policy on the existing account-deletion-scoped native record.
alter table private.es02_activation_foundation
 add column ai_cost_order_id uuid references private.es02_account_orders(id),
 add column ai_cost_subscription_id uuid references public.billing_subscriptions(id),
 add column ai_cost_monthly_limit_baisa numeric(18,6) check(ai_cost_monthly_limit_baisa>0),
 add column ai_cost_enabled boolean not null default false,
 add constraint es02_ai_cost_policy_complete check (
  (ai_cost_order_id is null and ai_cost_subscription_id is null and ai_cost_monthly_limit_baisa is null and not ai_cost_enabled)
  or (ai_cost_order_id is not null and ai_cost_subscription_id is not null and ai_cost_monthly_limit_baisa is not null));

create function private.es02_live_cost_policy_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.ai_cost_order_id is not null or new.ai_cost_subscription_id is not null
   or new.ai_cost_monthly_limit_baisa is not null or new.ai_cost_enabled then
   raise exception 'ES02_COST_POLICY_REQUIRES_OWNER' using errcode='42501';end if;
  return new;
 end if;
 if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=tg_relid) then
  raise exception 'ES02_COST_POLICY_REQUIRES_OWNER' using errcode='42501';end if;
 if old.ai_cost_monthly_limit_baisa is not null and
  row(new.ai_cost_order_id,new.ai_cost_subscription_id,new.ai_cost_monthly_limit_baisa)
  is distinct from row(old.ai_cost_order_id,old.ai_cost_subscription_id,old.ai_cost_monthly_limit_baisa)
 then raise exception 'ES02_COST_POLICY_IMMUTABLE' using errcode='23514';end if;
 if new.ai_cost_monthly_limit_baisa is not null and (new.ai_cost_order_id is distinct from new.order_id
  or not exists(select 1 from public.billing_subscriptions s where s.id=new.ai_cost_subscription_id
   and s.company_id=new.company_id and s.environment='live' and s.plan_version_id is null)) then
  raise exception 'ES02_COST_POLICY_BINDING_INVALID' using errcode='23514';end if;
 if old.ai_cost_enabled and not new.ai_cost_enabled then
  update public.ai_budget_accounts set enabled=false where scope='company_live' and company_id=old.company_id
   and subscription_id=old.ai_cost_subscription_id and period_start=private.ai_budget_period(clock_timestamp());
 end if;
 return new;
end;$$;
revoke all on function private.es02_live_cost_policy_guard() from public,anon,authenticated,service_role;
create trigger es02_live_cost_policy_guard before insert or update of ai_cost_order_id,ai_cost_subscription_id,ai_cost_monthly_limit_baisa,ai_cost_enabled on private.es02_activation_foundation
 for each row execute function private.es02_live_cost_policy_guard();

create or replace function private.ai_budget_account_binding() returns trigger
language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and row(new.id,new.scope,new.company_id,new.period_start,new.subscription_id,new.plan_version_id,new.limit_baisa,new.created_at)
 is distinct from row(old.id,old.scope,old.company_id,old.period_start,old.subscription_id,old.plan_version_id,old.limit_baisa,old.created_at)
 and (old.scope='company_live' or new.scope='company_live') then raise exception 'AI_BUDGET_BINDING_IMMUTABLE' using errcode='23514';end if;
 if TG_OP='INSERT' and new.scope='company_live' then
  if not exists(select 1 from public.billing_subscriptions s join private.ai_plan_budget_policies p on p.plan_version_id=s.plan_version_id
    where s.id=new.subscription_id and s.company_id=new.company_id and s.plan_version_id=new.plan_version_id and s.environment='live'
    and new.limit_baisa=p.monthly_limit_baisa and new.period_start=private.ai_budget_period(clock_timestamp()))
   and not exists(select 1 from private.es02_activation_foundation a
    join public.billing_subscriptions s on s.id=a.ai_cost_subscription_id and s.company_id=a.company_id and s.environment='live' and s.plan_version_id is null
    where a.company_id=new.company_id and a.ai_cost_order_id=a.order_id and a.ai_cost_subscription_id=new.subscription_id and a.ai_cost_enabled
      and new.plan_version_id is null and new.limit_baisa=a.ai_cost_monthly_limit_baisa
      and new.period_start=private.ai_budget_period(clock_timestamp()))
  then raise exception 'AI_BUDGET_BINDING_REQUIRED' using errcode='23514';end if;
 end if;
 return new;
end;$$;

alter function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) set schema private;
alter function private.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) rename to es02_reserve_whatsapp_capacity_cost_before_budget_bridge;
revoke all on function private.es02_reserve_whatsapp_capacity_cost_before_budget_bridge(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) from public,anon,authenticated,service_role;

-- Existing reservation/start use UTC month while the financial account uses
-- Muscat month. Preserve both actual function bodies except that expression.
do $month$
declare sig text; body text; old_expr text:='date_trunc(''month'',clock_timestamp())::date'; new_expr text:='private.ai_budget_period(clock_timestamp())';
begin
 foreach sig in array array[
  'private.es02_reserve_whatsapp_capacity_cost_before_budget_bridge(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)',
  'private.es02_start_whatsapp_attempt(uuid,uuid)'
 ] loop
  select pg_get_functiondef(sig::regprocedure) into body;
  if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'ES02_BUDGET_MONTH_SOURCE_DRIFT:%',sig;end if;
  execute replace(body,old_expr,new_expr);
 end loop;
end;$month$;

create function public.es02_reserve_whatsapp_capacity_cost_attempt(
 p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,p_model_id text,p_provider text,p_reserved_baisa numeric,
 p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,p_expected_persona text,
 p_expected_order_id uuid,p_expected_branch_id uuid,p_expected_slot_index integer,p_expected_paid_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb; policy private.es02_activation_foundation; existing public.ai_budget_accounts;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 gate:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 if gate->>'order_id' is distinct from p_expected_order_id::text or gate->>'branch_id' is distinct from p_expected_branch_id::text
  or gate->>'slot_index' is distinct from p_expected_slot_index::text or gate->>'paid_fingerprint' is distinct from p_expected_paid_fingerprint
  or gate->>'persona' is distinct from p_expected_persona then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 select * into policy from private.es02_activation_foundation where company_id=(gate->>'company_id')::uuid for share;
 if found and policy.ai_cost_monthly_limit_baisa is not null then
  if not policy.ai_cost_enabled or policy.ai_cost_order_id is distinct from p_expected_order_id
    or policy.ai_cost_subscription_id is distinct from (gate->>'subscription_id')::uuid then
   return jsonb_build_object('ok',false,'code','BUDGET_DISABLED');end if;
  insert into public.ai_budget_accounts(scope,company_id,subscription_id,plan_version_id,limit_baisa,enabled,period_start)
   values('company_live',policy.company_id,policy.ai_cost_subscription_id,null,policy.ai_cost_monthly_limit_baisa,true,private.ai_budget_period(clock_timestamp()))
   on conflict (company_id,period_start) where scope='company_live' do nothing;
  select * into existing from public.ai_budget_accounts where scope='company_live' and company_id=policy.company_id
   and period_start=private.ai_budget_period(clock_timestamp()) for update;
  if existing.subscription_id is distinct from policy.ai_cost_subscription_id or existing.plan_version_id is not null
    or existing.limit_baisa is distinct from policy.ai_cost_monthly_limit_baisa or not existing.enabled then
   return jsonb_build_object('ok',false,'code','BUDGET_BINDING_CHANGED');end if;
 end if;
 return private.es02_reserve_whatsapp_capacity_cost_before_budget_bridge(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,
   p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations,p_expected_persona,p_expected_order_id,
   p_expected_branch_id,p_expected_slot_index,p_expected_paid_fingerprint);
end;$$;
revoke all on function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) to service_role;
commit;
