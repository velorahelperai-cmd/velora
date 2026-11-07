// Atomic setup-trial budget cap on a disposable, network-less PostgreSQL container.
// The real migrated RPC bodies run; auth/context/settlement are labelled dependency doubles.
// This proves cap atomicity, unknown-hold accounting and cost/reply separation; it is NOT hosted RLS
// acceptance and does not exercise private.ai_settle_admin (reviewed statically instead).
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-trial-cap-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));
 child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
const args=(op,reserved)=>`'${op}','${a}','${a}','${c}','${b}','Q','k1',1,'ar','noura','gemini-3.8-flash',${reserved},'v1','{"modelId":"gemini-3.8-flash","version":"v1"}','[]'`;
const capped=(op,reserved,cap)=>`select public.es02_reserve_branch_trial_capped(${args(op,reserved)},${cap})`;
const run=async q=>JSON.parse(await sql(`set role service_role;${q}`));
const snapshot=()=>sql(`set role authenticated;select public.es02_read_owned_branch_assistant_trial('${a}','${c}','${b}')`).then(s=>JSON.parse(s).data.snapshot);
const settle=(op,status,cost)=>sql(`update ai_usage_ledger set status='${status}',cost_baisa=${cost} where id='${op}'`);
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=trial-budget-cap','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${a}'::uuid$$;
 create table public.companies(id uuid primary key, business_type text);
 create table public.company_branches(id uuid primary key,company_id uuid,name text,status text);
 create table public.company_members(company_id uuid,user_id uuid,status text);
 create table public.ai_budget_accounts(id uuid default gen_random_uuid(),scope text,company_id uuid,enabled boolean,spent_baisa numeric,held_baisa numeric,limit_baisa numeric);
 create table public.ai_usage_ledger(id uuid primary key,budget_account_id uuid,company_id uuid,actor_user_id uuid,actor_session_id uuid,execution_id uuid,attempt integer,usage_mode text,model_id text,provider text,reserved_baisa numeric,pricing_version text,pricing_snapshot jsonb,source_citations jsonb,status text default 'reserved',cost_baisa numeric);
 create table private.es02_branch_trial_operations(operation_id uuid primary key,company_id uuid,branch_id uuid,account_id uuid,native_session_id uuid,question_hash text,knowledge_revision text,hours_revision bigint,language_code text,persona text,model_id text,created_at timestamptz,native_session_id_snapshot uuid);
 create table private.es02_branch_assistant_trials(id uuid default gen_random_uuid(),company_id uuid,branch_id uuid,question text,answer text,origin text,model_id text,hours_revision bigint,language_code text,persona text,knowledge_revision text,execution_id uuid,created_at timestamptz default now());
 create function private.es02_trial_context_current(op private.es02_branch_trial_operations) returns boolean language sql as $$select op.company_id='${c}'::uuid and op.branch_id='${b}'::uuid and op.account_id='${a}'::uuid$$;
 create function private.es02_branch_knowledge_revision(uuid,uuid) returns text language sql as $$select 'k1'::text$$;
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 insert into companies values('${c}','retail');insert into company_branches values('${b}','${c}','Fixture','setup');insert into company_members values('${c}','${a}','active');
 insert into ai_budget_accounts(scope,enabled,spent_baisa,held_baisa,limit_baisa) values('admin_test',true,12,0,1000);`);
 const allowance=await readFile('supabase/migrations/20261028165254_es02_trial_success_allowance.sql','utf8');
 const cap=await readFile('supabase/migrations/20261030100000_es02_trial_budget_cap.sql','utf8');
 await sql(allowance);await sql(cap);
 const sig='public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb)';
 await sql(`revoke all on function ${sig} from public;grant execute on function ${sig} to service_role;`);
 // ACL: browser roles cannot call the capped reservation.
 await assert.rejects(sql(`set role authenticated;${capped(randomUUID(),0.65,2)}`),/permission denied/);
 // Invalid cap is rejected before any hold.
 assert.equal((await run(capped(randomUUID(),0.65,0))).code,'INVALID_INPUT');
 assert.equal(await sql('select count(*) from ai_usage_ledger'),'0');
 // Two billed-but-unusable calls (cost recorded, never a counted reply) stay under the cap.
 const [o1,o2,o3,o4]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
 assert.equal((await run(capped(o1,0.65,2))).newlyReserved,true);
 await settle(o1,'incomplete',0.6);
 assert.equal((await run(capped(o2,0.65,2))).newlyReserved,true);
 await settle(o2,'incomplete',0.6);
 let snap=await snapshot();assert.equal(snap.trialAllowance.used,0);assert.equal(snap.canAsk,true);
 // Third request fits (0.6+0.6+0.65=1.85) and is then left unknown: its full hold keeps counting.
 assert.equal((await run(capped(o3,0.65,2))).newlyReserved,true);
 await sql(`update ai_usage_ledger set status='uncertain' where id='${o3}'`);
 let r=await run(capped(o4,0.65,2));
 assert.equal(r.code,'TRIAL_BUDGET_EXCEEDED');assert.equal(Number(r.committedBaisa),1.85);
 assert.equal(await sql(`select count(*) from ai_usage_ledger where id='${o4}'`),'0');
 // Replay of an existing operation is never re-capped and never reserves again.
 r=await run(capped(o3,0.65,2));assert.equal(r.newlyReserved,false);
 // Reconciliation with evidence releases the unknown hold down to its actual cost.
 await settle(o3,'incomplete',0.3);
 assert.equal((await run(capped(o4,0.65,2))).code,'TRIAL_BUDGET_EXCEEDED');
 assert.equal((await run(capped(o4,0.4,2))).newlyReserved,true);
 assert.equal((await snapshot()).trialAllowance.used,0);
 // Concurrency: with room for exactly one hold, only one of two simultaneous requests is reserved.
 await sql(`delete from ai_usage_ledger;delete from private.es02_branch_trial_operations;update ai_budget_accounts set held_baisa=0;`);
 const both=await Promise.all([randomUUID(),randomUUID()].map(x=>sql(`set role service_role;${capped(x,0.65,1)}`).then(JSON.parse)));
 assert.equal(both.filter(x=>x.newlyReserved===true).length,1);
 assert.equal(both.filter(x=>x.code==='TRIAL_BUDGET_EXCEEDED').length,1);
 assert.equal(await sql('select count(*) from ai_usage_ledger'),'1');
 // Re-applying the migration keeps the ACL boundary.
 await sql(cap);await assert.rejects(sql(`set role authenticated;${capped(randomUUID(),0.65,2)}`),/permission denied/);
 console.log('PASS: atomic trial cap per branch, unknown holds, settled cost, replay, concurrency, ACL, cost separated from reply count. Fixture dependencies; hosted RLS and real settlement NOT_RUN.');
}finally{
 if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});
}
