-- WP01A-CORRECTION C5-R3: unified lock order (lineage → admission), idempotent
-- barrier release, atomic revocation finish, tighter capability probe.
-- Additive — no DROP. Browser init race closed in app layer (strict vel_ba monotonic).
begin;

-- Barrier: lineage advisory BEFORE admission row; release idempotent when already clear.
create or replace function public.vel_broker_set_admission_barrier(
  p_user_id uuid,
  p_operation_key text,
  p_active boolean,
  p_expected_tip_handle_hash text,
  p_browser_lineage_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_key text;
  cur_active boolean;
  tip_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  if p_operation_key is null or length(p_operation_key) < 16 then
    return false;
  end if;

  -- Lock order: lineage (when present) then admission — matches admit replay/new.
  if p_browser_lineage_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_browser_lineage_id::text, 0));
  end if;

  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, case when p_active then p_operation_key else null end, coalesce(p_active, false), clock_timestamp())
  on conflict (user_id) do nothing;

  select barrier_operation_key, barrier_active into cur_key, cur_active
  from public.vel_broker_admission where user_id = p_user_id for update;

  if p_active then
    if p_expected_tip_handle_hash is not null and p_browser_lineage_id is not null then
      select t.handle_hash into tip_hash
      from public.vel_broker_lineage_tip(p_browser_lineage_id) t;
      if tip_hash is distinct from p_expected_tip_handle_hash then
        return false;
      end if;
    end if;
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

  -- Release: idempotent if already inactive for this op (or cleared).
  if not coalesce(cur_active, false) then
    return cur_key is null or cur_key is not distinct from p_operation_key;
  end if;
  if cur_key is distinct from p_operation_key then
    return false;
  end if;
  update public.vel_broker_admission
    set barrier_operation_key = null,
        barrier_active = false,
        updated_at = clock_timestamp()
  where user_id = p_user_id;
  return true;
end;
$$;

-- Atomic finish: confirm operation + release barrier under admission lock.
create or replace function public.vel_broker_complete_revocation_operation(
  p_user_id uuid,
  p_operation_key text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  op_status text;
  op_kind text;
  native_stage text;
  cur_key text;
  cur_active boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return false;
  end if;
  if p_user_id is null or p_operation_key is null or length(p_operation_key) < 16 then
    return false;
  end if;

  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, null, false, clock_timestamp())
  on conflict (user_id) do nothing;

  select barrier_operation_key, barrier_active into cur_key, cur_active
  from public.vel_broker_admission where user_id = p_user_id for update;

  select status, kind, coalesce(stages->>'nativeRevocation', '')
    into op_status, op_kind, native_stage
  from public.vel_broker_operations
  where operation_key = p_operation_key
    and actor_user_id = p_user_id
  for update;

  if op_kind is distinct from 'password_revoke' then
    return false;
  end if;

  if op_status = 'confirmed' then
    if coalesce(cur_active, false) and cur_key is not distinct from p_operation_key then
      update public.vel_broker_admission
        set barrier_operation_key = null, barrier_active = false, updated_at = clock_timestamp()
      where user_id = p_user_id;
    end if;
    return true;
  end if;

  if op_status is distinct from 'pending' or native_stage is distinct from 'confirmed' then
    return false;
  end if;

  update public.vel_broker_operations
    set status = 'confirmed', updated_at = clock_timestamp()
  where operation_key = p_operation_key
    and actor_user_id = p_user_id
    and status = 'pending';

  if not found then
    return false;
  end if;

  if coalesce(cur_active, false) then
    if cur_key is distinct from p_operation_key then
      return false;
    end if;
    update public.vel_broker_admission
      set barrier_operation_key = null, barrier_active = false, updated_at = clock_timestamp()
    where user_id = p_user_id;
  elsif cur_key is not null and cur_key is distinct from p_operation_key then
    return false;
  end if;

  return true;
end;
$$;
revoke all on function public.vel_broker_complete_revocation_operation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.vel_broker_complete_revocation_operation(uuid, text)
  to service_role;

