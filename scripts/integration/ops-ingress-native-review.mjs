/** Existing LOCAL database only; synthetic diagnostics; entire candidate rolls back.
 * No Production connection, credentials, Auth users or business rows are accessed.
 */
import '../consolidation/guard.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const candidate=readFileSync(new URL('../../supabase/migrations/20261022164405_ops_ingress_observation_review.sql',import.meta.url),'utf8');
if(!/^begin;$/m.test(candidate)||!/^commit;\s*$/m.test(candidate))throw Error('CANDIDATE_TRANSACTION_MISSING');
const sql=candidate.replace(/^begin;$/m,'begin;\nset local statement_timeout=10000;').replace(/^commit;\s*$/m,()=>`
do $$ begin
 if not (select relrowsecurity from pg_class where oid='private.ops_ingress_attempt_observations'::regclass) then raise exception 'RLS_MISSING'; end if;
 if has_table_privilege('service_role','private.ops_ingress_attempt_observations','INSERT') then raise exception 'DIRECT_WRITE'; end if;
 if has_table_privilege('authenticated','private.ops_ingress_attempt_observations','SELECT') then raise exception 'DIRECT_READ'; end if;
 if has_function_privilege('authenticated','public.ops_record_ingress_attempt(uuid,uuid,text,text,integer,integer)','EXECUTE') then raise exception 'USER_RECORD'; end if;
 if has_function_privilege('anon','public.admin_read_ingress_attempts(uuid,text,text)','EXECUTE') then raise exception 'ANON_READ'; end if;
 begin perform public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','whatsapp','started',null,null); raise exception 'MISSING_ROLE_ACCEPTED'; exception when insufficient_privilege then null; end;
 begin perform public.admin_read_ingress_attempts(null); raise exception 'MISSING_SESSION_ACCEPTED'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','whatsapp','started',null,null);
select public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','whatsapp','started',null,null);
select public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','whatsapp','finished',503,20);
do $$ begin
 begin perform public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','instagram','started',null,null); raise exception 'SOURCE_REBOUND'; exception when invalid_parameter_value then null; end;
 begin perform public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','whatsapp','exception',null,20); raise exception 'TWO_TERMINALS'; exception when invalid_parameter_value then null; end;
 begin perform public.ops_record_ingress_attempt('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','whatsapp','finished',200,20); raise exception 'RESULT_REWRITTEN'; exception when invalid_parameter_value then null; end;
 begin perform public.ops_record_ingress_attempt('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','whatsapp','finished',null,20); raise exception 'NULL_STATUS'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from private.ops_ingress_attempt_observations)<>2 then raise exception 'DUPLICATE_OR_INVALID_ROW'; end if;
 begin update private.ops_ingress_attempt_observations set duration_ms=100; raise exception 'UPDATE_ACCEPTED'; exception when insufficient_privilege then null; end;
 begin delete from private.ops_ingress_attempt_observations; raise exception 'DELETE_ACCEPTED'; exception when insufficient_privilege then null; end;
end $$;
rollback;
do $$ begin if to_regclass('private.ops_ingress_attempt_observations') is not null then raise exception 'ROLLBACK_FAILED'; end if; end $$;
select 'OPS_INGRESS_NATIVE_PASS_ROLLBACK';
`);
const result=spawnSync('docker',['exec','-i','velora-es02-b3-postgres-2964b85e','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','c1_ui_integration'],{input:sql,encoding:'utf8',windowsHide:true});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);
