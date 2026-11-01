// Local PostgreSQL trigger regression. Minimal synthetic schema, not full RPC acceptance.
// Creates a unique database on the existing local test container; never drops a database.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {CONTAINER as container,verify} from './postgres.mjs';
await verify();
const db=`velora_f13_${Date.now()}`;
const args=['exec','-i','-u','postgres',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'];
execFileSync('docker',[...args,'-d','postgres','-c',`create database ${db}`]);
const bootstrap=`create schema private;
create table private.wa_checkpoint_review_requests(id uuid primary key,account_id uuid,company_id uuid,branch_id uuid,status text,resolved_at timestamptz,replacement_phone_hash text);
create table private.es02_b3_connection_attempts(id uuid primary key,legacy_attempt_id uuid,account_id uuid,company_id uuid,branch_id uuid,channel text,flow text,confirmed_phone text,status text default 'pending',created_at timestamptz default clock_timestamp());
create table private.whatsapp_coexistence_signup_attempts(id uuid primary key,company_id uuid,user_id uuid,checkpoint_proof jsonb,status text default 'started',expected_phone_number text,finalized_link_id uuid,finalized_link_generation bigint);
`;
const migration=readFileSync('supabase/migrations/20261101235000_wa_review_meta_number_checkpoint.sql','utf8');
const cases=`
create trigger wa_review_check_replacement before insert on private.es02_b3_connection_attempts for each row execute function private.wa_review_check_replacement();
insert into private.wa_checkpoint_review_requests values(md5('r')::uuid,md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'closed_preserved',now(),encode(sha256(convert_to('+96890000000','UTF8')),'hex'));
insert into private.es02_b3_connection_attempts(id,legacy_attempt_id,account_id,company_id,branch_id,channel,flow,confirmed_phone) values(md5('a')::uuid,md5('a')::uuid,md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'whatsapp','wa_coexistence',null);
insert into private.whatsapp_coexistence_signup_attempts(id,company_id,user_id,checkpoint_proof) values(md5('a')::uuid,md5('c')::uuid,md5('u')::uuid,null);
select 'PASS|pending reviewed coexistence allows Meta-derived phone';
do $$declare v text;begin
 foreach v in array array['wa_new_number','instagram_direct'] loop
  begin
   insert into private.es02_b3_connection_attempts(id,legacy_attempt_id,account_id,company_id,branch_id,channel,flow,confirmed_phone) values(gen_random_uuid(),gen_random_uuid(),md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'whatsapp',v,null);
   raise exception 'unexpected success';
  exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' then raise;end if;end;
 end loop;
 begin
  insert into private.es02_b3_connection_attempts(id,legacy_attempt_id,account_id,company_id,branch_id,channel,flow,confirmed_phone) values(gen_random_uuid(),gen_random_uuid(),md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'whatsapp','wa_coexistence','+96890000001');
  raise exception 'unexpected success';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' then raise;end if;end;
 begin
  insert into private.es02_b3_connection_attempts(id,legacy_attempt_id,account_id,company_id,branch_id,channel,flow,confirmed_phone) values(gen_random_uuid(),gen_random_uuid(),md5('other')::uuid,md5('c')::uuid,md5('b')::uuid,'whatsapp','wa_coexistence',null);
  raise exception 'unexpected success';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' then raise;end if;end;
end $$;
select 'PASS|wrong route, owner and pre-entered phone rejected with exact SQLSTATE/message';
do $$declare proof jsonb;begin
 foreach proof in array array['{}'::jsonb,'{"display_phone_number":"+96890000001"}'::jsonb,'{"display_phone_number":"invalid"}'::jsonb] loop
  begin
   update private.whatsapp_coexistence_signup_attempts set checkpoint_proof=proof where id=md5('a')::uuid;
   raise exception 'unexpected success';
  exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_PHONE_MISMATCH' then raise;end if;end;
 end loop;
 if exists(select 1 from private.whatsapp_coexistence_signup_attempts where checkpoint_proof is not null) then raise exception 'failed proof persisted';end if;
 begin
  insert into private.whatsapp_coexistence_signup_attempts(id,company_id,user_id,checkpoint_proof) values(gen_random_uuid(),md5('c')::uuid,md5('u')::uuid,'{"display_phone_number":"+96890000000"}');
  raise exception 'legacy bypass accepted';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' then raise;end if;end;
end $$;
select 'PASS|wrong or missing Meta phone and unbound legacy checkpoint rejected; rollback preserved';
update private.whatsapp_coexistence_signup_attempts set checkpoint_proof='{"display_phone_number":"968 9000 0000"}' where id=md5('a')::uuid;
select 'PASS|reviewed Meta phone accepted with canonical formatting';
do $$begin
 if has_function_privilege('authenticated','private.wa_review_check_meta_phone()','execute') or has_function_privilege('service_role','private.wa_review_check_meta_phone()','execute') or has_function_privilege('anon','private.wa_review_check_meta_phone()','execute') then raise exception 'client execute grant';end if;
end $$;
select 'PASS|no direct client execute grant';
do $$begin
 if private.wa_review_replacement_fulfilled(md5('r')::uuid) then raise exception 'checkpoint satisfied review prematurely';end if;
end $$;
update private.whatsapp_coexistence_signup_attempts set status='completed',expected_phone_number='+96890000000',finalized_link_id=gen_random_uuid(),finalized_link_generation=1 where id=md5('a')::uuid;
do $$begin
 if private.wa_review_replacement_fulfilled(md5('r')::uuid) then raise exception 'legacy-only completion satisfied review';end if;
end $$;
update private.es02_b3_connection_attempts set status='bound' where id=md5('a')::uuid;
do $$begin
 if not private.wa_review_replacement_fulfilled(md5('r')::uuid) then raise exception 'bound replacement did not satisfy review';end if;
end $$;
insert into private.es02_b3_connection_attempts(id,legacy_attempt_id,account_id,company_id,branch_id,channel,flow,confirmed_phone) values(gen_random_uuid(),gen_random_uuid(),md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'whatsapp','wa_new_number',null);
select 'PASS|only finalized branch-bound replacement fulfills review; future connection is not pinned forever';
insert into private.wa_checkpoint_review_requests values(md5('r2')::uuid,md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'closed_preserved',clock_timestamp(),encode(sha256(convert_to('+96890000001','UTF8')),'hex'));
do $$begin
 begin
  insert into private.es02_b3_connection_attempts(id,legacy_attempt_id,account_id,company_id,branch_id,channel,flow,confirmed_phone) values(gen_random_uuid(),gen_random_uuid(),md5('u')::uuid,md5('c')::uuid,md5('b')::uuid,'whatsapp','wa_new_number',null);
  raise exception 'new review inherited prior fulfillment';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' then raise;end if;end;
end $$;
select 'PASS|new review remains enforced after a prior review was fulfilled';

`;
const result=spawnSync('docker',[...args,'-d',db],{input:bootstrap+migration+cases,encoding:'utf8'});
console.log(`LOCAL_TEST_DATABASE ${db}`);
console.log(result.stdout.split('\n').filter(x=>x.includes('PASS|')).join('\n'));
if(result.status!==0){console.error(result.stderr);process.exitCode=1;}
