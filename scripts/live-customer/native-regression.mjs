// Disposable offline native SQL regression. Never loads local customer keys.
import {startStack} from '../integration/local-http-stack.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>(await readFile(p,'utf8')).replaceAll('\r\n','\n');
const strip=s=>s.replace(/^\s*(begin|commit);\s*$/gmi,'');
let stack;
try{
 stack=await startStack({databaseOnly:true,migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,progress:stage=>console.log(stage)});
 const migrations=['20261017120000_es02_account_bound_purchase.sql','20261017130000_es02_c1_authority_correction.sql','20261017140000_es02_c2_atomicity_ledger_snapshot.sql','20261017150000_es02_c3_exact_client_op_unique.sql','20261017160000_es02_hosted_primary_compat.sql','20261019172428_es02_optional_branch_contact_phone.sql','20261026110747_es02_hosted_test_account_checkout.sql','20261026125252_es02_thawani_uat_checkout.sql','20261026145000_es02_thawani_test_primary_branch.sql'];
 const parts=await Promise.all(migrations.map(async p=>strip(await read('supabase/migrations/'+p))));
 await stack.sql(['begin; set local role postgres;',...parts,'commit;'].join('\n'));
 await stack.sql(await read('scripts/live-customer/native-live-candidate.sql'));
 const setupMigrations=['20261019214259_es02_b1_read_owned_branch_setup.sql','20261019222213_es02_b2_paid_branch_channel_selection.sql','20261020012749_es02_b3_branch_channel_connection.sql','20261020150000_es02_single_branch_scope.sql','20261020153000_es02_b4_branch_hours.sql','20261020180000_es02_b5_b8_branch_setup_completion.sql'];
 await stack.sql(['begin; set local role postgres;',...await Promise.all(setupMigrations.map(async p=>strip(await read('supabase/migrations/'+p)))),'commit;'].join('\n'));
 await stack.sql(await read('scripts/live-customer/native-knowledge-candidate.sql'));
 const result=await stack.sql('begin; set local role postgres;'+await read('scripts/live-customer/native-regression.sql')+'rollback;');
 const receipt={time:new Date().toISOString(),outcome:'PASS',scope:'offline native Live finance and branch knowledge with synthetic provider evidence only; targeted migration chain',providerRequests:0,hostedMutation:false,output:result};
 await writeFile('artifacts/local-live-customer/native-regression.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
}catch(error){console.error(stack?stack.redact(error.message):'NATIVE_STACK_START_FAILED');process.exitCode=1;}
finally{if(stack)await stack.close();}
