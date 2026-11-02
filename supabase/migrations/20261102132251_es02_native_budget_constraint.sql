-- The existing verified insert trigger admits a native subscription with no
-- legacy plan only when its locked ES02 policy matches. Keep every previous
-- valid shape and continue rejecting a plan without a subscription.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $guard$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.ai_budget_accounts'::regclass
   and conname='ai_budget_version_binding' and convalidated and md5(pg_get_constraintdef(oid))='2498d731792d9e27dbe59add33d464d8')
  or not exists(select 1 from pg_trigger where tgrelid='public.ai_budget_accounts'::regclass
   and tgname='ai_budget_account_binding' and tgenabled='O' and not tgisinternal
   and tgfoid='private.ai_budget_account_binding()'::regprocedure)
  or to_regclass('public.ai_budget_company_es02_unique') is null
 then raise exception 'ES02_BUDGET_CONSTRAINT_PREREQUISITE_MISMATCH';end if;
end;$guard$;
alter table public.ai_budget_accounts add constraint ai_budget_version_binding_es02 check (
 (scope='admin_test' and subscription_id is null and plan_version_id is null)
 or (scope='company_live' and (plan_version_id is null or subscription_id is not null))
) not valid;
alter table public.ai_budget_accounts validate constraint ai_budget_version_binding_es02;
alter table public.ai_budget_accounts drop constraint ai_budget_version_binding;
alter table public.ai_budget_accounts rename constraint ai_budget_version_binding_es02 to ai_budget_version_binding;
commit;
