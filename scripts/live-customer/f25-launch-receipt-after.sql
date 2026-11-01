begin;
set local role postgres;
do $test$
declare f private.f25_launch_fixture%rowtype; r jsonb; again jsonb; authority jsonb;
begin
  if current_database() <> 'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED'; end if;
  select * into f from private.f25_launch_fixture;
  select jsonb_build_object('owner',proowner,'acl',proacl::text,'security',prosecdef,'config',proconfig) into authority
    from pg_proc where oid='public.es02_read_owned_branch_launch_summary(uuid,uuid,uuid)'::regprocedure;
  if authority is distinct from f.authority then raise exception 'AUTHORITY_CHANGED'; end if;
  if has_function_privilege('anon','public.es02_read_owned_branch_launch_summary(uuid,uuid,uuid)','EXECUTE') then raise exception 'ANON_GRANTED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',f.binding->>'accountId','session_id',f.binding->>'sessionId')::text,true);
  perform set_config('request.jwt.claim.sub',f.binding->>'accountId',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('role','authenticated',true);
  r:=public.es02_read_owned_branch_launch_summary((f.binding->>'accountId')::uuid,(f.binding->>'companyId')::uuid,(f.binding->>'branchId')::uuid);
  again:=public.es02_read_owned_branch_launch_summary((f.binding->>'accountId')::uuid,(f.binding->>'companyId')::uuid,(f.binding->>'branchId')::uuid);
  if r->>'ok' is distinct from 'true' or again->>'ok' is distinct from 'true'
     or r#>>'{data,snapshot,operationId}' is distinct from f.operation_id::text
     or again#>>'{data,snapshot,operationId}' is distinct from f.operation_id::text
     or r#>>'{data,snapshot,activation,operationId}' is distinct from f.operation_id::text
     or r#>>'{data,snapshot,activation,receiptId}' is distinct from f.receipt_id::text
     or r#>>'{data,snapshot,activation,status}' is distinct from 'launched' then raise exception 'STABLE_RECEIPT_PROJECTION_FAILED'; end if;
  r:=public.es02_read_owned_branch_launch_summary(gen_random_uuid(),(f.binding->>'companyId')::uuid,(f.binding->>'branchId')::uuid);
  if r->>'ok' is distinct from 'false' or r->>'code' is distinct from 'FORBIDDEN' then raise exception 'FOREIGN_ACTOR_NOT_DENIED'; end if;
  r:=public.es02_read_owned_branch_launch_summary((f.binding->>'accountId')::uuid,gen_random_uuid(),(f.binding->>'branchId')::uuid);
  if r->>'ok' is distinct from 'false' then raise exception 'FOREIGN_COMPANY_NOT_DENIED'; end if;
  perform set_config('role','postgres',true);
  if (select count(*) from private.es02_branch_launch_confirmations where branch_id=(f.binding->>'branchId')::uuid) <> 1 then raise exception 'READ_REPEATED_LAUNCH'; end if;
end;
$test$;
rollback;
