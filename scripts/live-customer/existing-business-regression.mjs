// Disposable PostgreSQL only. Never loads merchant/customer configuration.
import {startStack} from '../integration/local-http-stack.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async p=>(await readFile(p,'utf8')).replaceAll('\r\n','\n');
const strip=s=>s.replace(/^\s*(begin|commit);\s*$/gmi,'');
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const inputPaths=['scripts/live-customer/existing-business-live.sql','scripts/live-customer/existing-business-regression.sql','scripts/live-customer/existing-business-regression.mjs'];
const inputHashes=Object.fromEntries(await Promise.all(inputPaths.map(async p=>[p,await digest(p)])));
let stack;
try{
 stack=await startStack({databaseOnly:true,migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,progress:s=>console.log(s)});
 const migrations=['20261017120000_es02_account_bound_purchase.sql','20261017130000_es02_c1_authority_correction.sql','20261017140000_es02_c2_atomicity_ledger_snapshot.sql','20261017150000_es02_c3_exact_client_op_unique.sql','20261017160000_es02_hosted_primary_compat.sql','20261019172428_es02_optional_branch_contact_phone.sql','20261026110747_es02_hosted_test_account_checkout.sql','20261026125252_es02_thawani_uat_checkout.sql','20261026145000_es02_thawani_test_primary_branch.sql','20261019214259_es02_b1_read_owned_branch_setup.sql','20261019222213_es02_b2_paid_branch_channel_selection.sql','20261020012749_es02_b3_branch_channel_connection.sql','20261020150000_es02_single_branch_scope.sql','20261020153000_es02_b4_branch_hours.sql','20261020180000_es02_b5_b8_branch_setup_completion.sql'];
 await stack.sql(['begin;set local role postgres;',...await Promise.all(migrations.map(async p=>strip(await read('supabase/migrations/'+p)))),'commit;'].join('\n'));
 await stack.sql(await read('supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql'));
 await stack.sql(await read('scripts/live-customer/native-live-candidate.sql'));
 await stack.sql(await read('scripts/live-customer/native-knowledge-candidate.sql'));
 if(!process.argv.includes('--without-candidate'))await stack.sql(await read('scripts/live-customer/existing-business-live.sql'));
 console.log(await stack.sql(await read('scripts/live-customer/existing-business-regression.sql')));
 const fixture=JSON.parse(await stack.sql(`select value from public.existing_live_fixture where key='context'`));
 const actorSql=`set role authenticated;set request.jwt.claims='${JSON.stringify({role:'authenticated',sub:fixture.actor,session_id:fixture.sid})}';set request.jwt.claim.sub='${fixture.actor}';set request.jwt.claim.role='authenticated';`;
 const finish=`select public.es02_finish_thawani_live_checkout('${fixture.actor}','${fixture.order}')`;
 const before=JSON.parse(await stack.sql(`select jsonb_build_object('companies',(select count(*) from public.companies),'credits',(select count(*) from private.es02_credit_balances),'history',(select count(*) from private.es02_purchase_environment_history))`));
 // Independent backend transactions contend on the same real company/actor locks.
 const concurrent=await Promise.all(Array.from({length:4},(_,i)=>stack.sql(actorSql.replaceAll(fixture.sid,fixture.sids[i])+finish)));
 if(concurrent.some(s=>!JSON.parse(s).ok))throw Error('CONCURRENT_FINISH_FAILED');
 const after=JSON.parse(await stack.sql(`select jsonb_build_object('companies',(select count(*) from public.companies),'credits',(select count(*) from private.es02_credit_balances),'history',(select count(*) from private.es02_purchase_environment_history))`));
 if(after.companies!==before.companies||after.credits!==before.credits+1||after.history!==before.history+2)throw Error('CONCURRENT_DUPLICATE_EFFECT');
 const actions=concurrent.map(s=>JSON.parse(s).action);
 if(actions.filter(a=>a==='provisioned').length!==1||actions.filter(a=>a==='reuse').length!==3)throw Error('CONCURRENT_INITIAL_BINDING_NOT_ONCE');
 const replay=JSON.parse(await stack.sql(actorSql+finish));
 if(!replay.ok||replay.action!=='reuse'||replay.data.companyId!==fixture.company)throw Error('REPLAY_NOT_SAME_COMPANY');
 const binding=JSON.parse(await stack.sql(actorSql+`select public.es02_read_owned_branch_setup_binding('${fixture.actor}','${fixture.company}','${fixture.branch}')`));
 if(!binding.ok||binding.code!=='BOUND')throw Error('LIVE_CHANNEL_PREFERENCE_BINDING_INVALID');
 await stack.sql(`select public.existing_live_assertions()`);
 for(const p of inputPaths)if(await digest(p)!==inputHashes[p])throw Error('NATIVE_TEST_SOURCE_CHANGED_DURING_RUN');
 const observedWaiters=Number(JSON.parse(await stack.sql(`select value from public.existing_live_fixture where key='advisoryWaiters'`)));
 const receipt={time:new Date().toISOString(),status:'PASS',inputsStable:true,providerRequests:0,hostedWrites:0,concurrentConnections:4,independentNativeSessions:4,observedWaiters,actions,before,after,sqlSha256:inputHashes[inputPaths[0]],testSha256:inputHashes[inputPaths[1]],runnerSha256:inputHashes[inputPaths[2]],scope:'same-company Test history, exact Live payment, replay, concurrent initial finish, forced write failure rollback, unstarted START-001 clock'};
 await writeFile('.git/velora-release/LOCAL-LIVE-CUSTOMER-20261026/existing-business-regression.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(error){console.error(stack?stack.redact(error.message):'NATIVE_STACK_START_FAILED');process.exitCode=1;}
finally{if(stack)await stack.close();}
