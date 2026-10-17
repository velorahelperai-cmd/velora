-- WP01A-CORRECTION R2: atomic admit, lineage fence, refresh state, freeze flag, strict probe.
-- Additive only. Does not drop retained wrappers/OIDs.
begin;

do $$begin
  if to_regclass('public.vel_broker_sessions') is null then
    raise exception 'WP01A_R2_REGISTRY_MISSING';
  end if;
end;$$;

alter table public.vel_broker_sessions
  add column if not exists refresh_state text not null default 'idle'
    check (refresh_state in ('idle','rotating','uncertain'));

alter table public.vel_broker_operations
  add column if not exists snapshot_frozen boolean not null default false,
  add column if not exists target_receipts jsonb not null default '{}'::jsonb;

-- Shared ordinal domain: intents bigserial sequence (no app clock/random).
create or replace function public.vel_broker_next_auth_ordinal()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq regclass;
  ord bigint;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return null;
  end if;
  seq := pg_get_serial_sequence('public.vel_broker_auth_intents', 'ordinal');
  if seq is null then
    return null;
  end if;
  execute format('select nextval(%L)', seq) into ord;
  return ord;
end;
$$;
revoke all on function public.vel_broker_next_auth_ordinal() from public, anon, authenticated;
grant execute on function public.vel_broker_next_auth_ordinal() to service_role;

-- Atomic admit: barrier lock + intent/parent/ordinal + registry insert + fence superseded.
create or replace function public.vel_broker_admit_session(
  p_intent_id uuid,
  p_user_id uuid,
  p_native_session_id uuid,
  p_handle_hash text,
  p_cookie_name text,
  p_generation text,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_token_expires_at timestamptz,
  p_parent_handle_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ord bigint;
  allowed boolean;
  intent_parent text;
  intent_status text;
  registry_id uuid;
  n int;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  if p_user_id is null or p_native_session_id is null
     or p_handle_hash is null or p_cookie_name is null or p_generation is null
     or p_access_token_enc is null or p_refresh_token_enc is null
     or p_token_expires_at is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, null, false, clock_timestamp())
  on conflict (user_id) do nothing;

  perform 1 from public.vel_broker_admission where user_id = p_user_id for update;
  select not barrier_active into allowed
  from public.vel_broker_admission where user_id = p_user_id;
  if not coalesce(allowed, false) then
    return jsonb_build_object('ok', false, 'code', 'BARRIER');
  end if;

  if p_intent_id is not null then
    select status, expected_parent_handle_hash, ordinal
      into intent_status, intent_parent, ord
    from public.vel_broker_auth_intents
    where id = p_intent_id
    for update;
    if intent_status is distinct from 'reserved' then
      return jsonb_build_object('ok', false, 'code', 'INTENT_STALE');
    end if;
    if intent_parent is not null and intent_parent is distinct from p_parent_handle_hash then
      return jsonb_build_object('ok', false, 'code', 'PARENT_MISMATCH');
    end if;
    update public.vel_broker_auth_intents
      set status = 'committed',
          committed_native_session_id = p_native_session_id,
          user_id = p_user_id,
          updated_at = clock_timestamp()
    where id = p_intent_id
      and status = 'reserved'
      and expires_at > clock_timestamp()
    returning ordinal into ord;
    if ord is null then
      return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED');
    end if;
  else
    ord := public.vel_broker_next_auth_ordinal();
    if ord is null then
      return jsonb_build_object('ok', false, 'code', 'ORDINAL');
    end if;
  end if;

  -- Fence superseded lineage so deleted B cookie cannot resurrect A.
  update public.vel_broker_sessions
    set status = 'tombstoned',
        updated_at = clock_timestamp()
  where user_id = p_user_id
    and status = 'active'
    and native_session_id is distinct from p_native_session_id;

  insert into public.vel_broker_sessions (
    handle_hash, cookie_name, generation, user_id, native_session_id,
    access_token_enc, refresh_token_enc, token_expires_at,
    auth_ordinal, auth_intent_id, parent_handle_hash, status,
    refresh_state, last_seen_at
  ) values (
    p_handle_hash, p_cookie_name, p_generation, p_user_id, p_native_session_id,
    p_access_token_enc, p_refresh_token_enc, p_token_expires_at,
    ord, p_intent_id, p_parent_handle_hash, 'active',
    'idle', clock_timestamp()
  )
  returning id into registry_id;

  return jsonb_build_object(
    'ok', true,
    'ordinal', ord,
    'registry_id', registry_id
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
end;
$$;
revoke all on function public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text)
  to service_role;

