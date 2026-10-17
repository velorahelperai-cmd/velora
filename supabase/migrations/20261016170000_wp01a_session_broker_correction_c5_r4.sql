-- WP01A-CORRECTION C5-R4: continuity bind, bound intent/admit/resolve,
-- strict complete revocation, provider journal fields. Additive — no DROP.
begin;

create table if not exists public.vel_broker_browser_lineages (
  id uuid primary key default gen_random_uuid(),
  bootstrap_hash text not null unique,
  latest_reserved_generation bigint not null default 0,
  current_generation bigint not null default 0,
  current_registry_id uuid null,
  state text not null default 'active' check (state in ('active', 'closed')),
  valid_until timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.vel_broker_browser_lineages enable row level security;
revoke all on public.vel_broker_browser_lineages from public, anon, authenticated;
grant select, insert, update, delete on public.vel_broker_browser_lineages to service_role;

alter table public.vel_broker_operations
  add column if not exists revision bigint not null default 0,
  add column if not exists completion_receipt jsonb null;

alter table public.vel_broker_auth_intents
  add column if not exists lineage_generation bigint null,
  add column if not exists request_nonce uuid null,
  add column if not exists provider_state text not null default 'ready'
    check (provider_state in ('ready','in_flight','session_captured','unknown','rejected')),
  add column if not exists cleanup_state text not null default 'not_needed'
    check (cleanup_state in ('not_needed','pending','confirmed','unknown','rejected')),
  add column if not exists provider_access_enc text null,
  add column if not exists provider_refresh_enc text null,
  add column if not exists provider_expires_at timestamptz null;

create unique index if not exists vel_broker_auth_intents_lineage_nonce_uidx
  on public.vel_broker_auth_intents (browser_lineage_id, request_nonce)
  where request_nonce is not null and browser_lineage_id is not null;

-- Fail-close old issue RPC for new consumers (keep signature).
create or replace function public.vel_broker_issue_browser_attempt(
  p_attempt_id uuid default null,
  p_issue_seq bigint default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'code', 'DEPRECATED_USE_CONTINUITY');
$$;

create or replace function public.vel_broker_bind_browser_continuity(p_bootstrap_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid;
  st text;
  cur_gen bigint;
  cur_reg uuid;
  vu timestamptz;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  if p_bootstrap_hash is null or length(p_bootstrap_hash) < 32 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  insert into public.vel_broker_browser_lineages(bootstrap_hash)
  values (p_bootstrap_hash)
  on conflict (bootstrap_hash) do nothing;
  select id, state, current_generation, current_registry_id, valid_until
    into row_id, st, cur_gen, cur_reg, vu
  from public.vel_broker_browser_lineages
  where bootstrap_hash = p_bootstrap_hash
  for update;
  if row_id is null then
    return jsonb_build_object('ok', false, 'code', 'BIND_FAILED');
  end if;
  if st = 'closed' then
    return jsonb_build_object('ok', false, 'code', 'CLOSED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'browser_lineage_id', row_id,
    'current_generation', cur_gen,
    'current_registry_id', cur_reg,
    'state', st,
    'valid_until', vu
  );
end;
$$;
revoke all on function public.vel_broker_bind_browser_continuity(text) from public, anon, authenticated;
grant execute on function public.vel_broker_bind_browser_continuity(text) to service_role;

-- Read-only lookup: never INSERT (R4-F03). Auth/middleware readers must use this.
create or replace function public.vel_broker_lookup_browser_continuity(p_bootstrap_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid;
  st text;
  cur_gen bigint;
  cur_reg uuid;
  vu timestamptz;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  if p_bootstrap_hash is null or length(p_bootstrap_hash) < 32 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  select id, state, current_generation, current_registry_id, valid_until
    into row_id, st, cur_gen, cur_reg, vu
  from public.vel_broker_browser_lineages
  where bootstrap_hash = p_bootstrap_hash;
  if row_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if st = 'closed' then
    return jsonb_build_object('ok', false, 'code', 'CLOSED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'browser_lineage_id', row_id,
    'current_generation', cur_gen,
    'current_registry_id', cur_reg,
    'state', st,
    'valid_until', vu
  );
end;
$$;
revoke all on function public.vel_broker_lookup_browser_continuity(text) from public, anon, authenticated;
grant execute on function public.vel_broker_lookup_browser_continuity(text) to service_role;

create or replace function public.vel_broker_close_browser_continuity(
  p_bootstrap_hash text,
  p_reset_nonce uuid,
  p_expected_registry_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  root public.vel_broker_browser_lineages%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  if p_bootstrap_hash is null or p_reset_nonce is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  select * into root from public.vel_broker_browser_lineages
  where bootstrap_hash = p_bootstrap_hash for update;
  if root.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if root.state = 'closed' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'state', 'closed');
  end if;
  if root.current_registry_id is not null then
    if p_expected_registry_id is null
       or root.current_registry_id is distinct from p_expected_registry_id then
      return jsonb_build_object('ok', false, 'code', 'CAPTURE_MISMATCH');
    end if;
  end if;
  update public.vel_broker_browser_lineages
    set state = 'closed',
        current_registry_id = null,
        updated_at = clock_timestamp()
  where id = root.id and state = 'active';
  return jsonb_build_object(
    'ok', true,
    'state', 'closed',
    'reset_nonce', p_reset_nonce,
    'browser_lineage_id', root.id
  );
end;
$$;
revoke all on function public.vel_broker_close_browser_continuity(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.vel_broker_close_browser_continuity(text, uuid, uuid)
  to service_role;

create or replace function public.vel_broker_reserve_bound_intent(
  p_bootstrap_hash text,
  p_request_nonce uuid,
  p_purpose text,
  p_recovery_operation_key text default null,
  p_ttl_seconds integer default 600
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  root public.vel_broker_browser_lineages%rowtype;
  existing public.vel_broker_auth_intents%rowtype;
  gen bigint;
  intent_id uuid;
  state_nonce text;
  exp timestamptz;
  parent_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  if p_bootstrap_hash is null or p_request_nonce is null or p_purpose is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  select * into root from public.vel_broker_browser_lineages
  where bootstrap_hash = p_bootstrap_hash for update;
  if root.id is null then
    return jsonb_build_object('ok', false, 'code', 'ROOT_UNKNOWN');
  end if;
  if root.state is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'CLOSED');
  end if;
  select * into existing from public.vel_broker_auth_intents
  where browser_lineage_id = root.id and request_nonce = p_request_nonce;
  if existing.id is not null then
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'intent_id', existing.id,
      'state_nonce', existing.state_nonce,
      'lineage_generation', existing.lineage_generation,
      'browser_lineage_id', root.id,
      'provider_state', existing.provider_state,
      'status', existing.status
    );
  end if;
  gen := root.latest_reserved_generation + 1;
  update public.vel_broker_browser_lineages
    set latest_reserved_generation = gen, updated_at = clock_timestamp()
  where id = root.id;
  if root.current_registry_id is not null then
    select handle_hash into parent_hash from public.vel_broker_sessions
    where id = root.current_registry_id;
  end if;
  -- empty search_path: qualify pgcrypto (extensions schema on Supabase).
  state_nonce := encode(extensions.gen_random_bytes(32), 'base64');
  exp := clock_timestamp() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 600), 60));
  insert into public.vel_broker_auth_intents(
    purpose, expected_parent_handle_hash, state_nonce, status, expires_at,
    browser_lineage_id, recovery_operation_key, lineage_generation, request_nonce,
    provider_state, cleanup_state
  ) values (
    p_purpose, parent_hash, state_nonce, 'reserved', exp,
    root.id, p_recovery_operation_key, gen, p_request_nonce,
    'ready', 'not_needed'
  ) returning id into intent_id;
  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'intent_id', intent_id,
    'state_nonce', state_nonce,
    'lineage_generation', gen,
    'browser_lineage_id', root.id,
    'provider_state', 'ready',
    'status', 'reserved',
    'parent_handle_hash', parent_hash
  );
