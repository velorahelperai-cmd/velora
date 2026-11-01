// Bounded continuation with preserved unknown holds on isolated PostgreSQL.
// The real migrated RPC bodies run; auth/context/settlement are labelled dependency doubles.
// This proves cap atomicity, unknown-hold accounting and cost/reply separation; it is NOT hosted RLS
// acceptance and does not exercise private.ai_settle_admin (reviewed statically instead).
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-trial-continuation-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));
 child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
const args=(op,reserved)=>`'${op}','${a}','${a}','${c}','${b}','Q','k1',1,'ar','noura','gemini-3.8-flash',${reserved},'v1','{"modelId":"gemini-3.8-flash","version":"v1"}','[]'`;
const reserve=(op,reserved)=>`select public.es02_reserve_branch_trial(${args(op,reserved)})`;
const capped=(op,reserved,cap)=>`select public.es02_reserve_branch_trial_capped(${args(op,reserved)},${cap})`;
const run=async q=>JSON.parse(await sql(`set role service_role;${q}`));
const snapshot=()=>sql(`set role authenticated;select public.es02_read_owned_branch_assistant_trial('${a}','${c}','${b}')`).then(s=>JSON.parse(s).data.snapshot);
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=trial-continuation','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${a}'::uuid$$;
 create table public.companies(id uuid primary key, business_type text);
 create table public.company_branches(id uuid primary key,company_id uuid,name text,status text);
 create table public.company_members(company_id uuid,user_id uuid,status text);
 create table public.ai_budget_accounts(id uuid default gen_random_uuid(),scope text,company_id uuid,enabled boolean,spent_baisa numeric,held_baisa numeric,limit_baisa numeric);
 create table public.ai_usage_ledger(id uuid primary key,budget_account_id uuid,company_id uuid,actor_user_id uuid,actor_session_id uuid,execution_id uuid,attempt integer,usage_mode text,model_id text,provider text,reserved_baisa numeric,pricing_version text,pricing_snapshot jsonb,source_citations jsonb,status text default 'reserved',cost_baisa numeric,finished_at timestamptz);
 create table private.es02_branch_trial_operations(operation_id uuid primary key,company_id uuid,branch_id uuid,account_id uuid,native_session_id uuid,question_hash text,knowledge_revision text,hours_revision bigint,language_code text,persona text,model_id text,created_at timestamptz,native_session_id_snapshot uuid,result_checkpoint jsonb);
 create table private.es02_branch_assistant_trials(id uuid default gen_random_uuid(),company_id uuid,branch_id uuid,question text,answer text,origin text,model_id text,hours_revision bigint,language_code text,persona text,knowledge_revision text,execution_id uuid,created_at timestamptz default now());
 create function private.es02_trial_context_current(op private.es02_branch_trial_operations) returns boolean language sql as $$select op.company_id='${c}'::uuid and op.branch_id='${b}'::uuid and op.account_id='${a}'::uuid$$;
 create function private.es02_branch_knowledge_revision(uuid,uuid) returns text language sql as $$select 'k1'::text$$;
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 insert into companies values('${c}','retail');insert into company_branches values('${b}','${c}','Fixture','setup');insert into company_members values('${c}','${a}','active');
 insert into ai_budget_accounts(scope,enabled,spent_baisa,held_baisa,limit_baisa) values('admin_test',true,12,0,1000);`);
 const allowance=await readFile('supabase/migrations/20261028165254_es02_trial_success_allowance.sql','utf8');
 const cap=await readFile('supabase/migrations/20261030105845_es02_trial_budget_cap.sql','utf8');
 await sql(allowance);await sql(cap);
 const sig='public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb)';
 await sql(`revoke all on function ${sig} from public;grant execute on function ${sig} to service_role;`);

 if(process.argv.includes('--candidate'))await sql(await readFile('supabase/migrations/20261101051115_es02_uncertain_trial_continuation.sql','utf8'));
 const old=randomUUID();assert.equal((await run(reserve(old,4))).newlyReserved,true);
 await sql(`update ai_usage_ledger set status='uncertain',finished_at=now()-interval '10 minutes' where id='${old}'`);
 assert.equal((await snapshot()).canAsk,true,'an aged uncertain hold must not lock the entire branch');
 assert.equal((await snapshot()).trialAllowance.used,0,'unknown cost is not a successful reply');
 if(process.argv.includes('--candidate')){const recovery=JSON.parse(await sql(`set role authenticated;select public.es02_read_owned_branch_trial_recovery('${a}','${c}','${b}')`));assert.equal(recovery.operation.blocksNewRequests,false);assert.equal(recovery.operation.id,old);}
 const next=randomUUID();assert.equal((await run(reserve(next,4))).newlyReserved,true);
 assert.equal(await sql(`select status||':'||coalesce(cost_baisa::text,'null') from ai_usage_ledger where id='${old}'`),'uncertain:null');
 assert.equal(await sql('select held_baisa from ai_budget_accounts'),'8');
 if(process.argv.includes('--candidate')){const recovery=JSON.parse(await sql(`set role authenticated;select public.es02_read_owned_branch_trial_recovery('${a}','${c}','${b}')`));assert.equal(recovery.operation.blocksNewRequests,true);assert.equal(recovery.operation.id,next);}
 assert.equal((await run(reserve(old,4))).newlyReserved,false,'never replay the unknown operation');
 assert.equal((await run(reserve(randomUUID(),4))).code,'TRIAL_PENDING','active reservation still blocks concurrent generation');
 await sql(`update ai_usage_ledger set status='uncertain',finished_at=now() where id='${next}'`);
 assert.equal((await snapshot()).canAsk,false,'recent unknown waits for the existing in-flight window');
 await sql(`update ai_usage_ledger set finished_at=now()-interval '10 minutes' where id='${next}';update private.es02_branch_trial_operations set result_checkpoint='{}' where operation_id='${next}'`);
 assert.equal((await snapshot()).canAsk,false,'saved checkpoints require recovery, never replacement');
 await sql(`update private.es02_branch_trial_operations set result_checkpoint=null where operation_id='${next}'`);
 const simultaneous=await Promise.all([randomUUID(),randomUUID()].map(x=>run(reserve(x,4))));
 assert.equal(simultaneous.filter(x=>x.newlyReserved).length,1);assert.equal(simultaneous.filter(x=>x.code==='TRIAL_PENDING').length,1);
 await sql(`update ai_usage_ledger set status='uncertain',finished_at=now()-interval '10 minutes'`);
 for(let i=3;i<10;i++){const x=randomUUID();assert.equal((await run(reserve(x,4))).newlyReserved,true);await sql(`update ai_usage_ledger set status='uncertain',finished_at=now()-interval '10 minutes' where id='${x}'`);}
 assert.equal((await snapshot()).canAsk,false,'unresolved attempts occupy bounded slots');
 assert.equal((await run(reserve(randomUUID(),4))).code,'TRIAL_LIMIT_REACHED');
 assert.equal((await snapshot()).trialAllowance.used,0);assert.equal(await sql('select held_baisa from ai_budget_accounts'),'40');
 await sql(`update ai_usage_ledger set status='rejected',cost_baisa=0;update ai_budget_accounts set held_baisa=0,limit_baisa=13;`);
 assert.equal((await run(reserve(randomUUID(),4))).code,'BUDGET_EXCEEDED','global budget protection is preserved');
 await sql('update ai_budget_accounts set limit_baisa=1000');
 assert.equal((await run(capped(randomUUID(),4,2))).code,'TRIAL_BUDGET_EXCEEDED','configured branch caps still apply');
 await assert.rejects(sql(`set role authenticated;${reserve(randomUUID(),4)}`),/permission denied/);
 console.log('PASS: aged uncertainty preserves hold/cost, bounded continuation, replay denial, active/recent/checkpoint guards, atomic concurrency, quota and budget/ACL. Native auth/context dependencies are fixtures; not hosted acceptance.');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
