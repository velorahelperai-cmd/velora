-- VEL-PAYMOB-ATTEMPT-REPAIR-FIX-03
-- Resolve-or-create payment attempt inside one transaction:
--   lock order row → re-read attempts under lock → create bootstrap only if none exist.
-- Partial unique index alone does not close the race when the first attempt leaves
-- intent_created (e.g. becomes unresolved) between a stale empty read and a second insert.
-- Lock order matches settlement: billing_orders first, then attempts.
-- Do NOT modify private.billing_settle_payment_core.
-- New attempt after confirmed failed is a separate explicit RPC.
-- NOT applied to cloud from this package alone.

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
begin
  if p_order_id is null or p_company_id is null then
    raise exception 'billing_resolve_or_create_payment_attempt: order/company required'
      using errcode = '22023';
  end if;

  -- Lock order first (same family as settlement). Blocks concurrent resolve and
  -- lifecycle status changes that must also lock the order before mutating attempts.
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

  -- Re-read under order lock. Any existing row (including unresolved / failed / paid)
  -- is returned — never invent a second bootstrap from repair/reuse.
  select *
  into v_attempt
  from public.billing_payment_attempts
  where order_id = p_order_id
    and company_id = p_company_id
  order by created_at asc, id asc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', true,
      'action', 'reuse',
      'payment_attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'created', false
    );
  end if;

  insert into public.billing_payment_attempts (
    order_id,
    company_id,
    status,
    provider_intention_id,
    provider_order_id
  ) values (
    p_order_id,
    p_company_id,
    'intent_created',
    null,
    null
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'created',
    'payment_attempt_id', v_new_id,
    'status', 'intent_created',
    'created', true
  );
end;
$$;

comment on function private.billing_resolve_or_create_payment_attempt(uuid, uuid) is
  'FIX-03: lock order, re-read attempts, bootstrap only when zero rows. Unresolved blocks new bootstrap.';

-- Lifecycle statuses that affect whether a new attempt may be opened.
-- Always lock the parent order first, then the attempt row.
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
    'failed',
    'unresolved'
  ) then
    raise exception 'billing_set_payment_attempt_lifecycle_status: status not allowed (paid is settlement-owned)'
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

  update public.billing_payment_attempts
  set status = p_status,
      updated_at = now()
  where id = p_attempt_id
    and company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'payment_attempt_id', p_attempt_id,
    'status', p_status
  );
end;
$$;

comment on function private.billing_set_payment_attempt_lifecycle_status(uuid, uuid, text) is
  'FIX-03: order lock then attempt lock before lifecycle status change. Does not set paid.';

-- Explicit new attempt after confirmed provider rejection only.
create or replace function private.billing_open_payment_attempt_after_confirmed_failed(
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
  v_latest public.billing_payment_attempts%rowtype;
  v_new_id uuid;
begin
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
  into v_latest
  from public.billing_payment_attempts
  where order_id = p_order_id
    and company_id = p_company_id
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: no prior attempt'
      using errcode = '22023';
  end if;

  if v_latest.status is distinct from 'failed' then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: latest must be confirmed failed (got %)',
      v_latest.status
      using errcode = '22023';
  end if;

  -- Unsettled / open bootstrap must not be bypassed by this explicit path.
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

  insert into public.billing_payment_attempts (
    order_id,
    company_id,
    status,
    provider_intention_id,
    provider_order_id
  ) values (
    p_order_id,
    p_company_id,
    'intent_created',
    null,
    null
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'opened_after_failed',
    'payment_attempt_id', v_new_id,
    'prior_attempt_id', v_latest.id
  );
end;
$$;

comment on function private.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid) is
  'FIX-03: explicit new attempt only when latest is confirmed failed; not repair/reuse.';

-- Public service_role wrappers (same privilege pattern as settle HMAC entry).
create or replace function public.billing_resolve_or_create_payment_attempt(
  p_order_id uuid,
  p_company_id uuid
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
    raise exception 'billing_resolve_or_create_payment_attempt: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_resolve_or_create_payment_attempt: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;

  return private.billing_resolve_or_create_payment_attempt(p_order_id, p_company_id);
end;
$$;

create or replace function public.billing_set_payment_attempt_lifecycle_status(
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
    raise exception 'billing_set_payment_attempt_lifecycle_status: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_set_payment_attempt_lifecycle_status: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;

  return private.billing_set_payment_attempt_lifecycle_status(p_attempt_id, p_company_id, p_status);
end;
$$;

create or replace function public.billing_open_payment_attempt_after_confirmed_failed(
  p_order_id uuid,
  p_company_id uuid
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
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;

  return private.billing_open_payment_attempt_after_confirmed_failed(p_order_id, p_company_id);
end;
$$;

revoke all on function public.billing_resolve_or_create_payment_attempt(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.billing_set_payment_attempt_lifecycle_status(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid)
  from public, anon, authenticated;

do $$
begin
  grant execute on function public.billing_resolve_or_create_payment_attempt(uuid, uuid) to service_role;
  grant execute on function public.billing_set_payment_attempt_lifecycle_status(uuid, uuid, text) to service_role;
  grant execute on function public.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid) to service_role;
exception
  when undefined_object then
    null;
end;
$$;
