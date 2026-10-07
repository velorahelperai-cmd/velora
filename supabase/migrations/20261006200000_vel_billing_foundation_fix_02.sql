-- VEL-BILLING-FOUNDATION-FIX-02 (incremental)
-- Applies only when FIX-01 schema (global provider_transaction_id unique) is present.
-- Fresh installs: 20261006180000 already includes FIX-02 — this migration no-ops the DDL block.

create or replace function private.billing_plan_versions_immutability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('published', 'retired') then
      if new.status = 'draft' then
        perform private.billing_reject_immutable_change(
          'billing_plan_versions cannot revert to draft after publish; create a new version instead'
        );
      end if;
      if new.plan_id is distinct from old.plan_id
        or new.version is distinct from old.version
        or new.currency is distinct from old.currency
        or new.amount_baisa is distinct from old.amount_baisa
        or new.period_days is distinct from old.period_days
        or new.limits is distinct from old.limits
      then
        perform private.billing_reject_immutable_change(
          'billing_plan_versions financial fields are immutable after publish/retire'
        );
      end if;
      if old.status = 'retired' and new.status is distinct from old.status then
        perform private.billing_reject_immutable_change(
          'billing_plan_versions retired versions cannot change status'
        );
      end if;
      if old.status = 'published' and new.status is distinct from old.status then
        if new.status <> 'retired' then
          perform private.billing_reject_immutable_change(
            'billing_plan_versions published may only archive to retired'
          );
        end if;
      end if;
    elsif old.status = 'draft' then
      if new.status = 'retired' then
        perform private.billing_reject_immutable_change(
          'billing_plan_versions draft must publish before retire'
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'billing_entitlement_applications_txn_scope_uidx'
  ) then
    raise notice 'FIX-02 entitlement scope already present; skipping incremental DDL';
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_entitlement_applications_txn_uidx'
  ) then
    raise notice 'FIX-02 incremental: neither old nor new txn constraint found; skipping entitlement DDL';
    return;
  end if;

  alter table public.billing_entitlement_applications
    drop constraint if exists billing_entitlement_applications_event_link_fkey;

  alter table public.billing_provider_events
    drop constraint if exists billing_provider_events_grant_link_uidx;

  alter table public.billing_entitlement_applications
    add column if not exists provider text not null default 'paymob';

  alter table public.billing_entitlement_applications
    add column if not exists provider_account_ref text;

  alter table public.billing_entitlement_applications
    add column if not exists provider_environment text;

  update public.billing_entitlement_applications g
  set
    provider = o.provider,
    provider_account_ref = o.provider_account_ref,
    provider_environment = o.provider_environment
  from public.billing_orders o
  where g.order_id = o.id
    and (g.provider_account_ref is null or g.provider_environment is null);

  alter table public.billing_entitlement_applications
    alter column provider_account_ref set not null;

  alter table public.billing_entitlement_applications
    alter column provider_environment set not null;

  alter table public.billing_entitlement_applications
    drop constraint billing_entitlement_applications_txn_uidx;

  alter table public.billing_provider_events
    add constraint billing_provider_events_grant_link_uidx unique (
      id,
      company_id,
      provider,
      provider_account_ref,
      provider_environment,
      provider_transaction_id
    );

  alter table public.billing_entitlement_applications
    add constraint billing_entitlement_applications_txn_scope_uidx unique (
      provider,
      provider_account_ref,
      provider_environment,
      provider_transaction_id
    );

  alter table public.billing_entitlement_applications
    add constraint billing_entitlement_applications_event_link_fkey
    foreign key (
      provider_event_id,
      company_id,
      provider,
      provider_account_ref,
      provider_environment,
      provider_transaction_id
    )
    references public.billing_provider_events (
      id,
      company_id,
      provider,
      provider_account_ref,
      provider_environment,
      provider_transaction_id
    )
    on delete restrict;
end;
$$;

create or replace function private.billing_entitlement_applications_company_guard()
returns trigger
language plpgsql
as $$
declare
  attempt_order uuid;
  attempt_company uuid;
  sub_company uuid;
  ord_provider text;
  ord_account text;
  ord_env text;
begin
  select a.order_id, a.company_id into attempt_order, attempt_company
  from public.billing_payment_attempts a
  where a.id = new.payment_attempt_id;

  if attempt_order is null then
    raise exception 'billing_entitlement_applications: payment_attempt not found'
      using errcode = 'foreign_key_violation';
  end if;

  if new.order_id is distinct from attempt_order then
    raise exception 'billing_entitlement_applications: order_id must match payment_attempt.order_id'
      using errcode = 'integrity_constraint_violation';
  end if;

  if new.company_id is distinct from attempt_company then
    raise exception 'billing_entitlement_applications: company_id must match payment_attempt.company_id'
      using errcode = 'integrity_constraint_violation';
  end if;

  select s.company_id into sub_company
  from public.billing_subscriptions s
  where s.id = new.subscription_id;

  if sub_company is distinct from new.company_id then
    raise exception 'billing_entitlement_applications: subscription company mismatch'
      using errcode = 'integrity_constraint_violation';
  end if;

  select o.provider, o.provider_account_ref, o.provider_environment
  into ord_provider, ord_account, ord_env
  from public.billing_orders o
  where o.id = new.order_id;

  if ord_provider is null then
    raise exception 'billing_entitlement_applications: order not found'
      using errcode = 'foreign_key_violation';
  end if;

  new.provider := ord_provider;
  new.provider_account_ref := ord_account;
  new.provider_environment := ord_env;

  if new.provider_event_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.billing_provider_events e
    where e.id = new.provider_event_id
      and e.company_id = new.company_id
      and e.provider = new.provider
      and e.provider_account_ref = new.provider_account_ref
      and e.provider_environment = new.provider_environment
      and e.provider_transaction_id = new.provider_transaction_id
  ) then
    raise exception 'billing_entitlement_applications: provider_event scope mismatch'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;
