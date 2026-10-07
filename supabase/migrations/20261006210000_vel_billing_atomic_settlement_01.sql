-- VEL-BILLING-ATOMIC-SETTLEMENT-01
-- Atomic server-side settlement RPC over billing foundation.
-- Paymob live wiring DISABLED. Synthetic evidence marker only in this package.
-- NOT applied to production from this chat.

-- ---------------------------------------------------------------------------
-- Calendar period fields on catalog / locked orders / grants
-- ---------------------------------------------------------------------------
alter table public.billing_plan_versions
  add column if not exists period_unit text not null default 'day'
    check (period_unit in ('day', 'month', 'year'));

alter table public.billing_plan_versions
  add column if not exists period_count integer;

update public.billing_plan_versions
set period_count = period_days
where period_count is null;

alter table public.billing_plan_versions
  alter column period_count set not null;

alter table public.billing_plan_versions
  drop constraint if exists billing_plan_versions_period_count_chk;

alter table public.billing_plan_versions
  add constraint billing_plan_versions_period_count_chk
  check (period_count >= 1);

alter table public.billing_plan_versions
  drop constraint if exists billing_plan_versions_period_day_align_chk;

alter table public.billing_plan_versions
  add constraint billing_plan_versions_period_day_align_chk
  check (period_unit <> 'day' or period_count = period_days);

alter table public.billing_orders
  add column if not exists period_unit text not null default 'day'
    check (period_unit in ('day', 'month', 'year'));

alter table public.billing_orders
  add column if not exists period_count integer;

update public.billing_orders
set period_count = period_days
where period_count is null;

alter table public.billing_orders
  alter column period_count set not null;

alter table public.billing_orders
  drop constraint if exists billing_orders_period_count_chk;

alter table public.billing_orders
  add constraint billing_orders_period_count_chk
  check (period_count >= 1);

alter table public.billing_orders
  drop constraint if exists billing_orders_period_day_align_chk;

alter table public.billing_orders
  add constraint billing_orders_period_day_align_chk
  check (period_unit <> 'day' or period_count = period_days);

alter table public.billing_entitlement_applications
  add column if not exists period_unit text not null default 'day'
    check (period_unit in ('day', 'month', 'year'));

alter table public.billing_entitlement_applications
  add column if not exists period_count integer;

update public.billing_entitlement_applications
set period_count = period_days
where period_count is null;

alter table public.billing_entitlement_applications
  alter column period_count set not null;

alter table public.billing_entitlement_applications
  drop constraint if exists billing_entitlement_applications_period_count_chk;

alter table public.billing_entitlement_applications
  add constraint billing_entitlement_applications_period_count_chk
  check (period_count >= 1);

comment on column public.billing_orders.period_unit is
  'Pinned period unit on the locked order. month/year use calendar arithmetic, not 30-day months.';

-- ---------------------------------------------------------------------------
-- Settlement outcome ledger (audit; not a browser-facing table)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_settlement_outcomes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  order_id uuid not null,
  payment_attempt_id uuid not null,
  provider text not null default 'paymob' check (provider = 'paymob'),
  provider_account_ref text not null
    check (char_length(btrim(provider_account_ref)) between 1 and 128),
  provider_environment text not null check (provider_environment in ('test', 'live')),
  provider_transaction_id text not null
    check (char_length(btrim(provider_transaction_id)) between 1 and 128),
  provider_event_id uuid,
  entitlement_application_id uuid
    references public.billing_entitlement_applications (id) on delete restrict,
  outcome text not null
    check (outcome in (
      'granted',
      'idempotent_replay',
      'duplicate_collection_review',
      'rejected'
    )),
  evidence_marker text not null
    check (char_length(btrim(evidence_marker)) between 1 and 128),
  authenticity_method text not null
    check (char_length(btrim(authenticity_method)) between 1 and 64),
  previous_paid_through timestamptz,
  applied_paid_through timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_settlement_outcomes_order_company_fkey
    foreign key (order_id, company_id)
    references public.billing_orders (id, company_id)
    on delete restrict,
  constraint billing_settlement_outcomes_attempt_company_fkey
    foreign key (payment_attempt_id, company_id)
    references public.billing_payment_attempts (id, company_id)
    on delete restrict
);

