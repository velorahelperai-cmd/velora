-- VEL-BILLING-FOUNDATION-01 (P1 base, FIX-01 hardened schema).
-- Catalog, locked orders, attempts, scoped provider events, subscriptions,
-- one entitlement grant per purchase order. NOT applied to cloud from this file alone.
-- No Paymob keys. No ACCESS/LEADS changes.

-- ---------------------------------------------------------------------------
-- Plans + versions (published financial fields immutable via trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_code_chk check (
    char_length(btrim(code)) between 1 and 64
    and code = btrim(code)
  ),
  constraint billing_plans_name_chk check (
    char_length(btrim(name)) between 1 and 120
  )
);

create unique index if not exists billing_plans_code_uidx
  on public.billing_plans (code);

create table if not exists public.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans (id) on delete restrict,
  version integer not null check (version >= 1),
  currency text not null default 'OMR' check (currency = 'OMR'),
  -- Commercial catalog unit: Omani baisa (1 OMR = 1000 baisa). NOT Paymob "cents".
  amount_baisa bigint not null check (amount_baisa >= 0),
  period_days integer not null check (period_days >= 1),
  limits jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  created_at timestamptz not null default now(),
  constraint billing_plan_versions_plan_version_uidx unique (plan_id, version)
);

comment on column public.billing_plan_versions.amount_baisa is
  'Commercial amount in Omani baisa. Do not treat as Paymob amount/cents; conversion unconfigured until Paymob Oman docs confirm the factor.';

-- ---------------------------------------------------------------------------
-- Locked orders: company_id + client_op_id identifies one business operation
-- ---------------------------------------------------------------------------
create table if not exists public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  plan_version_id uuid not null references public.billing_plan_versions (id) on delete restrict,
  amount_baisa bigint not null check (amount_baisa >= 0),
  currency text not null default 'OMR' check (currency = 'OMR'),
  period_days integer not null check (period_days >= 1),
  provider text not null default 'paymob' check (provider = 'paymob'),
  provider_account_ref text not null
    check (char_length(btrim(provider_account_ref)) between 1 and 128),
  provider_environment text not null check (provider_environment in ('test', 'live')),
  provider_amount bigint,
  provider_amount_unit text
    check (provider_amount_unit is null or provider_amount_unit in ('unconfigured', 'paymob_amount')),
  special_reference text not null,
  client_op_id text not null
    check (char_length(btrim(client_op_id)) between 1 and 128),
  input_fingerprint text not null
    check (char_length(btrim(input_fingerprint)) between 1 and 128),
  status text not null default 'locked'
    check (status in ('locked', 'submitted', 'closed', 'cancelled')),
  locked_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint billing_orders_special_reference_uidx unique (special_reference),
  constraint billing_orders_provider_amount_pair_chk check (
    (provider_amount is null and provider_amount_unit is null)
    or (provider_amount is not null and provider_amount_unit is not null)
  ),
  constraint billing_orders_id_company_uidx unique (id, company_id)
);

-- One business operation per (company, client_op_id). Different fingerprint = conflict.
create unique index if not exists billing_orders_company_client_op_uidx
  on public.billing_orders (company_id, client_op_id);

create index if not exists billing_orders_company_created_idx
  on public.billing_orders (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Payment attempts (company denormalized; composite FK to order)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  company_id uuid not null references public.companies (id) on delete restrict,
  status text not null default 'intent_created'
    check (status in (
      'intent_created',
      'provider_submitted',
      'paid',
      'failed',
      'unresolved'
    )),
  provider_intention_id text,
  provider_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payment_attempts_order_company_fkey
    foreign key (order_id, company_id)
    references public.billing_orders (id, company_id)
    on delete restrict,
  constraint billing_payment_attempts_id_company_uidx unique (id, company_id)
);