-- Refresh claim: no time-based steal; idle only.
create or replace function public.vel_broker_claim_refresh(
  p_registry_id uuid,
  p_expected_revision bigint,
  p_lease_ms integer default 15000
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(16), 'hex');
  n int;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return null;
  end if;
  if p_lease_ms is null or p_lease_ms < 1000 or p_lease_ms > 120000 then
    return null;
  end if;
  update public.vel_broker_sessions
    set refresh_lease_until = clock_timestamp() + make_interval(secs => (p_lease_ms::numeric / 1000.0)),
        refresh_lease_token = token,
        refresh_state = 'rotating',
        updated_at = clock_timestamp()
  where id = p_registry_id
    and status = 'active'
    and refresh_revision = p_expected_revision
    and coalesce(refresh_state, 'idle') = 'idle';
  get diagnostics n = row_count;
  if n = 1 then return token; end if;
  return null;
end;
$$;

create or replace function public.vel_broker_mark_refresh_uncertain(
  p_registry_id uuid,
  p_lease_token text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  update public.vel_broker_sessions
    set refresh_state = 'uncertain',
        updated_at = clock_timestamp()
  where id = p_registry_id
    and refresh_lease_token is not distinct from p_lease_token
    and refresh_state = 'rotating';
  return found;
end;
$$;
revoke all on function public.vel_broker_mark_refresh_uncertain(uuid, text) from public, anon, authenticated;
grant execute on function public.vel_broker_mark_refresh_uncertain(uuid, text) to service_role;

create or replace function public.vel_broker_release_refresh(
  p_registry_id uuid,
  p_lease_token text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  -- Never clear uncertain via release — only CAS / explicit reconcile.
  update public.vel_broker_sessions
    set refresh_lease_until = null,
        refresh_lease_token = null,
        refresh_state = 'idle',
        updated_at = clock_timestamp()
  where id = p_registry_id
    and refresh_lease_token is not distinct from p_lease_token
    and refresh_state is distinct from 'uncertain';
  return found;
end;
$$;

-- Freeze once, including empty snapshot.
create or replace function public.vel_broker_freeze_operation_snapshot(
  p_operation_key text,
  p_actor_user_id uuid,
  p_snapshot jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  already boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  select snapshot_frozen into already
  from public.vel_broker_operations
  where operation_key = p_operation_key
    and actor_user_id = p_actor_user_id
  for update;
  if already is null then
    return false;
  end if;
  if already then
    return true;
  end if;
  update public.vel_broker_operations
    set target_snapshot = coalesce(p_snapshot, '[]'::jsonb),
        snapshot_frozen = true,
        updated_at = clock_timestamp()
  where operation_key = p_operation_key
    and actor_user_id = p_actor_user_id
    and snapshot_frozen = false;
  return found;
end;
$$;

-- Strengthened probe: types/defaults/grants + exact contract_version.
create or replace function public.vel_broker_capability_probe()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  codes text[] := array[]::text[];
  revoke_boolean boolean := false;
  idle_wrappers boolean := false;
  broker_registry boolean := false;
  revoke_at_operation boolean := false;
  refresh_lease boolean := false;
  admit_ordinal boolean := false;
  admit_atomic boolean := false;
  has_auth_ordinal boolean := false;
  auth_ordinal_bigint boolean := false;
  refresh_state_ok boolean := false;
  snapshot_frozen_ok boolean := false;
begin
  if to_regprocedure('public.master_revoke_account_sessions(uuid)') is null then
    codes := array_append(codes, 'REVOKE_RPC_MISSING');
  else
    revoke_boolean := pg_get_function_result('public.master_revoke_account_sessions(uuid)'::regprocedure) = 'boolean';
    if not revoke_boolean then codes := array_append(codes, 'REVOKE_RPC_NOT_BOOLEAN'); end if;
  end if;
  idle_wrappers := to_regprocedure('public.check_app_session(boolean)') is not null
    and to_regprocedure('public.app_session_is_valid()') is not null;
  if not idle_wrappers then codes := array_append(codes, 'IDLE_WRAPPERS_MISSING'); end if;
  broker_registry := to_regclass('public.vel_broker_sessions') is not null
    and to_regclass('public.vel_broker_auth_intents') is not null
    and to_regclass('public.vel_broker_operations') is not null
    and to_regclass('public.vel_broker_admission') is not null;
  if not broker_registry then codes := array_append(codes, 'BROKER_REGISTRY_MISSING'); end if;
  revoke_at_operation := to_regprocedure('public.vel_broker_revoke_sessions_at(uuid,text,timestamptz)') is not null;
  if not revoke_at_operation then codes := array_append(codes, 'REVOKE_AT_MISSING'); end if;
  refresh_lease := to_regprocedure('public.vel_broker_claim_refresh(uuid,bigint,integer)') is not null
    and to_regprocedure('public.vel_broker_release_refresh(uuid,text)') is not null
    and to_regprocedure('public.vel_broker_mark_refresh_uncertain(uuid,text)') is not null;
  if not refresh_lease then codes := array_append(codes, 'REFRESH_LEASE_MISSING'); end if;
  admit_ordinal := to_regprocedure('public.vel_broker_next_auth_ordinal()') is not null;
  if not admit_ordinal then codes := array_append(codes, 'ORDINAL_SEQ_MISSING'); end if;
  admit_atomic := to_regprocedure('public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text)') is not null;
  if not admit_atomic then codes := array_append(codes, 'ADMIT_ATOMIC_MISSING'); end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_sessions' and column_name='auth_ordinal'
      and data_type='bigint'
  ) into auth_ordinal_bigint;
  has_auth_ordinal := auth_ordinal_bigint;
  if not has_auth_ordinal then codes := array_append(codes, 'AUTH_ORDINAL_COLUMN_MISSING'); end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_sessions' and column_name='refresh_state'
  ) into refresh_state_ok;
  if not refresh_state_ok then codes := array_append(codes, 'REFRESH_STATE_MISSING'); end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_operations' and column_name='snapshot_frozen'
  ) into snapshot_frozen_ok;
  if not snapshot_frozen_ok then codes := array_append(codes, 'SNAPSHOT_FROZEN_MISSING'); end if;

  return jsonb_build_object(
    'ok', (revoke_boolean and idle_wrappers and broker_registry and revoke_at_operation
      and refresh_lease and admit_ordinal and admit_atomic and has_auth_ordinal
      and refresh_state_ok and snapshot_frozen_ok),
    'contract_version', 1,
    'revoke_boolean', revoke_boolean,
    'idle_wrappers', idle_wrappers,
    'broker_registry', broker_registry,
    'revoke_at_operation', revoke_at_operation,
    'refresh_lease', refresh_lease,
    'admit_ordinal', admit_ordinal,
    'admit_atomic', admit_atomic,
    'auth_ordinal_column', has_auth_ordinal,
    'refresh_state_column', refresh_state_ok,
    'snapshot_frozen_column', snapshot_frozen_ok,
    'codes', to_jsonb(codes)
  );
end;
$$;

commit;