end;
$$;
revoke all on function public.vel_broker_reserve_bound_intent(text, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.vel_broker_reserve_bound_intent(text, uuid, text, text, integer)
  to service_role;

create or replace function public.vel_broker_claim_provider_attempt(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.vel_broker_auth_intents%rowtype;
  root public.vel_broker_browser_lineages%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  select * into intent from public.vel_broker_auth_intents where id = p_intent_id;
  if intent.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN', 'claimed', false);
  end if;
  if intent.browser_lineage_id is null then
    return jsonb_build_object('ok', false, 'code', 'LINEAGE_REQUIRED', 'claimed', false);
  end if;
  select * into root from public.vel_broker_browser_lineages
  where id = intent.browser_lineage_id for update;
  if root.id is null or root.state is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'ROOT_CLOSED', 'claimed', false);
  end if;
  -- Match reserve/admit lock order: root first, then re-read and lock intent.
  select * into intent from public.vel_broker_auth_intents where id = p_intent_id for update;
  if intent.id is null or intent.browser_lineage_id is distinct from root.id then
    return jsonb_build_object('ok', false, 'code', 'LINEAGE_MISMATCH', 'claimed', false);
  end if;
  if intent.expires_at is null or intent.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED', 'claimed', false,
      'provider_state', intent.provider_state, 'status', intent.status);
  end if;
  if intent.lineage_generation is distinct from root.latest_reserved_generation then
    return jsonb_build_object('ok', false, 'code', 'GENERATION_NOT_ELIGIBLE', 'claimed', false,
      'provider_state', intent.provider_state, 'status', intent.status);
  end if;
  -- Non-owned / already claimed: ok false so callers never treat as success-to-proceed.
  if intent.provider_state in ('in_flight', 'session_captured', 'unknown') then
    return jsonb_build_object(
      'ok', false, 'code', 'NOT_OWNED', 'claimed', false,
      'provider_state', intent.provider_state, 'status', intent.status
    );
  end if;
  if intent.provider_state is distinct from 'ready' or intent.status is distinct from 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'NOT_READY', 'claimed', false,
      'provider_state', intent.provider_state, 'status', intent.status);
  end if;
  update public.vel_broker_auth_intents
    set provider_state = 'in_flight', updated_at = clock_timestamp()
  where id = p_intent_id and provider_state = 'ready' and status = 'reserved';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CLAIM_RACE', 'claimed', false);
  end if;
  return jsonb_build_object('ok', true, 'provider_state', 'in_flight', 'claimed', true,
    'status', 'reserved');
end;
$$;
revoke all on function public.vel_broker_claim_provider_attempt(uuid) from public, anon, authenticated;
grant execute on function public.vel_broker_claim_provider_attempt(uuid) to service_role;

create or replace function public.vel_broker_record_provider_session(
  p_intent_id uuid,
  p_user_id uuid,
  p_native_session_id uuid,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_token_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  if p_intent_id is null or p_user_id is null or p_native_session_id is null
     or p_access_token_enc is null or p_refresh_token_enc is null then
    return false;
  end if;
  -- WP01A: captured claims cannot substitute a foreign, missing, or expired native session.
  if p_token_expires_at is null or p_token_expires_at <= clock_timestamp()
     or not exists (select 1 from auth.sessions native
       where native.id = p_native_session_id and native.user_id = p_user_id
         and (native.not_after is null or native.not_after > clock_timestamp())) then
    return false;
  end if;

  update public.vel_broker_auth_intents
    set user_id = p_user_id,
        committed_native_session_id = p_native_session_id,
        provider_access_enc = p_access_token_enc,
        provider_refresh_enc = p_refresh_token_enc,
        provider_expires_at = p_token_expires_at,
        provider_state = 'session_captured',
        cleanup_state = 'pending',
        updated_at = clock_timestamp()
  where id = p_intent_id
    and provider_state in ('in_flight', 'session_captured')
    and status = 'reserved';
  return found;
end;
$$;
revoke all on function public.vel_broker_record_provider_session(uuid,uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.vel_broker_record_provider_session(uuid,uuid,uuid,text,text,timestamptz)
  to service_role;

create or replace function public.vel_broker_admit_bound_session(
  p_intent_id uuid,
  p_user_id uuid,
  p_native_session_id uuid,
  p_handle_hash text,
  p_cookie_name text,
  p_generation text,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_token_expires_at timestamptz,
  p_admission_scope text,
  p_recovery_operation_key text,
  p_handle_token_enc text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.vel_broker_auth_intents%rowtype;
  root public.vel_broker_browser_lineages%rowtype;
  allowed boolean;
  barrier_key text;
  registry_id uuid;
  receipt jsonb;
  scope text;
  tip_hash text;
  recovery_ok boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  scope := coalesce(p_admission_scope, 'app');
  if scope not in ('app', 'recovery') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SCOPE');
  end if;
  if p_intent_id is null or p_user_id is null or p_native_session_id is null
     or p_handle_hash is null or p_cookie_name is null or p_generation is null
     or p_access_token_enc is null or p_refresh_token_enc is null
     or p_token_expires_at is null or length(p_handle_hash) < 16
     or p_handle_token_enc is null or length(p_handle_token_enc) < 16 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  -- WP01A: captured claims cannot substitute a foreign, missing, or expired native session.
  if p_token_expires_at is null or p_token_expires_at <= clock_timestamp()
     or not exists (select 1 from auth.sessions native
       where native.id = p_native_session_id and native.user_id = p_user_id
         and (native.not_after is null or native.not_after > clock_timestamp())) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NATIVE_SESSION');
  end if;

  select * into intent from public.vel_broker_auth_intents where id = p_intent_id;
  if intent.id is null then
    return jsonb_build_object('ok', false, 'code', 'INTENT_UNKNOWN');
  end if;
  if intent.browser_lineage_id is null then
    return jsonb_build_object('ok', false, 'code', 'LINEAGE_REQUIRED');
  end if;

  -- Lock order: root -> user admission -> intent (R4-F07). Nonlocking intent read above.
  perform pg_advisory_xact_lock(hashtextextended(intent.browser_lineage_id::text, 0));

  select * into root from public.vel_broker_browser_lineages
  where id = intent.browser_lineage_id for update;
  if root.id is null or root.state is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'ROOT_CLOSED');
  end if;

  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, null, false, clock_timestamp())
  on conflict (user_id) do nothing;
  perform 1 from public.vel_broker_admission where user_id = p_user_id for update;
  select not barrier_active, barrier_operation_key into allowed, barrier_key
  from public.vel_broker_admission where user_id = p_user_id;

  select * into intent from public.vel_broker_auth_intents where id = p_intent_id for update;

  if exists(select 1 from public.vel_broker_auth_intents c where c.user_id=p_user_id
      and c.committed_native_session_id=p_native_session_id and c.status='rejected'
      and c.cleanup_state in ('pending','unknown','confirmed','rejected')) then
    return jsonb_build_object('ok',false,'code','PROVIDER_CLEANUP_PENDING');
  end if;
  if intent.status = 'committed' and intent.admission_receipt is not null
     and coalesce((intent.admission_receipt->>'ok')::boolean, false) then
    -- Intent TTL bounds receipt replay, not the lifetime of an established session.
    if intent.expires_at is null or intent.expires_at <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED');
    end if;
    -- Full authority gate on replay (R4-F06): pointer, expiry, identity, scope, registry, barrier.
    if root.current_registry_id is distinct from (intent.admission_receipt->>'registry_id')::uuid
       or root.current_generation is distinct from intent.lineage_generation then
      return jsonb_build_object('ok', false, 'code', 'STALE');
    end if;
    if root.valid_until is not null and root.valid_until <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'ROOT_EXPIRED');
    end if;
    if intent.user_id is distinct from p_user_id
       or intent.committed_native_session_id is distinct from p_native_session_id then
      return jsonb_build_object('ok', false, 'code', 'IDENTITY_MISMATCH');
    end if;
    if coalesce(intent.admission_receipt->>'admission_scope', 'app') is distinct from scope then
      return jsonb_build_object('ok', false, 'code', 'SCOPE_MISMATCH');
    end if;
    if not exists (
      select 1 from public.vel_broker_sessions s
      where s.id = root.current_registry_id and s.status = 'active'
        and s.user_id = p_user_id and s.native_session_id = p_native_session_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'STALE');
    end if;
    if scope = 'app' and not coalesce(allowed, false) then
      return jsonb_build_object('ok', false, 'code', 'BARRIER');
    end if;
    if scope = 'recovery' then
      if p_recovery_operation_key is null or barrier_key is distinct from p_recovery_operation_key then
        return jsonb_build_object('ok', false, 'code', 'BARRIER');
      end if;
    end if;
    return intent.admission_receipt || jsonb_build_object('idempotent', true);
  end if;

  if intent.status is distinct from 'reserved' then
    return jsonb_build_object('ok', false, 'code', 'INTENT_STALE');
  end if;
  if intent.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED');
  end if;
  if intent.provider_state is distinct from 'session_captured' then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_CAPTURED');
  end if;
  if intent.user_id is distinct from p_user_id
     or intent.committed_native_session_id is distinct from p_native_session_id then
    return jsonb_build_object('ok', false, 'code', 'IDENTITY_MISMATCH');
  end if;
  if intent.lineage_generation is null
     or intent.lineage_generation <> root.latest_reserved_generation then
    return jsonb_build_object('ok', false, 'code', 'GENERATION_NOT_ELIGIBLE');
  end if;

  if scope = 'app' and not coalesce(allowed, false) then
    return jsonb_build_object('ok', false, 'code', 'BARRIER');
  end if;
  if scope = 'recovery' then
    if p_recovery_operation_key is null or barrier_key is distinct from p_recovery_operation_key then
      return jsonb_build_object('ok', false, 'code', 'BARRIER');
    end if;
    select exists (
      select 1 from public.vel_broker_operations
      where operation_key = p_recovery_operation_key
        and actor_user_id = p_user_id
        and kind = 'password_revoke'
        and status in ('open', 'pending')
    ) into recovery_ok;
    if not coalesce(recovery_ok, false) then
      return jsonb_build_object('ok', false, 'code', 'RECOVERY_FORBIDDEN');
    end if;
  end if;

  if intent.expected_parent_handle_hash is not null then
    if root.current_registry_id is null then
      return jsonb_build_object('ok', false, 'code', 'PARENT_MISSING');
    end if;
    select handle_hash into tip_hash from public.vel_broker_sessions
    where id = root.current_registry_id for update;
    if tip_hash is distinct from intent.expected_parent_handle_hash then
      return jsonb_build_object('ok', false, 'code', 'PARENT_NOT_TIP');
    end if;
  end if;

  update public.vel_broker_sessions
    set status = 'tombstoned', updated_at = clock_timestamp()
  where browser_lineage_id = root.id
    and status = 'active'
    and id is distinct from root.current_registry_id
    and native_session_id is distinct from p_native_session_id;

  if root.current_registry_id is not null then
    update public.vel_broker_sessions
      set status = 'tombstoned', updated_at = clock_timestamp()
    where id = root.current_registry_id and status = 'active';
  end if;

  insert into public.vel_broker_sessions (
    handle_hash, cookie_name, generation, user_id, native_session_id,
    access_token_enc, refresh_token_enc, token_expires_at,
    auth_ordinal, auth_intent_id, parent_handle_hash, browser_lineage_id, status,
    refresh_state, last_seen_at, admission_scope
  ) values (
    p_handle_hash, p_cookie_name, p_generation, p_user_id, p_native_session_id,
    p_access_token_enc, p_refresh_token_enc, p_token_expires_at,
    public.vel_broker_next_auth_ordinal(), p_intent_id, intent.expected_parent_handle_hash,
    root.id, 'active', 'idle', clock_timestamp(), scope
  ) returning id into registry_id;

  update public.vel_broker_browser_lineages
    set current_generation = intent.lineage_generation,
        current_registry_id = registry_id,
        valid_until = clock_timestamp() + interval '30 days',
        updated_at = clock_timestamp()
  where id = root.id;

  receipt := jsonb_build_object(
    'ok', true,
    'registry_id', registry_id,
    'browser_lineage_id', root.id,
    'handle_hash', p_handle_hash,
    'handle_token_enc', p_handle_token_enc,
    'cookie_name', p_cookie_name,
    'generation', p_generation,
    'lineage_generation', intent.lineage_generation,
    'user_id', p_user_id,
    'native_session_id', p_native_session_id,
    'admission_scope', scope
  );

  update public.vel_broker_auth_intents
    set status = 'committed',
        admission_receipt = receipt,
        cleanup_state = 'not_needed',
        updated_at = clock_timestamp()
  where id = p_intent_id and status = 'reserved';

  return receipt;
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'CONFLICT');
end;
$$;
revoke all on function public.vel_broker_admit_bound_session(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text
) from public, anon, authenticated;
grant execute on function public.vel_broker_admit_bound_session(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text
) to service_role;

