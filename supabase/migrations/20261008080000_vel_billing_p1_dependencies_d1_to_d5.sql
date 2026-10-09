-- VEL-BILLING-P1-DEPENDENCIES-D1-TO-D5
-- Comprehensive database resolution for billing launch dependencies:
--   D1: Live settlement contract with authenticated processor evidence
--   D2: Complete Test/Live subscription state isolation
--   D3: Atomic plan publication, expiry validation, and financial snapshot locking
--   D4: Payment lifecycle handling (refunds, voids, reversals, late failure idempotency)
--   D5: Provider-order binding uniqueness and immutability guarantees

-- ---------------------------------------------------------------------------
-- 1. Schema Hardening
-- ---------------------------------------------------------------------------

-- D2: Environment separation on billing_subscriptions
alter table public.billing_subscriptions
  add column if not exists environment text not null default 'live'
    check (environment in ('test', 'live'));

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_company_uidx;

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_company_id_key;

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_status_check;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_status_check
  check (status in ('unprovisioned', 'awaiting_payment', 'active', 'cancel_at_period_end', 'ended', 'past_due', 'suspended'));

create unique index if not exists billing_subscriptions_company_env_uidx
  on public.billing_subscriptions (company_id, environment);

create index if not exists billing_subscriptions_lookup_idx
  on public.billing_subscriptions (company_id, environment, status, paid_through);

-- D3: Order checkout expiration
alter table public.billing_orders
  add column if not exists expires_at timestamptz not null default (now() + interval '2 hours');

create index if not exists billing_orders_expiry_idx
  on public.billing_orders (company_id, status, expires_at);

-- D4: Order status expansion for reversals
alter table public.billing_orders
  drop constraint if exists billing_orders_status_check;

alter table public.billing_orders
  add constraint billing_orders_status_check
  check (status in ('locked', 'submitted', 'closed', 'cancelled', 'refunded', 'voided'));

-- D4: Payment attempt status expansion for reversals
alter table public.billing_payment_attempts
  drop constraint if exists billing_payment_attempts_status_check;

alter table public.billing_payment_attempts
  add constraint billing_payment_attempts_status_check
  check (status in ('intent_created', 'provider_submitted', 'paid', 'failed', 'unresolved', 'refunded', 'voided'));

-- D4: Grant status on billing_entitlement_applications
alter table public.billing_entitlement_applications
  add column if not exists status text not null default 'active'
  check (status in ('active', 'revoked'));

-- D4: Allow order lifecycle reversal transitions in orders immutability trigger
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
      or new.period_unit is distinct from old.period_unit
      or new.period_count is distinct from old.period_count
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
        (old.status = 'locked' and new.status in ('submitted', 'cancelled', 'closed', 'voided'))
        or (old.status = 'submitted' and new.status in ('closed', 'cancelled', 'voided', 'failed'))
        or (old.status = 'closed' and new.status in ('refunded', 'voided', 'cancelled'))
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

-- D4: Extended provider event lifecycle statuses
alter table public.billing_provider_events
  drop constraint if exists billing_provider_events_event_status_check;

alter table public.billing_provider_events
  add constraint billing_provider_events_event_status_check
  check (event_status in ('pending', 'success', 'failed', 'refunded', 'voided', 'cancelled', 'other'));

-- D4: Settlement outcome domain expansion
alter table public.billing_settlement_outcomes
  drop constraint if exists billing_settlement_outcomes_outcome_check;

alter table public.billing_settlement_outcomes
  add constraint billing_settlement_outcomes_outcome_check
  check (outcome in ('granted', 'idempotent_replay', 'duplicate_collection_review', 'rejected', 'refunded', 'voided', 'late_failure_ignored'));

-- D5: Account and environment scoped provider order uniqueness on attempts
alter table public.billing_payment_attempts
  add column if not exists provider text not null default 'paymob' check (provider = 'paymob'),
  add column if not exists provider_account_ref text,
  add column if not exists provider_environment text check (provider_environment in ('test', 'live'));

create or replace function private.billing_payment_attempts_sync_order_scope()
returns trigger language plpgsql as $$
declare
  ord record;
