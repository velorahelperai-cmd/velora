-- LOCAL SYNTHETIC RUNTIME DEPENDENCY BASELINE ONLY. Never apply to production.
-- Metadata-only snapshot from vmpifljyozsbtssxhoxd; 2026-10-11 09:57:27 UTC; PG17.11.
-- No user/customer rows, grants, secrets or account changes. CR normalized to LF.
-- Enable only after validating the isolated synthetic target; existing ACLs are retained.
do $local_fixture$begin
 if current_setting('velora.fixture_dependencies',true) is distinct from 'synthetic-local' then raise exception 'LOCAL_FIXTURE_DEPENDENCIES_ONLY';end if;
end;$local_fixture$;

-- app_session_is_valid(); normalized prosrc MD5 b42c28f54d05778fcc994156c6ce4086
CREATE OR REPLACE FUNCTION public.app_session_is_valid()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not (select enabled from private.app_session_settings where singleton) then true else exists(
 select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
 where a.user_id=auth.uid() and a.session_id=(auth.jwt()->>'session_id')::uuid and a.expired_at is null
 and a.last_activity_at<=statement_timestamp() and a.last_activity_at>statement_timestamp()-interval '2 hours'
 ) end;
$function$;

-- is_platform_owner(); normalized prosrc MD5 d46584d9ac02072238753afd973d9de3
CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.platform_admins as a
    where a.user_id = (select auth.uid())
      and a.role = 'owner'
      and a.status = 'active'
  );
$function$;

-- private.write_admin_audit(uuid,uuid,text,jsonb,jsonb); normalized prosrc MD5 2f58d7407a5a169c0cb4d87a66661af4
CREATE OR REPLACE FUNCTION private.write_admin_audit(p_actor uuid, p_company_id uuid, p_action text, p_before jsonb, p_after jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.admin_audit_logs (actor_user_id, company_id, action, before_data, after_data)
  values (p_actor, p_company_id, p_action, p_before, p_after);
end;
$function$;