create or replace function public.vel_broker_patch_operation(
  p_operation_key text,
  p_expected_revision bigint,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.vel_broker_operations%rowtype;
  allow_keys text[] := array[
    'stages','status','cutoff','credential_mutated_at','snapshot_frozen',
    'target_snapshot','legacy_coverage'
  ];
  k text;
  new_status text;
  new_legacy text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  if p_operation_key is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  select * into op from public.vel_broker_operations
  where operation_key = p_operation_key for update;
  if op.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN');
  end if;
  if op.status = 'confirmed' then
    if op.revision is distinct from coalesce(p_expected_revision, op.revision) then
      return jsonb_build_object('ok', false, 'code', 'REVISION');
    end if;
    if (p_patch - 'stages' - 'status') <> '{}'::jsonb
       or coalesce(p_patch->>'status', 'confirmed') <> 'confirmed'
       or jsonb_typeof(p_patch->'stages') is distinct from 'object'
       or p_patch->'stages'->>'clientCleanup' is distinct from 'confirmed'
       or ((p_patch->'stages') - 'clientCleanup') is distinct from (coalesce(op.stages, '{}'::jsonb) - 'clientCleanup') then
      return jsonb_build_object('ok', false, 'code', 'CONFIRMED_IMMUTABLE');
    end if;
    if op.stages->>'clientCleanup' is distinct from 'confirmed' then
      update public.vel_broker_operations
      set stages = jsonb_set(coalesce(stages, '{}'::jsonb), '{clientCleanup}', '"confirmed"'::jsonb),
          revision = revision + 1, updated_at = clock_timestamp()
      where operation_key = p_operation_key;
      op.revision := op.revision + 1;
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'status', 'confirmed',
      'completion_receipt', op.completion_receipt, 'revision', op.revision
    );
  end if;
  if op.revision is distinct from coalesce(p_expected_revision, op.revision) then
    return jsonb_build_object('ok', false, 'code', 'REVISION');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allow_keys)) then
      return jsonb_build_object('ok', false, 'code', 'PATCH_KEY');
    end if;
  end loop;
  new_status := coalesce(p_patch->>'status', op.status);
  if new_status = 'confirmed' then
    return jsonb_build_object('ok', false, 'code', 'USE_COMPLETE_RPC');
  end if;
  -- Freeze immutability: once set, cutoff/snapshot/legacy/credential_mutated_at cannot rewrite (R4-F02).
  if op.cutoff is not null and p_patch ? 'cutoff'
     and (p_patch->>'cutoff')::timestamptz is distinct from op.cutoff then
    return jsonb_build_object('ok', false, 'code', 'CUTOFF_FROZEN');
  end if;
  if op.credential_mutated_at is not null and p_patch ? 'credential_mutated_at'
     and (p_patch->>'credential_mutated_at')::timestamptz is distinct from op.credential_mutated_at then
    return jsonb_build_object('ok', false, 'code', 'MUTATED_AT_FROZEN');
  end if;
  if op.snapshot_frozen is true and p_patch ? 'snapshot_frozen'
     and (p_patch->>'snapshot_frozen')::boolean is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_FROZEN');
  end if;
  if op.snapshot_frozen is true and p_patch ? 'target_snapshot'
     and p_patch->'target_snapshot' is distinct from op.target_snapshot then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_FROZEN');
  end if;
  if op.legacy_coverage is not null and op.legacy_coverage in ('absent', 'resolved')
     and p_patch ? 'legacy_coverage'
     and coalesce(p_patch->>'legacy_coverage', '') is distinct from op.legacy_coverage then
    return jsonb_build_object('ok', false, 'code', 'LEGACY_FROZEN');
  end if;
  if p_patch ? 'legacy_coverage' then
    new_legacy := p_patch->>'legacy_coverage';
    if new_legacy is not null and new_legacy not in ('pending', 'absent', 'resolved') then
      return jsonb_build_object('ok', false, 'code', 'LEGACY_INVALID');
    end if;
  else
    new_legacy := op.legacy_coverage;
  end if;
  update public.vel_broker_operations set
    stages = case when p_patch ? 'stages' then p_patch->'stages' else stages end,
    status = new_status,
    cutoff = case when p_patch ? 'cutoff' then (p_patch->>'cutoff')::timestamptz else cutoff end,
    credential_mutated_at = case when p_patch ? 'credential_mutated_at'
      then (p_patch->>'credential_mutated_at')::timestamptz else credential_mutated_at end,
    snapshot_frozen = case when p_patch ? 'snapshot_frozen'
      then (p_patch->>'snapshot_frozen')::boolean else snapshot_frozen end,
    target_snapshot = case when p_patch ? 'target_snapshot' then p_patch->'target_snapshot' else target_snapshot end,
    legacy_coverage = new_legacy,
    revision = revision + 1,
    updated_at = clock_timestamp()
  where operation_key = p_operation_key and status is distinct from 'confirmed';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CAS_FAILED');
  end if;
  return jsonb_build_object('ok', true, 'revision', op.revision + 1, 'status', new_status);
