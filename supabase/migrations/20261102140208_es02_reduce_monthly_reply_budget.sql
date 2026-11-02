-- Permit only a relation owner to lower a disabled native paid budget.
-- Holds and settled spend are retained; re-enablement remains a separate action.
begin;
create or replace function private.es02_live_cost_policy_guard() returns trigger
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
  (row(new.ai_cost_order_id,new.ai_cost_subscription_id) is distinct from row(old.ai_cost_order_id,old.ai_cost_subscription_id)
   or new.ai_cost_monthly_limit_baisa is null or new.ai_cost_monthly_limit_baisa > old.ai_cost_monthly_limit_baisa
   or (new.ai_cost_monthly_limit_baisa < old.ai_cost_monthly_limit_baisa and (old.ai_cost_enabled or new.ai_cost_enabled)))
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

create or replace function private.ai_budget_account_binding() returns trigger
language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and (old.scope='company_live' or new.scope='company_live') then
  if row(new.id,new.scope,new.company_id,new.period_start,new.subscription_id,new.plan_version_id,new.created_at)
   is distinct from row(old.id,old.scope,old.company_id,old.period_start,old.subscription_id,old.plan_version_id,old.created_at)
  then raise exception 'AI_BUDGET_BINDING_IMMUTABLE' using errcode='23514';end if;
  if new.limit_baisa is distinct from old.limit_baisa and not (
   current_user=pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid=tg_relid))
   and not old.enabled and not new.enabled and new.limit_baisa>0 and new.limit_baisa<old.limit_baisa
   and new.spent_baisa is not distinct from old.spent_baisa and new.held_baisa is not distinct from old.held_baisa
   and new.limit_baisa>=coalesce(old.spent_baisa,0)+coalesce(old.held_baisa,0)
   and exists(select 1 from private.es02_activation_foundation a where a.company_id=new.company_id
    and a.ai_cost_subscription_id=new.subscription_id and not a.ai_cost_enabled
    and a.ai_cost_monthly_limit_baisa=new.limit_baisa and new.plan_version_id is null))
  then raise exception 'AI_BUDGET_BINDING_IMMUTABLE' using errcode='23514';end if;
 end if;
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

commit;