-- Admit: lineage lock before admission on both replay and new paths.
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  ord bigint;
  allowed boolean;
  barrier_key text;
  intent_parent text;
  intent_status text;
  intent_ordinal bigint;
  intent_lineage uuid;
  intent_recovery text;
  intent_expires timestamptz;
  receipt_user uuid;
  receipt_native uuid;
  registry_id uuid;
  registry_status text;
  registry_scope text;
  lineage uuid;
  parent_row record;
  tip_hash text;
  tip_ord bigint;
  existing_receipt jsonb;
  receipt jsonb;
  scope text;
  receipt_scope text;
  recovery_ok boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'ROLE');
  end if;
  scope := coalesce(p_admission_scope, 'app');
  if scope not in ('app', 'recovery') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SCOPE');
  end if;
  if p_user_id is null or p_native_session_id is null
     or p_handle_hash is null or p_cookie_name is null or p_generation is null
     or p_access_token_enc is null or p_refresh_token_enc is null
     or p_token_expires_at is null or p_handle_token_enc is null
     or length(p_handle_token_enc) < 24 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  if p_intent_id is not null then
    select admission_receipt, status, expected_parent_handle_hash, ordinal,
           browser_lineage_id, recovery_operation_key, expires_at,
           user_id, committed_native_session_id
      into existing_receipt, intent_status, intent_parent, intent_ordinal,
           intent_lineage, intent_recovery, intent_expires,
           receipt_user, receipt_native
    from public.vel_broker_auth_intents where id = p_intent_id for update;
  end if;

  if p_intent_id is not null and intent_status = 'committed'
     and existing_receipt is not null
     and coalesce((existing_receipt->>'ok')::boolean, false) then
    if intent_expires is not null and intent_expires <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED');
    end if;
    if (existing_receipt->>'user_id')::uuid is distinct from p_user_id
       or (existing_receipt->>'native_session_id')::uuid is distinct from p_native_session_id then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_IDENTITY_MISMATCH');
    end if;
    if existing_receipt ? 'handle_token' then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_INSECURE');
    end if;
    if (existing_receipt->>'browser_lineage_id')::uuid is distinct from p_browser_lineage_id then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_LINEAGE_MISMATCH');
    end if;
    receipt_scope := coalesce(existing_receipt->>'admission_scope', 'app');
    lineage := (existing_receipt->>'browser_lineage_id')::uuid;
    if lineage is null then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_LINEAGE_MISMATCH');
    end if;
    -- Lock order: lineage → admission
    perform pg_advisory_xact_lock(hashtextextended(lineage::text, 0));
    insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
    values (p_user_id, null, false, clock_timestamp())
    on conflict (user_id) do nothing;
    perform 1 from public.vel_broker_admission where user_id = p_user_id for update;
    select not barrier_active, barrier_operation_key into allowed, barrier_key
    from public.vel_broker_admission where user_id = p_user_id;
    select t.handle_hash, t.auth_ordinal into tip_hash, tip_ord
    from public.vel_broker_lineage_tip(lineage) t;
    if tip_hash is distinct from (existing_receipt->>'handle_hash') then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_NOT_TIP');
    end if;
    registry_id := (existing_receipt->>'registry_id')::uuid;
    select status, admission_scope into registry_status, registry_scope
    from public.vel_broker_sessions where id = registry_id for update;
    if registry_status is distinct from 'active' then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_STALE');
    end if;
    if registry_scope is distinct from receipt_scope then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_SCOPE_MISMATCH');
    end if;
    if receipt_scope = 'app' and not coalesce(allowed, false) then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_BARRIER');
    end if;
    if receipt_scope = 'recovery' then
      if barrier_key is null or intent_recovery is distinct from barrier_key then
        return jsonb_build_object('ok', false, 'code', 'RECEIPT_BARRIER');
      end if;
    end if;
    return existing_receipt || jsonb_build_object('idempotent', true);
  end if;

  lineage := p_browser_lineage_id;
  if lineage is null then
    return jsonb_build_object('ok', false, 'code', 'LINEAGE_REQUIRED');
  end if;
  -- Lock order: lineage → admission (never reverse)
  perform pg_advisory_xact_lock(hashtextextended(lineage::text, 0));

  insert into public.vel_broker_admission(user_id, barrier_operation_key, barrier_active, updated_at)
  values (p_user_id, null, false, clock_timestamp())
  on conflict (user_id) do nothing;
  perform 1 from public.vel_broker_admission where user_id = p_user_id for update;
  select not barrier_active, barrier_operation_key into allowed, barrier_key
  from public.vel_broker_admission where user_id = p_user_id;

  if scope = 'app' and not coalesce(allowed, false) then
    return jsonb_build_object('ok', false, 'code', 'BARRIER');
  end if;
  if scope = 'recovery' then
    if p_recovery_operation_key is null or barrier_key is null
       or p_recovery_operation_key is distinct from barrier_key
       or length(p_recovery_operation_key) < 16 then
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

  if p_parent_handle_hash is not null then
    select s.* into parent_row from public.vel_broker_sessions s
    where s.handle_hash = p_parent_handle_hash for update;
    if parent_row.id is null then
      return jsonb_build_object('ok', false, 'code', 'PARENT_UNKNOWN');
    end if;
    if parent_row.browser_lineage_id is null then
      update public.vel_broker_sessions
        set browser_lineage_id = parent_row.id, updated_at = clock_timestamp()
      where id = parent_row.id and browser_lineage_id is null;
      lineage := parent_row.id;
    elsif parent_row.browser_lineage_id is distinct from lineage then
      return jsonb_build_object('ok', false, 'code', 'LINEAGE_MISMATCH');
    end if;
    select t.handle_hash, t.auth_ordinal into tip_hash, tip_ord
    from public.vel_broker_lineage_tip(lineage) t;
    if tip_hash is distinct from p_parent_handle_hash then
      return jsonb_build_object('ok', false, 'code', 'PARENT_NOT_TIP');
    end if;
  else
    select t.handle_hash, t.auth_ordinal into tip_hash, tip_ord
    from public.vel_broker_lineage_tip(lineage) t;
  end if;

  if p_intent_id is not null then
    select status, expected_parent_handle_hash, ordinal, browser_lineage_id, recovery_operation_key, expires_at
      into intent_status, intent_parent, intent_ordinal, intent_lineage, intent_recovery, intent_expires
    from public.vel_broker_auth_intents where id = p_intent_id for update;
    if intent_status is distinct from 'reserved' then
      return jsonb_build_object('ok', false, 'code', 'INTENT_STALE');
    end if;
    if intent_expires <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED');
    end if;
    if intent_lineage is distinct from lineage then
      return jsonb_build_object('ok', false, 'code', 'INTENT_LINEAGE_MISMATCH');
    end if;
    if intent_parent is not null and intent_parent is distinct from p_parent_handle_hash then
      return jsonb_build_object('ok', false, 'code', 'PARENT_MISMATCH');
    end if;
    if tip_ord is not null and intent_ordinal is not null and intent_ordinal <= tip_ord then
      return jsonb_build_object('ok', false, 'code', 'INTENT_SUPERSEDED');
    end if;
    if scope = 'recovery' and intent_recovery is distinct from p_recovery_operation_key then
      return jsonb_build_object('ok', false, 'code', 'RECOVERY_MISMATCH');
    end if;
    update public.vel_broker_auth_intents
      set status = 'committed',
          committed_native_session_id = p_native_session_id,
          user_id = p_user_id,
          browser_lineage_id = lineage,
          updated_at = clock_timestamp()
    where id = p_intent_id and status = 'reserved'
    returning ordinal into ord;
    if ord is null then
      return jsonb_build_object('ok', false, 'code', 'INTENT_EXPIRED');
    end if;
  else
    ord := public.vel_broker_next_auth_ordinal();
    if ord is null then return jsonb_build_object('ok', false, 'code', 'ORDINAL'); end if;
    if tip_ord is not null and ord <= tip_ord then
      return jsonb_build_object('ok', false, 'code', 'ORDINAL_SUPERSEDED');
    end if;
  end if;

  update public.vel_broker_sessions
    set status = 'tombstoned', updated_at = clock_timestamp()
  where browser_lineage_id = lineage
    and status = 'active'
    and auth_ordinal < ord
    and native_session_id is distinct from p_native_session_id;

  insert into public.vel_broker_sessions (
    handle_hash, cookie_name, generation, user_id, native_session_id,
    access_token_enc, refresh_token_enc, token_expires_at,
    auth_ordinal, auth_intent_id, parent_handle_hash, browser_lineage_id, status,
    refresh_state, last_seen_at, admission_scope
  ) values (
    p_handle_hash, p_cookie_name, p_generation, p_user_id, p_native_session_id,
    p_access_token_enc, p_refresh_token_enc, p_token_expires_at,
    ord, p_intent_id, p_parent_handle_hash, lineage, 'active',
    'idle', clock_timestamp(), scope
  )
  returning id into registry_id;

  receipt := jsonb_build_object(
    'ok', true, 'ordinal', ord, 'registry_id', registry_id,
    'browser_lineage_id', lineage, 'handle_hash', p_handle_hash,
    'cookie_name', p_cookie_name, 'generation', p_generation,
    'handle_token_enc', p_handle_token_enc,
    'user_id', p_user_id, 'native_session_id', p_native_session_id,
    'admission_scope', scope
  );
  if p_intent_id is not null then
    update public.vel_broker_auth_intents
      set admission_receipt = receipt, updated_at = clock_timestamp()
    where id = p_intent_id;
  end if;
  return receipt;
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'CONFLICT');
end;
$$;

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
  browser_attempt_ok boolean := false;
  issue_seq_col boolean := false;
  admission_scope_col boolean := false;
  complete_revoke_ok boolean := false;
  barrier_5arg boolean := false;
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
    and to_regclass('public.vel_broker_admission') is not null
    and to_regclass('public.vel_broker_browser_attempts') is not null;
  if not broker_registry then codes := array_append(codes, 'BROKER_REGISTRY_MISSING'); end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vel_broker_browser_attempts'
      and column_name = 'issue_seq'
  ) into issue_seq_col;
  if not issue_seq_col then codes := array_append(codes, 'BROWSER_ISSUE_SEQ_MISSING'); end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vel_broker_sessions'
      and column_name = 'admission_scope'
  ) into admission_scope_col;
  if not admission_scope_col then codes := array_append(codes, 'ADMISSION_SCOPE_MISSING'); end if;

  browser_attempt_ok := to_regprocedure('public.vel_broker_issue_browser_attempt(uuid,bigint)') is not null
    and issue_seq_col;
  if not browser_attempt_ok then codes := array_append(codes, 'BROWSER_ATTEMPT_MISSING'); end if;

  complete_revoke_ok := to_regprocedure(
    'public.vel_broker_complete_revocation_operation(uuid,text)'
  ) is not null;
  if not complete_revoke_ok then codes := array_append(codes, 'COMPLETE_REVOKE_MISSING'); end if;

  barrier_5arg := to_regprocedure(
    'public.vel_broker_set_admission_barrier(uuid,text,boolean,text,uuid)'
  ) is not null;
  if not barrier_5arg then codes := array_append(codes, 'BARRIER_5ARG_MISSING'); end if;

  revoke_at_operation := to_regprocedure('public.vel_broker_revoke_sessions_at(uuid,text,timestamptz)') is not null;
  if not revoke_at_operation then codes := array_append(codes, 'REVOKE_AT_MISSING'); end if;
  refresh_lease := to_regprocedure('public.vel_broker_claim_refresh(uuid,bigint,integer)') is not null
    and to_regprocedure('public.vel_broker_release_refresh(uuid,text)') is not null
    and to_regprocedure('public.vel_broker_mark_refresh_uncertain(uuid,text)') is not null;
  if not refresh_lease then codes := array_append(codes, 'REFRESH_LEASE_MISSING'); end if;
  admit_ordinal := to_regprocedure('public.vel_broker_next_auth_ordinal()') is not null;
  if not admit_ordinal then codes := array_append(codes, 'ORDINAL_SEQ_MISSING'); end if;
  admit_atomic := to_regprocedure(
    'public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text,text,text)'
  ) is not null;
  if not admit_atomic then codes := array_append(codes, 'ADMIT_ATOMIC_MISSING'); end if;

  return jsonb_build_object(
    'ok',
    revoke_boolean and idle_wrappers and broker_registry and revoke_at_operation
    and refresh_lease and admit_ordinal and admit_atomic and browser_attempt_ok
    and issue_seq_col and admission_scope_col and complete_revoke_ok and barrier_5arg
    and cardinality(codes) = 0,
    'contract_version', 1,
    'revoke_boolean', revoke_boolean,
    'idle_wrappers', idle_wrappers,
    'broker_registry', broker_registry,
    'revoke_at_operation', revoke_at_operation,
    'refresh_lease', refresh_lease,
    'admit_ordinal', admit_ordinal,
    'admit_atomic', admit_atomic,
    'browser_attempt_issue', browser_attempt_ok,
    'admit_14arg', admit_atomic,
    'issue_seq_column', issue_seq_col,
    'admission_scope_column', admission_scope_col,
    'complete_revocation', complete_revoke_ok,
    'barrier_tip_cas', barrier_5arg,
    'intent_lineage_column', true,
    'codes', codes
  );
end;
$$;

commit;
