-- WP01A-CORRECTION: authoritative admit ordinal, refresh lease, barrier ownership, probe contract.
-- Additive only. Does not drop prior wrappers/OIDs.
begin;

do $$begin
  if to_regclass('public.vel_broker_sessions') is null then
    raise exception 'WP01A_CORRECTION_REGISTRY_MISSING';
  end if;
end;$$;

alter table public.vel_broker_sessions
  add column if not exists auth_ordinal bigint not null default 0,
  add column if not exists refresh_lease_until timestamptz,
  add column if not exists refresh_lease_token text;

create index if not exists vel_broker_sessions_auth_ordinal_idx
  on public.vel_broker_sessions (auth_ordinal desc, created_at desc);

-- Claim refresh lease before provider rotation (C4).
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
  if p_lease_ms is null or p_lease_ms < 1000 or p_lease_ms > 60000 then
    return null;
  end if;
  update public.vel_broker_sessions
    set refresh_lease_until = clock_timestamp() + make_interval(secs => (p_lease_ms::numeric / 1000.0)),
        refresh_lease_token = token,
        updated_at = clock_timestamp()
  where id = p_registry_id
    and status = 'active'
    and refresh_revision = p_expected_revision
    and (refresh_lease_until is null or refresh_lease_until < clock_timestamp());
  get diagnostics n = row_count;
  if n = 1 then return token; end if;
  return null;
end;
$$;
revoke all on function public.vel_broker_claim_refresh(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.vel_broker_claim_refresh(uuid, bigint, integer) to service_role;

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
  update public.vel_broker_sessions
    set refresh_lease_until = null,
        refresh_lease_token = null,
        updated_at = clock_timestamp()
  where id = p_registry_id
    and refresh_lease_token is not distinct from p_lease_token;
  return found;
end;
$$;
revoke all on function public.vel_broker_release_refresh(uuid, text) from public, anon, authenticated;
grant execute on function public.vel_broker_release_refresh(uuid, text) to service_role;

-- Barrier ownership CAS: activate only when free or same operation; release only by owner.
create or replace function public.vel_broker_set_admission_barrier(
  p_user_id uuid,
  p_operation_key text,
  p_active boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_key text;
  cur_active boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  if p_operation_key is null or length(p_operation_key) < 16 then
    return false;
  end if;
  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, case when p_active then p_operation_key else null end, coalesce(p_active, false), clock_timestamp())
  on conflict (user_id) do nothing;

  select barrier_operation_key, barrier_active into cur_key, cur_active
  from public.vel_broker_admission where user_id = p_user_id for update;

  if p_active then
    if cur_active and cur_key is distinct from p_operation_key then
      return false;
    end if;
    update public.vel_broker_admission
      set barrier_operation_key = p_operation_key,
          barrier_active = true,
          updated_at = clock_timestamp()
    where user_id = p_user_id;
    return true;
  end if;

  -- Release only by owning operation.
  if cur_active and cur_key is distinct from p_operation_key then
    return false;
  end if;
  update public.vel_broker_admission
    set barrier_active = false,
        barrier_operation_key = null,
        updated_at = clock_timestamp()
  where user_id = p_user_id;
  return true;
end;
$$;

-- Atomic admit decision under barrier + intent commit (C5/C1 ordinal).
create or replace function public.vel_broker_commit_intent_ordinal(
  p_intent_id uuid,
  p_user_id uuid,
  p_native_session_id uuid
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  ord bigint;
  allowed boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return null;
  end if;
  select public.vel_broker_admission_allows(p_user_id) into allowed;
  if not allowed then
    return null;
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
  return ord;
end;
$$;
revoke all on function public.vel_broker_commit_intent_ordinal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.vel_broker_commit_intent_ordinal(uuid, uuid, uuid) to service_role;

-- Resume helper: freeze snapshot once for password ops (idempotent).
create or replace function public.vel_broker_freeze_operation_snapshot(
  p_operation_key text,
  p_actor_user_id uuid,
  p_snapshot jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  update public.vel_broker_operations
    set target_snapshot = p_snapshot,
        updated_at = clock_timestamp()
  where operation_key = p_operation_key
    and actor_user_id = p_actor_user_id
    and (target_snapshot is null or target_snapshot = '[]'::jsonb);
  -- Already frozen with same or prior non-empty snapshot: success without rewrite.
  if not found then
    return exists (
      select 1 from public.vel_broker_operations
      where operation_key = p_operation_key
        and actor_user_id = p_actor_user_id
        and target_snapshot is not null
        and target_snapshot <> '[]'::jsonb
    );
  end if;
  return true;
end;
$$;
revoke all on function public.vel_broker_freeze_operation_snapshot(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.vel_broker_freeze_operation_snapshot(text, uuid, jsonb) to service_role;

-- Strengthened capability probe: exact column/function contract (not existence-only).
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
  has_auth_ordinal boolean := false;
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
    and to_regprocedure('public.vel_broker_release_refresh(uuid,text)') is not null;
  if not refresh_lease then codes := array_append(codes, 'REFRESH_LEASE_MISSING'); end if;
  admit_ordinal := to_regprocedure('public.vel_broker_commit_intent_ordinal(uuid,uuid,uuid)') is not null;
  if not admit_ordinal then codes := array_append(codes, 'ADMIT_ORDINAL_MISSING'); end if;
  has_auth_ordinal := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vel_broker_sessions' and column_name = 'auth_ordinal'
  );
  if not has_auth_ordinal then codes := array_append(codes, 'AUTH_ORDINAL_COLUMN_MISSING'); end if;
  return jsonb_build_object(
    'ok', revoke_boolean and idle_wrappers and broker_registry and revoke_at_operation
      and refresh_lease and admit_ordinal and has_auth_ordinal,
    'contract_version', 1,
    'revoke_boolean', revoke_boolean,
    'idle_wrappers', idle_wrappers,
    'broker_registry', broker_registry,
    'revoke_at_operation', revoke_at_operation,
    'refresh_lease', refresh_lease,
    'admit_ordinal', admit_ordinal,
    'auth_ordinal_column', has_auth_ordinal,
    'codes', to_jsonb(codes)
  );
end;
$$;

commit;
