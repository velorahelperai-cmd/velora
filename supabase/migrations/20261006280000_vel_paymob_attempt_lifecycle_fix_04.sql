-- VEL-PAYMOB-ATTEMPT-LIFECYCLE-FIX-04
-- Closes FIX-03 review gaps:
--   A) unresolved cannot become failed by status-only change; confirmed fail needs
--      a provider event bound to the attempt (no cosmetic flag).
--   B) open-after-confirmed-failed is idempotent by (prior_attempt, open_client_op).
--   C) resolve returns the CURRENT attempt (latest), not the oldest failed row.
-- Does NOT modify private.billing_settle_payment_core.
-- Does NOT change single-product purchase gate.
-- NOT applied to cloud from this package alone.

-- ---------------------------------------------------------------------------
-- Attempt lineage columns (history preserved; current = latest by seq/created_at)
-- ---------------------------------------------------------------------------
alter table public.billing_payment_attempts
  add column if not exists attempt_seq integer;

alter table public.billing_payment_attempts
  add column if not exists supersedes_attempt_id uuid;

alter table public.billing_payment_attempts
  add column if not exists open_client_op_id text;

-- Backfill sequence for existing rows (stable by created_at, id).
with ranked as (
  select
    id,
    row_number() over (
      partition by order_id, company_id
      order by created_at asc, id asc
    ) as seq
  from public.billing_payment_attempts
  where attempt_seq is null
)
update public.billing_payment_attempts a
set attempt_seq = ranked.seq
from ranked
where a.id = ranked.id;

alter table public.billing_payment_attempts
  alter column attempt_seq set default 1;

update public.billing_payment_attempts
set attempt_seq = 1
where attempt_seq is null;

alter table public.billing_payment_attempts
  alter column attempt_seq set not null;

do $$
begin
  alter table public.billing_payment_attempts
    drop constraint if exists billing_payment_attempts_supersedes_fkey;
  alter table public.billing_payment_attempts
    add constraint billing_payment_attempts_supersedes_fkey
    foreign key (supersedes_attempt_id)
    references public.billing_payment_attempts (id)
    on delete restrict;

  alter table public.billing_payment_attempts
    drop constraint if exists billing_payment_attempts_open_client_op_chk;
  alter table public.billing_payment_attempts
    add constraint billing_payment_attempts_open_client_op_chk
    check (
      open_client_op_id is null
      or (
        char_length(btrim(open_client_op_id)) between 1 and 128
        and open_client_op_id = btrim(open_client_op_id)
      )
    );
exception
  when duplicate_object then null;
end;
$$;

-- One successor per confirmed-failed attempt.
create unique index if not exists billing_payment_attempts_supersedes_uidx
  on public.billing_payment_attempts (supersedes_attempt_id)
  where supersedes_attempt_id is not null;

-- Idempotent open key within an order.
create unique index if not exists billing_payment_attempts_order_open_op_uidx
  on public.billing_payment_attempts (order_id, open_client_op_id)
  where open_client_op_id is not null;

create unique index if not exists billing_payment_attempts_order_seq_uidx
  on public.billing_payment_attempts (order_id, attempt_seq);

comment on column public.billing_payment_attempts.attempt_seq is
  'FIX-04: monotonic attempt sequence per order. Current identity = max seq under order lock.';
comment on column public.billing_payment_attempts.supersedes_attempt_id is
  'FIX-04: prior confirmed-failed attempt this row replaces. Unique → idempotent open.';
comment on column public.billing_payment_attempts.open_client_op_id is
  'FIX-04: client operation id for explicit open-after-failed; mismatch on replay rejects.';

-- ---------------------------------------------------------------------------
-- Resolve-or-create: return CURRENT (latest) attempt; create only if none.
-- ---------------------------------------------------------------------------
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

  -- CURRENT attempt = highest sequence (not the oldest failed row).
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
  'FIX-04: lock order; return CURRENT (max seq) attempt; bootstrap only when zero rows.';

-- ---------------------------------------------------------------------------
-- Lifecycle status: may set intent_created / provider_submitted / unresolved.
-- May NOT set failed (confirmed rejection requires bound provider evidence).
-- ---------------------------------------------------------------------------
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

  -- unresolved stays non-final unless confirm-with-evidence path is used.
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
  'FIX-04: order then attempt lock. Cannot set failed/paid. Unresolved→failed blocked.';

