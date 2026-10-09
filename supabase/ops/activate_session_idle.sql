-- Run ONLY with the new application deployment, after validating activity tracking on that host.
-- Existing older sessions may need one fresh sign-in. Do not revive expired sessions or delete drafts.
begin;
do $$begin
 if to_regprocedure('public.check_app_session(boolean)') is null or to_regprocedure('public.app_session_pre_request()') is null then raise exception 'Session policy is not installed';end if;
end;$$;
update private.app_session_settings set enabled=true where singleton=true;
notify pgrst,'reload config';
commit;
-- Rollback of the database gate, if deployment must be reverted:
-- update private.app_session_settings set enabled=false where singleton=true;
-- The previous application deployment must also be restored to roll back its server-side checks.
