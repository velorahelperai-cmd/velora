-- WP01A-CORRECTION C3: browser lineage fence, parent tip CAS, admission receipt, legacy freeze.
-- Additive only.
begin;

do $$begin
  if to_regclass('public.vel_broker_sessions') is null then
    raise exception 'WP01A_C3_REGISTRY_MISSING';
  end if;
end;$$;

alter table public.vel_broker_sessions
  add column if not exists browser_lineage_id uuid;

create index if not exists vel_broker_sessions_lineage_ordinal_idx
  on public.vel_broker_sessions (browser_lineage_id, auth_ordinal desc)
  where status = 'active';

alter table public.vel_broker_operations
  add column if not exists legacy_coverage text
    check (legacy_coverage is null or legacy_coverage in ('pending','absent','resolved')),
  add column if not exists legacy_resolution text;

alter table public.vel_broker_auth_intents
  add column if not exists admission_receipt jsonb;

-- Tip of an active browser lineage (highest ordinal), or null.
create or replace function public.vel_broker_lineage_tip(p_lineage_id uuid)
returns table (handle_hash text, auth_ordinal bigint, user_id uuid, registry_id uuid)
language sql
security definer
set search_path = ''
as $$
  select s.handle_hash, s.auth_ordinal, s.user_id, s.id
  from public.vel_broker_sessions s
  where s.browser_lineage_id = p_lineage_id
    and s.status = 'active'
  order by s.auth_ordinal desc, s.created_at desc
  limit 1;
$$;
revoke all on function public.vel_broker_lineage_tip(uuid) from public, anon, authenticated;
grant execute on function public.vel_broker_lineage_tip(uuid) to service_role;

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
  p_handle_token text
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
  intent_ordinal bigint;
  registry_id uuid;
  lineage uuid;
  parent_row record;
  tip_hash text;
  tip_ord bigint;
  existing_receipt jsonb;
  receipt jsonb;
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

  -- Idempotent retry: return original admission receipt without new session (C3-2).
  if p_intent_id is not null then
    select admission_receipt, status into existing_receipt, intent_status
    from public.vel_broker_auth_intents where id = p_intent_id for update;
    if intent_status = 'committed' and existing_receipt is not null
       and coalesce((existing_receipt->>'ok')::boolean, false) then
      return existing_receipt || jsonb_build_object('idempotent', true);
    end if;
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

  -- Resolve browser lineage from parent tip CAS (not mere equality) — C3-1/C3-2.
  lineage := p_browser_lineage_id;
  if p_parent_handle_hash is not null then
    select s.* into parent_row
    from public.vel_broker_sessions s
    where s.handle_hash = p_parent_handle_hash
    for update;
    if parent_row.id is null then
      return jsonb_build_object('ok', false, 'code', 'PARENT_UNKNOWN');
    end if;
    lineage := coalesce(parent_row.browser_lineage_id, parent_row.id);
    -- Parent must be the current tip of that lineage.
    select t.handle_hash, t.auth_ordinal into tip_hash, tip_ord
    from public.vel_broker_lineage_tip(lineage) t;
    if tip_hash is distinct from p_parent_handle_hash then
      return jsonb_build_object('ok', false, 'code', 'PARENT_NOT_TIP');
    end if;
  elsif lineage is null then
    lineage := gen_random_uuid();
  end if;

  if p_intent_id is not null then
    select status, expected_parent_handle_hash, ordinal
      into intent_status, intent_parent, intent_ordinal
    from public.vel_broker_auth_intents
    where id = p_intent_id
    for update;
    if intent_status is distinct from 'reserved' then
      return jsonb_build_object('ok', false, 'code', 'INTENT_STALE');
    end if;
    -- Stored expected parent must match AND be tip (CAS already checked tip above).
    if intent_parent is not null and intent_parent is distinct from p_parent_handle_hash then
      return jsonb_build_object('ok', false, 'code', 'PARENT_MISMATCH');
    end if;
    if intent_parent is null and p_parent_handle_hash is not null then
      return jsonb_build_object('ok', false, 'code', 'PARENT_UNEXPECTED');
    end if;
    -- Reject intent older than already-committed tip in this lineage.
    if tip_ord is not null and intent_ordinal is not null and intent_ordinal <= tip_ord then
      return jsonb_build_object('ok', false, 'code', 'INTENT_SUPERSEDED');
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
    if tip_ord is not null and ord <= tip_ord then
      -- Should not happen with sequence, but fail closed.
      return jsonb_build_object('ok', false, 'code', 'ORDINAL_SUPERSEDED');
    end if;
  end if;

  -- Fence ONLY same browser lineage — other devices keep working (C3-1).
  update public.vel_broker_sessions
    set status = 'tombstoned',
        updated_at = clock_timestamp()
  where browser_lineage_id = lineage
    and status = 'active'
    and native_session_id is distinct from p_native_session_id;

  insert into public.vel_broker_sessions (
    handle_hash, cookie_name, generation, user_id, native_session_id,
    access_token_enc, refresh_token_enc, token_expires_at,
    auth_ordinal, auth_intent_id, parent_handle_hash, browser_lineage_id, status,
    refresh_state, last_seen_at
  ) values (
    p_handle_hash, p_cookie_name, p_generation, p_user_id, p_native_session_id,
    p_access_token_enc, p_refresh_token_enc, p_token_expires_at,
    ord, p_intent_id, p_parent_handle_hash, lineage, 'active',
    'idle', clock_timestamp()
  )
  returning id into registry_id;

  receipt := jsonb_build_object(
    'ok', true,
    'ordinal', ord,
    'registry_id', registry_id,
    'browser_lineage_id', lineage,
    'handle_hash', p_handle_hash,
    'cookie_name', p_cookie_name,
    'generation', p_generation,
    'handle_token', p_handle_token
  );
  if p_intent_id is not null then
    update public.vel_broker_auth_intents
      set admission_receipt = receipt,
          updated_at = clock_timestamp()
    where id = p_intent_id;
  end if;
  return receipt;
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
end;
$$;

-- C4-07: Do NOT DROP prior admit overloads here. Expansion remains additive.
-- Exact retirement list lives in a separate gated migration after replacement
-- acceptance + dependency proof + explicit approval (not authorized in C3/C4 code).

revoke all on function public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text)
  to service_role;

-- Capability probe must match C3 admit signature + lineage column (strict booleans).
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
  browser_lineage_ok boolean := false;
  legacy_coverage_ok boolean := false;
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
  admit_atomic := to_regprocedure(
    'public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text)'
  ) is not null;
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

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_sessions' and column_name='browser_lineage_id'
  ) into browser_lineage_ok;
  if not browser_lineage_ok then codes := array_append(codes, 'BROWSER_LINEAGE_MISSING'); end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vel_broker_operations' and column_name='legacy_coverage'
  ) into legacy_coverage_ok;
  if not legacy_coverage_ok then codes := array_append(codes, 'LEGACY_COVERAGE_MISSING'); end if;

  return jsonb_build_object(
    'ok', (revoke_boolean and idle_wrappers and broker_registry and revoke_at_operation
      and refresh_lease and admit_ordinal and admit_atomic and has_auth_ordinal
      and refresh_state_ok and snapshot_frozen_ok and browser_lineage_ok and legacy_coverage_ok),
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
    'browser_lineage_column', browser_lineage_ok,
    'legacy_coverage_column', legacy_coverage_ok,
    'codes', to_jsonb(codes)
  );
end;
$$;

commit;