-- ---------------------------------------------------------------------------
-- Confirm failed: requires existing failed provider event bound to this attempt.
-- ---------------------------------------------------------------------------
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

  -- Reject cosmetic flags — only durable event binding counts.
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

  if v_attempt.status = 'failed' then
    -- Idempotent confirm replay when same evidence still binds.
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
    select *
    into v_event
    from public.billing_provider_events e
    where e.id = v_event_id
      and e.company_id = p_company_id
      and e.payment_attempt_id = p_attempt_id
      and e.event_status = 'failed'
    for update;
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
  else
    raise exception 'billing_confirm_payment_attempt_failed: evidence must cite provider_event_id or provider_transaction_id bound to this attempt'
      using errcode = '22023';
  end if;

  if not found then
    raise exception 'billing_confirm_payment_attempt_failed: no failed provider event bound to this attempt'
      using errcode = '22023';
  end if;

  if v_event.payment_attempt_id is distinct from p_attempt_id
     or v_event.company_id is distinct from p_company_id
     or v_event.event_status is distinct from 'failed' then
    raise exception 'billing_confirm_payment_attempt_failed: evidence not bound to attempt'
      using errcode = '22023';
  end if;

  update public.billing_payment_attempts
  set status = 'failed',
      updated_at = now()
  where id = p_attempt_id
    and company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'payment_attempt_id', p_attempt_id,
    'status', 'failed',
    'provider_event_id', v_event.id,
    'attempt_seq', v_attempt.attempt_seq,
    'is_current', true
  );
end;
$$;

comment on function private.billing_confirm_payment_attempt_failed(uuid, uuid, jsonb) is
  'FIX-04: mark failed only with billing_provider_events failed row bound to the attempt.';

-- ---------------------------------------------------------------------------
-- Explicit open after confirmed failed — idempotent by prior + open_client_op.
-- ---------------------------------------------------------------------------
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

  if v_prior.status is distinct from 'failed' then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior must be confirmed failed (got %)',
      v_prior.status
      using errcode = '22023';
  end if;

  -- Evidence must still be bound (failed event on prior). No status-only shortcut.
  if not exists (
    select 1
    from public.billing_provider_events e
    where e.payment_attempt_id = p_prior_attempt_id
      and e.company_id = p_company_id
      and e.event_status = 'failed'
  ) then
    raise exception 'billing_open_payment_attempt_after_confirmed_failed: prior lacks bound failed provider event'
      using errcode = '22023';
  end if;

  -- Idempotent: successor for this prior already exists.
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

  -- Same open_client_op already on this order (replay / concurrent).
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

  -- Current must be the confirmed-failed prior (no unsettled newer row).
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
      -- Concurrent twin: re-read successor / open_op winner.
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
  'FIX-04: idempotent open after evidenced failed prior; concurrent replay returns same successor.';

-- Drop old 2-arg open signature if present (replaced by 4-arg).
drop function if exists public.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid);
drop function if exists private.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid);

-- ---------------------------------------------------------------------------
-- Public wrappers (service_role)
-- ---------------------------------------------------------------------------
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

create or replace function public.billing_confirm_payment_attempt_failed(
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
    raise exception 'billing_confirm_payment_attempt_failed: forbidden for role %', v_jwt_role
      using errcode = '42501';
  end if;
  if v_jwt_role is distinct from 'service_role'
     and current_user is distinct from 'postgres'
     and current_user is distinct from 'supabase_admin' then
    raise exception 'billing_confirm_payment_attempt_failed: forbidden for role % (user %)',
      coalesce(nullif(v_jwt_role, ''), '<none>'), current_user
      using errcode = '42501';
  end if;
  return private.billing_confirm_payment_attempt_failed(p_attempt_id, p_company_id, p_evidence);
end;
$$;

create or replace function public.billing_open_payment_attempt_after_confirmed_failed(
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
  return private.billing_open_payment_attempt_after_confirmed_failed(
    p_order_id, p_company_id, p_prior_attempt_id, p_open_client_op_id
  );
end;
$$;

revoke all on function public.billing_resolve_or_create_payment_attempt(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.billing_set_payment_attempt_lifecycle_status(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.billing_confirm_payment_attempt_failed(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid, uuid, text)
  from public, anon, authenticated;

do $$
begin
  grant execute on function public.billing_resolve_or_create_payment_attempt(uuid, uuid) to service_role;
  grant execute on function public.billing_set_payment_attempt_lifecycle_status(uuid, uuid, text) to service_role;
  grant execute on function public.billing_confirm_payment_attempt_failed(uuid, uuid, jsonb) to service_role;
  grant execute on function public.billing_open_payment_attempt_after_confirmed_failed(uuid, uuid, uuid, text) to service_role;
exception
  when undefined_object then null;
end;
$$;
