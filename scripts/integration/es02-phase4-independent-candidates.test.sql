-- Existing isolated fixture; candidate DDL and all probes must be rolled back.
do $checks$
declare
  role_name text;
  table_name text;
  signature text;
  result jsonb;
  scope_company uuid;
  valid_schedule jsonb;
  refused boolean := false;
begin
  if current_database() <> 'c1_ui_integration' or inet_client_addr() is not null then
    raise exception 'LOCAL_FIXTURE_REQUIRED';
  end if;
  foreach table_name in array array['es02_branch_hours','es02_branch_hours_receipts'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=table_name and c.relrowsecurity) then
      raise exception 'PRIVATE_TABLE_RLS_MISSING';
    end if;
    raise notice 'CANDIDATE_PASS:rls_%',table_name;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(role_name,format('private.%I',table_name),'select,insert,update,delete') then
        raise exception 'PRIVATE_TABLE_DIRECT_ACCESS';
      end if;
      raise notice 'CANDIDATE_PASS:no_direct_access_%_%',table_name,role_name;
    end loop;
  end loop;
  foreach signature in array array[
    'public.es02_read_owned_branch_hours(uuid,uuid,uuid)',
    'public.es02_save_owned_branch_hours(uuid,uuid,uuid,bigint,jsonb)',
    'public.es02_copy_owned_branch_hours(uuid,uuid,uuid,bigint,jsonb)'
  ] loop
    if not has_function_privilege('authenticated',signature,'execute')
       or has_function_privilege('anon',signature,'execute') then
      raise exception 'RPC_EXECUTION_ACL_MISMATCH';
    end if;
    if not exists(select 1 from pg_proc p where p.oid=signature::regprocedure
      and p.prosecdef and p.proowner=to_regrole('postgres')
      and 'search_path=""'=any(p.proconfig)) then
      raise exception 'RPC_AUTHORITY_METADATA_MISMATCH';
    end if;
    raise notice 'CANDIDATE_PASS:rpc_authority_%',split_part(signature,'(',1);
  end loop;
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('role','authenticated',true);
  result := public.es02_read_owned_branch_hours(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
  if result->>'ok' is distinct from 'false' or result->>'code' is distinct from 'UNAUTHENTICATED' then
    raise exception 'HOURS_READ_NO_SESSION_NOT_DENIED';
  end if;
  raise notice 'CANDIDATE_PASS:hours_read_no_session';
  select jsonb_object_agg(day,jsonb_build_object('state','closed')) into valid_schedule
  from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
  result := public.es02_save_owned_branch_hours(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,valid_schedule);
  if result->>'ok' is distinct from 'false' or result->>'code' is distinct from 'UNAUTHENTICATED' then
    raise exception 'HOURS_SAVE_NO_SESSION_NOT_DENIED';
  end if;
  raise notice 'CANDIDATE_PASS:hours_save_no_session';
  result := public.es02_copy_owned_branch_hours(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,
    jsonb_build_array(jsonb_build_object('branchId',gen_random_uuid(),'expectedVersion',0)));
  if result->>'ok' is distinct from 'false' or result->>'code' is distinct from 'UNAUTHENTICATED' then
    raise exception 'HOURS_COPY_NO_SESSION_NOT_DENIED';
  end if;
  raise notice 'CANDIDATE_PASS:hours_copy_no_session';
  perform set_config('role','none',true);
  select company_id into scope_company from public.company_branches
  where status in ('setup','active') limit 1;
  if scope_company is null then raise exception 'EXISTING_BRANCH_FIXTURE_REQUIRED';end if;
  begin
    insert into public.company_branches(company_id,name,timezone,status,is_primary,city)
    values(scope_company,'Synthetic rejected second branch','Asia/Muscat','setup',false,'');
  exception when sqlstate 'P0001' then
    if sqlerrm='SECOND_BRANCH_DEFERRED' then refused:=true;else raise;end if;
  end;
  if not refused then raise exception 'SECOND_BRANCH_WAS_NOT_REJECTED';end if;
  raise notice 'CANDIDATE_PASS:second_branch_denied';
end;
$checks$;
