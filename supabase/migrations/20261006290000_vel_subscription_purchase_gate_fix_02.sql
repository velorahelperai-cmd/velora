-- VEL-SUBSCRIPTION-PURCHASE-GATE-FIX-02
-- Atomic create/reuse under company + subscription locks (settlement-compatible family:
--   company → subscription → order). Re-checks eligibility before persist.
-- Renew cannot change tier (plan_id); cycle change keeps same plan_id.
-- Stale initial after activation rejected; open initial cancelled when renew opens.
-- ON CONFLICT only on open product+purpose index; other uniques are not treated as reuse.
-- Does NOT enable upgrade pricing/collection. Does NOT modify settlement core.
-- NOT applied to cloud from this package alone.

create or replace function private.billing_subscription_within_paid_period(
  p_paid_through timestamptz,
  p_now timestamptz default now()
)
returns boolean
language sql
immutable
as $$
  select p_paid_through is not null and p_paid_through > p_now;
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

  -- Lock order family aligned with settlement: company then subscription, then order rows.
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
    -- Cancel any open initial that must not remain collectible beside active sub / renew.
    update public.billing_orders
    set status = 'cancelled'
    where company_id = p_company_id
      and product_code = p_product_code
      and purchase_purpose = 'initial'
      and status in ('locked', 'submitted');

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

  -- Creating renew: invalidate open initial so it cannot collect beside renew.
  if p_purchase_purpose = 'renew' then
    update public.billing_orders
    set status = 'cancelled'
    where company_id = p_company_id
      and product_code = p_product_code
      and purchase_purpose = 'initial'
      and status in ('locked', 'submitted');
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

comment on function private.billing_create_or_reuse_subscription_order is
  'FIX-02: company+subscription lock; renew tier-safe; stale initial blocked; precise unique conflicts.';

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

revoke all on function public.billing_create_or_reuse_subscription_order(
  uuid, text, text, uuid, uuid, text, text, text, bigint, text, integer, text, integer, text, text, uuid
) from public, anon, authenticated;

do $$
begin
  grant execute on function public.billing_create_or_reuse_subscription_order(
    uuid, text, text, uuid, uuid, text, text, text, bigint, text, integer, text, integer, text, text, uuid
  ) to service_role;
exception
  when undefined_object then null;
end;
$$;
