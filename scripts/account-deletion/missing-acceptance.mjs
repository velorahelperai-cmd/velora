import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {lit} from '../integration/local-http-stack.mjs';

export async function loadWorker(file){
 const b=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node',tsconfig:'tsconfig.json',plugins:[{name:'test-server-only',setup(p){p.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));p.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});
 const m={exports:{}};new Function('module','exports','require',b.outputFiles[0].text)(m,m.exports,createRequire(import.meta.url));return m.exports;
}
export async function runMissingAcceptance(stack,record,{selectedCases=null}={}){
 const ctx={stack,record,lit,selectedCases,admin:createClient(stack.url,stack.serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}),owner:createClient(stack.url,stack.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})};
 ctx.loginOwner=async()=>{const r=await ctx.owner.auth.signInWithPassword({email:stack.owner.email,password:stack.owner.password});assert(!r.error,'NATIVE_OWNER_LOGIN');ctx.ownerClaims=JSON.parse(Buffer.from(r.data.session.access_token.split('.')[1],'base64url'));await ctx.owner.rpc('check_app_session',{p_touch:true});};
 await ctx.loginOwner();
 ctx.command=async(action,input)=>{const r=await ctx.owner.rpc('account_deletion_command',{p_action:action,p_input:input});if(r.error)throw Error(r.error.code+':'+r.error.message);return r.data;};
 ctx.expectProtected=async input=>{let response;try{response=await ctx.command('start',input);}catch(error){if(/PROTECTED_DEPENDENCY/i.test(error.message))return 'RPC_EXCEPTION';throw error;}if(response?.code==='SCOPE_CHANGED'){if(!Array.isArray(response.diff)||response.diff.length===0||typeof response.receipt?.fingerprint!=='string')throw Object.assign(Error('SCOPE_DIFF_RECONFIRMATION_REQUIRED'),{safeCommandShape:{code:response.code,diffCount:Array.isArray(response.diff)?response.diff.length:0,refreshedFingerprint:typeof response.receipt?.fingerprint==='string'}});try{response=await ctx.command('start',{id:input.id,fingerprint:response.receipt.fingerprint});}catch(error){if(/PROTECTED_DEPENDENCY/i.test(error.message))return 'RPC_EXCEPTION_AFTER_DIFF';throw error;}}if(response?.code==='PROTECTED_DEPENDENCY')return 'JSON_REFUSAL';const failure=Error('PROTECTED_DEPENDENCY_REQUIRED');failure.safeCommandShape={type:Array.isArray(response)?'array':typeof response,keys:response&&typeof response==='object'?Object.keys(response).filter(key=>/^[a-z_]{1,32}$/i.test(key)).slice(0,12):[],code:typeof response?.code==='string'?response.code:null,diffCount:Array.isArray(response?.diff)?response.diff.length:undefined};throw failure;};
 ctx.fresh=async(name)=>{const account=await stack.adminCreateUser(name+'-'+randomUUID()+'@example.invalid'),company=randomUUID();await stack.sql(`begin;set local role postgres;insert into companies(id,display_name,status,created_by) values('${company}','Synthetic missing-case scope','active','${account.id}');insert into company_members(company_id,user_id,role,status) values('${company}','${account.id}','owner','active');commit;`);await ctx.command('classify',{target:account.id,isTest:true});return {account,company};};
 ctx.service=async(name,args)=>{const r=await ctx.admin.rpc(name,args);return {data:r.data,error:r.error?{code:r.error.code,message:r.error.message}:null};};
 ctx.case=async(id,fn)=>{if(selectedCases&&!selectedCases.has(id))return;try{const details=await fn();record({id,status:'PASS',details});}catch(e){
  const raw=[e?.message,e?.stderr,e?.stdout].filter(Boolean).join('\n');
  const marker=raw.match(/\b(?:W\d{2}[A-Z0-9_]*|W\d{2}R[A-Z0-9_]*|R\d{2}[A-Z0-9_]*|P\d{2}[A-Z][A-Z0-9_]*|NATIVE_[A-Z0-9_]+|BROKER_[A-Z0-9_]+|ACCOUNT_[A-Z0-9_]+|ES02_[A-Z0-9_]+|RESTORE_[A-Z0-9_]+|LOCAL_[A-Z0-9_]+|VALID_[A-Z0-9_]+|POSITIVE_[A-Z0-9_]+|PROTECTED_[A-Z0-9_]+|SCOPE_[A-Z0-9_]+|STALE_[A-Z0-9_]+)\b/)?.[0];
  const sqlState=raw.match(/(?:SQLSTATE|ERROR:\s*)([0-9A-Z]{5})\b/i)?.[1];
  const constraint=raw.match(/constraint\s+"([a-z0-9_]+)"/i)?.[1];
  const column=raw.match(/null value in column "([a-z0-9_]+)"|column "([a-z0-9_]+)" does not exist/i)?.slice(1).find(Boolean);
  const relation=raw.match(/(?:relation|table)\s+"([a-z0-9_.]+)"/i)?.[1];
  const category=/must be owner/i.test(raw)?'DATABASE_OWNER_REQUIRED':/permission denied/i.test(raw)?'PERMISSION_DENIED':/being accessed by other users/i.test(raw)?'DATABASE_IN_USE':/violates foreign key constraint/i.test(raw)?'FOREIGN_KEY_VIOLATION':/violates unique constraint/i.test(raw)?'UNIQUE_VIOLATION':/null value in column/i.test(raw)?'NOT_NULL_VIOLATION':null;
  const dbMarker=raw.match(/(?:P0001|23503|23514)\s*:\s*([a-z][a-z0-9_]{4,})\b|ERROR:\s*([a-z][a-z0-9_]{4,})\s*(?:\(|$)/i)?.slice(1).find(Boolean)?.toUpperCase();
  const errorCode=marker??dbMarker??(sqlState?`SQLSTATE_${sqlState}`:category??(e?.name==='AssertionError'?'ASSERTION_FAILURE':'NATIVE_CASE_FAILURE'));
  const rawCause=/port is already allocated/i.test(raw)?'LOCAL_PORT_OCCUPIED':/no such container/i.test(raw)?'LOCAL_CONTAINER_MISSING':/cannot start.*container/i.test(raw)?'LOCAL_CONTAINER_START_REJECTED':/timed out|timeout/i.test(raw)?'LOCAL_OPERATION_TIMEOUT':undefined;
  const diagnostics=Object.fromEntries(Object.entries({sqlState,constraint,relation,column,category,stage:e?.restoreStage??e?.safeStage,errorType:['Error','TypeError','AssertionError','TimeoutError'].includes(e?.name)?e.name:undefined,systemCode:/^[A-Z_]+$/.test(e?.code)?e.code:undefined,exitCode:Number.isInteger(e?.code)?e.code:undefined,safeCause:e?.safeCause??rawCause??(Number.isInteger(e?.code)?'LOCAL_COMMAND_EXIT':undefined),assertion:e?.name==='AssertionError'&&/^[A-Z][A-Z0-9_]{4,}$/.test(e.message)?e.message:undefined,buildErrors:e?.safeBuildErrors,workerProof:e?.safeWorkerProof&&typeof e.safeWorkerProof==='object'?e.safeWorkerProof:undefined,commandShape:e?.safeCommandShape,capabilityDrift:e?.safeCapabilityDrift,connectionSummary:e?.safeConnectionSummary&&/^\[.*\]$/.test(e.safeConnectionSummary)?JSON.parse(e.safeConnectionSummary):undefined}).filter(([,v])=>v));
  record({id,status:'FAIL',errorCode,...(Object.keys(diagnostics).length?{diagnostics}:{})});
 }};
 let jobs,fixture;
 await ctx.case('W01_PENDING_AND_CLAIMED_JOBS_BLOCK_DELETION',async()=>{
  jobs=await ctx.fresh('worker-jobs');
  fixture={...jobs,conv:randomUUID(),message:randomUUID(),job:randomUUID(),claim:randomUUID()};
  const received=await ctx.service('save_whatsapp_inbound',{p_company_id:jobs.company,p_phone_number_id:'15550000001',p_customer_wa_id:'15550000002',p_customer_name:'Synthetic',p_wa_message_id:'wamid.synthetic.'+randomUUID(),p_body:'Synthetic bounded question',p_message_type:'text',p_received_at:new Date().toISOString()});assert(received.data?.ok,'NATIVE_JOB_INGRESS_REQUIRED');
  const [nativeJob]=await stack.rows(`select id from whatsapp_inbound_jobs where company_id='${jobs.company}' order by created_at desc limit 1`);assert(nativeJob,'NATIVE_JOB_REQUIRED');fixture.job=nativeJob.id;
  for(const status of ['pending','claimed']){
   if(status==='claimed')await stack.sql(`begin;set local role postgres;update whatsapp_inbound_jobs set status='claimed',claim_token='${fixture.claim}',claim_expires_at=clock_timestamp()+interval '2 minutes',expected_automation_generation=(select c.automation_generation from whatsapp_messages m join whatsapp_conversations c on c.id=m.conversation_id where m.id='${fixture.message}') where id='${fixture.job}';commit;`);
   const p=await ctx.command('preview',{target:jobs.account.id});assert(p.items.some(i=>i.relation==='public.whatsapp_inbound_jobs'&&i.category==='blocker'),'JOB_BLOCKER_REQUIRED');
   await ctx.expectProtected({id:p.id,fingerprint:p.fingerprint});
  }
  return {states:['pending','claimed'],start:'DENIED',workerRowsPreserved:true};
 });
 await ctx.case('W02_STALE_NATIVE_CLAIMS_NO_PROVIDER_DISPATCH',async()=>{
  assert(fixture,'FIXTURE_JOB_REQUIRED');
  const {runOperationalAnswer}=await loadWorker('src/lib/answers/operational-worker/run.ts');let dispatch=0;const outcomes=[];
  for(const claim of [randomUUID(),fixture.claim]){
   if(claim===fixture.claim)await stack.sql(`set role postgres;update whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id='${fixture.job}';`);
   const frame=await ctx.service('billing_load_worker_frame',{p_job_id:fixture.job,p_claim_token:claim});assert(!frame.data?.ok,'STALE_FRAME_MUST_REFUSE');
   for(const [name,args] of [['whatsapp_stage_job_reply',{p_job_id:fixture.job,p_claim_token:claim,p_ai_attempt_id:randomUUID(),p_citations:[]}],['whatsapp_claim_assistant_job_send',{p_job_id:fixture.job,p_claim_token:claim}]]){const r=await ctx.service(name,args);assert(!r.data?.ok,'STALE_EFFECT_MUST_REFUSE');outcomes.push({rpc:name,code:r.data?.code??r.error?.code??'NO_FRAME'});}
   const result=await runOperationalAnswer(fixture.job,claim,{enabled:true,loadFrame:async()=>null,complete:async()=>{dispatch++;throw Error('UNEXPECTED_PROVIDER_CALL');}});assert.equal(result.code,'claim_invalid');
  }
  assert.equal(dispatch,0);return {claims:['replaced','expired'],nativeRefusals:outcomes,modelCalls:dispatch};
 });
 await ctx.case('W03_NATIVE_INGRESS_BEFORE_CONFIRM_SHOWS_SCOPE_DIFF',async()=>{
  const f=await ctx.fresh('ingress-before'),p=await ctx.command('preview',{target:f.account.id});
  const r=await ctx.service('save_whatsapp_inbound',{p_company_id:f.company,p_phone_number_id:'synthetic-clean-phone',p_customer_wa_id:'synthetic-clean-recipient',p_customer_name:'Synthetic',p_wa_message_id:'synthetic-'+randomUUID(),p_body:'Synthetic ingress',p_message_type:'text',p_received_at:new Date().toISOString()});
  assert(r.data?.ok,'POSITIVE_NATIVE_INGRESS_REQUIRED');const changed=await ctx.command('start',{id:p.id,fingerprint:p.fingerprint});assert.equal(changed.code,'SCOPE_CHANGED');assert(changed.diff.length);return {persistedBeforeCutover:true,confirmation:'SCOPE_CHANGED',diffOnly:true};
 });
 await ctx.case('W04_NATIVE_INGRESS_AFTER_CONFIRM_ROLLS_BACK',async()=>{
  const f=await ctx.fresh('ingress-after'),p=await ctx.command('preview',{target:f.account.id});await ctx.command('start',{id:p.id,fingerprint:p.fingerprint});
  const r=await ctx.service('save_whatsapp_inbound',{p_company_id:f.company,p_phone_number_id:'synthetic-clean-phone',p_customer_wa_id:'synthetic-clean-recipient',p_customer_name:'Synthetic',p_wa_message_id:'synthetic-'+randomUUID(),p_body:'Synthetic ingress',p_message_type:'text',p_received_at:new Date().toISOString()});
  assert(r.error?.message.includes('ACCOUNT_DELETING'),'NATIVE_FENCE_DENIAL_REQUIRED');assert.equal((await stack.rows(`select count(*)::int n from whatsapp_messages where company_id='${f.company}'`))[0].n,0);return {rpc:'save_whatsapp_inbound',denial:'ACCOUNT_DELETING',partialWrites:0};
 });
 if(!selectedCases||selectedCases.has('P01_REAL_META_GEMINI_PROVIDER_ACCEPTANCE'))record({id:'P01_REAL_META_GEMINI_PROVIDER_ACCEPTANCE',status:'BLOCKED_AUTHORIZATION',details:'Real messages/model generation and external credentials are outside this local-only authorization; local stand-ins cannot close live provider acceptance.'});
 if(!selectedCases||selectedCases.has('W05_FULL_PAID_ES02_PROVIDER_SUCCESS'))record({id:'W05_FULL_PAID_ES02_PROVIDER_SUCCESS',status:'BLOCKED_NATIVE_FIXTURE_PREREQUISITE',details:'Full bootstrap replays empty billing dependency components, not a configured native checkout/paid-order foundation. Do not fabricate provider/HMAC evidence or weaken financial guards to manufacture a paid worker success.'});
 const deadline=Date.now()+10*60_000;while(!existsSync('scripts/account-deletion/restore-drill.mjs')){if(Date.now()>deadline)throw Error('RESTORE_HARNESS_NOT_READY');await new Promise(r=>setTimeout(r,250));}
 if(!selectedCases||['W01R_NATIVE_PENDING_CLAIMED_AND_INTENT_SCOPE','W02R_NATIVE_CLAIM_HEARTBEAT_POSITIVE_AND_STALE','W03R_NATIVE_NUMERIC_INGRESS_AND_SCOPE_DIFF','W05R_SUPPORTED_TEST_ORDER_CANNOT_AUTHORIZE_LIVE_WORKER','R01_REAL_DB_AUTH_STORAGE_RESTORE_WITH_ACTIVE_FENCE','R02_PRE_FENCE_BACKUP_REQUIRES_QUARANTINED_RECONFIRMATION'].some(id=>selectedCases.has(id))) await (await import('./restore-drill.mjs')).runRestoreDrill(ctx);
}
