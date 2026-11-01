-- Read-only launch projection repair. Keep the persisted operation identifier once
-- a confirmation exists; never create a confirmation or repeat launch.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $migration$
declare
  target regprocedure := to_regprocedure('public.es02_read_owned_branch_launch_summary(uuid,uuid,uuid)');
  definition text;
  needle text := '''operationId'', op_id,';
  replacement text := '''operationId'', coalesce(conf_launch.operation_id, op_id),';
begin
  if target is null then raise exception 'LAUNCH_SUMMARY_PREREQUISITE_MISSING'; end if;
  select pg_get_functiondef(target) into definition;
  if position(replacement in definition) > 0 then return; end if;
  if (length(definition) - length(replace(definition, needle, ''))) <> length(needle)
     or position('''operationId'', conf_launch.operation_id' in definition) = 0
     or position('private.es02_branch_launch_confirmations' in definition) = 0 then
    raise exception 'LAUNCH_SUMMARY_OPERATION_BASELINE_MISMATCH';
  end if;
  -- CREATE OR REPLACE preserves ownership/ACLs and every authority/readiness check.
  execute replace(definition, needle, replacement);
end;
$migration$;
commit;