end;
$$;
revoke all on function public.vel_broker_patch_operation(text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.vel_broker_patch_operation(text, bigint, jsonb)
  to service_role;

create or replace function public.vel_broker_resolve_bound_session(
  p_bootstrap_hash text,
  p_handle_hashes text[],
  p_admission_scope text default 'app'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  root public.vel_broker_browser_lineages%rowtype;
  sess public.vel_broker_sessions%rowtype;
  scope text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  scope := coalesce(p_admission_scope, 'app');
  select * into root from public.vel_broker_browser_lineages
  where bootstrap_hash = p_bootstrap_hash;
  if root.id is null or root.state is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  -- App resolve enforces enrollment expiry; recovery may still read for reauth on same root.
  if scope = 'app' and root.valid_until is not null and root.valid_until <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'ROOT_EXPIRED');
  end if;
  if root.current_registry_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select * into sess from public.vel_broker_sessions where id = root.current_registry_id;
  if sess.id is null or sess.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if coalesce(sess.admission_scope, 'app') is distinct from scope then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if sess.browser_lineage_id is distinct from root.id then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if root.current_generation is distinct from coalesce(
    (select i.lineage_generation from public.vel_broker_auth_intents i where i.id = sess.auth_intent_id),
    root.current_generation
  ) then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if p_handle_hashes is null or not (sess.handle_hash = any (p_handle_hashes)) then
    -- Missing current handle (B) — never fall back to A.
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  if scope = 'recovery' then
    if not exists (
      select 1 from public.vel_broker_admission a
      join public.vel_broker_operations o on o.operation_key = a.barrier_operation_key
      where a.user_id = sess.user_id and a.barrier_active = true
        and o.kind = 'password_revoke' and o.status in ('open', 'pending')
        and o.actor_user_id = sess.user_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
    end if;
  end if;
  return jsonb_build_object(
    'ok', true,
    'registry_id', sess.id,
    'handle_hash', sess.handle_hash,
    'cookie_name', sess.cookie_name,
    'generation', sess.generation,
    'user_id', sess.user_id,
    'native_session_id', sess.native_session_id,
    'access_token_enc', sess.access_token_enc,
    'refresh_token_enc', sess.refresh_token_enc,
    'token_expires_at', sess.token_expires_at,
    'refresh_revision', sess.refresh_revision,
    'auth_ordinal', sess.auth_ordinal,
    'browser_lineage_id', sess.browser_lineage_id,
    'lineage_generation', root.current_generation,
    'admission_scope', coalesce(sess.admission_scope, 'app')
  );
end;
$$;
revoke all on function public.vel_broker_resolve_bound_session(text, text[], text)
  from public, anon, authenticated;
grant execute on function public.vel_broker_resolve_bound_session(text, text[], text)
  to service_role;

-- Deprecated side channels: explicit denial (no DROP).
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
  p_parent_handle_hash text,
  p_browser_lineage_id uuid,
  p_handle_token_enc text,
  p_recovery_operation_key text,
  p_admission_scope text
) returns jsonb
language sql security definer set search_path = ''
as $$ select jsonb_build_object('ok', false, 'code', 'DEPRECATED_USE_BOUND_ADMIT'); $$;

-- Preserve R3 boolean return signature (R4-F01). Receipt via completion_receipt column / status reader.
create or replace function public.vel_broker_complete_revocation_operation(
  p_user_id uuid,
  p_operation_key text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.vel_broker_operations%rowtype;
  cur_key text;
  cur_active boolean;
  tgt jsonb;
  receipts jsonb;
  legacy_txt text;
  rid text;
  receipt text;
  snap_len int;
  seen text[] := array[]::text[];
  native_id uuid;
  actor_ok boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  if p_user_id is null or p_operation_key is null or length(p_operation_key) < 16 then
    return false;
  end if;

  -- A completable owned barrier already has admission; rejected calls must not insert rows.
  select barrier_operation_key, barrier_active into cur_key, cur_active
  from public.vel_broker_admission where user_id = p_user_id for update;
  if not found then return false; end if;

  select * into op from public.vel_broker_operations
  where operation_key = p_operation_key and actor_user_id = p_user_id
  for update;
  if op.id is null or op.kind is distinct from 'password_revoke' then
    return false;
  end if;

  if op.status = 'confirmed' then
    -- Historical success: require shaped receipt; never touch barrier owned by another op.
    if op.completion_receipt is null
       or coalesce(op.completion_receipt->>'operation', '') is distinct from p_operation_key
       or coalesce(op.completion_receipt->>'actor', '') is distinct from p_user_id::text then
      return false;
    end if;
    return true;
  end if;

  if op.status is distinct from 'pending' then
    return false;
  end if;
  if not coalesce(cur_active, false) or cur_key is distinct from p_operation_key then
    return false;
  end if;
  if op.cutoff is null or op.credential_mutated_at is null then
    return false;
  end if;
  if op.cutoff is distinct from op.credential_mutated_at then
    return false;
  end if;
  if coalesce(op.stages->>'credentialMutation','') is distinct from 'confirmed'
     or coalesce(op.stages->>'appRevocation','') is distinct from 'confirmed'
     or coalesce(op.stages->>'nativeRevocation','') is distinct from 'confirmed' then
    return false;
  end if;
  if op.snapshot_frozen is not true then
    return false;
  end if;

  tgt := coalesce(op.target_snapshot, '[]'::jsonb);
  receipts := coalesce(op.target_receipts, '{}'::jsonb);
  legacy_txt := op.legacy_coverage;
  if legacy_txt is null or legacy_txt = 'pending' then
    return false;
  end if;
  if legacy_txt not in ('absent', 'resolved') then
    return false;
  end if;
  if legacy_txt = 'resolved'
     and (op.legacy_resolution is null or length(op.legacy_resolution) < 8) then
    return false;
  end if;

  snap_len := jsonb_array_length(tgt);
  if snap_len = 0 then
    return false;
  end if;
  for rid in select jsonb_array_elements(tgt)->>'registryId' loop
    if rid is null or rid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if rid = any (seen) then
      return false;
    end if;
    seen := array_append(seen, rid);
    receipt := receipts->>rid;
    if receipt is distinct from 'native_confirmed' then
      return false;
    end if;
    select s.native_session_id, s.user_id = p_user_id into native_id, actor_ok
    from public.vel_broker_sessions s where s.id = rid::uuid;
    if native_id is null or not coalesce(actor_ok, false) then
      return false;
    end if;
  end loop;

  -- All checks passed — writes only below.
  update public.vel_broker_operations
    set status = 'confirmed',
        revision = revision + 1,
        completion_receipt = jsonb_build_object(
          'actor', p_user_id,
          'operation', p_operation_key,
          'cutoff', op.cutoff,
          'completed_at', clock_timestamp(),
          'barrier_release_key', p_operation_key
        ),
        updated_at = clock_timestamp()
  where operation_key = p_operation_key and status = 'pending';
  if not found then
    return false;
  end if;

  update public.vel_broker_admission
    set barrier_operation_key = null, barrier_active = false, updated_at = clock_timestamp()
  where user_id = p_user_id
    and barrier_active = true
    and barrier_operation_key = p_operation_key;

  return true;
end;
$$;
revoke all on function public.vel_broker_complete_revocation_operation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.vel_broker_complete_revocation_operation(uuid, text)
  to service_role;

create or replace function public.vel_broker_record_target_outcome(
  p_operation_key text,
  p_registry_id uuid,
  p_outcome text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.vel_broker_operations%rowtype;
  receipts jsonb;
  sess_user uuid;
  sess_native uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  if p_outcome not in ('native_confirmed', 'native_unknown', 'native_rejected', 'credential_ref_missing') then
    return false;
  end if;
  select * into op from public.vel_broker_operations
  where operation_key = p_operation_key for update;
  if op.id is null then
    return false;
  end if;
  -- Same receipt already confirmed: idempotent true without regress (R4-F02).
  if op.status = 'confirmed' then
    receipts := coalesce(op.target_receipts, '{}'::jsonb);
    return receipts ? p_registry_id::text
      and receipts->>p_registry_id::text = p_outcome
      and p_outcome = 'native_confirmed';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(op.target_snapshot, '[]'::jsonb)) e
    where e->>'registryId' = p_registry_id::text
  ) then
    return false;
  end if;
  select user_id, native_session_id into sess_user, sess_native
  from public.vel_broker_sessions where id = p_registry_id for update;
  if sess_user is null or sess_user is distinct from op.actor_user_id then
    return false;
  end if;
  receipts := coalesce(op.target_receipts, '{}'::jsonb);
  if receipts ? p_registry_id::text
     and receipts->>p_registry_id::text = 'native_confirmed'
     and p_outcome is distinct from 'native_confirmed' then
    return true; -- terminal confirmed cannot regress
  end if;
  receipts := jsonb_set(receipts, array[p_registry_id::text], to_jsonb(p_outcome), true);
  update public.vel_broker_operations
    set target_receipts = receipts, revision = revision + 1, updated_at = clock_timestamp()
  where operation_key = p_operation_key and status is distinct from 'confirmed';
  if p_outcome = 'native_confirmed' then
    update public.vel_broker_sessions set status = 'revoked', updated_at = clock_timestamp()
    where id = p_registry_id;
  elsif p_outcome in ('native_unknown', 'native_rejected', 'credential_ref_missing') then
    update public.vel_broker_sessions set status = 'quarantined', updated_at = clock_timestamp()
    where id = p_registry_id;
  end if;
  return true;
end;
$$;
revoke all on function public.vel_broker_record_target_outcome(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.vel_broker_record_target_outcome(text, uuid, text)
  to service_role;

-- Terminal confirmed: freeze status/cutoff/snapshot/receipts/stages/actor/kind/legacy (R4-F02).
create or replace function public.vel_broker_operations_terminal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed' then
    if new.status is distinct from 'confirmed' then
      raise exception 'WP01A_CONFIRMED_TERMINAL';
    end if;
    if new.cutoff is distinct from old.cutoff
       or new.target_snapshot is distinct from old.target_snapshot
       or new.credential_mutated_at is distinct from old.credential_mutated_at
       or new.target_receipts is distinct from old.target_receipts
       or ((new.stages is distinct from old.stages) and (
         new.stages->>'clientCleanup' is distinct from 'confirmed'
         or (new.stages - 'clientCleanup') is distinct from (old.stages - 'clientCleanup')
       ))
       or new.completion_receipt is distinct from old.completion_receipt
       or new.actor_user_id is distinct from old.actor_user_id
       or new.kind is distinct from old.kind
       or new.legacy_coverage is distinct from old.legacy_coverage
       or new.legacy_resolution is distinct from old.legacy_resolution then
      raise exception 'WP01A_CONFIRMED_IMMUTABLE';
    end if;
  end if;
  if old.snapshot_frozen is true and (new.snapshot_frozen is distinct from true
      or new.target_snapshot is distinct from old.target_snapshot) then
    raise exception 'WP01A_SNAPSHOT_FROZEN';
  end if;
  return new;
end;
$$;

-- Fail-close retained unsafe side channel (R4-F07); no DROP.
create or replace function public.vel_broker_commit_intent_ordinal(
  p_intent_id uuid,
  p_user_id uuid,
  p_native_session_id uuid
) returns bigint
language sql
security definer
set search_path = ''
as $$
  select null::bigint;
$$;
revoke all on function public.vel_broker_commit_intent_ordinal(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.vel_broker_commit_intent_ordinal(uuid, uuid, uuid)
  to service_role;

drop trigger if exists vel_broker_operations_terminal_guard on public.vel_broker_operations;
create trigger vel_broker_operations_terminal_guard
  before update on public.vel_broker_operations
  for each row execute function public.vel_broker_operations_terminal_guard();
revoke all on function public.vel_broker_operations_terminal_guard() from public,anon,authenticated;
grant execute on function public.vel_broker_operations_terminal_guard() to service_role;

-- Serialize cleanup ownership against admission before revoking any captured token.
create or replace function public.vel_broker_begin_provider_cleanup(
  p_intent_id uuid, p_user_id uuid, p_native_session_id uuid,
  p_access_token_enc text, p_refresh_token_enc text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent public.vel_broker_auth_intents%rowtype;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    return jsonb_build_object('ok',false,'code','ROLE');
  end if;
  if p_intent_id is null or p_user_id is null or p_native_session_id is null
     or nullif(p_access_token_enc,'') is null or nullif(p_refresh_token_enc,'') is null then
    return jsonb_build_object('ok',false,'code','INVALID');
  end if;
  -- Admission uses root->user->intent. Cleanup never locks a root: user->intent is compatible.
  insert into public.vel_broker_admission(user_id,barrier_active,updated_at)
    values(p_user_id,false,clock_timestamp()) on conflict(user_id) do nothing;
  perform 1 from public.vel_broker_admission where user_id=p_user_id for update;
  select * into intent from public.vel_broker_auth_intents where id=p_intent_id for update;
  if intent.id is null then return jsonb_build_object('ok',false,'code','UNKNOWN'); end if;
  if intent.status='committed' or exists(select 1 from public.vel_broker_sessions
      where user_id=p_user_id and native_session_id=p_native_session_id) then
    return jsonb_build_object('ok',true,'allowed',false,'adopted',true);
  end if;
  if (intent.user_id is not null and intent.user_id is distinct from p_user_id)
     or (intent.committed_native_session_id is not null and intent.committed_native_session_id is distinct from p_native_session_id)
     or intent.status not in ('reserved','rejected') then
    return jsonb_build_object('ok',false,'code','IDENTITY_MISMATCH');
  end if;
  if intent.cleanup_state='confirmed' then
    return jsonb_build_object('ok',true,'allowed',false,'cleanup_state','confirmed');
  end if;
  update public.vel_broker_auth_intents set status='rejected',provider_state='unknown',cleanup_state='unknown',
    user_id=p_user_id,committed_native_session_id=p_native_session_id,
    provider_access_enc=p_access_token_enc,provider_refresh_enc=p_refresh_token_enc,updated_at=clock_timestamp()
    where id=p_intent_id;
  return jsonb_build_object('ok',true,'allowed',true,'cleanup_state','unknown');
end; $$;
revoke all on function public.vel_broker_begin_provider_cleanup(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.vel_broker_begin_provider_cleanup(uuid,uuid,uuid,text,text) to service_role;

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
  browser_bootstrap boolean := false;
  bound_admit boolean := false;
  bound_resolve boolean := false;
  complete_strict boolean := false;
  complete_returns_boolean boolean := false;
  issue_seq_col boolean := false;
  admission_scope_col boolean := false;
  lineages_ok boolean := false;
  lookup_ok boolean := false;
  claim_ok boolean := false;
  capture_ok boolean := false;
  patch_ok boolean := false;
  close_ok boolean := false;
  trigger_ok boolean := false;
  intent_lineage_col boolean := false;
  provider_state_col boolean := false;
  cleanup_state_col boolean := false;
  revision_col boolean := false;
  current_pointer_col boolean := false;
begin
  if to_regprocedure('public.master_revoke_account_sessions(uuid)') is null then
    codes := array_append(codes, 'REVOKE_RPC_MISSING');
  else
    revoke_boolean := pg_get_function_result('public.master_revoke_account_sessions(uuid)'::regprocedure) = 'boolean';
  end if;
  idle_wrappers := to_regprocedure('public.check_app_session(boolean)') is not null
    and to_regprocedure('public.app_session_is_valid()') is not null;
  broker_registry := to_regclass('public.vel_broker_sessions') is not null
    and to_regclass('public.vel_broker_auth_intents') is not null
    and to_regclass('public.vel_broker_operations') is not null
    and to_regclass('public.vel_broker_admission') is not null;
  lineages_ok := to_regclass('public.vel_broker_browser_lineages') is not null;
  if not lineages_ok then codes := array_append(codes, 'BROWSER_LINEAGES_MISSING'); end if;
  lookup_ok := to_regprocedure('public.vel_broker_lookup_browser_continuity(text)') is not null;
  if not lookup_ok then codes := array_append(codes, 'LOOKUP_MISSING'); end if;
  close_ok := to_regprocedure('public.vel_broker_close_browser_continuity(text,uuid,uuid)') is not null;
  if not close_ok then codes := array_append(codes, 'CLOSE_MISSING'); end if;
  browser_bootstrap := to_regprocedure('public.vel_broker_bind_browser_continuity(text)') is not null
    and to_regprocedure('public.vel_broker_reserve_bound_intent(text,uuid,text,text,integer)') is not null
    and lookup_ok and lineages_ok;
  if not browser_bootstrap then codes := array_append(codes, 'BROWSER_BOOTSTRAP_MISSING'); end if;
  bound_admit := to_regprocedure(
    'public.vel_broker_admit_bound_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text)'
  ) is not null;
  if not bound_admit then codes := array_append(codes, 'BOUND_ADMIT_MISSING'); end if;
  bound_resolve := to_regprocedure('public.vel_broker_resolve_bound_session(text,text[],text)') is not null;
  if not bound_resolve then codes := array_append(codes, 'BOUND_RESOLVE_MISSING'); end if;
  claim_ok := to_regprocedure('public.vel_broker_claim_provider_attempt(uuid)') is not null;
  capture_ok := to_regprocedure(
    'public.vel_broker_record_provider_session(uuid,uuid,uuid,text,text,timestamptz)'
  ) is not null;
  patch_ok := to_regprocedure('public.vel_broker_patch_operation(text,bigint,jsonb)') is not null;
  if not claim_ok then codes := array_append(codes, 'CLAIM_MISSING'); end if;
  if not capture_ok then codes := array_append(codes, 'CAPTURE_MISSING'); end if;
  if not patch_ok then codes := array_append(codes, 'PATCH_MISSING'); end if;
  complete_strict := to_regprocedure('public.vel_broker_complete_revocation_operation(uuid,text)') is not null
    and to_regprocedure('public.vel_broker_record_target_outcome(text,uuid,text)') is not null;
  if complete_strict then
    complete_returns_boolean := pg_get_function_result(
      'public.vel_broker_complete_revocation_operation(uuid,text)'::regprocedure
    ) = 'boolean';
  end if;
  if not complete_strict or not complete_returns_boolean then
    codes := array_append(codes, 'COMPLETE_STRICT_MISSING');
    complete_strict := false;
  end if;
  select exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vel_broker_operations'
      and t.tgname = 'vel_broker_operations_terminal_guard' and not t.tgisinternal
  ) into trigger_ok;
  if not trigger_ok then codes := array_append(codes, 'TERMINAL_TRIGGER_MISSING'); end if;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_browser_attempts' and column_name='issue_seq'
  ) into issue_seq_col;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_sessions' and column_name='admission_scope'
  ) into admission_scope_col;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_auth_intents' and column_name='browser_lineage_id'
  ) into intent_lineage_col;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_auth_intents' and column_name='provider_state'
  ) into provider_state_col;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_auth_intents' and column_name='cleanup_state'
  ) into cleanup_state_col;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_operations' and column_name='revision'
  ) into revision_col;
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_browser_lineages'
      and column_name='current_registry_id'
  ) into current_pointer_col;
  if not intent_lineage_col then codes := array_append(codes, 'INTENT_LINEAGE_MISSING'); end if;
  if not provider_state_col or not cleanup_state_col then
    codes := array_append(codes, 'INTENT_JOURNAL_MISSING');
  end if;
  if not revision_col then codes := array_append(codes, 'REVISION_MISSING'); end if;
  if not current_pointer_col then codes := array_append(codes, 'CURRENT_POINTER_MISSING'); end if;
  revoke_at_operation := to_regprocedure('public.vel_broker_revoke_sessions_at(uuid,text,timestamptz)') is not null;
  refresh_lease := to_regprocedure('public.vel_broker_claim_refresh(uuid,bigint,integer)') is not null
    and to_regprocedure('public.vel_broker_release_refresh(uuid,text)') is not null
    and to_regprocedure('public.vel_broker_mark_refresh_uncertain(uuid,text)') is not null;
  if not refresh_lease then codes := array_append(codes, 'REFRESH_LEASE_INCOMPLETE'); end if;
  if to_regprocedure('public.vel_broker_begin_provider_cleanup(uuid,uuid,uuid,text,text)') is null then
    codes := array_append(codes, 'CLEANUP_DISPOSITION_MISSING');
  end if;
  admit_ordinal := to_regprocedure('public.vel_broker_next_auth_ordinal()') is not null;
  admit_atomic := bound_admit;
  if not private.vel_broker_capability_contract_matches() then
    codes := array_append(codes, 'CAPABILITY_CONTRACT_DRIFT');
  end if;
  return jsonb_build_object(
    'ok', revoke_boolean and idle_wrappers and broker_registry and revoke_at_operation
      and refresh_lease and admit_ordinal and admit_atomic and browser_bootstrap
      and bound_admit and bound_resolve and complete_strict and issue_seq_col
      and admission_scope_col and lineages_ok and lookup_ok and claim_ok and capture_ok
      and patch_ok and close_ok and trigger_ok and intent_lineage_col and provider_state_col
      and cleanup_state_col and revision_col and current_pointer_col
      and cardinality(codes) = 0,
    'contract_version', 2,
    'revoke_boolean', revoke_boolean,
    'idle_wrappers', idle_wrappers,
    'broker_registry', broker_registry,
    'revoke_at_operation', revoke_at_operation,
    'refresh_lease', refresh_lease,
    'admit_ordinal', admit_ordinal,
    'admit_atomic', admit_atomic,
    'browser_attempt_issue', false,
    'admit_14arg', false,
    'issue_seq_column', issue_seq_col,
    'admission_scope_column', admission_scope_col,
    'complete_revocation', complete_strict,
    'browser_bootstrap_claim', browser_bootstrap,
    'complete_revocation_strict', complete_strict,
    'bound_admit', bound_admit,
    'bound_resolve', bound_resolve,
    'continuity_lookup', lookup_ok,
    'claim_provider', claim_ok,
    'record_provider_session', capture_ok,
    'patch_operation', patch_ok,
    'close_continuity', close_ok,
    'terminal_trigger', trigger_ok,
    'complete_returns_boolean', complete_returns_boolean,
    'intent_lineage_column', intent_lineage_col,
    'codes', codes
  );
