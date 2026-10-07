-- VEL-BILLING-LOCK-ORDER-AND-UNKNOWN-FIX-03
-- Canonical lock family (all intersecting purchase / renew / settle / attempt paths):
--   1) company
--   2) subscription
--   3) order
--   4) attempt
--   5) provider_event
-- Settlement previously locked order before company (40P01 vs purchase). Fixed here.
-- Does NOT modify FIX-05 confirm-failed / open-after-failed bodies.
-- Does NOT enable upgrade pricing. Local/disposable apply only from this package.

-- Safe draft: locked, never submitted, no collectible/unknown attempt evidence.
create or replace function private.billing_order_is_safe_uncirculated_draft(p_order_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.billing_orders o
    where o.id = p_order_id
      and o.status = 'locked'
      and not exists (
        select 1
        from public.billing_payment_attempts a
        where a.order_id = o.id
          and (
            a.status in ('provider_submitted', 'unresolved', 'paid')
            or nullif(btrim(a.provider_order_id), '') is not null
            or nullif(btrim(a.provider_intention_id), '') is not null
          )
      )
  );
$$;

comment on function private.billing_order_is_safe_uncirculated_draft(uuid) is
  'FIX-03: true only for locked orders with no submitted/unresolved/paid or provider-bound attempt.';

-- Attempt helpers: take company before order (same family as purchase/settle).
-- Does NOT replace FIX-05 confirm-failed / open-after-failed.
create or replace function private.billing_resolve_or_create_payment_attempt(
  p_order_id uuid,
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_order public.billing_orders%rowtype;
  v_attempt public.billing_payment_attempts%rowtype;
  v_new_id uuid;
  v_seq integer;
begin
  if p_order_id is null or p_company_id is null then
    raise exception 'billing_resolve_or_create_payment_attempt: order/company required'
      using errcode = '22023';
  end if;

  -- Canonical: company -> order -> attempt
  perform 1 from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception 'billing_resolve_or_create_payment_attempt: company not found'
      using errcode = '22023';
  end if;

  select *
  into v_order
  from public.billing_orders
  where id = p_order_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'billing_resolve_or_create_payment_attempt: order not found'
      using errcode = '22023';
  end if;

  select *
  into v_attempt
  from public.billing_payment_attempts
  where order_id = p_order_id
    and company_id = p_company_id
  order by attempt_seq desc, created_at desc, id desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse',
      'payment_attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'attempt_seq', v_attempt.attempt_seq,
      'is_current', true,
      'supersedes_attempt_id', v_attempt.supersedes_attempt_id,
      'created', false
    );
  end if;

  v_seq := 1;
  insert into public.billing_payment_attempts (
    order_id,
    company_id,
    status,
    provider_intention_id,
    provider_order_id,
    attempt_seq
  ) values (
    p_order_id,
    p_company_id,
    'intent_created',
    null,
    null,
    v_seq
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'payment_attempt_id', v_new_id,
    'status', 'intent_created',
    'attempt_seq', v_seq,
    'is_current', true,
    'supersedes_attempt_id', null,
    'created', true
  );
end;
$$;

comment on function private.billing_resolve_or_create_payment_attempt(uuid, uuid) is
  'FIX-03: company -> order -> attempt; CURRENT = max seq; bootstrap only when zero rows.';

create or replace function private.billing_set_payment_attempt_lifecycle_status(
  p_attempt_id uuid,
  p_company_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.billing_payment_attempts%rowtype;
  v_order public.billing_orders%rowtype;
begin
  if p_status is null or p_status not in (
    'intent_created',
    'provider_submitted',
    'unresolved'
  ) then
    raise exception 'billing_set_payment_attempt_lifecycle_status: status not allowed (failed requires confirm-with-evidence; paid is settlement-owned)'
      using errcode = '22023';
  end if;

  select *
  into v_attempt
  from public.billing_payment_attempts
  where id = p_attempt_id
    and company_id = p_company_id;

  if not found then
    raise exception 'billing_set_payment_attempt_lifecycle_status: attempt not found'
      using errcode = '22023';
  end if;

  -- Canonical: company -> order -> attempt
  perform 1 from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception 'billing_set_payment_attempt_lifecycle_status: company not found'
      using errcode = '22023';
  end if;

  select *
  into v_order
  from public.billing_orders
  where id = v_attempt.order_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'billing_set_payment_attempt_lifecycle_status: order not found'
      using errcode = '22023';
  end if;

  select *
  into v_attempt
  from public.billing_payment_attempts
  where id = p_attempt_id
    and company_id = p_company_id
  for update;

  if v_attempt.status = 'paid' then
    raise exception 'billing_set_payment_attempt_lifecycle_status: paid is settlement-owned'
      using errcode = '22023';
  end if;

  if v_attempt.status = 'failed' then
    raise exception 'billing_set_payment_attempt_lifecycle_status: confirmed failed is immutable here'
      using errcode = '22023';
  end if;

  update public.billing_payment_attempts
  set status = p_status,
      updated_at = now()
  where id = p_attempt_id
    and company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'payment_attempt_id', p_attempt_id,
    'status', p_status,
    'attempt_seq', v_attempt.attempt_seq
  );
