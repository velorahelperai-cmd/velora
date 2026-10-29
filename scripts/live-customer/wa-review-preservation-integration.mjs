// Disposable native PostgreSQL/Vault only. No production credentials or Meta calls.
import {startStack} from '../integration/local-http-stack.mjs';
import {readFile,readdir} from 'node:fs/promises';
const read=async p=>(await readFile(p,'utf8')).replaceAll('\r\n','\n');
const strip=s=>s.replace(/^\s*(begin|commit);\s*$/gmi,'');
let stack;
try {
 stack=await startStack({databaseOnly:true,migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,progress:s=>console.log(s)});
 const files=['20261017120000_es02_account_bound_purchase.sql','20261017130000_es02_c1_authority_correction.sql','20261017140000_es02_c2_atomicity_ledger_snapshot.sql','20261017150000_es02_c3_exact_client_op_unique.sql','20261017160000_es02_hosted_primary_compat.sql','20261019172428_es02_optional_branch_contact_phone.sql','20261026110747_es02_hosted_test_account_checkout.sql','20261026125252_es02_thawani_uat_checkout.sql','20261026145000_es02_thawani_test_primary_branch.sql'];
 await stack.sql(['begin;set local role postgres;',...await Promise.all(files.map(async f=>strip(await read('supabase/migrations/'+f)))),'commit;'].join('\n'));
 await stack.sql(await read('scripts/live-customer/native-live-candidate.sql'));
 const setup=['20261019214259_es02_b1_read_owned_branch_setup.sql','20261019222213_es02_b2_paid_branch_channel_selection.sql','20261020012749_es02_b3_branch_channel_connection.sql','20261020150000_es02_single_branch_scope.sql','20261020153000_es02_b4_branch_hours.sql','20261020180000_es02_b5_b8_branch_setup_completion.sql','20261027034749_wa_new_number_secure_recovery.sql','20261028172343_wa_checkpoint_review_request.sql'];
 await stack.sql(['begin;set local role postgres;',...await Promise.all(setup.map(async f=>strip(await read('supabase/migrations/'+f)))),'commit;'].join('\n'));
 await stack.sql(await read('scripts/live-customer/native-knowledge-candidate.sql'));
 const original=await read('scripts/live-customer/native-regression.sql');
 const marker=" r:=public.es02_save_owned_branch_knowledge_text(actor,company,branchid,1,'Synthetic opening hours','We open at nine.');";
 if(!original.includes(marker))throw Error('FIXTURE_MARKER_CHANGED');
 const fixture=(await read('scripts/live-customer/whatsapp-recovery-regression.sql')).split('-- AFTER_FIXTURE')[0];
 await stack.sql('begin;set local role postgres;create table private.wa_recovery_fixture(binding jsonb);'+original.slice(0,original.indexOf(marker))+fixture+'\nend $$;commit;');
 const migration=(await readdir('supabase/migrations')).find(f=>f.endsWith('_wa_review_preserve_supersession.sql'));
 // Match hosted extension ACLs: postgres can REFERENCES, but cannot add a Vault trigger.
 await stack.sql('revoke all on vault.secrets from postgres,service_role;grant select,delete,truncate,references on vault.secrets to postgres with grant option;grant select,delete on vault.secrets to service_role;');
 if(migration)await stack.sql(await read('supabase/migrations/'+migration));
 const [beforeRace,afterRace]=(await read('scripts/live-customer/wa-review-preservation-regression.sql')).split('-- AFTER_CONCURRENT_RESOLUTION');
 await stack.sql(beforeRace);
 const decision="private.wa_resolve_review_preserving_assets(review_id,(binding->>'attemptId')::uuid,1,(binding->>'companyId')::uuid,(binding->>'branchId')::uuid,'222','333',checkpoint_digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW')";
 const first=stack.sql(`begin;set local role postgres;with decision as materialized(select ${decision} r from private.wa_review_race_fixture), held as materialized(select pg_sleep(3) from decision) select decision.r from decision,held;commit;`);
 await new Promise(resolve=>setTimeout(resolve,500));
 const second=stack.sql(`begin;set local role postgres;select ${decision} r from private.wa_review_race_fixture;commit;`);
 const outcomes=(await Promise.all([first,second])).map(output=>JSON.parse(output.trim()).outcome).sort();
 if(JSON.stringify(outcomes)!==JSON.stringify(['already_resolved','closed_preserved']))throw Error('CONCURRENT_RESOLUTION_NOT_EXACTLY_ONCE');
 console.log('PASS two concurrent decisions produce one closure and one idempotent replay');
 await stack.sql(afterRace);
 console.log('PASS native review: authority, retention, rollback, idempotence, stale evidence, safe successor and old callback rejection');
}catch(error){console.error(stack?stack.redact(error.message):'LOCAL_STACK_START_FAILED');process.exitCode=1;}
finally{if(stack)await stack.close();}