create unique index if not exists billing_settlement_outcomes_txn_scope_uidx
  on public.billing_settlement_outcomes (
    provider,
    provider_account_ref,
    provider_environment,
    provider_transaction_id
  )
  where outcome in ('granted', 'idempotent_replay', 'duplicate_collection_review');

create index if not exists billing_settlement_outcomes_order_idx
  on public.billing_settlement_outcomes (order_id, created_at desc);

comment on table public.billing_settlement_outcomes is
  'Server settlement results. Synthetic test evidence is marked; live Paymob HMAC is a later package.';

revoke all on table public.billing_settlement_outcomes from public, anon, authenticated;
do $$
begin
  grant all on table public.billing_settlement_outcomes to service_role;
exception
  when undefined_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immutability: pin period_unit / period_count after publish / lock
-- ---------------------------------------------------------------------------
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
        or new.period_unit is distinct from old.period_unit
        or new.period_count is distinct from old.period_count
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

-- ---------------------------------------------------------------------------
-- Calendar period helper (UTC; month/year clamp to end of month)
-- ---------------------------------------------------------------------------
create or replace function private.billing_add_calendar_period(
  p_from timestamptz,
  p_unit text,
  p_count integer
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_day integer;
  v_target date;
  v_last integer;
  v_base_date date;
  v_time time;
begin
  if p_from is null then
    raise exception 'billing_add_calendar_period: from is null'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'billing_add_calendar_period: count must be >= 1'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Always compute on UTC wall-clock (session TimeZone / DST must not affect days).
  v_base_date := (p_from at time zone 'UTC')::date;
  v_time := (p_from at time zone 'UTC')::time;

  if p_unit = 'day' then
    return ((v_base_date + p_count) + v_time) at time zone 'UTC';
  end if;

  v_day := extract(day from v_base_date)::integer;

  if p_unit = 'month' then
    v_target := (date_trunc('month', v_base_date) + make_interval(months => p_count))::date;
  elsif p_unit = 'year' then
    v_target := (date_trunc('month', v_base_date) + make_interval(years => p_count))::date;
  else
    raise exception 'billing_add_calendar_period: invalid unit %', p_unit
      using errcode = 'invalid_parameter_value';
  end if;

  v_last := extract(day from (date_trunc('month', v_target) + interval '1 month - 1 day'))::integer;
  v_target := make_date(
    extract(year from v_target)::integer,
    extract(month from v_target)::integer,
    least(v_day, v_last)
  );
  return (v_target + v_time) at time zone 'UTC';
end;
$$;

revoke all on function private.billing_add_calendar_period(timestamptz, text, integer)
  from public, anon, authenticated;

create or replace function private.billing_compute_paid_through(
  p_now timestamptz,
  p_current timestamptz,
  p_unit text,
  p_count integer
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_base timestamptz;
begin
  if p_current is null or p_current < p_now then
    v_base := p_now;
  else
    v_base := p_current;
  end if;
  return private.billing_add_calendar_period(v_base, p_unit, p_count);
end;
$$;

revoke all on function private.billing_compute_paid_through(timestamptz, timestamptz, text, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic settlement RPC (service_role only)
-- Evidence contract for future Paymob server adapter after HMAC verify.
-- This package accepts only VEL_BILLING_SYNTHETIC_TEST_EVIDENCE + synthetic_test_only.
-- Browser signature_verified is rejected when present.
-- ---------------------------------------------------------------------------
create or replace function public.billing_settle_verified_payment(p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
        then (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
      else null
    end,
    ''
  );
  v_marker text;
  v_auth jsonb;
  v_company_id uuid;
  v_order_id uuid;
  v_attempt_id uuid;
  v_provider text;
  v_account text;
  v_env text;
  v_txn text;
  v_special text;
  v_amount bigint;
  v_currency text;
  v_event_status text;
  v_obs_key text;
  v_method text;
  v_fail_after text;
  v_order public.billing_orders%rowtype;
  v_attempt public.billing_payment_attempts%rowtype;
  v_sub public.billing_subscriptions%rowtype;
  v_event_id uuid;
  v_grant public.billing_entitlement_applications%rowtype;
  v_existing_order_grant uuid;
  v_existing_outcome public.billing_settlement_outcomes%rowtype;
  v_prev timestamptz;
  v_applied timestamptz;
  v_now timestamptz := clock_timestamp();
  v_outcome_id uuid;
  v_company_status text;
begin
  -- Privilege: reject anon/authenticated JWT even under security definer.
  -- Execute grant is service_role only; postgres allowed for local SQL assertions.
  if v_jwt_role in ('anon', 'authenticated') then
    raise exception 'billing_settle_verified_payment: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_settle_verified_payment: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;

  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'billing_settle_verified_payment: evidence incomplete'
      using errcode = '22023';
  end if;

  -- Reject browser-style signature_verified as proof.
  if p_evidence ? 'signature_verified' then
    raise exception 'billing_settle_verified_payment: signature_verified is not accepted; use server authenticity attestation'
      using errcode = '22023';
  end if;

  v_marker := nullif(btrim(p_evidence ->> 'evidence_marker'), '');
  v_auth := p_evidence -> 'authenticity';
  if v_marker is null or v_auth is null or jsonb_typeof(v_auth) <> 'object' then
    raise exception 'billing_settle_verified_payment: evidence incomplete'
      using errcode = '22023';
  end if;

  if (v_auth ->> 'source') is distinct from 'server_adapter_attestation'
     or (v_auth ->> 'verified') is distinct from 'true'
     or nullif(btrim(v_auth ->> 'method'), '') is null then
    raise exception 'billing_settle_verified_payment: authenticity attestation missing or invalid'
      using errcode = '22023';
  end if;

  v_method := btrim(v_auth ->> 'method');

  -- Paymob HMAC path reserved; not enabled in this package.
  if v_marker is distinct from 'VEL_BILLING_SYNTHETIC_TEST_EVIDENCE'
     or v_method is distinct from 'synthetic_test_only' then
    raise exception 'billing_settle_verified_payment: paymob verification path disabled; synthetic test evidence only'
      using errcode = '22023';
  end if;

  begin
    v_company_id := (p_evidence ->> 'company_id')::uuid;
    v_order_id := (p_evidence ->> 'order_id')::uuid;
    v_attempt_id := (p_evidence ->> 'payment_attempt_id')::uuid;
  exception when others then
    raise exception 'billing_settle_verified_payment: evidence incomplete or conflicting ids'
      using errcode = '22023';
  end;

  v_provider := nullif(btrim(p_evidence ->> 'provider'), '');
  v_account := nullif(btrim(p_evidence ->> 'provider_account_ref'), '');
  v_env := nullif(btrim(p_evidence ->> 'provider_environment'), '');
  v_txn := nullif(btrim(p_evidence ->> 'provider_transaction_id'), '');
  v_special := nullif(btrim(p_evidence ->> 'special_reference'), '');
  v_currency := nullif(btrim(p_evidence ->> 'currency'), '');
  v_event_status := nullif(btrim(p_evidence ->> 'event_status'), '');
  v_obs_key := coalesce(nullif(btrim(p_evidence ->> 'observation_key'), ''), 'default');
  v_fail_after := nullif(btrim(p_evidence ->> '_test_fail_after'), '');

  begin
    v_amount := (p_evidence ->> 'amount_baisa')::bigint;
  exception when others then
    raise exception 'billing_settle_verified_payment: amount invalid'
      using errcode = '22023';
  end;

  if v_company_id is null or v_order_id is null or v_attempt_id is null
     or v_provider is null or v_account is null or v_env is null
     or v_txn is null or v_special is null or v_currency is null
     or v_event_status is null or v_amount is null then
    raise exception 'billing_settle_verified_payment: evidence incomplete'
      using errcode = '22023';
  end if;

  if v_provider is distinct from 'paymob'
     or v_currency is distinct from 'OMR'
     or v_env not in ('test', 'live')
     or v_event_status is distinct from 'success'
     or v_amount < 0 then
    raise exception 'billing_settle_verified_payment: evidence conflicting'
      using errcode = '22023';
  end if;

  -- Fixed lock order: order row, then subscription for that company, then attempt.
  select * into v_order
  from public.billing_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception 'billing_settle_verified_payment: order not found'
      using errcode = '22023';
  end if;

  select * into v_sub
  from public.billing_subscriptions
  where company_id = v_order.company_id
  for update;

  if not found then
    raise exception 'billing_settle_verified_payment: subscription not found'
      using errcode = '22023';
  end if;

  select * into v_attempt
  from public.billing_payment_attempts
  where id = v_attempt_id
  for update;

  if not found then
    raise exception 'billing_settle_verified_payment: payment_attempt not found'
      using errcode = '22023';
  end if;

  -- Match company / order / attempt / provider account / env / currency / amount / special_reference.
  if v_order.company_id is distinct from v_company_id
     or v_sub.company_id is distinct from v_company_id
     or v_attempt.company_id is distinct from v_company_id
     or v_attempt.order_id is distinct from v_order_id
     or v_order.provider is distinct from v_provider
     or v_order.provider_account_ref is distinct from v_account
     or v_order.provider_environment is distinct from v_env
     or v_order.currency is distinct from v_currency
     or v_order.amount_baisa is distinct from v_amount
     or v_order.special_reference is distinct from v_special then
    raise exception 'billing_settle_verified_payment: evidence conflicting with locked order'
      using errcode = '22023';
  end if;

  if v_order.status not in ('locked', 'submitted', 'closed') then
    raise exception 'billing_settle_verified_payment: order not settleable'
      using errcode = '22023';
  end if;

  -- After locks: same scoped transaction returns prior result without a new extension.
  select * into v_existing_outcome
  from public.billing_settlement_outcomes o
  where o.provider = v_provider
    and o.provider_account_ref = v_account
    and o.provider_environment = v_env
    and o.provider_transaction_id = v_txn
    and o.outcome in ('granted', 'idempotent_replay', 'duplicate_collection_review')
  for update;

  if found then
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
      'evidence_kind', 'synthetic_test'
    );
  end if;

  -- Record provider event (financial observation). Duplicate observation is unique-violation → conflict.
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
    jsonb_build_object(
      'evidence_marker', v_marker,
      'authenticity_method', v_method,
      'settlement', 'atomic_rpc',
      'paymob_live', false
    )
  )
  on conflict on constraint billing_provider_events_scope_obs_uidx do update
    set raw_summary = public.billing_provider_events.raw_summary
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.billing_provider_events e
    where e.provider = v_provider
      and e.provider_account_ref = v_account
      and e.provider_environment = v_env
      and e.provider_transaction_id = v_txn
      and e.event_status = 'success'
      and e.observation_key = v_obs_key;
  end if;

  -- Existing grant for this transaction → idempotent (no new extension).
  select * into v_grant
  from public.billing_entitlement_applications g
  where g.provider = v_provider
    and g.provider_account_ref = v_account
    and g.provider_environment = v_env
    and g.provider_transaction_id = v_txn
  for update;

  if found then
    -- Prefer existing outcome row; do not insert a second scoped txn outcome.
    select * into v_existing_outcome
    from public.billing_settlement_outcomes o
    where o.provider = v_provider
      and o.provider_account_ref = v_account
      and o.provider_environment = v_env
      and o.provider_transaction_id = v_txn
      and o.outcome in ('granted', 'idempotent_replay', 'duplicate_collection_review')
    for update;

    if not found then
      insert into public.billing_settlement_outcomes (
        company_id, order_id, payment_attempt_id,
        provider, provider_account_ref, provider_environment, provider_transaction_id,
        provider_event_id, entitlement_application_id, outcome,
        evidence_marker, authenticity_method,
        previous_paid_through, applied_paid_through, detail
      ) values (
        v_company_id, v_order_id, v_attempt_id,
        v_provider, v_account, v_env, v_txn,
        v_event_id, v_grant.id, 'idempotent_replay',
        v_marker, v_method,
        v_grant.previous_paid_through, v_grant.applied_paid_through,
        jsonb_build_object('note', 'grant already exists for transaction')
      )
      returning id into v_outcome_id;
    else
      v_outcome_id := v_existing_outcome.id;
      update public.billing_settlement_outcomes
      set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('replayed_at', v_now)
      where id = v_outcome_id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'outcome', 'idempotent_replay',
      'settlement_outcome_id', v_outcome_id,
      'entitlement_application_id', v_grant.id,
      'order_id', v_order_id,
      'applied_paid_through', v_grant.applied_paid_through,
      'previous_paid_through', v_grant.previous_paid_through,
      'evidence_kind', 'synthetic_test'
    );
  end if;

  -- Second collection for same order (different txn): retain for review, no extra grant.
  select g.id into v_existing_order_grant
  from public.billing_entitlement_applications g
  where g.order_id = v_order_id
  for update;

  if v_existing_order_grant is not null then
    update public.billing_payment_attempts
    set status = case when status = 'paid' then status else 'paid' end,
        updated_at = v_now
    where id = v_attempt_id;

    insert into public.billing_settlement_outcomes (
      company_id, order_id, payment_attempt_id,
      provider, provider_account_ref, provider_environment, provider_transaction_id,
      provider_event_id, entitlement_application_id, outcome,
      evidence_marker, authenticity_method,
      previous_paid_through, applied_paid_through, detail
    ) values (
      v_company_id, v_order_id, v_attempt_id,
      v_provider, v_account, v_env, v_txn,
      v_event_id, v_existing_order_grant, 'duplicate_collection_review',
      v_marker, v_method,
      v_sub.paid_through, v_sub.paid_through,
      jsonb_build_object(
        'note', 'second collection retained for human review; no additional grant',
        'existing_grant_id', v_existing_order_grant
      )
    )
    returning id into v_outcome_id;

    return jsonb_build_object(
      'ok', true,
      'outcome', 'duplicate_collection_review',
      'settlement_outcome_id', v_outcome_id,
      'entitlement_application_id', v_existing_order_grant,
      'order_id', v_order_id,
      'applied_paid_through', v_sub.paid_through,
      'previous_paid_through', v_sub.paid_through,
      'evidence_kind', 'synthetic_test'
    );
  end if;

  if v_fail_after = 'before_grant' then
    raise exception 'billing_settle_verified_payment: synthetic mid-transaction failure before_grant'
      using errcode = 'P0001';
  end if;

  v_prev := v_sub.paid_through;
  v_applied := private.billing_compute_paid_through(
    v_now,
    v_prev,
    v_order.period_unit,
    v_order.period_count
  );

  if v_fail_after = 'before_paid_through' then
    raise exception 'billing_settle_verified_payment: synthetic mid-transaction failure before_paid_through'
      using errcode = 'P0001';
  end if;

  -- Security suspend / membership withdrawal stay independent: settlement never flips company.status.
  select c.status into v_company_status
  from public.companies c
  where c.id = v_company_id;

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
    period_count
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
    v_prev,
    v_applied,
    case when v_order.period_unit = 'day' then v_order.period_count else greatest(v_order.period_days, 1) end,
    v_order.period_unit,
    v_order.period_count
  )
  returning * into v_grant;

  update public.billing_subscriptions
  set
    paid_through = v_applied,
    plan_version_id = v_order.plan_version_id,
    status = 'active',
    cancel_at_period_end = false,
    updated_at = v_now
  where id = v_sub.id;

  update public.billing_payment_attempts
  set status = 'paid', updated_at = v_now
  where id = v_attempt_id;

  if v_order.status in ('locked', 'submitted') then
    update public.billing_orders
    set status = 'closed'
    where id = v_order_id;
  end if;

  insert into public.billing_settlement_outcomes (
    company_id, order_id, payment_attempt_id,
    provider, provider_account_ref, provider_environment, provider_transaction_id,
    provider_event_id, entitlement_application_id, outcome,
    evidence_marker, authenticity_method,
    previous_paid_through, applied_paid_through, detail
  ) values (
    v_company_id, v_order_id, v_attempt_id,
    v_provider, v_account, v_env, v_txn,
    v_event_id, v_grant.id, 'granted',
    v_marker, v_method,
    v_prev, v_applied,
    jsonb_build_object(
      'company_status_unchanged', v_company_status,
      'period_unit', v_order.period_unit,
      'period_count', v_order.period_count
    )
  )
  returning id into v_outcome_id;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'granted',
    'settlement_outcome_id', v_outcome_id,
    'entitlement_application_id', v_grant.id,
    'order_id', v_order_id,
    'applied_paid_through', v_applied,
    'previous_paid_through', v_prev,
    'company_status', v_company_status,
    'evidence_kind', 'synthetic_test'
  );
end;
$$;

comment on function public.billing_settle_verified_payment(jsonb) is
  'Atomic settlement after server authenticity attestation. service_role only. Synthetic evidence in this package; Paymob HMAC wiring disabled. Does not clear security suspend or membership withdrawal.';

revoke all on function public.billing_settle_verified_payment(jsonb)
  from public, anon, authenticated;

do $$
begin
  grant execute on function public.billing_settle_verified_payment(jsonb) to service_role;
exception
  when undefined_object then null;
end;
$$;
