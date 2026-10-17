-- ES01/WP01B E01/C01 — recovery write linearization on broker root tip (not JWT-only).
-- Defect: master_phone_current_session is JWT native sid; comparing expected_sid to JWT
-- after actor intake lock does not see root.current_registry_id advancing to tip B while
-- native A remains valid. Fix: lock browser lineage root first (same order as
-- vel_broker_admit_bound_session), require active registry == root.current_registry_id,
-- matching native sid + JWT actor. Client capture (registry/lineage/native) must match tip;
-- null/missing capture is not authority.
-- 3-arg open / 0-arg read: server-resolve tip from JWT; superseded native (not current
-- registry) → insufficient_privilege (deny-safe, not EXECUTE-only compatibility).
-- Does NOT grant identity mutation.
-- Deny-safe rollback (not native-only downgrade): keep broker tip guards on review RPCs
-- (tip-from-JWT / 6-arg tip path) OR revoke EXECUTE on affected public review overloads
-- until an approved forward; never restore 20261014033009 native-only bodies that could
-- accept a superseded broker tip while native sid remains valid; never reset
-- auth/broker revocation/generation/barrier or revive revoked sessions.

begin;

-- Drop prior JWT-sid-only tip opener (signature change cannot OR REPLACE args).
drop function if exists private.master_open_recovery_case_tip(uuid, text, uuid, uuid);

-- Tip opener: root lock → tip recheck → actor intake → subject → insert fence.
create or replace function private.master_open_recovery_case_tip(
  uid uuid,
  why text,
  key uuid,
  expected_sid uuid,
  expected_registry_id uuid,
  expected_lineage_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c private.master_identity_recovery_cases;
  actor uuid := auth.uid();
  sid uuid;
  root public.vel_broker_browser_lineages%rowtype;
  tip public.vel_broker_sessions%rowtype;
begin
  if expected_sid is null or expected_registry_id is null or expected_lineage_id is null
     or uid is null or key is null or why is null
     or why not in ('lost_phone', 'lost_email_and_phone')
     or not exists(select 1 from auth.users where id = uid) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  sid := private.master_phone_current_session(actor);
  if sid is null or sid is distinct from expected_sid then
    raise insufficient_privilege;
  end if;

  -- Load captured registry row before locks (non-locking); must match JWT native.
  select * into tip from public.vel_broker_sessions
  where id = expected_registry_id;
  if tip.id is null
     or tip.user_id is distinct from actor
     or tip.native_session_id is distinct from expected_sid
     or tip.browser_lineage_id is distinct from expected_lineage_id
     or tip.status is distinct from 'active' then
    raise insufficient_privilege;
  end if;

  -- Lock order matches vel_broker_admit_bound_session: lineage advisory → root FOR UPDATE.
  perform pg_advisory_xact_lock(hashtextextended(expected_lineage_id::text, 0));
  select * into root from public.vel_broker_browser_lineages
  where id = expected_lineage_id for update;
  if root.id is null or root.state is distinct from 'active' then
    raise insufficient_privilege;
  end if;
  if root.valid_until is not null and root.valid_until <= clock_timestamp() then
    raise insufficient_privilege;
  end if;
  -- Tip fence: root pointer must still be the captured registry (detects B commit).
  if root.current_registry_id is distinct from expected_registry_id then
    raise insufficient_privilege;
  end if;

  select * into tip from public.vel_broker_sessions
  where id = expected_registry_id for update;
  if tip.id is null
     or tip.status is distinct from 'active'
     or tip.native_session_id is distinct from expected_sid
     or tip.browser_lineage_id is distinct from expected_lineage_id
     or tip.user_id is distinct from actor then
    raise insufficient_privilege;
  end if;

  perform 1 from auth.sessions
  where id = sid and user_id = actor
    and (not_after is null or not_after > clock_timestamp())
  for share;
  if not found then
    raise insufficient_privilege;
  end if;

  -- Actor intake serialization (after root), then recheck tip under held root.
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':identity-recovery-intake', 0));
  if private.master_phone_current_session(actor) is distinct from expected_sid
     or (actor <> uid and not private.master_recovery_platform_owner()) then
    raise insufficient_privilege;
  end if;
  select current_registry_id into root.current_registry_id
  from public.vel_broker_browser_lineages where id = expected_lineage_id;
  if root.current_registry_id is distinct from expected_registry_id then
    raise insufficient_privilege;
  end if;

  select * into c from private.master_identity_recovery_cases
  where opened_by = actor and request_key = key;
  if c.id is not null then
    if c.user_id <> uid or c.reason <> why then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    return jsonb_build_object('ok', true, 'data', private.master_identity_recovery_case_json(c.id));
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':identity-recovery-subject', 0));
  select * into c from private.master_identity_recovery_cases
  where user_id = uid and state in ('review', 'needs_evidence');
  if c.id is not null then
    return jsonb_build_object('ok', true, 'data', private.master_identity_recovery_case_json(c.id));
  end if;

  -- Final tip fence immediately before insert.
  if private.master_phone_current_session(actor) is distinct from expected_sid then
    raise insufficient_privilege;
  end if;
  select current_registry_id into root.current_registry_id
  from public.vel_broker_browser_lineages where id = expected_lineage_id;
  if root.current_registry_id is distinct from expected_registry_id then
    raise insufficient_privilege;
  end if;

  insert into private.master_identity_recovery_cases(user_id, opened_by, open_session_id, request_key, reason)
  values (uid, actor, sid, key, why) returning * into c;
  insert into private.master_identity_recovery_events(case_id, actor_user_id, actor_session_id, event)
  values (c.id, actor, sid, 'review_opened_no_identity_authority');
  return jsonb_build_object('ok', true, 'data', private.master_identity_recovery_case_json(c.id));
