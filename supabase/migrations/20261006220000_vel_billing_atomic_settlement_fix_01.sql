-- VEL-BILLING-ATOMIC-SETTLEMENT-FIX-01
-- Closes: synthetic/live boundary, txn binding before replay, UTC day math,
-- first-subscription ensure, RLS on settlement outcomes.
-- Provider HMAC still NOT implemented — no alternate live path.
-- NOT applied to production from this chat.

-- ---------------------------------------------------------------------------
-- 1) UTC-stable calendar day arithmetic (session TimeZone must not affect days)
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

  -- Always compute on UTC wall-clock, never session TimeZone (DST-safe).
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

-- ---------------------------------------------------------------------------
-- 2) RLS on settlement outcomes — clients keep zero table privileges
-- ---------------------------------------------------------------------------
alter table public.billing_settlement_outcomes enable row level security;

revoke all on table public.billing_settlement_outcomes from public, anon, authenticated;

do $$
begin
  grant all on table public.billing_settlement_outcomes to service_role;
exception
  when undefined_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Core settlement (no evidence-kind gate). Callers must gate evidence.
--    Rejects live environment always in this package.
-- ---------------------------------------------------------------------------
create or replace function private.billing_settle_payment_core(p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
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
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'billing_settle_payment_core: evidence incomplete'
      using errcode = '22023';
  end if;

  if p_evidence ? 'signature_verified' then
    raise exception 'billing_settle_payment_core: signature_verified is not accepted'
      using errcode = '22023';
  end if;

  v_marker := nullif(btrim(p_evidence ->> 'evidence_marker'), '');
  v_auth := p_evidence -> 'authenticity';
  if v_marker is null or v_auth is null or jsonb_typeof(v_auth) <> 'object' then
    raise exception 'billing_settle_payment_core: evidence incomplete'
      using errcode = '22023';
  end if;

  if (v_auth ->> 'source') is distinct from 'server_adapter_attestation'
     or (v_auth ->> 'verified') is distinct from 'true'
     or nullif(btrim(v_auth ->> 'method'), '') is null then
    raise exception 'billing_settle_payment_core: authenticity attestation missing or invalid'
      using errcode = '22023';
  end if;

  v_method := btrim(v_auth ->> 'method');

  begin
    v_company_id := (p_evidence ->> 'company_id')::uuid;
    v_order_id := (p_evidence ->> 'order_id')::uuid;
    v_attempt_id := (p_evidence ->> 'payment_attempt_id')::uuid;
  exception when others then
    raise exception 'billing_settle_payment_core: evidence incomplete or conflicting ids'
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

  -- Live rejected entirely in this package (no provider verification path).
  if v_env is distinct from 'test' then
    raise exception 'billing_settle_payment_core: live environment settlement disabled in this package'
      using errcode = '22023';
  end if;

  if v_provider is distinct from 'paymob'
     or v_currency is distinct from 'OMR'
     or v_event_status is distinct from 'success'
     or v_amount < 0 then
    raise exception 'billing_settle_payment_core: evidence conflicting'
      using errcode = '22023';
  end if;

  -- Lock order → company (sub ensure) → subscription → attempt
  select * into v_order
  from public.billing_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: order not found'
      using errcode = '22023';
  end if;

  perform 1 from public.companies c where c.id = v_order.company_id for update;
  if not found then
    raise exception 'billing_settle_payment_core: company not found'
      using errcode = '22023';
  end if;

  insert into public.billing_subscriptions (company_id, status)
  values (v_order.company_id, 'awaiting_payment')
  on conflict (company_id) do nothing;

  select * into v_sub
  from public.billing_subscriptions
  where company_id = v_order.company_id
  for update;

  if not found then
    raise exception 'billing_settle_payment_core: subscription ensure failed'
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
    raise exception 'billing_settle_payment_core: evidence conflicting with locked order'
      using errcode = '22023';
  end if;

  if v_order.provider_environment is distinct from 'test' then
    raise exception 'billing_settle_payment_core: live environment settlement disabled in this package'
      using errcode = '22023';
  end if;

  if v_order.status not in ('locked', 'submitted', 'closed') then
    raise exception 'billing_settle_payment_core: order not settleable'
      using errcode = '22023';
  end if;

  -- Same scoped txn: replay only when bound to same order/company/account/env.
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
      'evidence_kind', 'authorized_synthetic_test'
    );
  end if;

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
      'settlement', 'atomic_core',
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

  select * into v_grant
  from public.billing_entitlement_applications g
  where g.provider = v_provider
    and g.provider_account_ref = v_account
    and g.provider_environment = v_env
    and g.provider_transaction_id = v_txn
  for update;

  if found then
    if v_grant.order_id is distinct from v_order_id
       or v_grant.company_id is distinct from v_company_id
       or v_grant.provider_account_ref is distinct from v_account
       or v_grant.provider_environment is distinct from v_env then
      raise exception 'billing_settle_payment_core: provider transaction binding conflict'
        using errcode = '22023';
    end if;

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
      if v_existing_outcome.order_id is distinct from v_order_id
         or v_existing_outcome.company_id is distinct from v_company_id then
        raise exception 'billing_settle_payment_core: provider transaction binding conflict'
          using errcode = '22023';
      end if;
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
      'evidence_kind', 'authorized_synthetic_test'
    );
  end if;

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
      'evidence_kind', 'authorized_synthetic_test'
    );
  end if;

  v_prev := v_sub.paid_through;
  v_applied := private.billing_compute_paid_through(
    v_now,
    v_prev,
    v_order.period_unit,
    v_order.period_count
  );

  select c.status into v_company_status
  from public.companies c
  where c.id = v_company_id;

  begin
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
  exception
    when unique_violation then
      select * into v_grant
      from public.billing_entitlement_applications g
      where g.provider = v_provider
        and g.provider_account_ref = v_account
        and g.provider_environment = v_env
        and g.provider_transaction_id = v_txn;

      if found then
        if v_grant.order_id is distinct from v_order_id
           or v_grant.company_id is distinct from v_company_id then
          raise exception 'billing_settle_payment_core: provider transaction binding conflict'
            using errcode = '22023';
        end if;
        return jsonb_build_object(
          'ok', true,
          'outcome', 'idempotent_replay',
          'settlement_outcome_id', null,
          'entitlement_application_id', v_grant.id,
          'order_id', v_order_id,
          'applied_paid_through', v_grant.applied_paid_through,
          'previous_paid_through', v_grant.previous_paid_through,
          'evidence_kind', 'authorized_synthetic_test'
        );
      end if;

      select g.id into v_existing_order_grant
      from public.billing_entitlement_applications g
      where g.order_id = v_order_id;
      if v_existing_order_grant is not null then
        return jsonb_build_object(
          'ok', true,
          'outcome', 'duplicate_collection_review',
          'settlement_outcome_id', null,
          'entitlement_application_id', v_existing_order_grant,
          'order_id', v_order_id,
          'applied_paid_through', v_sub.paid_through,
          'previous_paid_through', v_sub.paid_through,
          'evidence_kind', 'authorized_synthetic_test'
        );
      end if;
      raise;
  end;

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
    'evidence_kind', 'authorized_synthetic_test'
  );
