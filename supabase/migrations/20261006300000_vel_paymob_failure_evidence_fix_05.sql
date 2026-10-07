-- VEL-PAYMOB-FAILURE-EVIDENCE-FIX-05
-- Harden confirm-failed / open-after-failed evidence binding:
-- 1) provider_event_id path must still match server event identity (txn/obs) +
--    attempt/company/order provider account+environment; other-txn pending/success
--    must not be cleared by a different failed observation.
-- 2) Durable success awaiting settlement blocks failed confirm and retry open
--    (not only paid/settled attempt status).
-- Settlement cores and purchase-gate RPC untouched.

create or replace function private.billing_confirm_payment_attempt_failed(
  p_attempt_id uuid,
  p_company_id uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_attempt public.billing_payment_attempts%rowtype;
  v_order public.billing_orders%rowtype;
  v_event public.billing_provider_events%rowtype;
  v_event_id uuid;
  v_txn text;
  v_obs text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'billing_confirm_payment_attempt_failed: evidence required'
      using errcode = '22023';
  end if;

  if p_evidence ? 'confirmed' or p_evidence ? 'is_confirmed' or p_evidence ? 'force' then
    raise exception 'billing_confirm_payment_attempt_failed: cosmetic confirmation flags are not accepted'
      using errcode = '22023';
  end if;

  select *
  into v_attempt
  from public.billing_payment_attempts
  where id = p_attempt_id
    and company_id = p_company_id;

  if not found then
    raise exception 'billing_confirm_payment_attempt_failed: attempt not found'
      using errcode = '22023';
  end if;

  select *
  into v_order
  from public.billing_orders
  where id = v_attempt.order_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'billing_confirm_payment_attempt_failed: order not found'
      using errcode = '22023';
  end if;

  select *
  into v_attempt
  from public.billing_payment_attempts
  where id = p_attempt_id
    and company_id = p_company_id
  for update;

  if v_attempt.status = 'paid' then
    raise exception 'billing_confirm_payment_attempt_failed: paid is settlement-owned'
      using errcode = '22023';
  end if;

  -- Durable success evidence (awaiting settlement or otherwise) outranks last status.
  if exists (
    select 1
    from public.billing_provider_events e
    where e.payment_attempt_id = p_attempt_id
      and e.company_id = p_company_id
      and e.event_status = 'success'
    for update
  ) then
    raise exception 'billing_confirm_payment_attempt_failed: stored success awaiting settlement blocks failed confirm'
      using errcode = '22023';
  end if;

  if v_attempt.status = 'failed' then
    null;
  elsif v_attempt.status not in ('intent_created', 'provider_submitted', 'unresolved') then
    raise exception 'billing_confirm_payment_attempt_failed: attempt status % not confirmable',
      v_attempt.status
      using errcode = '22023';
  end if;

  v_event_id := nullif(btrim(p_evidence ->> 'provider_event_id'), '')::uuid;
  v_txn := nullif(btrim(p_evidence ->> 'provider_transaction_id'), '');
  v_obs := nullif(btrim(p_evidence ->> 'observation_key'), '');

  if v_event_id is not null then
    -- Load by id first (any status), then validate — never drop client txn/obs identity.
    select *
    into v_event
    from public.billing_provider_events e
    where e.id = v_event_id
      and e.company_id = p_company_id
      and e.payment_attempt_id = p_attempt_id
    for update;

    if not found then
      raise exception 'billing_confirm_payment_attempt_failed: no failed provider event bound to this attempt'
        using errcode = '22023';
    end if;

    if v_event.event_status is distinct from 'failed' then
      raise exception 'billing_confirm_payment_attempt_failed: cited provider event is not failed'
        using errcode = '22023';
    end if;

    if v_txn is not null and v_event.provider_transaction_id is distinct from v_txn then
      raise exception 'billing_confirm_payment_attempt_failed: evidence transaction identity mismatch'
        using errcode = '22023';
    end if;

    if v_obs is not null and v_event.observation_key is distinct from v_obs then
      raise exception 'billing_confirm_payment_attempt_failed: evidence observation identity mismatch'
        using errcode = '22023';
    end if;
  elsif v_txn is not null then
    select *
    into v_event
    from public.billing_provider_events e
    where e.company_id = p_company_id
      and e.payment_attempt_id = p_attempt_id
      and e.provider_transaction_id = v_txn
      and e.event_status = 'failed'
      and (v_obs is null or e.observation_key = v_obs)
    order by e.received_at desc
    limit 1
    for update;

    if not found then
      raise exception 'billing_confirm_payment_attempt_failed: no failed provider event bound to this attempt'
        using errcode = '22023';
    end if;
  else
    raise exception 'billing_confirm_payment_attempt_failed: evidence must cite provider_event_id or provider_transaction_id bound to this attempt'
      using errcode = '22023';
  end if;

  if v_event.payment_attempt_id is distinct from p_attempt_id
     or v_event.company_id is distinct from p_company_id
     or v_event.event_status is distinct from 'failed' then
    raise exception 'billing_confirm_payment_attempt_failed: evidence not bound to attempt'
      using errcode = '22023';
  end if;

  -- Order ↔ event provider scope (account + environment + provider).
  if v_event.provider is distinct from v_order.provider
     or v_event.provider_account_ref is distinct from v_order.provider_account_ref
     or v_event.provider_environment is distinct from v_order.provider_environment then
    raise exception 'billing_confirm_payment_attempt_failed: evidence provider account/environment mismatch'
      using errcode = '22023';
  end if;

  -- Failure for transaction B must not clear unresolved outcomes for transaction A.
  if exists (
    select 1
    from public.billing_provider_events e
    where e.payment_attempt_id = p_attempt_id
      and e.company_id = p_company_id
      and e.provider_transaction_id is distinct from v_event.provider_transaction_id
      and e.event_status in ('pending', 'success')
    for update
  ) then
    raise exception 'billing_confirm_payment_attempt_failed: other transaction outcome still open on attempt'
      using errcode = '22023';
  end if;

  update public.billing_payment_attempts
  set status = 'failed',
      updated_at = now()
  where id = p_attempt_id
    and company_id = p_company_id
    and status is distinct from 'failed';

  return jsonb_build_object(
    'ok', true,
    'payment_attempt_id', p_attempt_id,
    'status', 'failed',
    'provider_event_id', v_event.id,
    'provider_transaction_id', v_event.provider_transaction_id,
    'observation_key', v_event.observation_key,
    'attempt_seq', v_attempt.attempt_seq,
    'is_current', true
  );
end;
$$;

comment on function private.billing_confirm_payment_attempt_failed(uuid, uuid, jsonb) is
  'FIX-05: failed confirm requires bound failed event identity match (txn/obs/account/env); blocks when success or other-txn pending exists.';

create or replace function private.billing_open_payment_attempt_after_confirmed_failed(
  p_order_id uuid,
  p_company_id uuid,
  p_prior_attempt_id uuid,
  p_open_client_op_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_order public.billing_orders%rowtype;
  v_prior public.billing_payment_attempts%rowtype;
  v_existing public.billing_payment_attempts%rowtype;
  v_current public.billing_payment_attempts%rowtype;
  v_new_id uuid;
  v_seq integer;
  v_op text;
begin
  v_op := nullif(btrim(p_open_client_op_id), '');
  if p_prior_attempt_id is null or v_op is null then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior_attempt_id and open_client_op_id required'
      using errcode = '22023';
  end if;

  select *
  into v_order
  from public.billing_orders
  where id = p_order_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: order not found'
      using errcode = '22023';
  end if;

  select *
  into v_prior
  from public.billing_payment_attempts
  where id = p_prior_attempt_id
    and company_id = p_company_id
    and order_id = p_order_id
  for update;

  if not found then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior attempt not found'
      using errcode = '22023';
  end if;

  -- Evidence under lock: success outranks failed status / stale failed observations.
  if exists (
    select 1
    from public.billing_provider_events e
    where e.payment_attempt_id = p_prior_attempt_id
      and e.company_id = p_company_id
      and e.event_status = 'success'
    for update
  ) then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: stored success awaiting settlement blocks retry open'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.billing_provider_events e
    where e.payment_attempt_id = p_prior_attempt_id
      and e.company_id = p_company_id
      and e.event_status = 'pending'
    for update
  ) then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: unresolved provider outcome blocks retry open'
      using errcode = '22023';
  end if;

  if v_prior.status is distinct from 'failed' then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior must be confirmed failed (got %)',
      v_prior.status
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.billing_provider_events e
    where e.payment_attempt_id = p_prior_attempt_id
      and e.company_id = p_company_id
      and e.event_status = 'failed'
      and e.provider is not distinct from v_order.provider
      and e.provider_account_ref is not distinct from v_order.provider_account_ref
      and e.provider_environment is not distinct from v_order.provider_environment
  ) then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior lacks bound failed provider event'
      using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.billing_payment_attempts
  where supersedes_attempt_id = p_prior_attempt_id
  for update;

  if found then
    if v_existing.open_client_op_id is distinct from v_op then
      raise exception 'billing_open_payment_attempt_after_confirmed_failed: open_client_op_id mismatch for existing successor'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse_opened',
      'payment_attempt_id', v_existing.id,
      'prior_attempt_id', p_prior_attempt_id,
      'attempt_seq', v_existing.attempt_seq,
      'is_current', true,
      'created', false
    );
  end if;

  select *
  into v_existing
  from public.billing_payment_attempts
  where order_id = p_order_id
    and open_client_op_id = v_op
  for update;

  if found then
    if v_existing.supersedes_attempt_id is distinct from p_prior_attempt_id then
      raise exception 'billing_open_payment_attempt_after_confirmed_failed: open_client_op_id bound to different prior'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse_opened',
      'payment_attempt_id', v_existing.id,
      'prior_attempt_id', p_prior_attempt_id,
      'attempt_seq', v_existing.attempt_seq,
      'is_current', true,
      'created', false
    );
  end if;

  select *
  into v_current
  from public.billing_payment_attempts
  where order_id = p_order_id
    and company_id = p_company_id
  order by attempt_seq desc, created_at desc, id desc
  limit 1
  for update;

  if v_current.id is distinct from p_prior_attempt_id then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior is not current attempt'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.billing_payment_attempts a
    where a.order_id = p_order_id
      and a.company_id = p_company_id
      and a.status in ('intent_created', 'provider_submitted', 'unresolved')
  ) then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: unsettled attempt exists'
      using errcode = '22023';
  end if;

  select coalesce(max(attempt_seq), 0) + 1
  into v_seq
  from public.billing_payment_attempts
  where order_id = p_order_id
    and company_id = p_company_id;

  begin
    insert into public.billing_payment_attempts (
      order_id,
      company_id,
      status,
      provider_intention_id,
      provider_order_id,
      attempt_seq,
      supersedes_attempt_id,
      open_client_op_id
    ) values (
      p_order_id,
      p_company_id,
      'intent_created',
      null,
      null,
      v_seq,
      p_prior_attempt_id,
      v_op
    )
    returning id into v_new_id;
  exception
    when unique_violation then
      select *
      into v_existing
      from public.billing_payment_attempts
      where supersedes_attempt_id = p_prior_attempt_id
         or (order_id = p_order_id and open_client_op_id = v_op)
      order by attempt_seq desc
      limit 1;

      if not found then
        raise;
      end if;
      if v_existing.open_client_op_id is distinct from v_op
         or v_existing.supersedes_attempt_id is distinct from p_prior_attempt_id then
        raise exception 'billing_open_payment_attempt_after_confirmed_failed: open identity conflict'
          using errcode = '22023';
      end if;
      return jsonb_build_object(
        'ok', true,
        'action', 'reuse_opened',
        'payment_attempt_id', v_existing.id,
        'prior_attempt_id', p_prior_attempt_id,
        'attempt_seq', v_existing.attempt_seq,
        'is_current', true,
        'created', false
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'action', 'opened_after_failed',
    'payment_attempt_id', v_new_id,
    'prior_attempt_id', p_prior_attempt_id,
    'attempt_seq', v_seq,
    'is_current', true,
    'created', true
  );
end;
$$;

comment on function private.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid, uuid, text) is
  'FIX-05: idempotent open after evidenced failed prior; blocks when stored success or pending outcomes remain.';
