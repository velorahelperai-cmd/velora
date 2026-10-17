-- WP01A post-stage cleanup — PHASE A only (approval-gated).
-- Location: supabase/cleanup-packages/wp01a-post-stage/ (NOT auto-applied with migrations/).
-- Prepared by Cursor. NOT authorized for Production. Historical migrations retained.
--
-- Fresh rebuild path:
--   1) Apply Auth-scoped sorted migrations (129: through password/identity + WP01A;
--      9 post-baseline installers remain AUTH_SCOPE_NOT_APPLIED).
--   2) Optionally apply THIS file under
--      select set_config('velora.cleanup_approval','WP01A-POST-STAGE-PHASE-A', true);
-- Upgrade path (existing DB):
--   Explicit psql/apply of this file only after Codex local proof + named owner approval;
--   each DROP uses RESTRICT after empty pg_depend inventory. No CASCADE.
-- Restore:
--   DB backup taken before apply, or rebuild fixture from historical migrations/ (deny stubs
--   return). This file does not delete auth.*, financial receipts, or audit rows.
--
-- Phase B+ (ES02–ES05 object retirement) is intentionally ABSENT here — see DIAGNOSTICS
--   inventory; requires separate named approvals for each data-loss class.

do $gate$
begin
  if current_setting('velora.cleanup_approval', true)
     is distinct from 'WP01A-POST-STAGE-PHASE-A' then
    raise exception 'CLEANUP_APPROVAL_REQUIRED:WP01A-POST-STAGE-PHASE-A';
  end if;
end;
$gate$;

create or replace function private.wp01a_cleanup_drop_function_if_unused(p_signature text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target regprocedure;
  dep_count integer;
begin
  begin
    target := p_signature::regprocedure;
  exception
    when undefined_function then
      return;
  end;

  select count(*)::integer into dep_count
  from pg_depend d
  where d.refobjid = target
    and d.deptype in ('n', 'a')
    and d.classid <> 'pg_proc'::regclass;

  if dep_count > 0 then
    raise exception 'CLEANUP_DEPENDENCY_BLOCKED:%:%', p_signature, dep_count;
  end if;

  execute format('drop function %s restrict', target);
end;
$$;

revoke all on function private.wp01a_cleanup_drop_function_if_unused(text)
  from public, anon, authenticated, service_role;

-- Continuity replaced browser-attempt mint/bind. Deny stubs are not parallel fallbacks.
select private.wp01a_cleanup_drop_function_if_unused(
  'public.vel_broker_bind_browser_attempt(uuid)'
);
select private.wp01a_cleanup_drop_function_if_unused(
  'public.vel_broker_issue_browser_attempt(uuid,bigint)'
);

-- Unbound 14-arg admit is deny-only after bound admit cutover.
select private.wp01a_cleanup_drop_function_if_unused(
  'public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text,text,text)'
);

-- Keep: check_app_session, app_session_is_valid, master_revoke_account_sessions,
-- vel_broker_admit_bound_session, vel_broker_resolve_bound_session,
-- vel_broker_complete_revocation_operation(uuid,text) RETURNS boolean,
-- 3-arg barrier forwarding wrapper, Auth/financial/audit tables.

do $probe$
begin
  if to_regprocedure('public.vel_broker_issue_browser_attempt(uuid,bigint)') is not null
     or to_regprocedure('public.vel_broker_bind_browser_attempt(uuid)') is not null
     or to_regprocedure(
          'public.vel_broker_admit_session(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,uuid,text,text,text)'
        ) is not null then
    raise exception 'CLEANUP_PHASE_A_STUBS_REMAIN';
  end if;

  if to_regprocedure('public.vel_broker_bind_browser_continuity(text)') is null
     or to_regprocedure('public.vel_broker_lookup_browser_continuity(text)') is null
     or to_regprocedure('public.vel_broker_resolve_bound_session(text,text[],text)') is null then
    raise exception 'CLEANUP_PHASE_A_REMOVED_LIVE_CONTINUITY';
  end if;

  if to_regprocedure('public.check_app_session(boolean)') is null
     or to_regprocedure('public.app_session_is_valid()') is null
     or to_regprocedure('public.master_revoke_account_sessions(uuid)') is null then
    raise exception 'CLEANUP_PHASE_A_REMOVED_NATIVE_SESSION_GATES';
  end if;
end;
$probe$;
