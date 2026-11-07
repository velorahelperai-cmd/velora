// Offline drill, only the newly created, verified fixture containers. Dumps never
// leave their disposable PostgreSQL container and are never emitted as log data.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const exec=promisify(execFile);
export async function run(ctx){
 const {stack,lit}=ctx;await ctx.loginOwner();
 const selected=id=>!ctx.selectedCases||ctx.selectedCases.has(id);
 if(!['R01_REAL_DB_AUTH_STORAGE_RESTORE_WITH_ACTIVE_FENCE','R02_PRE_FENCE_BACKUP_REQUIRES_QUARANTINED_RECONFIRMATION'].some(selected))return;
 const docker=async(args,stage='docker')=>{try{await stack.verify();return(await exec('docker',['--host','npipe:////./pipe/docker_engine',...args],{windowsHide:true,timeout:120000,maxBuffer:4*1024*1024})).stdout.trim();}catch(error){error.restoreStage=stage;const text=String(error.stderr??'');error.safeCause=/port is already allocated|Only one usage of each socket address/i.test(text)?'LOCAL_PORT_OCCUPIED':/failed to start shim|OCI runtime create failed/i.test(text)?'LOCAL_RUNTIME_START_FAILED':/is not running|cannot start.*paused/i.test(text)?'LOCAL_CONTAINER_STATE_INVALID':/No such container/i.test(text)?'LOCAL_CONTAINER_MISSING':undefined;throw error;}};
 const pg=async(db,sql,stage='native_sql')=>docker(['exec','-u','postgres',stack.names.postgres,'psql','-X','-U','supabase_admin','-d',db,'-Atq','-v','ON_ERROR_STOP=1','-c',sql],stage);
 const runTag=stack.runId.replaceAll('-','').slice(0,12);assert(/^[a-f0-9]+$/.test(runTag));
 const dump=label=>'/tmp/ad-'+runTag+'-'+label+'.dump';
 const backup=async label=>docker(['exec','-u','postgres',stack.names.postgres,'pg_dump','-U','supabase_admin','-d',stack.database,'-Fc','-f',dump(label)],`pg_dump_${label}`);
 const wait=async(url,stage)=>{for(let n=0;n<80;n++){try{const r=await fetch(url,{headers:{Authorization:'Bearer '+stack.serviceRoleKey,apikey:stack.serviceRoleKey},signal:AbortSignal.timeout(1000)});await r.arrayBuffer();if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}const error=Error('RESTORED_NATIVE_SERVICE_NOT_READY');error.restoreStage=stage;throw error;};
 const start=async kind=>{await stack.closeLocalIngress(kind);await docker(['start',stack.names[kind]],`start_${kind}`);await stack.ensureLocalIngress(kind);await wait(kind==='auth'?'http://127.0.0.1:4140/health':kind==='storage'?'http://127.0.0.1:4143/status':'http://127.0.0.1:4141/',`wait_${kind}_healthy`);};
 let restores=0;
 const waitForConnectionDrain=async()=>{
  const deadline=Date.now()+20_000;
  while(Date.now()<deadline){
   const count=Number(await pg('postgres',"select count(*) from pg_stat_activity where datname='c1_ui_integration' and pid<>pg_backend_pid()",'inspect_connection_drain'));
   if(count===0)return;
   await new Promise(ok=>setTimeout(ok,250));
  }
  const diagnostic=await pg('postgres',"select coalesce(jsonb_agg(jsonb_build_object('application',application_name,'backend',backend_type,'state',state,'count',n)),'[]'::jsonb) from (select application_name,backend_type,state,count(*) n from pg_stat_activity where datname='c1_ui_integration' and pid<>pg_backend_pid() group by application_name,backend_type,state) s",'connection_drain_diagnostic');
  const error=Error('RESTORE_DATABASE_STILL_CONNECTED');error.restoreStage='verify_old_connections_closed';error.safeConnectionSummary=diagnostic;throw error;
 };
 const restore=async(label,exposeRest)=>{
  for(const k of ['rest','storage','auth']){await stack.closeLocalIngress(k);await docker(['stop','--time','3',stack.names[k]]);}
  const evidence='ad_evidence_'+runTag+'_'+(++restores);assert(/^[a-z0-9_]+$/.test(evidence));assert.equal(stack.database,'c1_ui_integration');
  // The isolated Supabase fixture pins pg_cron.database_name to this database.
  // Stop its local launcher connection while renaming; no jobs are enabled in
  // this fixture, and the database is made inaccessible before the worker is
  // signalled so it cannot reconnect to the database being quarantined.
  await pg('postgres',"alter database c1_ui_integration with allow_connections=false; select pg_terminate_backend(pid) from pg_stat_activity where datname='c1_ui_integration' and backend_type='pg_cron launcher';",'quiesce_local_cron_before_restore');
  await waitForConnectionDrain();
  await pg('postgres',`alter database c1_ui_integration rename to ${evidence};`,'quarantine_restored_database');
  await docker(['exec','-u','postgres',stack.names.postgres,'createdb','-U','supabase_admin','-O','postgres','c1_ui_integration'],'create_restored_database');
  await docker(['exec','-u','postgres',stack.names.postgres,'pg_restore','-U','supabase_admin','-d','c1_ui_integration','--exit-on-error',dump(label)],`pg_restore_${label}`);
  // Keep all client APIs quarantined for a pre-fence backup. A fresh owner
  // preview and confirmation are performed through the isolated fixture DB;
  // services return only after the target fence is committed.
  if(exposeRest){await start('auth');await start('storage');await start('rest');}
 };
 const storage='http://127.0.0.1:4143',headers={Authorization:'Bearer '+stack.serviceRoleKey,apikey:stack.serviceRoleKey};
 const worker=async(op,step,action,outcome=null)=>{const r=await ctx.admin.rpc('account_deletion_worker',{p_actor:stack.owner.id,p_session:ctx.ownerClaims.session_id,p_id:op.id,p_claim:step.claim,p_action:action,p_outcome:outcome,p_code:null});if(r.error)throw Error(r.error.message);return r.data;};
 const finish=async(op,initial=null)=>{for(let n=0;n<5;n++){
  const step=n===0&&initial?initial:await ctx.command('claim',{id:op.id});if(!step)break;
  if(step.stage==='STORAGE'&&step.objects.length){const r=await fetch(storage+'/object/company-knowledge',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:step.objects.map(o=>({path:o.path,versionId:o.version}))})});assert(r.ok,'RESTORE_NATIVE_STORAGE_REMOVE');await r.arrayBuffer();}
  if(step.stage==='DATABASE')await worker(op,step,'database');
  if(step.stage==='AUTH'){const r=await ctx.admin.auth.admin.deleteUser(op.target,false);assert(!r.error,'RESTORE_NATIVE_AUTH_REMOVE');}
  if(step.stage==='VERIFY')assert.equal((await worker(op,step,'verify')).absent,true);
  await worker(op,step,'finish','SUCCEEDED');
 }const receipt=await ctx.command('status',{id:op.id});assert(Object.values(receipt.states).every(s=>s==='SUCCEEDED'),'RESTORE_COMPLETION_REQUIRED');return receipt;};
 let f,op,stale,journal,schemaHashBeforeRestore;
 await ctx.case('R01_REAL_DB_AUTH_STORAGE_RESTORE_WITH_ACTIVE_FENCE',async()=>{
  f=await ctx.fresh('restore-native');const file=randomUUID();f.path=f.company+'/'+file+'/restore.txt';const bytes='isolated synthetic restore payload';
  const uploaded=await fetch(storage+'/object/company-knowledge/'+f.path,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:bytes});assert(uploaded.ok,'RESTORE_UPLOAD_REQUIRED');await uploaded.arrayBuffer();
  await stack.sql(`set role postgres;insert into knowledge_sources(id,company_id,kind,title,file_name,storage_path,created_by) values('${file}','${f.company}','file','Synthetic restore source','restore.txt',${lit(f.path)},'${f.account.id}');`);
  const target=createClient(stack.url,stack.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});const signed=await target.auth.signInWithPassword({email:f.account.email,password:f.account.password});assert(!signed.error);await target.rpc('check_app_session',{p_touch:true});f.token=signed.data.session.access_token;f.ownerClaims={...ctx.ownerClaims};
  const oldHeaders={apikey:stack.anonKey,Authorization:'Bearer '+f.token};const readableBeforeFence=await fetch(storage+'/object/authenticated/company-knowledge/'+f.path,{headers:oldHeaders});assert(readableBeforeFence.ok,'RESTORE_PRE_FENCE_STORAGE_READ_REQUIRED');assert.equal(await readableBeforeFence.text(),bytes,'RESTORE_PRE_FENCE_STORAGE_BYTES_REQUIRED');
  await backup('before');op=await ctx.command('preview',{target:f.account.id});assert(!op.items.some(i=>i.category==='blocker'||i.blocks),'RESTORE_SCOPE_MUST_BE_ELIGIBLE');await ctx.command('start',{id:op.id,fingerprint:op.fingerprint});const deniedStorage=await fetch(storage+'/object/authenticated/company-knowledge/'+f.path,{headers:oldHeaders});assert(!deniedStorage.ok,'RESTORE_FENCE_MUST_DENY_OLD_STORAGE_JWT');await deniedStorage.arrayBuffer();stale=await ctx.command('claim',{id:op.id});assert.equal(stale.stage,'STORAGE');await backup('fenced');schemaHashBeforeRestore=(await stack.rows('select private.ad_schema_hash() hash'))[0].hash;
  const completed=await finish(op,stale);journal={operation:completed.id,target:completed.target,actor:completed.actor,policyVersion:completed.policyVersion,completedAt:completed.completedAt};ctx.restoreJournal=journal;
  await restore('fenced',true);await ctx.loginOwner();
  assert.equal((await stack.rows('select private.ad_schema_hash() hash'))[0].hash,schemaHashBeforeRestore,'RESTORE_SCHEMA_HASH_STABLE');
  assert(!(await ctx.admin.auth.admin.getUserById(f.account.id)).error,'RESTORED_NATIVE_AUTH_ROW_REQUIRED');
  const denied=await fetch(stack.url+'/rest/v1/rpc/is_platform_owner',{method:'POST',headers:{apikey:stack.anonKey,Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:'{}'});assert.equal((await denied.json()).code,'42501','RESTORED_FENCE_MUST_DENY_OLD_JWT');
  await stack.sql(`set role postgres;update private.ad_operations set lease_until=clock_timestamp()-interval '1 second' where id='${op.id}';`);
  const resumed=await ctx.command('status',{id:op.id});assert.equal(resumed.states.STORAGE,'UNKNOWN');await assert.rejects(worker(op,stale,'inspect'),/STALE_CLAIM/);
  await finish(op);assert((await ctx.admin.auth.admin.getUserById(f.account.id)).error,'RESTORED_AUTH_ERASURE_REQUIRED');
  await assert.rejects(stack.sql('begin;set local role postgres;truncate public.admin_audit_logs;rollback;'),/ADMIN_AUDIT_LOG_APPEND_ONLY/);
  return {nativePgDumpRestore:true,nativeAuthResurrectionObserved:true,oldJwtDeniedByRestoredFence:true,restoredSchemaHashStable:true,expiredLeaseReconciled:true,staleClaimDenied:true,allStagesReconciled:true,auditProtectionStillRejectsTruncate:true,backupDataNeverLogged:true};
 });
 await ctx.case('R02_PRE_FENCE_BACKUP_REQUIRES_QUARANTINED_RECONFIRMATION',async()=>{
  assert(journal&&f,'FIRST_RESTORE_CASE_REQUIRED');await restore('before',false);
  assert.equal((await stack.rows(`select count(*)::int n from auth.users where id='${f.account.id}'`))[0].n,1);
  assert.equal((await stack.rows(`select count(*)::int n from private.ad_operations where target='${f.account.id}' and fenced`))[0].n,0);
  // Storage must also stay unreachable: PostgREST isolation alone does not
  // protect the independent object API from a still-valid pre-fence JWT.
  const blocked=await fetch(stack.url+'/rest/v1/rpc/is_platform_owner',{method:'POST',headers:{apikey:stack.anonKey,Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:'{}'});assert(!blocked.ok,'QUARANTINE_REQUIRED');await blocked.arrayBuffer();
  let storageResponse=null;try{storageResponse=await fetch(storage+'/object/authenticated/company-knowledge/'+f.path,{headers:{apikey:stack.anonKey,Authorization:'Bearer '+f.token},signal:AbortSignal.timeout(1000)});await storageResponse.arrayBuffer();}catch{}assert.equal(storageResponse,null,'PRE_FENCE_STORAGE_INGRESS_MUST_BE_CLOSED');
  // Fresh owner preview/confirmation uses the saved synthetic owner session
  // against the isolated local database while all client APIs stay closed.
  // Never import a fake SUCCEEDED operation row or expose restored APIs first.
  const claims=f.ownerClaims;assert(claims?.session_id,'QUARANTINED_OWNER_SESSION_REQUIRED');
  const command=async(action,input)=>JSON.parse(await stack.sql(`begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims))};select account_deletion_command(${lit(action)},${lit(JSON.stringify(input))}::jsonb);commit;`));
  await stack.sql(`begin;set local role authenticated;set local request.jwt.claims=${lit(JSON.stringify(claims))};select check_app_session(true);commit;`);
  const fresh=await command('preview',{target:journal.target});assert.equal(fresh.target,journal.target);assert.equal(fresh.policyVersion,journal.policyVersion);assert(!fresh.items.some(i=>i.category==='blocker'||i.blocks));await command('start',{id:fresh.id,fingerprint:fresh.fingerprint});
  await start('auth');await start('storage');await start('rest');await ctx.loginOwner();await finish(fresh);
  assert((await ctx.admin.auth.admin.getUserById(f.account.id)).error);const gone=await fetch(storage+'/object/authenticated/company-knowledge/'+f.path,{headers});assert(!gone.ok);await gone.arrayBuffer();
  return {preFenceBackupResurrectedAuth:true,missingTombstoneDetected:true,externalReceiptReusedAsEvidenceNotAuthorization:true,authStorageAndRestQuarantinedUntilFreshOwnerPreviewAndConfirm:true,nativeAuthStorageAndDbErasedAgain:true,scopeProtectedGuardsPreserved:true};
 });
 if(!ctx.selectedCases||ctx.selectedCases.has('R03_HOSTED_PITR_AND_DURABLE_EXTERNAL_JOURNAL_RELEASE_GATE'))ctx.record({id:'R03_HOSTED_PITR_AND_DURABLE_EXTERNAL_JOURNAL_RELEASE_GATE',status:'BLOCKED_PRODUCTION_AUTHORIZATION',details:'Local manual quarantine/restore drill is separate from managed backup/PITR restoration and durable external erasure-journal/quarantine integration. No hosted restore, automation enablement or secret/config change is authorized.'});
}