begin
  if new.provider_account_ref is null or new.provider_environment is null or new.provider is null then
    select o.provider, o.provider_account_ref, o.provider_environment
    into ord
    from public.billing_orders o
    where o.id = new.order_id and o.company_id = new.company_id;

    if found then
      new.provider := coalesce(new.provider, ord.provider, 'paymob');
      new.provider_account_ref := coalesce(new.provider_account_ref, ord.provider_account_ref);
      new.provider_environment := coalesce(new.provider_environment, ord.provider_environment);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_payment_attempts_sync_scope_trg on public.billing_payment_attempts;
create trigger billing_payment_attempts_sync_scope_trg
  before insert or update on public.billing_payment_attempts
  for each row execute function private.billing_payment_attempts_sync_order_scope();

-- Backfill any existing attempts from their parent order
update public.billing_payment_attempts a
set
  provider = coalesce(a.provider, o.provider, 'paymob'),
  provider_account_ref = coalesce(a.provider_account_ref, o.provider_account_ref),
  provider_environment = coalesce(a.provider_environment, o.provider_environment)
from public.billing_orders o
where a.order_id = o.id
  and (a.provider_account_ref is null or a.provider_environment is null);

-- Unique index scoped by provider + merchant account + environment + provider_order_id
drop index if exists public.billing_payment_attempts_provider_order_uidx;
create unique index if not exists billing_payment_attempts_provider_order_uidx
  on public.billing_payment_attempts (provider, provider_account_ref, provider_environment, provider_order_id)
  where provider_order_id is not null;

-- D5: Immutability guard for payment attempt tenant, provider, and account/env bindings
create or replace function private.billing_payment_attempts_binding_guard()
returns trigger language plpgsql as $$
begin
  if old.company_id is distinct from new.company_id then
    raise exception 'billing_payment_attempts: company_id is immutable' using errcode = '22023';
  end if;
  if old.order_id is distinct from new.order_id then
    raise exception 'billing_payment_attempts: order_id is immutable' using errcode = '22023';
  end if;
  if old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id then
    raise exception 'billing_payment_attempts: provider_order_id is immutable once bound' using errcode = '22023';
  end if;
  if old.provider_account_ref is not null and new.provider_account_ref is distinct from old.provider_account_ref then
    raise exception 'billing_payment_attempts: provider_account_ref is immutable once bound' using errcode = '22023';
  end if;
  if old.provider_environment is not null and new.provider_environment is distinct from old.provider_environment then
    raise exception 'billing_payment_attempts: provider_environment is immutable once bound' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_payment_attempts_binding_guard_trg on public.billing_payment_attempts;
create trigger billing_payment_attempts_binding_guard_trg
  before update on public.billing_payment_attempts
  for each row execute function private.billing_payment_attempts_binding_guard();


