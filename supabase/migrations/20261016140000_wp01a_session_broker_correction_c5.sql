-- WP01A-CORRECTION C5: server-bound browser attempt, receipt validity, recovery scope,
-- lineage CAS, legacy overload fail-closed. Additive — no DROP.
begin;

create table if not exists public.vel_broker_browser_attempts (
  attempt_id uuid primary key,
  browser_lineage_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.vel_broker_browser_attempts enable row level security;
revoke all on public.vel_broker_browser_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.vel_broker_browser_attempts to service_role;

alter table public.vel_broker_sessions
  add column if not exists admission_scope text not null default 'app'
    check (admission_scope in ('app', 'recovery'));

create or replace function public.vel_broker_bind_browser_attempt(p_attempt_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  lin uuid;
begin
  if p_attempt_id is null then return null; end if;
  insert into public.vel_broker_browser_attempts(attempt_id, browser_lineage_id)
  values (p_attempt_id, gen_random_uuid())
  on conflict (attempt_id) do nothing;
  select browser_lineage_id into lin
  from public.vel_broker_browser_attempts where attempt_id = p_attempt_id;
  return lin;
end;
$$;
revoke all on function public.vel_broker_bind_browser_attempt(uuid) from public, anon, authenticated;
grant execute on function public.vel_broker_bind_browser_attempt(uuid) to service_role;

-- Fail-closed legacy overloads (C5-06) — route consumers to 13-arg contract.
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
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'code', 'DEPRECATED_SIGNATURE');
$$;

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
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'code', 'DEPRECATED_SIGNATURE');
$$;

-- C5 admit: lineage lock, receipt after validity, recovery scope, ordinal fence.
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
  lineage uuid;
  parent_row record;
  tip_hash text;
  tip_ord bigint;
  existing_receipt jsonb;
  receipt jsonb;
  scope text;
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

  -- Idempotent retry ONLY when intent still valid and registry row authoritative (C5-03).
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
    registry_id := (existing_receipt->>'registry_id')::uuid;
    select status into registry_status from public.vel_broker_sessions where id = registry_id;
    if registry_status is distinct from 'active' then
      return jsonb_build_object('ok', false, 'code', 'RECEIPT_STALE');
    end if;
    return existing_receipt || jsonb_build_object('idempotent', true);
  end if;

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

  lineage := p_browser_lineage_id;
  if lineage is null then
    return jsonb_build_object('ok', false, 'code', 'LINEAGE_REQUIRED');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lineage::text, 0));

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

revoke all on function public.vel_broker_admit_session(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text,text,text
) from public, anon, authenticated;
grant execute on function public.vel_broker_admit_session(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text,text,text
) to service_role;

-- C4 13-arg admit without scope → fail closed (C5-06).
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
  p_recovery_operation_key text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'code', 'DEPRECATED_SIGNATURE');
$$;

-- Barrier activation CAS against lineage tip (C5-05).
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
  if p_active and p_expected_tip_handle_hash is not null and p_browser_lineage_id is not null then
    select t.handle_hash into tip_hash
    from public.vel_broker_lineage_tip(p_browser_lineage_id) t;
    if tip_hash is distinct from p_expected_tip_handle_hash then
      return false;
    end if;
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
  if not cur_active or cur_key is distinct from p_operation_key then
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

revoke all on function public.vel_broker_set_admission_barrier(uuid, text, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.vel_broker_set_admission_barrier(uuid, text, boolean, text, uuid)
  to service_role;

create or replace function public.vel_broker_set_admission_barrier(
  p_user_id uuid,
  p_operation_key text,
  p_active boolean
) returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.vel_broker_set_admission_barrier(
    p_user_id, p_operation_key, p_active, null::text, null::uuid
  );
$$;

revoke all on function public.vel_broker_set_admission_barrier(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.vel_broker_set_admission_barrier(uuid, text, boolean)
  to service_role;

commit;