end;
$$;


-- A valid native touch must be visible to the subsequent validity predicate.
-- Preserve the exact native two-hour/future-activity policy, OID and ACL.
do $idle_snapshot$ declare d text; begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('private.master_password_native_session_is_valid()')) is distinct from 'b42c28f54d05778fcc994156c6ce4086'
 then raise exception 'WP01A_NATIVE_IDLE_KERNEL_DRIFT';end if;
 alter function private.master_password_native_session_is_valid() volatile;
 d:=pg_get_functiondef('private.master_password_native_session_is_valid()'::regprocedure);
 execute replace(d,'statement_timestamp()','clock_timestamp()');
end;$idle_snapshot$;

-- Confirm observed native absence only after the original frozen app revocation.
-- No Auth deletion, no credential mutation and no barrier release here.
create or replace function public.vel_broker_confirm_native_absence(p_user_id uuid,p_operation_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare op public.vel_broker_operations%rowtype;t jsonb;rid uuid;sid uuid;seen uuid[]:='{}';receipts jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then return false;end if;
 perform 1 from public.vel_broker_admission where user_id=p_user_id and barrier_active=true and barrier_operation_key=p_operation_key for update;
 if not found then return false;end if;
 select * into op from public.vel_broker_operations where operation_key=p_operation_key and actor_user_id=p_user_id for update;
 if not found or op.kind is distinct from 'password_revoke' or op.status not in('open','pending') or op.snapshot_frozen is not true
  or op.cutoff is null or op.credential_mutated_at is distinct from op.cutoff
  or coalesce(op.stages->>'credentialMutation','')<>'confirmed' or coalesce(op.stages->>'appRevocation','')<>'confirmed'
  or op.legacy_coverage is distinct from 'pending' then return false;end if;
 if not exists(select 1 from private.master_account_session_revocations where user_id=p_user_id and revoked_before>=op.cutoff) then return false;end if;
 if jsonb_typeof(op.target_snapshot) is distinct from 'array' or jsonb_array_length(op.target_snapshot)=0 then return false;end if;
 -- Never attest a changing/inaccessible native inventory. Busy inventory fails closed.
 lock table auth.sessions,auth.refresh_tokens in share mode nowait;
 receipts:=coalesce(op.target_receipts,'{}'::jsonb);
 for t in select value from jsonb_array_elements(op.target_snapshot) loop
  if coalesce(t->>'registryId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(t->>'nativeSessionId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
  rid:=(t->>'registryId')::uuid;sid:=(t->>'nativeSessionId')::uuid;
  if rid=any(seen) then return false;end if;seen:=array_append(seen,rid);
  if not exists(select 1 from public.vel_broker_sessions where id=rid and user_id=p_user_id and native_session_id=sid and created_at<=op.cutoff) then return false;end if;
  -- A captured pre-cutoff target must itself be absent, even if its timestamp drifted.
  if exists(select 1 from auth.sessions where id=sid) then return false;end if;
  receipts:=jsonb_set(receipts,array[rid::text],'"native_confirmed"'::jsonb,true);
 end loop;
 if exists(select 1 from auth.sessions where user_id=p_user_id and (created_at is null or created_at<=op.cutoff)) then return false;end if;
 if exists(select 1 from auth.refresh_tokens where user_id::text=p_user_id::text and not coalesce(revoked,false) and (created_at is null or created_at<=op.cutoff)) then return false;end if;
 -- All negative proofs succeeded. New post-cutoff sessions and other actors are untouched.
 update public.vel_broker_sessions set status='revoked',updated_at=clock_timestamp() where user_id=p_user_id and id=any(seen);
 update public.vel_broker_operations set target_receipts=receipts,legacy_coverage='resolved',legacy_resolution='native_absence_with_epoch_v1',revision=revision+1,updated_at=clock_timestamp() where id=op.id;
 return true;
end;$$;
revoke all on function public.vel_broker_confirm_native_absence(uuid,text) from public,anon,authenticated;
grant execute on function public.vel_broker_confirm_native_absence(uuid,text) to service_role;

commit;

-- Existing Storage and knowledge-source policies retain function OID dependencies after a public
-- capability function is renamed by lifecycle installation. Keep the retired
-- kernel non-callable by browser roles; rebind ONLY existing Storage/knowledge predicates
-- to the current public gate without changing roles/commands/permissiveness.
do $wp01a_storage_policy_binding$
declare
 retired oid:=to_regprocedure('public.lifecycle_native_has_company_capability(uuid,text)');
 current_gate oid:=to_regprocedure('public.has_company_capability(uuid,text)');
 p record; q text; c text; replacement text;
begin
 if retired is null or current_gate is null then
  raise exception 'WP01A_STORAGE_CAPABILITY_GATE_MISSING';
 end if;
 perform set_config('search_path','',true);
 for p in select pol.oid,pol.polname,pol.polqual,pol.polwithcheck,pol.polrelid
  from pg_catalog.pg_policy pol
  where pol.polrelid in ('storage.objects'::regclass,'public.knowledge_sources'::regclass) and exists(
   select 1 from pg_catalog.pg_depend d
   where d.classid='pg_catalog.pg_policy'::regclass and d.objid=pol.oid
   and d.refclassid='pg_catalog.pg_proc'::regclass and d.refobjid=retired)
 loop
  q:=pg_catalog.pg_get_expr(p.polqual,p.polrelid);
  c:=pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid);
  replacement:=format('alter policy %I on %s',p.polname,p.polrelid::regclass);
  if q is not null then
   replacement:=replacement||' using ('||replace(q,'public.lifecycle_native_has_company_capability(','public.has_company_capability(')||')';
  end if;
  if c is not null then
   replacement:=replacement||' with check ('||replace(c,'public.lifecycle_native_has_company_capability(','public.has_company_capability(')||')';
  end if;
  if position('lifecycle_native_has_company_capability' in replacement)>0 then
   raise exception 'WP01A_STORAGE_POLICY_REBIND_UNRECOGNIZED';
  end if;
  execute replacement;
 end loop;
 if exists(select 1 from pg_catalog.pg_depend d join pg_catalog.pg_policy pol on d.classid='pg_catalog.pg_policy'::regclass and d.objid=pol.oid where pol.polrelid in ('storage.objects'::regclass,'public.knowledge_sources'::regclass) and d.refclassid='pg_catalog.pg_proc'::regclass and d.refobjid=retired) then
  raise exception 'WP01A_STORAGE_POLICY_REBIND_INCOMPLETE';
 end if;
 if has_function_privilege('anon',retired,'execute') or has_function_privilege('authenticated',retired,'execute') then
  raise exception 'WP01A_RETIRED_CAPABILITY_GATE_EXPOSED';
 end if;
end;$wp01a_storage_policy_binding$;



-- WP01A-V15: a required interface is its reviewed body/type/rights contract,
-- not merely its name. Frozen hashes are from the canonical LF source chain.
-- No native kernel, epoch, receipt, OID, owner, ACL or search_path is changed.
create or replace function private.vel_broker_capability_contract_matches()
returns boolean language sql stable security definer set search_path='' as $contract$
 select not exists (
  select 1 from jsonb_to_recordset($functions$[{"sig":"private.master_identity_pre_check_app_session(boolean)","body":"527d94335def24684dbf286f315c6fa0","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"private.master_identity_pre_session_is_valid()","body":"3e4c3a71a10e0b4294ed968121d5e308","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"private.master_identity_session_current(uuid, uuid)","body":"cc0f5948e15619248e0fea9812f615d3","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"private.master_password_native_check_app_session(boolean)","body":"b148984a1d599c33aeeb315fd8e0ac6a","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"private.master_password_native_session_is_valid()","body":"6611d237337109b84ee573559f0f170f","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.app_session_is_valid()","body":"3e09485d3bf86bf3ab574ead6c78505d","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.check_app_session(boolean)","body":"312a1b266b86302ecd94c33adf1f50e1","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.master_revoke_account_sessions(uuid)","body":"517049560bddd4fddd3b26611155e881","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_admission_allows(uuid)","body":"ac5d40a56aa698181dad03f172416463","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_admit_bound_session(uuid, uuid, uuid, text, text, text, text, text, timestamp with time zone, text, text, text)","body":"8a0db9ca3db679aa8d42f5c63c511fda","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_admit_session(uuid, uuid, uuid, text, text, text, text, text, timestamp with time zone, text)","body":"58c98621b35ee2a3c59cbdf137db5233","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_admit_session(uuid, uuid, uuid, text, text, text, text, text, timestamp with time zone, text, uuid, text)","body":"58c98621b35ee2a3c59cbdf137db5233","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_admit_session(uuid, uuid, uuid, text, text, text, text, text, timestamp with time zone, text, uuid, text, text)","body":"58c98621b35ee2a3c59cbdf137db5233","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_admit_session(uuid, uuid, uuid, text, text, text, text, text, timestamp with time zone, text, uuid, text, text, text)","body":"e3c184895868755829092a2b6ba3d4d1","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_begin_provider_cleanup(uuid, uuid, uuid, text, text)","body":"cd28f274e75bdd581e7029ef8ba9fa6c","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_bind_browser_attempt(uuid)","body":"d687007a4f91960f0dacdb3139c3442d","result":"uuid","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_bind_browser_continuity(text)","body":"bcae8b120b6f80a337ad411d4fdb8a22","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_claim_provider_attempt(uuid)","body":"5e8dfe1ec6b0b2729c706f3b65631983","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_claim_refresh(uuid, bigint, integer)","body":"d5994dddb26a2bad2b93c4069b98a800","result":"text","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_close_browser_continuity(text, uuid, uuid)","body":"0ce560abbc5bbd5c5329affff29f4df6","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_commit_intent_ordinal(uuid, uuid, uuid)","body":"78128f25cade410244b72fc3aa8973b8","result":"bigint","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_complete_revocation_operation(uuid, text)","body":"80cb54ef96bbfed8532fd7a781fcfa2d","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_confirm_native_absence(uuid, text)","body":"a9056abdc7a99dc61e72d222ee9361e6","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_freeze_operation_snapshot(text, uuid, jsonb)","body":"b934aee1268dbcaebcd366855b267d21","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_issue_browser_attempt(uuid, bigint)","body":"72e10d48d43444e0c93ef56d6b23351b","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_lineage_tip(uuid)","body":"9e1ab0f5d7605f31fb10d409c94c3506","result":"TABLE(handle_hash text, auth_ordinal bigint, user_id uuid, registry_id uuid)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_lookup_browser_continuity(text)","body":"b06078425a52e5911f8ff2d7f48ea899","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_mark_refresh_uncertain(uuid, text)","body":"998b7adc66dade5ddc661e3b1734f2f9","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_next_auth_ordinal()","body":"716596e69743a2ec137a7a9022ea7de8","result":"bigint","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_operation_status(text)","body":"45bbf0286b712d163d383b3d76acb02a","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_operations_terminal_guard()","body":"2104fee2d42fa317e24560808750ede2","result":"trigger","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_patch_operation(text, bigint, jsonb)","body":"3c538d11e1761a609c56c0a817c4ff1e","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_record_provider_session(uuid, uuid, uuid, text, text, timestamp with time zone)","body":"563edce89a66580c14e2d735b1ebebd3","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_record_target_outcome(text, uuid, text)","body":"e6da0fbd2a0f3e7c5d50f1f08fbddff0","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_release_refresh(uuid, text)","body":"6a76456e5f261a5538262bce372c0d81","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_reserve_bound_intent(text, uuid, text, text, integer)","body":"846392a6d0f02bba3e14fb37ce5fe0f7","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_resolve_bound_session(text, text[], text)","body":"800016db1c25c0dc7e6570295c1895e4","result":"jsonb","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_revoke_sessions_at(uuid, text, timestamp with time zone)","body":"e6510c6d547207524038f098c7207578","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_set_admission_barrier(uuid, text, boolean)","body":"c3a0130dbddb649283976c4ff8a4ac1e","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"},{"sig":"public.vel_broker_set_admission_barrier(uuid, text, boolean, text, uuid)","body":"cf933d4bdd2af8faf8a0686882eb6bdf","result":"boolean","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"security":true,"volatility":"v"}]$functions$::jsonb)
   as expected(sig text,body text,result text,owner text,acl text,config jsonb,security boolean,volatility text)
  left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(expected.sig)
  where p.oid is null
   or md5(replace(p.prosrc,chr(13),'')) is distinct from expected.body
   or pg_catalog.pg_get_function_result(p.oid) is distinct from expected.result
   or pg_catalog.pg_get_userbyid(p.proowner) is distinct from expected.owner
   or p.proacl::text is distinct from expected.acl
   or to_jsonb(p.proconfig) is distinct from expected.config
   or p.prosecdef is distinct from expected.security
   or p.provolatile::text is distinct from expected.volatility
 ) and not exists (
  select 1 from jsonb_to_recordset($columns$[{"relation":"public.vel_broker_admission","name":"barrier_active","type":"boolean","required":true},{"relation":"public.vel_broker_admission","name":"barrier_operation_key","type":"text","required":false},{"relation":"public.vel_broker_admission","name":"updated_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_admission","name":"user_id","type":"uuid","required":true},{"relation":"public.vel_broker_auth_intents","name":"admission_receipt","type":"jsonb","required":false},{"relation":"public.vel_broker_auth_intents","name":"browser_lineage_id","type":"uuid","required":false},{"relation":"public.vel_broker_auth_intents","name":"cleanup_state","type":"text","required":true},{"relation":"public.vel_broker_auth_intents","name":"committed_native_session_id","type":"uuid","required":false},{"relation":"public.vel_broker_auth_intents","name":"created_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_auth_intents","name":"expected_parent_handle_hash","type":"text","required":false},{"relation":"public.vel_broker_auth_intents","name":"expires_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_auth_intents","name":"id","type":"uuid","required":true},{"relation":"public.vel_broker_auth_intents","name":"lineage_generation","type":"bigint","required":false},{"relation":"public.vel_broker_auth_intents","name":"ordinal","type":"bigint","required":true},{"relation":"public.vel_broker_auth_intents","name":"pkce_verifier_enc","type":"text","required":false},{"relation":"public.vel_broker_auth_intents","name":"provider_access_enc","type":"text","required":false},{"relation":"public.vel_broker_auth_intents","name":"provider_expires_at","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_auth_intents","name":"provider_refresh_enc","type":"text","required":false},{"relation":"public.vel_broker_auth_intents","name":"provider_state","type":"text","required":true},{"relation":"public.vel_broker_auth_intents","name":"purpose","type":"text","required":true},{"relation":"public.vel_broker_auth_intents","name":"recovery_operation_key","type":"text","required":false},{"relation":"public.vel_broker_auth_intents","name":"request_nonce","type":"uuid","required":false},{"relation":"public.vel_broker_auth_intents","name":"state_nonce","type":"text","required":true},{"relation":"public.vel_broker_auth_intents","name":"status","type":"text","required":true},{"relation":"public.vel_broker_auth_intents","name":"updated_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_auth_intents","name":"user_id","type":"uuid","required":false},{"relation":"public.vel_broker_browser_attempts","name":"attempt_id","type":"uuid","required":true},{"relation":"public.vel_broker_browser_attempts","name":"browser_lineage_id","type":"uuid","required":true},{"relation":"public.vel_broker_browser_attempts","name":"created_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_browser_attempts","name":"issue_seq","type":"bigint","required":true},{"relation":"public.vel_broker_browser_attempts","name":"superseded_at","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_browser_attempts","name":"superseded_by","type":"uuid","required":false},{"relation":"public.vel_broker_browser_lineages","name":"bootstrap_hash","type":"text","required":true},{"relation":"public.vel_broker_browser_lineages","name":"created_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_browser_lineages","name":"current_generation","type":"bigint","required":true},{"relation":"public.vel_broker_browser_lineages","name":"current_registry_id","type":"uuid","required":false},{"relation":"public.vel_broker_browser_lineages","name":"id","type":"uuid","required":true},{"relation":"public.vel_broker_browser_lineages","name":"latest_reserved_generation","type":"bigint","required":true},{"relation":"public.vel_broker_browser_lineages","name":"state","type":"text","required":true},{"relation":"public.vel_broker_browser_lineages","name":"updated_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_browser_lineages","name":"valid_until","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_operations","name":"actor_user_id","type":"uuid","required":true},{"relation":"public.vel_broker_operations","name":"completion_receipt","type":"jsonb","required":false},{"relation":"public.vel_broker_operations","name":"created_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_operations","name":"credential_mutated_at","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_operations","name":"cutoff","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_operations","name":"id","type":"uuid","required":true},{"relation":"public.vel_broker_operations","name":"kind","type":"text","required":true},{"relation":"public.vel_broker_operations","name":"legacy_coverage","type":"text","required":false},{"relation":"public.vel_broker_operations","name":"legacy_resolution","type":"text","required":false},{"relation":"public.vel_broker_operations","name":"operation_key","type":"text","required":true},{"relation":"public.vel_broker_operations","name":"revision","type":"bigint","required":true},{"relation":"public.vel_broker_operations","name":"snapshot_frozen","type":"boolean","required":true},{"relation":"public.vel_broker_operations","name":"stages","type":"jsonb","required":true},{"relation":"public.vel_broker_operations","name":"status","type":"text","required":true},{"relation":"public.vel_broker_operations","name":"target_native_session_id","type":"uuid","required":false},{"relation":"public.vel_broker_operations","name":"target_receipts","type":"jsonb","required":true},{"relation":"public.vel_broker_operations","name":"target_snapshot","type":"jsonb","required":true},{"relation":"public.vel_broker_operations","name":"updated_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_sessions","name":"access_token_enc","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"admission_scope","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"auth_intent_id","type":"uuid","required":false},{"relation":"public.vel_broker_sessions","name":"auth_ordinal","type":"bigint","required":true},{"relation":"public.vel_broker_sessions","name":"browser_lineage_id","type":"uuid","required":false},{"relation":"public.vel_broker_sessions","name":"cookie_name","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"created_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_sessions","name":"generation","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"handle_hash","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"id","type":"uuid","required":true},{"relation":"public.vel_broker_sessions","name":"last_seen_at","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_sessions","name":"native_session_id","type":"uuid","required":true},{"relation":"public.vel_broker_sessions","name":"parent_handle_hash","type":"text","required":false},{"relation":"public.vel_broker_sessions","name":"refresh_lease_token","type":"text","required":false},{"relation":"public.vel_broker_sessions","name":"refresh_lease_until","type":"timestamp with time zone","required":false},{"relation":"public.vel_broker_sessions","name":"refresh_revision","type":"bigint","required":true},{"relation":"public.vel_broker_sessions","name":"refresh_state","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"refresh_token_enc","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"status","type":"text","required":true},{"relation":"public.vel_broker_sessions","name":"token_expires_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_sessions","name":"updated_at","type":"timestamp with time zone","required":true},{"relation":"public.vel_broker_sessions","name":"user_id","type":"uuid","required":true}]$columns$::jsonb)
   as expected(relation text,name text,type text,required boolean)
  left join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass(expected.relation)
   and a.attname=expected.name and a.attnum>0 and not a.attisdropped
  where a.attrelid is null or pg_catalog.format_type(a.atttypid,a.atttypmod) is distinct from expected.type
   or a.attnotnull is distinct from expected.required
 ) and not exists (
  select 1 from jsonb_to_recordset($tables$[{"relation":"private.app_session_activity","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=r/postgres}","rls":false},{"relation":"private.app_session_settings","owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","rls":false},{"relation":"private.master_account_session_revocations","owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","rls":true},{"relation":"public.vel_broker_admission","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true},{"relation":"public.vel_broker_auth_intents","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true},{"relation":"public.vel_broker_browser_attempts","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true},{"relation":"public.vel_broker_browser_lineages","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true},{"relation":"public.vel_broker_operations","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true},{"relation":"public.vel_broker_sessions","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,service_role=arwd/postgres}","rls":true}]$tables$::jsonb)
   as expected(relation text,owner text,acl text,rls boolean)
  left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass(expected.relation)
  where c.oid is null or pg_catalog.pg_get_userbyid(c.relowner) is distinct from expected.owner
   or c.relacl::text is distinct from expected.acl or c.relrowsecurity is distinct from expected.rls
 );
$contract$;
alter function private.vel_broker_capability_contract_matches() owner to postgres;
revoke all on function private.vel_broker_capability_contract_matches() from public,anon,authenticated,service_role;
