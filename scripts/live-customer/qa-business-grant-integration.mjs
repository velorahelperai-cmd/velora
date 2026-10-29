// Disposable PostgreSQL only. Never loads merchant/customer configuration.
import {startStack} from '../integration/local-http-stack.mjs';
import {readFile} from 'node:fs/promises';
const read=async p=>(await readFile(p,'utf8')).replaceAll('\r\n','\n');
const strip=s=>s.replace(/^\s*(begin|commit);\s*$/gmi,'');
let stack;
try{
 stack=await startStack({databaseOnly:true,migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,progress:s=>console.log(s)});
 const migrations=['20261017120000_es02_account_bound_purchase.sql','20261017130000_es02_c1_authority_correction.sql','20261017140000_es02_c2_atomicity_ledger_snapshot.sql','20261017150000_es02_c3_exact_client_op_unique.sql','20261017160000_es02_hosted_primary_compat.sql','20261019172428_es02_optional_branch_contact_phone.sql','20261026110747_es02_hosted_test_account_checkout.sql','20261026125252_es02_thawani_uat_checkout.sql','20261026145000_es02_thawani_test_primary_branch.sql','20261019214259_es02_b1_read_owned_branch_setup.sql','20261019222213_es02_b2_paid_branch_channel_selection.sql','20261020012749_es02_b3_branch_channel_connection.sql','20261020150000_es02_single_branch_scope.sql','20261020153000_es02_b4_branch_hours.sql','20261020180000_es02_b5_b8_branch_setup_completion.sql'];
 await stack.sql(['begin;set local role postgres;',...await Promise.all(migrations.map(async p=>strip(await read('supabase/migrations/'+p)))),'commit;'].join('\n'));
 await stack.sql(await read('supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql'));
 await stack.sql(await read('scripts/live-customer/native-live-candidate.sql'));
 await stack.sql(await read('scripts/live-customer/native-knowledge-candidate.sql'));
 if(!process.argv.includes('--without-candidate'))await stack.sql(await read('scripts/live-customer/existing-business-live.sql'));

 await stack.sql(await read('supabase/migrations/20261014033011_master_business_archive.sql'));
 await stack.sql(await read('supabase/migrations/20261028172913_es02_reply_language_cas.sql'));
 const candidatePath='supabase/migrations/20261029023158_qa_business_grant.sql',testPath='scripts/live-customer/qa-business-grant-regression.sql';
 console.log(await stack.sql('begin;\n'+strip(await read(candidatePath))+'\n'+strip(await read(testPath))+'\ncommit;'));
 const f=JSON.parse(await stack.sql("select value from public.qa_grant_fixture where key='context'"));
 const auth=`set role authenticated;set request.jwt.claims='${JSON.stringify({role:'authenticated',sub:f.actor,session_id:f.sid})}';set request.jwt.claim.sub='${f.actor}';set request.jwt.claim.role='authenticated';`;
 const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const results=await Promise.all(Array.from({length:4},()=>stack.sql(auth+`select public.es02_grant_qa_setup('${f.actor}',gen_random_uuid(),'monthly',${json(f.slots)},${json(f.business)},${json(f.branches)})`)));
 const replies=results.map(v=>JSON.parse(v));
 if(replies.some(r=>!r.ok)||new Set(replies.map(r=>r.companyId)).size!==1||replies.filter(r=>r.action==='created').length!==1)throw Error('QA_CONCURRENT_GRANT_NOT_EXACTLY_ONCE:'+JSON.stringify(replies));
 console.log('FOUR_CONCURRENT_GRANTS_ONE_COMPANY_PASS');
 console.log('QA_GRANT_NATIVE_PASS');
}finally{if(stack)await stack.close();}
