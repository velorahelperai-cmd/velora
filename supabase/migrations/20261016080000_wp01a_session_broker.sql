-- WP01A: server session broker registry, auth intents, operations, admission barrier.
-- Additive only. Preserves check_app_session / app_session_is_valid / master_revoke_account_sessions OIDs.
begin;

do $$begin
  if to_regnamespace('private') is null then raise exception 'WP01A_PRIVATE_SCHEMA_MISSING';end if;
  if to_regprocedure('public.master_revoke_account_sessions(uuid)') is null then raise exception 'WP01A_REVOKE_RPC_MISSING';end if;
  if to_regprocedure('public.check_app_session(boolean)') is null then raise exception 'WP01A_CHECK_SESSION_MISSING';end if;
  if to_regprocedure('public.app_session_is_valid()') is null then raise exception 'WP01A_SESSION_VALID_MISSING';end if;
end;$$;

create table if not exists public.vel_broker_sessions (
  id uuid primary key default gen_random_uuid(),
  handle_hash text not null unique,
  cookie_name text not null unique,
  generation text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  native_session_id uuid not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  token_expires_at timestamptz not null,
  refresh_revision bigint not null default 0,
  auth_intent_id uuid,
  parent_handle_hash text,
  status text not null check (status in ('active','quarantined','revoked','tombstoned')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz
);
create unique index if not exists vel_broker_sessions_active_native_uidx
  on public.vel_broker_sessions (user_id, native_session_id)
  where status = 'active';
alter table public.vel_broker_sessions enable row level security;
revoke all on public.vel_broker_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.vel_broker_sessions to service_role;

create table if not exists public.vel_broker_auth_intents (
  id uuid primary key default gen_random_uuid(),
  ordinal bigserial not null unique,
  purpose text not null,
  expected_parent_handle_hash text,
  user_id uuid references auth.users(id) on delete set null,
  pkce_verifier_enc text,
  state_nonce text not null unique,
  status text not null check (status in ('reserved','committed','rejected','expired','frozen_target')),
  expires_at timestamptz not null,
  committed_native_session_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.vel_broker_auth_intents enable row level security;
revoke all on public.vel_broker_auth_intents from public, anon, authenticated;
grant select, insert, update, delete on public.vel_broker_auth_intents to service_role;

create table if not exists public.vel_broker_operations (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  kind text not null check (kind in ('logout','password_revoke')),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  target_native_session_id uuid,
  cutoff timestamptz,
  target_snapshot jsonb not null default '[]'::jsonb,
  stages jsonb not null default '{}'::jsonb,
  status text not null,
  credential_mutated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.vel_broker_operations enable row level security;
revoke all on public.vel_broker_operations from public, anon, authenticated;
grant select, insert, update, delete on public.vel_broker_operations to service_role;

create table if not exists public.vel_broker_admission (
  user_id uuid primary key references auth.users(id) on delete cascade,
  barrier_operation_key text,
  barrier_active boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.vel_broker_admission enable row level security;
revoke all on public.vel_broker_admission from public, anon, authenticated;
grant select, insert, update, delete on public.vel_broker_admission to service_role;

create or replace function public.vel_broker_set_admission_barrier(
  p_user_id uuid,
  p_operation_key text,
  p_active boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, p_operation_key, coalesce(p_active, false), clock_timestamp())
  on conflict (user_id) do update
    set barrier_operation_key = excluded.barrier_operation_key,
        barrier_active = excluded.barrier_active,
        updated_at = excluded.updated_at;
  return true;
end;
$$;
revoke all on function public.vel_broker_set_admission_barrier(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.vel_broker_set_admission_barrier(uuid, text, boolean) to service_role;

create or replace function public.vel_broker_admission_allows(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.vel_broker_admission a
    where a.user_id = p_user_id and a.barrier_active
  );
$$;
revoke all on function public.vel_broker_admission_allows(uuid) from public, anon, authenticated;
grant execute on function public.vel_broker_admission_allows(uuid) to service_role;

-- Immutable cutoff per operation_key. Resume never advances cutoff for the same operation.
create or replace function public.vel_broker_revoke_sessions_at(
  p_expected_user_id uuid,
  p_operation_key text,
  p_cutoff timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n timestamptz;
  op_cutoff timestamptz;
  is_service boolean := current_setting('role', true) = 'service_role';
begin
  if p_operation_key is null or length(p_operation_key) < 16 or p_cutoff is null then
    return false;
  end if;
  if not is_service then
    if current_setting('role', true) is distinct from 'authenticated'
      or auth.uid() is distinct from p_expected_user_id
      or not public.app_session_is_valid() then
      return false;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text || ':session-revocation', 0));
  if not is_service and not public.app_session_is_valid() then
    return false;
  end if;

  select cutoff into op_cutoff
  from public.vel_broker_operations
  where operation_key = p_operation_key and actor_user_id = p_expected_user_id
  for update;
  if not found then
    return false;
  end if;
  if op_cutoff is null then
    n := p_cutoff;
    update public.vel_broker_operations
      set cutoff = n, updated_at = clock_timestamp()
      where operation_key = p_operation_key and cutoff is null;
    select cutoff into n from public.vel_broker_operations where operation_key = p_operation_key;
  else
    n := op_cutoff;
  end if;

  insert into private.master_account_session_revocations(user_id, revoked_before, requested_at)
  values (p_expected_user_id, n, clock_timestamp())
  on conflict (user_id) do update
    set revoked_before = greatest(private.master_account_session_revocations.revoked_before, excluded.revoked_before),
        requested_at = excluded.requested_at;

  insert into private.app_session_activity(session_id, user_id, last_activity_at, expired_at)
  select s.id, s.user_id, least(s.created_at, n), n
  from auth.sessions s
  where s.user_id = p_expected_user_id and s.created_at <= n
  on conflict (session_id) do update
    set expired_at = coalesce(private.app_session_activity.expired_at, excluded.expired_at);

  return true;
end;
$$;
revoke all on function public.vel_broker_revoke_sessions_at(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vel_broker_revoke_sessions_at(uuid, text, timestamptz) to authenticated, service_role;

-- Minimal original-operation status for recovery after self-revoke (no JWT privilege).
create or replace function public.vel_broker_operation_status(p_operation_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.vel_broker_operations%rowtype;
begin
  if p_operation_key is null or length(p_operation_key) < 16 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  select * into op from public.vel_broker_operations where operation_key = p_operation_key;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if current_setting('role', true) is distinct from 'service_role'
    and (current_setting('role', true) is distinct from 'authenticated' or auth.uid() is distinct from op.actor_user_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return jsonb_build_object(
    'ok', true,
    'operation_key', op.operation_key,
    'kind', op.kind,
    'status', op.status,
    'stages', op.stages,
    'has_cutoff', op.cutoff is not null,
    'credential_mutated', op.credential_mutated_at is not null
  );
end;
$$;
revoke all on function public.vel_broker_operation_status(text) from public, anon;
grant execute on function public.vel_broker_operation_status(text) to authenticated, service_role;

-- Capability probe last so revoke_at and registry objects already exist.
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
  return jsonb_build_object(
    'ok', revoke_boolean and idle_wrappers and broker_registry and revoke_at_operation,
    'contract_version', 1,
    'revoke_boolean', revoke_boolean,
    'idle_wrappers', idle_wrappers,
    'broker_registry', broker_registry,
    'revoke_at_operation', revoke_at_operation,
    'codes', to_jsonb(codes)
  );
end;
$$;
revoke all on function public.vel_broker_capability_probe() from public, anon, authenticated;
grant execute on function public.vel_broker_capability_probe() to service_role;

commit;
