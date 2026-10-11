-- PREPARED ONLY: requires explicit owner authorization for this target/action.
-- Contain only the R3 package's authenticated public entry points and table reads.
-- Preserve all relations, rows, private operation history, audit and existing grants.
begin;
set local search_path = '';
set local lock_timeout = '2s';
set local statement_timeout = '15s';
do $installer$
begin
 if current_user <> 'postgres' then raise exception 'TEAM_INSTALLER_REQUIRED';end if;
end;
$installer$;
revoke execute on function public.platform_team_read_self() from authenticated;
revoke execute on function public.platform_team_read_directory(uuid,uuid,integer,integer,text,jsonb) from authenticated;
revoke execute on function public.platform_team_preview_transfer(jsonb) from authenticated;
revoke execute on function public.platform_team_mutate(jsonb) from authenticated;
revoke select on public.platform_teams,public.platform_team_members from authenticated;
notify pgrst,'reload schema';
commit;