-- ---------------------------------------------------------------------------
-- 2. D3 + D2: Atomic Order Creation and Reuse
-- ---------------------------------------------------------------------------
create or replace function public.billing_create_or_reuse_subscription_order(
  p_company_id uuid,
  p_product_code text,
  p_purchase_purpose text,
  p_plan_version_id uuid,
  p_requested_plan_id uuid,
  p_client_op_id text,
  p_input_fingerprint text,
  p_special_reference text,
  p_amount_baisa bigint,
  p_currency text,
  p_period_days integer,
  p_period_unit text,
  p_period_count integer,
  p_provider_account_ref text,
  p_provider_environment text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_open public.billing_orders%rowtype;
  v_sub public.billing_subscriptions%rowtype;
  v_pv record;
  v_paid_through timestamptz;
  v_resolve jsonb;
  v_order public.billing_orders%rowtype;
  v_attempt_status text;
  v_constraint text;
begin
  -- Validate basic inputs
  if p_company_id is null or p_plan_version_id is null or p_created_by is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'detail', 'Missing required identifiers');
  end if;

  if p_provider_environment not in ('test', 'live') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'detail', 'Invalid provider environment');
  end if;

  if p_purchase_purpose not in ('initial', 'renew') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'detail', 'Invalid purchase purpose');
  end if;

  -- Verify active company lock
  perform 1 from public.companies where id = p_company_id and status <> 'suspended' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'COMPANY_NOT_FOUND_OR_SUSPENDED');
  end if;

  -- D3: Atomically verify plan and version publication status and lock catalog row
  select pv.*, p.status as plan_status, p.code as plan_code
  into v_pv
  from public.billing_plan_versions pv
  join public.billing_plans p on p.id = pv.plan_id
  where pv.id = p_plan_version_id
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLAN_VERSION_NOT_FOUND');
  end if;

  if v_pv.status is distinct from 'published' or v_pv.plan_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_PUBLISHED');
  end if;

  if p_requested_plan_id is not null and v_pv.plan_id is distinct from p_requested_plan_id then
    return jsonb_build_object('ok', false, 'code', 'PLAN_ID_MISMATCH');
  end if;

  -- Validate financial snapshot against locked catalog version
  if p_amount_baisa is distinct from v_pv.amount_baisa
     or p_currency is distinct from v_pv.currency
     or p_period_days is distinct from v_pv.period_days then
    return jsonb_build_object('ok', false, 'code', 'FINANCIAL_SNAPSHOT_MISMATCH');
  end if;

  -- D2: Environment-isolated subscription inspection
  select * into v_sub
  from public.billing_subscriptions
  where company_id = p_company_id and environment = p_provider_environment
  for update;

  v_paid_through := v_sub.paid_through;

  if p_purchase_purpose = 'initial' then
    if v_sub.status = 'active' and v_paid_through is not null and v_paid_through > v_now then
      return jsonb_build_object(
        'ok', false,
        'code', 'INITIAL_PURCHASE_ALREADY_ACTIVE',
        'block_new_collection', true,
        'manage_subscription_hint', true
      );
    end if;
  elsif p_purchase_purpose = 'renew' then
    if v_sub.status not in ('active', 'suspended') or v_paid_through is null then
      return jsonb_build_object('ok', false, 'code', 'RENEW_WITHOUT_PRIOR_SUBSCRIPTION');
    end if;
  end if;

  -- Check existing open order for this company / product / environment
  select * into v_open
  from public.billing_orders o
  where o.company_id = p_company_id
    and o.product_code = p_product_code
    and o.provider_environment = p_provider_environment
    and o.status in ('locked', 'submitted')
  order by o.created_at desc
  limit 1
  for update;

  if found then
    -- D3: Check checkout session expiration on existing open order
    if v_open.expires_at is not null and v_open.expires_at < v_now and v_open.status = 'locked' then
      update public.billing_orders
      set status = 'cancelled'
      where id = v_open.id;
      -- Proceed to create a fresh order below
    else
      if v_open.plan_version_id is distinct from p_plan_version_id
         or v_open.amount_baisa is distinct from p_amount_baisa
         or v_open.currency is distinct from p_currency
         or v_open.purchase_purpose is distinct from p_purchase_purpose then
        return jsonb_build_object(
          'ok', false,
          'code', 'CONTENT_MISMATCH',
          'order_id', v_open.id
        );
      end if;

      v_resolve := private.billing_resolve_or_create_payment_attempt(v_open.id, p_company_id);
      if coalesce((v_resolve ->> 'ok')::boolean, false) is not true then
        return jsonb_build_object('ok', false, 'code', 'attempt_resolve_failed', 'detail', v_resolve);
      end if;

      select a.status into v_attempt_status
      from public.billing_payment_attempts a
      where a.id = (v_resolve ->> 'payment_attempt_id')::uuid;

      return jsonb_build_object(
        'ok', true,
        'action', 'reuse',
        'order_id', v_open.id,
        'special_reference', v_open.special_reference,
        'payment_attempt_id', v_resolve ->> 'payment_attempt_id',
        'plan_version_id', v_open.plan_version_id,
        'block_new_collection', v_attempt_status in ('provider_submitted', 'unresolved'),
        'purchase_purpose', p_purchase_purpose
      );
    end if;
  end if;

  -- Create fresh locked order with explicit 2-hour checkout expiration
  insert into public.billing_orders (
    company_id,
    plan_version_id,
    product_code,
    purchase_purpose,
    amount_baisa,
    currency,
    period_days,
    period_unit,
    period_count,
    provider,
    provider_account_ref,
    provider_environment,
    provider_amount,
    provider_amount_unit,
    special_reference,
    client_op_id,
    input_fingerprint,
    status,
    expires_at,
    created_by
  ) values (
    p_company_id,
    p_plan_version_id,
    p_product_code,
    p_purchase_purpose,
    v_pv.amount_baisa,
    v_pv.currency,
    v_pv.period_days,
    p_period_unit,
    p_period_count,
    'paymob',
    p_provider_account_ref,
    p_provider_environment,
    null,
    null,
    p_special_reference,
    btrim(p_client_op_id),
    btrim(p_input_fingerprint),
    'locked',
    v_now + interval '2 hours',
    p_created_by
  )
  returning * into v_order;

  v_resolve := private.billing_resolve_or_create_payment_attempt(v_order.id, p_company_id);
  if coalesce((v_resolve ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'attempt_create_failed', 'detail', v_resolve);
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'order_id', v_order.id,
    'special_reference', v_order.special_reference,
    'payment_attempt_id', v_resolve ->> 'payment_attempt_id',
    'plan_version_id', v_order.plan_version_id,
    'block_new_collection', false,
    'purchase_purpose', p_purchase_purpose
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_constraint := lower(coalesce(v_constraint, ''));
    if v_constraint like '%client_op%' then
      return jsonb_build_object('ok', false, 'code', 'CLIENT_OP_ID_REUSED');
    end if;
    if v_constraint like '%special_ref%' then
      return jsonb_build_object('ok', false, 'code', 'SPECIAL_REFERENCE_COLLISION');
    end if;
    return jsonb_build_object('ok', false, 'code', 'UNIQUE_VIOLATION', 'constraint', v_constraint);
end;
$$;

revoke all on function public.billing_create_or_reuse_subscription_order from public, anon, authenticated;
grant execute on function public.billing_create_or_reuse_subscription_order to service_role;


-- ---------------------------------------------------------------------------
-- 3. D1 + D2 + D4: Hardened Settlement Core
-- ---------------------------------------------------------------------------
create or replace function private.billing_settle_payment_core(
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_company_id uuid;
  v_order_id uuid;
  v_attempt_id uuid;
  v_provider text;
  v_account text;
  v_env text;
  v_txn text;
  v_special text;
  v_currency text;
  v_event_status text;
  v_obs_key text;
  v_amount bigint;
  v_evidence_kind text;

  v_sub public.billing_subscriptions%rowtype;
  v_order public.billing_orders%rowtype;
  v_attempt public.billing_payment_attempts%rowtype;
  v_pv public.billing_plan_versions%rowtype;

  v_existing_outcome public.billing_settlement_outcomes%rowtype;
  v_existing_grant public.billing_entitlement_applications%rowtype;
  v_active_until timestamptz;
  v_applied_paid_through timestamptz;
  v_event_id uuid;
  v_grant_id uuid;
  v_outcome_id uuid;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'billing_settle_payment_core: evidence payload must be an object'
      using errcode = '22023';
  end if;

  v_company_id := (p_evidence ->> 'company_id')::uuid;
  v_order_id := (p_evidence ->> 'order_id')::uuid;
  v_attempt_id := (p_evidence ->> 'payment_attempt_id')::uuid;
  v_provider := nullif(btrim(p_evidence ->> 'provider'), '');
  v_account := nullif(btrim(p_evidence ->> 'provider_account_ref'), '');
  v_env := nullif(btrim(p_evidence ->> 'provider_environment'), '');
  v_txn := nullif(btrim(p_evidence ->> 'provider_transaction_id'), '');
  v_special := nullif(btrim(p_evidence ->> 'special_reference'), '');
  v_currency := nullif(btrim(p_evidence ->> 'currency_expected'), '');
  v_event_status := nullif(btrim(p_evidence ->> 'event_status'), '');
  v_obs_key := coalesce(nullif(btrim(p_evidence ->> 'observation_key'), ''), 'default');
  v_evidence_kind := coalesce(nullif(btrim(p_evidence ->> 'evidence_kind'), ''), 'unknown');

  begin
    v_amount := (p_evidence ->> 'amount_baisa')::bigint;
  exception when others then
    raise exception 'billing_settle_payment_core: amount invalid'
      using errcode = '22023';
  end;

  if v_company_id is null or v_order_id is null or v_attempt_id is null
     or v_provider is null or v_account is null or v_env is null
     or v_txn is null or v_special is null or v_currency is null
     or v_event_status is null or v_amount is null then
    raise exception 'billing_settle_payment_core: evidence incomplete'
      using errcode = '22023';
  end if;

  -- Validate environment
  if v_env not in ('test', 'live') then
    raise exception 'billing_settle_payment_core: invalid environment %', v_env
      using errcode = '22023';
  end if;

  -- D1: In live environment, synthetic evidence is strictly rejected
  if v_env = 'live' and v_evidence_kind = 'authorized_synthetic_test' then
    raise exception 'billing_settle_payment_core: synthetic evidence rejected in live environment'
      using errcode = '22023';
  end if;

  if v_provider is distinct from 'paymob'
     or v_currency is distinct from 'OMR'
     or v_event_status is distinct from 'success'
     or v_amount <= 0 then
    raise exception 'billing_settle_payment_core: evidence conflicting or negative amount'
      using errcode = '22023';
  end if;

  -- Canonical lock family: company -> subscription -> order -> attempt
  perform 1 from public.companies c where c.id = v_company_id for update;
  if not found then
    raise exception 'billing_settle_payment_core: company not found'
      using errcode = '22023';
  end if;

  -- D2: Environment-isolated subscription lock
  insert into public.billing_subscriptions (company_id, environment, status)
  values (v_company_id, v_env, 'awaiting_payment')
  on conflict (company_id, environment) do nothing;

  select * into v_sub
  from public.billing_subscriptions
  where company_id = v_company_id and environment = v_env
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: subscription ensure failed'
      using errcode = '22023';
  end if;

  select * into v_order
  from public.billing_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: order not found'
      using errcode = '22023';
  end if;

  select * into v_attempt
  from public.billing_payment_attempts
  where id = v_attempt_id
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: payment_attempt not found'
      using errcode = '22023';
  end if;

  -- Validate tenant and environment consistency
  if v_order.company_id is distinct from v_company_id
     or v_attempt.company_id is distinct from v_company_id
     or v_attempt.order_id is distinct from v_order_id
     or v_order.provider is distinct from v_provider
     or v_order.provider_account_ref is distinct from v_account
     or v_order.provider_environment is distinct from v_env
     or v_order.currency is distinct from v_currency
     or v_order.amount_baisa is distinct from v_amount
     or v_order.special_reference is distinct from v_special then
    raise exception 'billing_settle_payment_core: evidence conflicting with locked order'
      using errcode = '22023';
  end if;

  if v_order.status not in ('locked', 'submitted', 'closed') then
    raise exception 'billing_settle_payment_core: order status % not settleable', v_order.status
      using errcode = '22023';
  end if;

  -- Check existing outcome for this exact provider transaction
  select * into v_existing_outcome
  from public.billing_settlement_outcomes o
  where o.provider = v_provider
    and o.provider_account_ref = v_account
    and o.provider_environment = v_env
    and o.provider_transaction_id = v_txn
    and o.outcome in ('granted', 'idempotent_replay', 'duplicate_collection_review')
  for update;

  if found then
    if v_existing_outcome.order_id is distinct from v_order_id
       or v_existing_outcome.company_id is distinct from v_company_id
       or v_existing_outcome.provider_account_ref is distinct from v_account
       or v_existing_outcome.provider_environment is distinct from v_env then
      raise exception 'billing_settle_payment_core: provider transaction binding conflict'
        using errcode = '22023';
    end if;

    update public.billing_settlement_outcomes
    set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('replayed_at', v_now)
    where id = v_existing_outcome.id;

    return jsonb_build_object(
      'ok', true,
      'outcome', case
        when v_existing_outcome.outcome = 'granted' then 'idempotent_replay'
        else v_existing_outcome.outcome
      end,
      'settlement_outcome_id', v_existing_outcome.id,
      'entitlement_application_id', v_existing_outcome.entitlement_application_id,
      'order_id', v_existing_outcome.order_id,
      'applied_paid_through', v_existing_outcome.applied_paid_through,
      'previous_paid_through', v_existing_outcome.previous_paid_through,
      'evidence_kind', v_evidence_kind
    );
  end if;

  -- Ensure provider event is recorded
  insert into public.billing_provider_events (
    payment_attempt_id,
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id,
    event_status,
    observation_key,
    company_id,
    amount_baisa_expected,
    currency_expected,
    raw_summary
  ) values (
    v_attempt_id,
    v_provider,
    v_account,
    v_env,
    v_txn,
    'success',
    v_obs_key,
    v_company_id,
    v_amount,
    v_currency,
    p_evidence
  )
  on conflict (provider, provider_account_ref, provider_environment, provider_transaction_id, event_status, observation_key)
  do nothing;

  select id into v_event_id
  from public.billing_provider_events
  where provider = v_provider
    and provider_account_ref = v_account
    and provider_environment = v_env
    and provider_transaction_id = v_txn
    and event_status = 'success'
    and observation_key = v_obs_key
  limit 1;

  -- Check if order already has a grant applied (prevents double grant per order)
  select * into v_existing_grant
  from public.billing_entitlement_applications g
  where g.order_id = v_order_id
  for update;

  if found then
    insert into public.billing_settlement_outcomes (
      company_id, order_id, payment_attempt_id,
      provider, provider_account_ref, provider_environment, provider_transaction_id,
      provider_event_id, entitlement_application_id, outcome,
      evidence_marker, authenticity_method,
      previous_paid_through, applied_paid_through, detail
    ) values (
      v_company_id, v_order_id, v_attempt_id,
      v_provider, v_account, v_env, v_txn,
      v_event_id, v_existing_grant.id, 'duplicate_collection_review',
      coalesce(nullif(btrim(p_evidence ->> 'evidence_marker'), ''), 'obs:' || v_obs_key),
      v_evidence_kind,
      v_sub.paid_through, v_sub.paid_through,
      jsonb_build_object('reason', 'order_already_has_grant', 'observed_at', v_now, 'evidence_kind', v_evidence_kind)
    )
    returning id into v_outcome_id;

    return jsonb_build_object(
      'ok', true,
      'outcome', 'duplicate_collection_review',
      'settlement_outcome_id', v_outcome_id,
      'entitlement_application_id', v_existing_grant.id,
      'order_id', v_order_id,
      'applied_paid_through', v_sub.paid_through,
      'previous_paid_through', v_sub.paid_through,
      'evidence_kind', v_evidence_kind
    );
  end if;

  -- Read plan version period for calendar arithmetic
  select * into v_pv
  from public.billing_plan_versions
  where id = v_order.plan_version_id;

  if not found then
    raise exception 'billing_settle_payment_core: plan_version not found'
      using errcode = '22023';
  end if;

  -- Calculate calendar renewal arithmetic
  v_active_until := v_sub.paid_through;
  v_applied_paid_through := private.billing_add_calendar_period(
    greatest(coalesce(v_active_until, v_now), v_now),
    v_pv.period_unit,
    v_pv.period_count
  );

  -- Apply entitlement grant
  insert into public.billing_entitlement_applications (
    company_id,
    order_id,
    subscription_id,
    payment_attempt_id,
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id,
    provider_event_id,
    previous_paid_through,
    applied_paid_through,
    period_days,
    period_unit,
    period_count,
    status
  ) values (
    v_company_id,
    v_order_id,
    v_sub.id,
    v_attempt_id,
    v_provider,
    v_account,
    v_env,
    v_txn,
    v_event_id,
    v_active_until,
    v_applied_paid_through,
    case when v_order.period_unit = 'day' then v_order.period_count else greatest(v_order.period_days, 1) end,
    v_order.period_unit,
    v_order.period_count,
    'active'
  )
  returning id into v_grant_id;

  -- Update D2 environment-scoped subscription
  update public.billing_subscriptions
  set status = 'active',
      plan_version_id = v_order.plan_version_id,
      paid_through = v_applied_paid_through,
      cancel_at_period_end = false,
      updated_at = v_now
  where company_id = v_company_id and environment = v_env;

  -- Transition attempt and order to final paid status
  update public.billing_payment_attempts
  set status = 'paid',
      updated_at = v_now
  where id = v_attempt_id;

  update public.billing_orders
  set status = 'closed'
  where id = v_order_id;

  -- Record successful settlement outcome
  insert into public.billing_settlement_outcomes (
    company_id, order_id, payment_attempt_id,
    provider, provider_account_ref, provider_environment, provider_transaction_id,
    provider_event_id, entitlement_application_id, outcome,
    evidence_marker, authenticity_method,
    previous_paid_through, applied_paid_through, detail
  ) values (
    v_company_id, v_order_id, v_attempt_id,
    v_provider, v_account, v_env, v_txn,
    v_event_id, v_grant_id, 'granted',
    coalesce(nullif(btrim(p_evidence ->> 'evidence_marker'), ''), 'obs:' || v_obs_key),
    v_evidence_kind,
    v_active_until, v_applied_paid_through,
    jsonb_build_object('settled_at', v_now, 'evidence_kind', v_evidence_kind)
  )
  returning id into v_outcome_id;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'granted',
    'settlement_outcome_id', v_outcome_id,
    'entitlement_application_id', v_grant_id,
    'order_id', v_order_id,
    'applied_paid_through', v_applied_paid_through,
    'previous_paid_through', v_active_until,
    'evidence_kind', v_evidence_kind
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. D1: Live-Enabled Entry Point for Paymob Webhook Settlement
-- ---------------------------------------------------------------------------
create or replace function public.billing_settle_paymob_hmac_verified(
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_evidence jsonb := p_evidence;
begin
  if v_evidence is null or jsonb_typeof(v_evidence) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVIDENCE');
  end if;

  -- Tag with authentic processor evidence kind
  v_evidence := v_evidence || jsonb_build_object('evidence_kind', 'paymob_hmac_verified');

  return private.billing_settle_payment_core(v_evidence);
end;
$$;

revoke all on function public.billing_settle_paymob_hmac_verified from public, anon, authenticated;
grant execute on function public.billing_settle_paymob_hmac_verified to service_role;


-- ---------------------------------------------------------------------------
-- 5. D4: Atomic Reversal / Refund / Void Management
-- ---------------------------------------------------------------------------
create or replace function private.billing_apply_reversal(
  p_company_id uuid,
  p_order_id uuid,
  p_attempt_id uuid,
  p_reversal_type text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order public.billing_orders%rowtype;
  v_attempt public.billing_payment_attempts%rowtype;
  v_grant public.billing_entitlement_applications%rowtype;
  v_outcome_id uuid;
begin
  if p_reversal_type not in ('refunded', 'voided', 'cancelled') then
    raise exception 'billing_apply_reversal: invalid reversal type %', p_reversal_type
      using errcode = '22023';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'company_not_found');
  end if;

  select * into v_order from public.billing_orders where id = p_order_id and company_id = p_company_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;

  select * into v_attempt from public.billing_payment_attempts where id = p_attempt_id and order_id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  end if;

  -- Check if order was granted
  select * into v_grant from public.billing_entitlement_applications where order_id = p_order_id for update;
  if found then
    -- Revoke entitlement application
    update public.billing_entitlement_applications
    set status = 'revoked'
    where id = v_grant.id;

    -- Suspend active subscription if granted by this order
    update public.billing_subscriptions
    set status = 'suspended',
        paid_through = least(coalesce(paid_through, v_now), v_now),
        updated_at = v_now
    where company_id = p_company_id and environment = v_order.provider_environment;
  end if;

  update public.billing_orders
  set status = p_reversal_type
  where id = p_order_id;

  update public.billing_payment_attempts
  set status = case when p_reversal_type = 'cancelled' then 'failed' else p_reversal_type end,
      updated_at = v_now
  where id = p_attempt_id;

  insert into public.billing_settlement_outcomes (
    company_id, order_id, payment_attempt_id,
    provider, provider_account_ref, provider_environment, provider_transaction_id,
    entitlement_application_id, outcome,
    evidence_marker, authenticity_method,
    previous_paid_through, applied_paid_through, detail
  ) values (
    p_company_id, p_order_id, p_attempt_id,
    v_order.provider, v_order.provider_account_ref, v_order.provider_environment,
    coalesce(v_attempt.provider_order_id, 'reversal:' || p_order_id::text),
    v_grant.id,
    p_reversal_type,
    'reversal:' || p_reversal_type || ':' || p_order_id::text,
    'signed_lifecycle_reversal',
    v_grant.applied_paid_through, v_now,
    jsonb_build_object('reversal_type', p_reversal_type, 'reversal_at', v_now, 'evidence', p_evidence)
  )
  returning id into v_outcome_id;

  return jsonb_build_object(
    'ok', true,
    'outcome', p_reversal_type,
    'outcome_id', v_outcome_id,
    'order_id', p_order_id
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. D2: Authoritative Live Operational Entitlement Reader
-- ---------------------------------------------------------------------------
create or replace function public.billing_read_company_operational_entitlement(
  p_company_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'ok', true,
        'active', (s.status = 'active' and s.paid_through is not null and s.paid_through > clock_timestamp()),
        'environment', 'live',
        'status', s.status,
        'paid_through', s.paid_through,
        'plan_version_id', s.plan_version_id,
        'cancel_at_period_end', s.cancel_at_period_end
      )
      from public.billing_subscriptions s
      where s.company_id = p_company_id and s.environment = 'live'
    ),
    jsonb_build_object(
      'ok', true,
      'active', false,
      'environment', 'live',
      'status', 'none',
      'paid_through', null,
      'plan_version_id', null,
      'cancel_at_period_end', false
    )
  );
$$;

revoke all on function public.billing_read_company_operational_entitlement from public, anon;
grant execute on function public.billing_read_company_operational_entitlement to authenticated, service_role;

notify pgrst, 'reload schema';