end;
$$;

comment on function private.billing_set_payment_attempt_lifecycle_status(uuid, uuid, text) is
  'FIX-03: company -> order -> attempt. Cannot set failed/paid. Unresolved→failed blocked.';

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

  
  -- Canonical billing lock family (FIX-03):
  --   company -> subscription -> order -> attempt -> provider_event
  perform 1 from public.companies c where c.id = v_company_id for update;
  if not found then
    raise exception 'billing_settle_payment_core: company not found'
      using errcode = '22023';
  end if;

  insert into public.billing_subscriptions (company_id, status)
  values (v_company_id, 'awaiting_payment')
  on conflict (company_id) do nothing;

  select * into v_sub
  from public.billing_subscriptions
  where company_id = v_company_id
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

create or replace function private.billing_create_or_reuse_subscription_order(
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
  v_sub public.billing_subscriptions%rowtype;
  v_open public.billing_orders%rowtype;
  v_order public.billing_orders%rowtype;
  v_attempt_id uuid;
  v_attempt_status text;
  v_sub_plan_id uuid;
  v_now timestamptz := now();
  v_within boolean;
  v_resolve jsonb;
  v_seq integer;
  v_constraint text;
begin
  if p_company_id is null or nullif(btrim(p_product_code), '') is null
     or p_purchase_purpose is null or p_plan_version_id is null
     or nullif(btrim(p_client_op_id), '') is null
     or nullif(btrim(p_input_fingerprint), '') is null
     or nullif(btrim(p_special_reference), '') is null then
    raise exception 'billing_create_or_reuse_subscription_order: incomplete input'
      using errcode = '22023';
  end if;

  if p_purchase_purpose not in ('initial', 'renew', 'upgrade') then
    raise exception 'billing_create_or_reuse_subscription_order: invalid purpose'
      using errcode = '22023';
  end if;

  if p_purchase_purpose = 'upgrade' then
    return jsonb_build_object(
      'ok', false,
      'code', 'UPGRADE_NOT_CONFIGURED',
      'manage_subscription_hint', true
    );
  end if;

  -- Canonical lock family (FIX-03): company -> subscription -> order (-> attempt via resolve).
  perform 1 from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception 'billing_create_or_reuse_subscription_order: company not found'
      using errcode = '22023';
  end if;

  insert into public.billing_subscriptions (company_id, status)
  values (p_company_id, 'awaiting_payment')
  on conflict (company_id) do nothing;

  select * into v_sub
  from public.billing_subscriptions
  where company_id = p_company_id
  for update;

  if not found then
    raise exception 'billing_create_or_reuse_subscription_order: subscription ensure failed'
      using errcode = '22023';
  end if;

  v_within := private.billing_subscription_within_paid_period(v_sub.paid_through, v_now);

  if v_sub.plan_version_id is not null then
    select pv.plan_id into v_sub_plan_id
    from public.billing_plan_versions pv
    where pv.id = v_sub.plan_version_id;
  end if;

  -- Re-check eligibility under lock (closes stale initial after activation).
  if p_purchase_purpose = 'initial' and v_within then
    -- Only cancel never-submitted drafts; keep submitted/unresolved for reconciliation.
    update public.billing_orders o
    set status = 'cancelled'
    where o.company_id = p_company_id
      and o.product_code = p_product_code
      and o.purchase_purpose = 'initial'
      and private.billing_order_is_safe_uncirculated_draft(o.id);

    return jsonb_build_object(
      'ok', false,
      'code', 'ALREADY_SUBSCRIBED',
      'manage_subscription_hint', true
    );
  end if;

  if p_purchase_purpose = 'renew' then
    if not v_within then
      return jsonb_build_object('ok', false, 'code', 'EARLY_RENEW_NOT_ELIGIBLE');
    end if;
    -- Tier change disguised as renew → upgrade not configured (cycle-only keeps plan_id).
    if v_sub_plan_id is not null
       and p_requested_plan_id is not null
       and v_sub_plan_id is distinct from p_requested_plan_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'UPGRADE_NOT_CONFIGURED',
        'manage_subscription_hint', true
      );
    end if;
  end if;

  -- Open order for this purpose (lock it).
  select * into v_open
  from public.billing_orders o
  where o.company_id = p_company_id
    and o.product_code = p_product_code
    and o.purchase_purpose = p_purchase_purpose
    and o.status in ('locked', 'submitted')
  order by o.created_at asc, o.id asc
  limit 1
  for update;

  if found then
    -- Same client_op with different fingerprint → CONTENT_MISMATCH (not another open order).
    if v_open.client_op_id = btrim(p_client_op_id)
       and v_open.input_fingerprint is distinct from btrim(p_input_fingerprint) then
      return jsonb_build_object(
        'ok', false,
        'code', 'CONTENT_MISMATCH',
        'order_id', v_open.id
      );
    end if;

    -- Resolve/create attempt under existing order lock path.
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

  -- Creating renew: never cancel submitted/unresolved to free a slot.
  if p_purchase_purpose = 'renew' then
    if exists (
      select 1
      from public.billing_orders o
      where o.company_id = p_company_id
        and o.product_code = p_product_code
        and o.purchase_purpose = 'initial'
        and o.status in ('locked', 'submitted')
        and not private.billing_order_is_safe_uncirculated_draft(o.id)
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'OPEN_COLLECTION_UNRESOLVED',
        'block_new_collection', true,
        'manage_subscription_hint', true
      );
    end if;

    update public.billing_orders o
    set status = 'cancelled'
    where o.company_id = p_company_id
      and o.product_code = p_product_code
      and o.purchase_purpose = 'initial'
      and private.billing_order_is_safe_uncirculated_draft(o.id);
  end if;

  begin
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
      created_by
    ) values (
      p_company_id,
      p_plan_version_id,
      p_product_code,
      p_purchase_purpose,
      p_amount_baisa,
      p_currency,
      p_period_days,
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
      p_created_by
    )
    returning * into v_order;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      v_constraint := lower(coalesce(v_constraint, ''));

      -- Only the open product+purpose arbiter may resolve as reuse.
      if v_constraint like '%open_product_purpose%' then
        select * into v_open
        from public.billing_orders o
        where o.company_id = p_company_id
          and o.product_code = p_product_code
          and o.purchase_purpose = p_purchase_purpose
          and o.status in ('locked', 'submitted')
        order by o.created_at asc
        limit 1
        for update;

        if not found then
          return jsonb_build_object('ok', false, 'code', 'open_purpose_conflict');
        end if;

        if v_open.client_op_id = btrim(p_client_op_id)
           and v_open.input_fingerprint is distinct from btrim(p_input_fingerprint) then
          return jsonb_build_object('ok', false, 'code', 'CONTENT_MISMATCH', 'order_id', v_open.id);
        end if;

        v_resolve := private.billing_resolve_or_create_payment_attempt(v_open.id, p_company_id);
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
      elsif v_constraint like '%client_op%' then
        return jsonb_build_object('ok', false, 'code', 'client_op_conflict');
      elsif v_constraint like '%special_reference%' then
        return jsonb_build_object('ok', false, 'code', 'special_reference_conflict');
      else
        return jsonb_build_object(
          'ok', false,
          'code', 'unique_constraint_conflict',
          'constraint', v_constraint
        );
      end if;
  end;

  -- Final eligibility guard after insert race window closed by company lock:
  -- if another actor activated mid-flight for initial, we already held sub lock so OK.

  v_resolve := private.billing_resolve_or_create_payment_attempt(v_order.id, p_company_id);
  if coalesce((v_resolve ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'attempt_resolve_failed', 'detail', v_resolve);
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'insert',
    'order_id', v_order.id,
    'special_reference', v_order.special_reference,
    'payment_attempt_id', v_resolve ->> 'payment_attempt_id',
    'plan_version_id', v_order.plan_version_id,
    'block_new_collection', false,
    'purchase_purpose', p_purchase_purpose
  );
end;
$$;

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
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
        then (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
      else null
    end,
    ''
  );
begin
  if v_jwt_role in ('anon', 'authenticated') then
    raise exception 'billing_create_or_reuse_subscription_order: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_create_or_reuse_subscription_order: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;
  return private.billing_create_or_reuse_subscription_order(
    p_company_id, p_product_code, p_purchase_purpose, p_plan_version_id, p_requested_plan_id,
    p_client_op_id, p_input_fingerprint, p_special_reference,
    p_amount_baisa, p_currency, p_period_days, p_period_unit, p_period_count,
    p_provider_account_ref, p_provider_environment, p_created_by
  );
end;
$$;