end;
$$;

revoke all on function private.billing_settle_payment_core(jsonb)
  from public, anon, authenticated;

comment on function private.billing_settle_payment_core(jsonb) is
  'Internal settlement core. Live env always rejected. Callers must enforce evidence kind; synthetic entry exists only in authorized test artifacts.';

-- ---------------------------------------------------------------------------
-- 4) Production public RPC: no synthetic path, no live, no unimplemented HMAC
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
  v_method text;
  v_env text;
begin
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

  if p_evidence ? 'signature_verified' then
    raise exception 'billing_settle_verified_payment: signature_verified is not accepted; use server authenticity attestation'
      using errcode = '22023';
  end if;

  v_marker := nullif(btrim(p_evidence ->> 'evidence_marker'), '');
  v_auth := p_evidence -> 'authenticity';
  v_env := nullif(btrim(p_evidence ->> 'provider_environment'), '');
  v_method := case
    when v_auth is null or jsonb_typeof(v_auth) <> 'object' then null
    else nullif(btrim(v_auth ->> 'method'), '')
  end;

  -- Live closed in this package.
  if v_env is not distinct from 'live' then
    raise exception 'billing_settle_verified_payment: live environment settlement disabled in this package'
      using errcode = '22023';
  end if;

  -- Synthetic evidence is NOT accepted on the production RPC (no GUC/flag bypass).
  if v_marker is not distinct from 'VEL_BILLING_SYNTHETIC_TEST_EVIDENCE'
     or v_method is not distinct from 'synthetic_test_only' then
    raise exception 'billing_settle_verified_payment: synthetic evidence is not accepted on production RPC; use authorized test helper only'
      using errcode = '22023';
  end if;

  -- Real provider verification is not implemented — do not open an alternate path.
  raise exception 'billing_settle_verified_payment: provider verification path not implemented in this package'
    using errcode = '22023';
end;
$$;

comment on function public.billing_settle_verified_payment(jsonb) is
  'Production settlement entry. Rejects live + synthetic. Provider HMAC not implemented — no settlement grant path until a later package. service_role only.';

revoke all on function public.billing_settle_verified_payment(jsonb)
  from public, anon, authenticated;

do $$
begin
  grant execute on function public.billing_settle_verified_payment(jsonb) to service_role;
exception
  when undefined_object then null;
end;
$$;
