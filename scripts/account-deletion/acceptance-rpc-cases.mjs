import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
export async function run(ctx){
 const {stack}=ctx;await ctx.loginOwner();
 const selected=id=>!ctx.selectedCases||ctx.selectedCases.has(id);
 if(!['W01R_NATIVE_PENDING_CLAIMED_AND_INTENT_SCOPE','W02R_NATIVE_CLAIM_HEARTBEAT_POSITIVE_AND_STALE','W03R_NATIVE_NUMERIC_INGRESS_AND_SCOPE_DIFF','W05R_SUPPORTED_TEST_ORDER_CANNOT_AUTHORIZE_LIVE_WORKER'].some(selected))return;
 const defs=await stack.rows("select p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_whatsapp_inbound'");
 writeFileSync('scripts/account-deletion/acceptance-rpc-definitions.json',JSON.stringify(defs,null,2));
 const f=selected('W01R_NATIVE_PENDING_CLAIMED_AND_INTENT_SCOPE')||selected('W02R_NATIVE_CLAIM_HEARTBEAT_POSITIVE_AND_STALE')?await ctx.fresh('job-scope-corrected'):null;
 await ctx.case('W01R_NATIVE_PENDING_CLAIMED_AND_INTENT_SCOPE',async()=>{
  const received=await ctx.service('save_whatsapp_inbound',{p_company_id:f.company,p_phone_number_id:'15550000001',p_customer_wa_id:'15550000002',p_customer_name:'Synthetic',p_wa_message_id:'wamid.synthetic.'+randomUUID(),p_body:'Synthetic bounded question',p_message_type:'text',p_received_at:new Date().toISOString()});assert(received.data?.ok,'NATIVE_INGRESS_JOB_REQUIRED');
  const jobs=await stack.rows(`select id from whatsapp_inbound_jobs where company_id='${f.company}' order by created_at desc limit 1`);assert.equal(jobs.length,1,'ONE_NATIVE_JOB');f.job=jobs[0].id;
  f.claim=randomUUID();
  for(const state of ['pending','claimed']){
   if(state==='claimed')await stack.sql(`begin;set local role postgres;update whatsapp_inbound_jobs set status='claimed',claim_token='${f.claim}',claim_expires_at=clock_timestamp()+interval '5 minutes',expected_automation_generation=(select c.automation_generation from whatsapp_messages m join whatsapp_conversations c on c.id=m.conversation_id where m.id='${(await stack.rows(`select message_id from whatsapp_inbound_jobs where id='${f.job}'`))[0].message_id}') where id='${f.job}';commit;`);
   const p=await ctx.command('preview',{target:f.account.id});assert(p.items.some(i=>i.relation==='public.whatsapp_inbound_jobs'&&i.category==='blocker'));await ctx.expectProtected({id:p.id,fingerprint:p.fingerprint});
  }
  return {states:['pending','claimed'],nativeJobs:1,start:'DENIED_PROTECTED_DEPENDENCY',noPolicyRelaxation:true};
 });
 await ctx.case('W02R_NATIVE_CLAIM_HEARTBEAT_POSITIVE_AND_STALE',async()=>{
  assert(f.job,'REAL_JOB_REQUIRED');
  await stack.sql(`begin;set local role postgres;set local velora.conversation_control='1';update whatsapp_conversations c set automation_allowed=true from whatsapp_messages m where m.id=(select message_id from whatsapp_inbound_jobs where id='${f.job}') and c.id=m.conversation_id;update whatsapp_inbound_jobs set status='claimed',claim_token='${f.claim}',claim_expires_at=clock_timestamp()+interval '5 minutes',expected_automation_generation=(select c.automation_generation from whatsapp_messages m join whatsapp_conversations c on c.id=m.conversation_id where m.id=(select message_id from whatsapp_inbound_jobs where id='${f.job}')) where id='${f.job}';commit;`);
  const live=await ctx.service('whatsapp_heartbeat_inbound_job',{p_job_id:f.job,p_claim_token:f.claim});
  const [workerProof]=await stack.rows(`select j.status,j.claim_token is not null claim_present,j.claim_expires_at>clock_timestamp() lease_active,c.status conversation_status,c.automation_allowed,c.automation_generation=j.expected_automation_generation generation_matches from whatsapp_inbound_jobs j join whatsapp_messages m on m.id=j.message_id join whatsapp_conversations c on c.id=m.conversation_id where j.id='${f.job}'`);
  if(live.data!==true){const error=Object.assign(new Error('VALID_NATIVE_CLAIM_CONTROL'),{safeWorkerProof:workerProof});throw error;}
  const replaced=await ctx.service('whatsapp_heartbeat_inbound_job',{p_job_id:f.job,p_claim_token:randomUUID()});assert.equal(replaced.data,false);
  await stack.sql(`set role postgres;update whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id='${f.job}';`);
  const expired=await ctx.service('whatsapp_heartbeat_inbound_job',{p_job_id:f.job,p_claim_token:f.claim});assert.equal(expired.data,false);
  return {validClaim:true,replacedClaim:false,expiredClaim:false,limits:'Frame/stage/send positive authority remains separately blocked by verified-live-payment policy'};
 });
 await ctx.case('W03R_NATIVE_NUMERIC_INGRESS_AND_SCOPE_DIFF',async()=>{
  const f=await ctx.fresh('numeric-ingress'),p=await ctx.command('preview',{target:f.account.id});
  const r=await ctx.service('save_whatsapp_inbound',{p_company_id:f.company,p_phone_number_id:'15550000001',p_customer_wa_id:'15550000002',p_customer_name:'Synthetic',p_wa_message_id:'wamid.synthetic.'+randomUUID(),p_body:'Synthetic ingress',p_message_type:'text',p_received_at:new Date().toISOString()});
  writeFileSync('scripts/account-deletion/ingress-code-result.json',JSON.stringify({ok:r.data?.ok,code:r.data?.code??r.error?.code,error:r.error?.message?.split('\n')[0]},null,2));
  assert(r.data?.ok,'VALID_INGRESS_CONTROL_REQUIRED');const changed=await ctx.command('start',{id:p.id,fingerprint:p.fingerprint});assert.equal(changed.code,'SCOPE_CHANGED');assert(changed.diff.length);return {nativePersisted:true,confirmation:'SCOPE_CHANGED',diffOnly:true};
 });
 const optional='scripts/account-deletion/native-test-order.mjs';const {existsSync}=await import('node:fs');if(existsSync(optional))await(await import('./native-test-order.mjs')).run(ctx);
}