end;
$$;

-- Resolve JWT → current tip registry (active + root.current_registry_id). Superseded → null.
create or replace function private.master_recovery_tip_from_jwt()
returns table(registry_id uuid, lineage_id uuid, native_session_id uuid)
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid := auth.uid();
  sid uuid;
begin
  sid := private.master_phone_current_session(actor);
  if sid is null then
    return;
  end if;
  return query
  select s.id, s.browser_lineage_id, s.native_session_id
  from public.vel_broker_sessions s
  join public.vel_broker_browser_lineages r on r.id = s.browser_lineage_id
  where s.user_id = actor
    and s.native_session_id = sid
    and s.status = 'active'
    and r.state = 'active'
    and r.current_registry_id = s.id
    and (r.valid_until is null or r.valid_until > clock_timestamp());
end;
$$;

-- App tip open: all capture fields required (no null authority).
create or replace function public.master_open_identity_recovery_review(
  p_expected_user_id uuid,
  p_reason text,
  p_request_key uuid,
  p_expected_native_session_id uuid,
  p_expected_registry_id uuid,
  p_expected_browser_lineage_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is distinct from p_expected_user_id then
    raise insufficient_privilege;
  end if;
  if p_expected_native_session_id is null
     or p_expected_registry_id is null
     or p_expected_browser_lineage_id is null then
    raise insufficient_privilege;
  end if;
  return private.master_open_recovery_case_tip(
    auth.uid(),
    p_reason,
    p_request_key,
    p_expected_native_session_id,
    p_expected_registry_id,
    p_expected_browser_lineage_id
  );
end;
$$;

-- Prior 4-arg tip (JWT sid only) is not authoritative — always deny.
create or replace function public.master_open_identity_recovery_review(
  p_expected_user_id uuid,
  p_reason text,
  p_request_key uuid,
  p_expected_native_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  raise insufficient_privilege;
end;
$$;

-- 3-arg legacy: server-resolve tip from JWT; superseded native cannot open.
create or replace function public.master_open_identity_recovery_review(
  p_expected_user_id uuid,
  p_reason text,
  p_request_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  tip record;
begin
  if auth.uid() is distinct from p_expected_user_id then
    raise insufficient_privilege;
  end if;
  select * into tip from private.master_recovery_tip_from_jwt() limit 1;
  if tip.registry_id is null then
    raise insufficient_privilege;
  end if;
  return private.master_open_recovery_case_tip(
    auth.uid(),
    p_reason,
    p_request_key,
    tip.native_session_id,
    tip.registry_id,
    tip.lineage_id
  );
end;
$$;

create or replace function public.master_read_identity_recovery_reviews(
  p_expected_native_session_id uuid,
  p_expected_registry_id uuid,
  p_expected_browser_lineage_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  sid uuid;
  root public.vel_broker_browser_lineages%rowtype;
  tip public.vel_broker_sessions%rowtype;
begin
  if p_expected_native_session_id is null
     or p_expected_registry_id is null
     or p_expected_browser_lineage_id is null then
    raise insufficient_privilege;
  end if;
  sid := private.master_phone_current_session(auth.uid());
  if sid is null or sid is distinct from p_expected_native_session_id then
    raise insufficient_privilege;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_expected_browser_lineage_id::text, 0));
  select * into root from public.vel_broker_browser_lineages
  where id = p_expected_browser_lineage_id for update;
  if root.id is null or root.state is distinct from 'active'
     or root.current_registry_id is distinct from p_expected_registry_id then
    raise insufficient_privilege;
  end if;
  if root.valid_until is not null and root.valid_until <= clock_timestamp() then
    raise insufficient_privilege;
  end if;

  select * into tip from public.vel_broker_sessions where id = p_expected_registry_id;
  if tip.id is null or tip.status is distinct from 'active'
     or tip.native_session_id is distinct from p_expected_native_session_id
     or tip.browser_lineage_id is distinct from p_expected_browser_lineage_id
     or tip.user_id is distinct from auth.uid() then
    raise insufficient_privilege;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'userId', auth.uid(),
      'configuration', case
        when (select enabled from private.master_identity_recovery_policy where singleton) then 'CONFIGURED'
        else 'UNCONFIGURED'
      end,
      'cases', coalesce(
        (select jsonb_agg(private.master_identity_recovery_case_json(id) order by created_at desc)
         from private.master_identity_recovery_cases where user_id = auth.uid()),
        '[]'::jsonb
      )
    )
  );