create index if not exists billing_payment_attempts_order_idx
  on public.billing_payment_attempts (order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Provider events: scoped by provider + account + environment + transaction
-- Exact duplicate observation rejected; distinct same-status observations allowed.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid,
  provider text not null default 'paymob' check (provider = 'paymob'),
  provider_account_ref text not null
    check (char_length(btrim(provider_account_ref)) between 1 and 128),
  provider_environment text not null check (provider_environment in ('test', 'live')),
  provider_transaction_id text not null
    check (char_length(btrim(provider_transaction_id)) between 1 and 128),
  event_status text not null
    check (event_status in ('pending', 'success', 'failed', 'other')),
  -- Distinguishes relevant observations under the same status (e.g. captured vs refunded notice).
  observation_key text not null default 'default'
    check (char_length(btrim(observation_key)) between 1 and 128),
  company_id uuid not null references public.companies (id) on delete restrict,
  amount_baisa_expected bigint,
  currency_expected text check (currency_expected is null or currency_expected = 'OMR'),
  raw_summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint billing_provider_events_attempt_company_fkey
    foreign key (payment_attempt_id, company_id)
    references public.billing_payment_attempts (id, company_id)
    on delete restrict,
  constraint billing_provider_events_scope_obs_uidx unique (
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id,
    event_status,
    observation_key
  ),
  constraint billing_provider_events_grant_link_uidx unique (
    id,
    company_id,
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id
  )
);

create index if not exists billing_provider_events_attempt_idx
  on public.billing_provider_events (payment_attempt_id, received_at desc);

create index if not exists billing_provider_events_txn_scope_idx
  on public.billing_provider_events (
    provider, provider_account_ref, provider_environment, provider_transaction_id, received_at desc
  );

comment on table public.billing_provider_events is
  'Append-only provider notifications. Transaction identity is scoped by provider/account/environment. pending and success are separate rows; distinct observation_key allows multiple same-status notices without colliding across merchants/envs.';

-- ---------------------------------------------------------------------------
-- Subscriptions (one row per company in v1)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  plan_version_id uuid references public.billing_plan_versions (id) on delete restrict,
  status text not null default 'unprovisioned'
    check (status in (
      'unprovisioned',
      'awaiting_payment',
      'active',
      'cancel_at_period_end',
      'ended',
      'past_due'
    )),
  paid_through timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_company_uidx unique (company_id),
  constraint billing_subscriptions_id_company_uidx unique (id, company_id),
  constraint billing_subscriptions_ended_needs_paid_through_chk check (
    status <> 'ended' or paid_through is not null
  )
);

comment on column public.billing_subscriptions.paid_through is
  'Operational cutover. NULL means never paid — not ended, and no 7-day inbound retention window.';

create index if not exists billing_subscriptions_paid_through_idx
  on public.billing_subscriptions (paid_through)
  where paid_through is not null;

-- ---------------------------------------------------------------------------
-- Entitlement applications: at most ONE grant per purchase order.
-- Multiple successful provider txns for the same order are retained as attempts/events
-- for review; a second grant row is rejected.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_entitlement_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  order_id uuid not null,
  subscription_id uuid not null,
  payment_attempt_id uuid not null,
  provider text not null default 'paymob' check (provider = 'paymob'),
  provider_account_ref text not null
    check (char_length(btrim(provider_account_ref)) between 1 and 128),
  provider_environment text not null check (provider_environment in ('test', 'live')),
  provider_transaction_id text not null
    check (char_length(btrim(provider_transaction_id)) between 1 and 128),
  provider_event_id uuid,
  previous_paid_through timestamptz,
  applied_paid_through timestamptz not null,
  period_days integer not null check (period_days >= 1),
  applied_at timestamptz not null default now(),
  constraint billing_entitlement_applications_sub_company_fkey
    foreign key (subscription_id, company_id)
    references public.billing_subscriptions (id, company_id)
    on delete restrict,
  constraint billing_entitlement_applications_order_company_fkey
    foreign key (order_id, company_id)
    references public.billing_orders (id, company_id)
    on delete restrict,
  constraint billing_entitlement_applications_attempt_company_fkey
    foreign key (payment_attempt_id, company_id)
    references public.billing_payment_attempts (id, company_id)
    on delete restrict,
  constraint billing_entitlement_applications_event_link_fkey
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
    on delete restrict,
  constraint billing_entitlement_applications_txn_scope_uidx unique (
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id
  ),
  constraint billing_entitlement_applications_attempt_uidx unique (payment_attempt_id),
  constraint billing_entitlement_applications_order_uidx unique (order_id)
);

