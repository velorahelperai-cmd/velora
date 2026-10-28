// Disposable PostgreSQL/Vault contract tests. Synthetic credentials, no Meta requests.
import {startStack} from '../integration/local-http-stack.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async p=>(await readFile(p,'utf8')).replaceAll('\r\n','\n');
const strip=s=>s.replace(/^\s*(begin|commit);\s*$/gmi,'');
let stack;
try{
 stack=await startStack({databaseOnly:true,migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,progress:stage=>console.log(stage)});
 const files=['20261017120000_es02_account_bound_purchase.sql','20261017130000_es02_c1_authority_correction.sql','20261017140000_es02_c2_atomicity_ledger_snapshot.sql','20261017150000_es02_c3_exact_client_op_unique.sql','20261017160000_es02_hosted_primary_compat.sql','20261019172428_es02_optional_branch_contact_phone.sql','20261026110747_es02_hosted_test_account_checkout.sql','20261026125252_es02_thawani_uat_checkout.sql','20261026145000_es02_thawani_test_primary_branch.sql'];
 await stack.sql(['begin; set local role postgres;',...await Promise.all(files.map(async f=>strip(await read('supabase/migrations/'+f)))),'commit;'].join('\n'));
 await stack.sql(await read('scripts/live-customer/native-live-candidate.sql'));
 const setup=['20261019214259_es02_b1_read_owned_branch_setup.sql','20261019222213_es02_b2_paid_branch_channel_selection.sql','20261020012749_es02_b3_branch_channel_connection.sql','20261020150000_es02_single_branch_scope.sql','20261020153000_es02_b4_branch_hours.sql','20261020180000_es02_b5_b8_branch_setup_completion.sql'];
 await stack.sql(['begin; set local role postgres;',...await Promise.all(setup.map(async f=>strip(await read('supabase/migrations/'+f)))),'commit;'].join('\n'));
 await stack.sql(await read('scripts/live-customer/native-knowledge-candidate.sql'));
 await stack.sql(await read('supabase/migrations/20261027034749_wa_new_number_secure_recovery.sql'));
 const contractSql="select md5(pg_get_functiondef('public.es02_b3_whatsapp_signup_checkpoint(text,jsonb,uuid,text)'::regprocedure)||coalesce((select proacl::text from pg_proc where oid='public.es02_b3_whatsapp_signup_checkpoint(text,jsonb,uuid,text)'::regprocedure),'')||(select relacl::text from pg_class where oid='private.es02_b3_whatsapp_signup_checkpoints'::regclass));";
 const originalContract=await stack.sql(contractSql);
 await stack.sql('create extension if not exists pg_cron;');
 const candidateBytes=await readFile('supabase/migrations/20261028043000_wa_early_authorization_receipt.sql');
 await stack.sql(candidateBytes.toString('utf8').replaceAll('\r\n','\n'));
 console.log(JSON.stringify({candidateSha256:createHash('sha256').update(candidateBytes).digest('hex')}));
 if(await stack.sql(contractSql)!==originalContract)throw Error('EXISTING_CHECKPOINT_CONTRACT_CHANGED');
 // Same approved synthetic fixture, inlined to avoid an unpublished local dependency.
 const fixture=" -- Inserted inside the existing synthetic native fixture DO block, after paid channel selection.\n declare started jsonb; binding jsonb;\n begin\n  started:=public.es02_b3_start_owned_branch_connection(actor,company,branchid,'whatsapp','wa_new_number',gen_random_uuid(),r->>'revision',null,'111','123','v25.0',repeat('a',64),null,null,sid,false);\n  perform pg_temp.must(started->>'ok'='true','new_number_native_start');\n  binding:=jsonb_build_object('accountId',actor,'companyId',company,'branchId',branchid,'sessionId',sid,'attemptId',started->'launch'->>'attemptId','generation',1,'nonce',repeat('a',64),'appId','111','configId','123','graphVersion','v25.0','wabaId','222','phoneNumberId','333','codeHash',repeat('b',64));\n  insert into private.wa_recovery_fixture values(binding);\n end;\n";
 const original=await read('scripts/live-customer/native-regression.sql');
 const marker=" r:=public.es02_save_owned_branch_knowledge_text(actor,company,branchid,1,'Synthetic opening hours','We open at nine.');";
 if(!original.includes(marker))throw Error('FIXTURE_MARKER_CHANGED');
 await stack.sql('begin;set local role postgres;create table private.wa_recovery_fixture(binding jsonb);'+original.replace(marker,fixture.split('-- AFTER_FIXTURE')[0]+'\n'+marker)+'commit;');

 await stack.sql('grant usage on schema private to service_role;grant select on private.wa_recovery_fixture to service_role;');
 if(process.argv.includes('--cleanup-only')){
 await stack.sql(await read('scripts/live-customer/wa-early-cleanup-regression.sql'));
 const cleanupTick="begin;set local role service_role;select public.es02_b3_cleanup_early_wa_tick(1);commit;";
 const concurrent=await Promise.all(Array.from({length:4},()=>stack.sql(cleanupTick)));
 if(concurrent.filter(v=>v.includes('"cleaned": 1')).length!==1)throw Error('CLEANUP_NOT_EXACTLY_ONCE');
 await stack.sql("do $$begin if exists(select 1 from private.es02_b3_early_whatsapp_authorizations where token_secret_id is not null) then raise exception 'CLEANUP_TOKEN_REMAINS';end if;end $$;");
 console.log(JSON.stringify({outcome:'PASS',scope:'targeted cleanup PostgreSQL/Vault and disabled Cron registration',providerRequests:0,hostedMutation:false}));
 }else{
 const reserve="begin;set local role service_role;select public.es02_b3_early_whatsapp_authorization('reserve',(select binding from private.wa_recovery_fixture),gen_random_uuid(),null);commit;";
 const results=await Promise.all(Array.from({length:4},()=>stack.sql(reserve)));
 if(results.filter(r=>r.includes('"acquired": true')).length!==1)throw Error('CONCURRENT_EARLY_RESERVATION_NOT_EXACTLY_ONCE');
 // A separate SQL session owns its temporary trigger function for an actual Vault write failure.
 await stack.sql(`begin;
 create function private.wa_early_test_fail_vault() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_VAULT_FAILURE' using errcode='P0002';end $$;
 create trigger wa_early_test_vault_failure before insert on vault.secrets for each row execute function private.wa_early_test_fail_vault();
 do $$declare b jsonb;r uuid;begin select binding into b from private.wa_recovery_fixture;select reservation into r from private.es02_b3_early_whatsapp_authorizations where attempt_id=(b->>'attemptId')::uuid;
 perform set_config('role','service_role',true);
 begin perform public.es02_b3_early_whatsapp_authorization('save',b,r,'synthetic-token');raise exception 'EXPECTED_VAULT_FAILURE';exception when no_data_found then null;end;
 perform set_config('role','postgres',true);
 if exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=(b->>'attemptId')::uuid and (state<>'reserved' or token_secret_id is not null)) then raise exception 'VAULT_FAILURE_RECEIPT_CHANGED';end if;
 end $$;rollback;`);
 await stack.sql(await read('scripts/live-customer/wa-early-authorization-regression.sql'));
 // Promotion rollback must preserve the early secret and leave no checkpoint reservation.
 await stack.sql(`begin;
 create function private.wa_early_test_fail_promotion() returns trigger language plpgsql as $$begin if new.name not like 'wa-early-%' then raise exception 'SYNTHETIC_PROMOTION_VAULT_FAILURE' using errcode='P0002';end if;return new;end $$;
 create trigger wa_early_test_promotion_failure before insert on vault.secrets for each row execute function private.wa_early_test_fail_promotion();
 do $$declare b jsonb;begin select binding into b from private.wa_recovery_fixture;perform set_config('role','service_role',true);
 begin perform public.es02_b3_early_whatsapp_authorization('promote',b,null,null);raise exception 'EXPECTED_PROMOTION_FAILURE';exception when no_data_found then null;end;
 perform set_config('role','postgres',true);
 if exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints where attempt_id=(b->>'attemptId')::uuid) or not exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=(b->>'attemptId')::uuid and state='stored' and token_secret_id is not null) then raise exception 'PROMOTION_ROLLBACK_BROKEN';end if;
 end $$;rollback;`);
 const promote="begin;set local role service_role;select public.es02_b3_early_whatsapp_authorization('promote',(select binding from private.wa_recovery_fixture),null,null);commit;";
 const promoted=await Promise.all(Array.from({length:4},()=>stack.sql(promote)));
 if(promoted.some(r=>!r.includes('"promoted": true')))throw Error('CONCURRENT_PROMOTION_FAILED');
 await stack.sql(`do $$declare b jsonb;a uuid;begin
 select binding into b from private.wa_recovery_fixture;a:=(b->>'attemptId')::uuid;
 if (select count(*) from private.es02_b3_whatsapp_signup_checkpoints where attempt_id=a)<>1 then raise exception 'CHECKPOINT_COUNT';end if;
 if not exists(select 1 from private.es02_b3_early_whatsapp_authorizations where attempt_id=a and state='consumed' and token_secret_id is null) then raise exception 'RECEIPT_NOT_CONSUMED';end if;
 if exists(select 1 from vault.secrets where name='wa-early-'||a::text) then raise exception 'TEMP_SECRET_LEAK';end if;
 if exists(select 1 from private.es02_b3_connection_links where attempt_id=a) or exists(select 1 from public.whatsapp_company_links where company_id=(b->>'companyId')::uuid) then raise exception 'FALSE_LINK';end if;
 if not exists(select 1 from private.es02_activation_foundation where company_id=(b->>'companyId')::uuid and subscription_started_at is null and clock_state='waiting_readiness') then raise exception 'CLOCK_CHANGED';end if;
 end $$;`);
 console.log(JSON.stringify({outcome:'PASS',scope:'PostgreSQL/Vault early authorization, four concurrent reserves/promotions, rollback, expiry cleanup, isolation, privileges',providerRequests:0,hostedMutation:false}));
 }
}catch(error){console.error(stack?stack.redact(error.message):'LOCAL_STACK_START_FAILED');process.exitCode=1;}
finally{if(stack)await stack.close();}