end;
$$;

-- Prior 1-arg read (sid only) is not authoritative — always deny.
create or replace function public.master_read_identity_recovery_reviews(
  p_expected_native_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  raise insufficient_privilege;
end;
$$;

-- 0-arg legacy read: tip-from-JWT or deny superseded.
create or replace function public.master_read_identity_recovery_reviews()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  tip record;
begin
  select * into tip from private.master_recovery_tip_from_jwt() limit 1;
  if tip.registry_id is null then
    raise insufficient_privilege;
  end if;
  return public.master_read_identity_recovery_reviews(
    tip.native_session_id,
    tip.registry_id,
    tip.lineage_id
  );
end;
$$;

-- 4-arg private tip was DROP IF EXISTS above — do not REVOKE a non-existent signature.
revoke all on function private.master_open_recovery_case_tip(uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.master_recovery_tip_from_jwt() from public, anon, authenticated, service_role;

revoke all on function public.master_open_identity_recovery_review(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.master_open_identity_recovery_review(uuid, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.master_open_identity_recovery_review(uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.master_read_identity_recovery_reviews() from public, anon, authenticated, service_role;
revoke all on function public.master_read_identity_recovery_reviews(uuid) from public, anon, authenticated, service_role;
revoke all on function public.master_read_identity_recovery_reviews(uuid, uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.master_open_identity_recovery_review(uuid, text, uuid) to authenticated;
grant execute on function public.master_open_identity_recovery_review(uuid, text, uuid, uuid, uuid, uuid) to authenticated;
-- 4-arg retained only as deny-closed overload (no grant to authenticated) — prevent sid-only bypass.
grant execute on function public.master_read_identity_recovery_reviews() to authenticated;
grant execute on function public.master_read_identity_recovery_reviews(uuid, uuid, uuid) to authenticated;

commit;