create index if not exists billing_entitlement_applications_sub_idx
  on public.billing_entitlement_applications (subscription_id, applied_at desc);

-- ---------------------------------------------------------------------------
-- Immutability: published plan versions + locked order financial fields (SQL)
-- ---------------------------------------------------------------------------
create or replace function private.billing_reject_immutable_change(p_msg text)
returns void
language plpgsql
as $$
begin
  raise exception '%', p_msg using errcode = 'integrity_constraint_violation';
end;
$$;

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

drop trigger if exists billing_plan_versions_immutability_trg on public.billing_plan_versions;
create trigger billing_plan_versions_immutability_trg
  before update on public.billing_plan_versions
  for each row
  execute function private.billing_plan_versions_immutability();

create or replace function private.billing_orders_immutability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id
      or new.plan_version_id is distinct from old.plan_version_id
      or new.amount_baisa is distinct from old.amount_baisa
      or new.currency is distinct from old.currency
      or new.period_days is distinct from old.period_days
      or new.provider is distinct from old.provider
      or new.provider_account_ref is distinct from old.provider_account_ref
      or new.provider_environment is distinct from old.provider_environment
      or new.provider_amount is distinct from old.provider_amount
      or new.provider_amount_unit is distinct from old.provider_amount_unit
      or new.special_reference is distinct from old.special_reference
      or new.client_op_id is distinct from old.client_op_id
      or new.input_fingerprint is distinct from old.input_fingerprint
      or new.locked_at is distinct from old.locked_at
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      perform private.billing_reject_immutable_change(
        'billing_orders locked financial/identity fields are immutable; only lifecycle status may change'
      );
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'locked' and new.status in ('submitted', 'cancelled', 'closed'))
        or (old.status = 'submitted' and new.status in ('closed', 'cancelled'))
      ) then
        perform private.billing_reject_immutable_change(
          'billing_orders status transition not allowed'
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_orders_immutability_trg on public.billing_orders;
create trigger billing_orders_immutability_trg
  before update on public.billing_orders
  for each row
  execute function private.billing_orders_immutability();

-- Fingerprint conflict messaging: same client_op with different fingerprint is unique_violation
-- on (company_id, client_op_id). Optional trigger for clearer error when fingerprint differs.
create or replace function private.billing_orders_client_op_fingerprint_guard()
returns trigger
language plpgsql
as $$
declare
  existing_fp text;
begin
  if tg_op = 'INSERT' then
    select o.input_fingerprint into existing_fp
    from public.billing_orders o
    where o.company_id = new.company_id
      and o.client_op_id = new.client_op_id
    limit 1;
    if existing_fp is not null and existing_fp is distinct from new.input_fingerprint then
      raise exception 'billing_orders client_op_id fingerprint conflict'
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_orders_client_op_fp_guard_trg on public.billing_orders;
create trigger billing_orders_client_op_fp_guard_trg
  before insert on public.billing_orders
  for each row
  execute function private.billing_orders_client_op_fingerprint_guard();

-- Grant attempt must match order company (defense in depth with composite FK)
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

drop trigger if exists billing_entitlement_applications_company_guard_trg
  on public.billing_entitlement_applications;
create trigger billing_entitlement_applications_company_guard_trg
  before insert or update on public.billing_entitlement_applications
  for each row
  execute function private.billing_entitlement_applications_company_guard();

-- ---------------------------------------------------------------------------
-- RLS fail-closed: no authenticated grants (no ACCESS capability changes)
-- ---------------------------------------------------------------------------
alter table public.billing_plans enable row level security;
alter table public.billing_plan_versions enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_payment_attempts enable row level security;
alter table public.billing_provider_events enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_entitlement_applications enable row level security;

revoke all on table public.billing_plans from anon, authenticated, public;
revoke all on table public.billing_plan_versions from anon, authenticated, public;
revoke all on table public.billing_orders from anon, authenticated, public;
revoke all on table public.billing_payment_attempts from anon, authenticated, public;
revoke all on table public.billing_provider_events from anon, authenticated, public;
revoke all on table public.billing_subscriptions from anon, authenticated, public;
revoke all on table public.billing_entitlement_applications from anon, authenticated, public;
