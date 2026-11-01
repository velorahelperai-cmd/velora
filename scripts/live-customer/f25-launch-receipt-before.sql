-- Synthetic receipt in the disposable native integration database only.
begin;
set local role postgres;
create table private.f25_launch_fixture(binding jsonb, receipt_id uuid, operation_id uuid, authority jsonb);
do $test$
declare b jsonb; r jsonb; receipt uuid; operation uuid := gen_random_uuid(); authority jsonb;
begin
  if current_database() <> 'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED'; end if;
  select binding into b from private.wa_recovery_fixture;
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',b->>'accountId','session_id',b->>'sessionId')::text,true);
  perform set_config('request.jwt.claim.sub',b->>'accountId',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('role','authenticated',true);
  r:=public.es02_read_owned_branch_launch_summary((b->>'accountId')::uuid,(b->>'companyId')::uuid,(b->>'branchId')::uuid);
  if r->>'ok' is distinct from 'true' or r#>>'{data,snapshot,activation,status}' is distinct from 'not_started'
     or r#>>'{data,snapshot,operationId}' is null then raise exception 'UNCONFIRMED_READ_INVALID:%',r->>'code'; end if;
  perform set_config('role','postgres',true);
  if exists(select 1 from private.es02_branch_launch_confirmations where branch_id=(b->>'branchId')::uuid) then raise exception 'READ_CREATED_CONFIRMATION'; end if;
  insert into private.es02_branch_launch_confirmations(company_id,branch_id,account_id,readiness_revision,operation_id,confirmed)
    values((b->>'companyId')::uuid,(b->>'branchId')::uuid,(b->>'accountId')::uuid,md5('synthetic-f25'),operation,true) returning id into receipt;
  select jsonb_build_object('owner',proowner,'acl',proacl::text,'security',prosecdef,'config',proconfig) into authority
    from pg_proc where oid='public.es02_read_owned_branch_launch_summary(uuid,uuid,uuid)'::regprocedure;
  insert into private.f25_launch_fixture values(b,receipt,operation,authority);
  perform set_config('role','authenticated',true);
  r:=public.es02_read_owned_branch_launch_summary((b->>'accountId')::uuid,(b->>'companyId')::uuid,(b->>'branchId')::uuid);
  if r->>'ok' is distinct from 'true' or r#>>'{data,snapshot,activation,operationId}' is distinct from operation::text
     or r#>>'{data,snapshot,operationId}' is not distinct from operation::text then raise exception 'EXPECTED_OPERATION_MISMATCH_NOT_REPRODUCED'; end if;
end;
$test$;
commit;
