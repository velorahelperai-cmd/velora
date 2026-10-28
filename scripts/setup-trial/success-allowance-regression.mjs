// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is allowance/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-setup-trial-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
const reserve=op=>`select public.es02_reserve_branch_trial('${op}','${a}','${a}','${c}','${b}','Q','k1',1,'ar','noura','gemini-3.8-flash',1,'v1','{"modelId":"gemini-3.8-flash","version":"v1"}','[]')`;
const snapshot=()=>sql(`set role authenticated;select public.es02_read_owned_branch_assistant_trial('${a}','${c}','${b}')`).then(s=>JSON.parse(s).data.snapshot);
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=setup-trial-allowance','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');
 await sql(`create role authenticated;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${a}'::uuid$$;
 create table public.companies(id uuid primary key, business_type text);
 create table public.company_branches(id uuid primary key,company_id uuid,name text,status text);
 create table public.company_members(company_id uuid,user_id uuid,status text);
 create table public.ai_budget_accounts(id uuid default gen_random_uuid(),scope text,company_id uuid,enabled boolean,spent_baisa numeric,held_baisa numeric,limit_baisa numeric);
 create table public.ai_usage_ledger(id uuid primary key,budget_account_id uuid,company_id uuid,actor_user_id uuid,actor_session_id uuid,execution_id uuid,attempt integer,usage_mode text,model_id text,provider text,reserved_baisa numeric,pricing_version text,pricing_snapshot jsonb,source_citations jsonb,status text default 'reserved');
 create table private.es02_branch_trial_operations(operation_id uuid primary key,company_id uuid,branch_id uuid,account_id uuid,native_session_id uuid,question_hash text,knowledge_revision text,hours_revision bigint,language_code text,persona text,model_id text,created_at timestamptz,native_session_id_snapshot uuid);
 create table private.es02_branch_assistant_trials(id uuid default gen_random_uuid(),company_id uuid,branch_id uuid,question text,answer text,origin text,model_id text,hours_revision bigint,language_code text,persona text,knowledge_revision text,execution_id uuid,created_at timestamptz default now());
 -- Explicit dependency doubles: allow only the fixture scope; no Auth/provider claims.
 create function private.es02_trial_context_current(op private.es02_branch_trial_operations) returns boolean language sql as $$select op.company_id='${c}'::uuid and op.branch_id='${b}'::uuid and op.account_id='${a}'::uuid$$;
 create function private.es02_branch_knowledge_revision(uuid,uuid) returns text language sql as $$select 'k1'::text$$;
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 insert into companies values('${c}','retail');insert into company_branches values('${b}','${c}','Fixture','setup');insert into company_members values('${c}','${a}','active');
 insert into ai_budget_accounts(scope,enabled,spent_baisa,held_baisa,limit_baisa) values('admin_test',true,12,0,1000);`);
 const migration=await readFile('supabase/migrations/20261028165254_es02_trial_success_allowance.sql','utf8');
 await sql(migration);
 if(process.argv.includes('--launch-only')){
  await sql(`alter table companies add column status text default 'setup';
   create table private.es02_branch_launch_confirmations(id uuid default gen_random_uuid(),company_id uuid,branch_id uuid,account_id uuid,readiness_revision text,operation_id uuid unique,confirmed boolean,confirmed_at timestamptz default clock_timestamp(),unique(company_id,branch_id));
   create function public.es02_read_owned_branch_launch_summary(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid,'data',jsonb_build_object('snapshot',jsonb_build_object('version',1,'readiness',jsonb_build_object('status','ready','revision','fixture-revision'))))$$;`);
  let launch=await readFile('supabase/migrations/20261028165819_es02_launch_revision_idempotency.sql','utf8');
  if(process.argv.includes('--baseline')){const old=await readFile('supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql','utf8');const start=old.indexOf('create or replace function public.es02_confirm_owned_branch_launch(');launch=old.slice(start,old.indexOf('$$;',old.indexOf('as $$',start))+3);}
  await sql(launch);
  const confirm=(version,op=randomUUID())=>`select public.es02_confirm_owned_branch_launch('${a}','${c}','${b}',${version},'fixture-revision','${op}',true)`;
  assert.equal(JSON.parse(await sql(`set role authenticated;${confirm(2)}`)).code,'VERSION_CHANGED');
  assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'0');
  const first=randomUUID();assert.equal(JSON.parse(await sql(`set role authenticated;${confirm(1,first)}`)).ok,true);
  const receipt=await sql('select row_to_json(r) from private.es02_branch_launch_confirmations r');
  await Promise.all([first,randomUUID()].map(op=>sql(`set role authenticated;${confirm(1,op)}`)));
  assert.equal(await sql('select row_to_json(r) from private.es02_branch_launch_confirmations r'),receipt);
  assert.equal(await sql('select status from company_branches'),'active');
  console.log('PASS: native launch version rejection without mutation, success, replay/concurrent confirmation preserve original receipt/time. Readiness/auth dependencies doubled.');
 }else{
 // ACLs mirror existing role boundaries; migration must preserve them on reapply.
 const sig='public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb)';
 await sql(`revoke all on function ${sig} from public;grant execute on function ${sig} to service_role;`);
 const op=randomUUID();
 await assert.rejects(sql(`set role authenticated;${reserve(op)}`),/permission denied/);
 let result=JSON.parse(await sql(`set role service_role;${reserve(op)}`));assert.equal(result.newlyReserved,true);
 result=JSON.parse(await sql(`set role service_role;${reserve(op)}`));assert.equal(result.newlyReserved,false);
 let snap=await snapshot();assert.equal(snap.trialAllowance.used,0);assert.equal(snap.canAsk,false);
 await sql(`update ai_usage_ledger set status='uncertain' where id='${op}'`);
 result=JSON.parse(await sql(`set role service_role;${reserve(randomUUID())}`));assert.equal(result.code,'TRIAL_PENDING');
 snap=await snapshot();assert.equal(snap.trialAllowance.used,0);assert.equal(snap.canAsk,false);
 await sql(`update ai_usage_ledger set status='success' where id='${op}'`);
 snap=await snapshot();assert.equal(snap.trialAllowance.used,0);assert.equal(snap.canAsk,false);
 result=JSON.parse(await sql(`set role service_role;${reserve(randomUUID())}`));assert.equal(result.code,'TRIAL_PENDING');
 await sql(`update private.es02_branch_trial_operations set result_discarded_at=now() where operation_id='${op}'`);
 snap=await snapshot();assert.equal(snap.canAsk,true);assert.equal(snap.trialAllowance.used,0);
 result=JSON.parse(await sql(`set role service_role;${reserve(randomUUID())}`));assert.equal(result.newlyReserved,true);
 await sql(`update ai_usage_ledger set status='rejected' where status='reserved';update private.es02_branch_trial_operations set result_discarded_at=null where operation_id='${op}'`);
 await sql(`insert into private.es02_branch_assistant_trials(company_id,branch_id,execution_id,origin,question,answer,knowledge_revision) values('${c}','${b}','${op}','engine','Q','A','k1')`);
 snap=await snapshot();assert.equal(snap.trialAllowance.used,1);assert.equal(snap.canAsk,true);
 // Failed attempts remain cost history, never customer reply usage.
 await sql(`insert into ai_usage_ledger(id,status) select gen_random_uuid(),'rejected' from generate_series(1,12);insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id) select id,'${c}','${b}' from ai_usage_ledger l where status='rejected' and not exists(select 1 from private.es02_branch_trial_operations t where t.operation_id=l.id);`);
 assert.equal((await snapshot()).trialAllowance.used,1);
 // Two concurrent requests: branch/budget locks allow exactly one new dispatch.
 const concurrent=await Promise.all([randomUUID(),randomUUID()].map(x=>sql(`set role service_role;${reserve(x)}`).then(JSON.parse)));
 assert.equal(concurrent.filter(x=>x.newlyReserved===true).length,1);assert.equal(concurrent.filter(x=>x.code==='TRIAL_PENDING').length,1);
 await sql(`update ai_usage_ledger set status='rejected' where status='reserved';
 insert into ai_usage_ledger(id,status) select gen_random_uuid(),'success' from generate_series(1,9);
 insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id) select id,'${c}','${b}' from ai_usage_ledger l where not exists(select 1 from private.es02_branch_trial_operations o where o.operation_id=l.id);
 insert into private.es02_branch_assistant_trials(company_id,branch_id,execution_id,origin,question,answer,knowledge_revision) select '${c}','${b}',id,'engine','Q','A','k1' from ai_usage_ledger l where status='success' and not exists(select 1 from private.es02_branch_assistant_trials t where t.execution_id=l.id);`);
 snap=await snapshot();assert.equal(snap.trialAllowance.used,10);assert.equal(snap.canAsk,false);
 result=JSON.parse(await sql(`set role service_role;${reserve(randomUUID())}`));assert.equal(result.code,'TRIAL_LIMIT_REACHED');
 await sql(migration);await assert.rejects(sql(`set role authenticated;${reserve(randomUUID())}`),/permission denied/);
 assert.equal(await sql('select spent_baisa from ai_budget_accounts'),'12');
 console.log('PASS: actual RPC allowance, unknown/missing receipt, replay, concurrent reservation, ten-success limit, ACL preservation and cost separation. Fixture dependencies; hosted RLS NOT_RUN.');
 }
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'setup-trial-allowance');assert.equal(state.HostConfig.NetworkMode,'none');assert.equal(state.Name,'/'+name);assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
