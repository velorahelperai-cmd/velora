// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is allowance/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-setup-recovery-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=setup-trial-recovery','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${a}'::uuid$$;
 create table public.companies(id uuid primary key, business_type text,status text);
 create table public.company_branches(id uuid primary key,company_id uuid,name text,status text);
 create table public.company_members(company_id uuid,user_id uuid,status text,role text);
 create table public.ai_budget_accounts(id uuid default gen_random_uuid(),scope text,company_id uuid,enabled boolean,spent_baisa numeric,held_baisa numeric,limit_baisa numeric);
 create table public.ai_usage_ledger(id uuid primary key,budget_account_id uuid,company_id uuid,actor_user_id uuid,actor_session_id uuid,execution_id uuid,attempt integer,usage_mode text,model_id text,provider text,reserved_baisa numeric,pricing_version text,pricing_snapshot jsonb,source_citations jsonb,status text default 'reserved');
 create table private.es02_branch_trial_operations(operation_id uuid primary key,company_id uuid,branch_id uuid,account_id uuid,native_session_id uuid,question_hash text,knowledge_revision text,hours_revision bigint,language_code text,persona text,model_id text,created_at timestamptz,native_session_id_snapshot uuid,result_discarded_at timestamptz);
 create table private.es02_branch_assistant_trials(id uuid default gen_random_uuid(),company_id uuid,branch_id uuid,question text,answer text,origin text,model_id text,hours_revision bigint,language_code text,persona text,knowledge_revision text,execution_id uuid,created_at timestamptz default now());
 -- Explicit dependency doubles: allow only the fixture scope; no Auth/provider claims.
 create function private.es02_trial_context_current(op private.es02_branch_trial_operations) returns boolean language sql as $$select current_setting('fixture.context_stale',true) is distinct from 'true' and op.company_id='${c}'::uuid and op.branch_id='${b}'::uuid and op.account_id='${a}'::uuid$$;
 create function private.es02_branch_knowledge_revision(uuid,uuid) returns text language sql as $$select 'k1'::text$$;
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 insert into companies values('${c}','retail','setup');insert into company_branches values('${b}','${c}','Fixture','setup');insert into company_members values('${c}','${a}','active','owner');
 insert into ai_budget_accounts(scope,enabled,spent_baisa,held_baisa,limit_baisa) values('admin_test',true,12,0,1000);`);

 await sql(`create function private.es02_b3_session_open(uuid,uuid) returns boolean language sql as $$select current_setting('fixture.session_closed',true) is distinct from 'true' and $1='${a}'::uuid and $2 in ('${a}'::uuid,'44444444-4444-4444-8444-444444444444'::uuid)$$;
 create function private.ai_validated_usage(jsonb,text,boolean) returns jsonb language sql as $$select $1$$;
 create function private.ai_validate_cost(text,numeric,numeric) returns void language plpgsql as $$begin if $2<0 or $3<0 then raise exception 'invalid';end if;end$$;
 create function public.ai_settle_admin_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer,text,text) returns boolean language plpgsql as $$begin
 if current_setting('fixture.settle_throws',true)='true' then raise exception 'fixture settlement unavailable';end if;
 update public.ai_usage_ledger set status='success' where id=$1 and status='running';
 if found then update public.ai_budget_accounts set spent_baisa=spent_baisa+$4;return true;end if;
 return exists(select 1 from public.ai_usage_ledger where id=$1 and status='success');end$$;
 create function public.es02_record_owned_branch_assistant_trial(uuid,uuid,uuid,text,text,text,bigint,text,text,text,uuid) returns jsonb language plpgsql as $$begin
 if current_setting('fixture.record_fails',true)='true' then return '{"ok":false,"code":"UNAVAILABLE"}'::jsonb;end if;
 perform 1 from public.company_branches where id=$3 for update;
 if not exists(select 1 from private.es02_branch_assistant_trials where execution_id=$11) then
 insert into private.es02_branch_assistant_trials(company_id,branch_id,execution_id,origin,question,answer,knowledge_revision) values($2,$3,$11,'engine',$4,$5,$10);end if;
 return '{"ok":true}'::jsonb;end$$;
 insert into ai_usage_ledger(id,status,usage_mode) values('${a}','running','setup_trial');
 insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id,account_id,native_session_id,question_hash,knowledge_revision,hours_revision,language_code,persona,model_id,created_at,native_session_id_snapshot) values('${a}','${c}','${b}','${a}','${a}',md5('Q'),'k1',1,'ar','noura','gemini-3.8-flash',now(),'${a}');`);
 await sql(await readFile('supabase/migrations/20261028171417_es02_trial_result_recovery.sql','utf8'));
 const payload=JSON.stringify({question:'Q',answer:'Saved answer',modelId:'gemini-3.8-flash',usage:{promptTokens:1,completionTokens:1},costUsd:0.001,costBaisa:1,requestId:'fixture',actualModelId:'gemini-3.8-flash',latencyMs:1});
 const checkpoint=(actor=a,company=c,body=payload)=>`select public.es02_checkpoint_branch_trial_result('${a}','${actor}','${a}','${company}','${b}','${body}')`;
 const recover=(actor=a,company=c,session=a)=>`select public.es02_recover_branch_trial_result('${a}','${actor}','${session}','${company}','${b}')`;
 await assert.rejects(sql('set role authenticated;'+checkpoint()),/permission denied/);
 assert.equal(JSON.parse(await sql('set role service_role;'+recover())).code,'TRIAL_OUTCOME_UNKNOWN');
 assert.equal(JSON.parse(await sql('set role service_role;'+checkpoint(b))).code,'FORBIDDEN');
 assert.equal(JSON.parse(await sql('set role service_role;'+checkpoint(a,b))).code,'FORBIDDEN');
 assert.equal(JSON.parse(await sql("set role service_role;set fixture.settle_throws='true';"+checkpoint())).code,'TRIAL_PENDING');
 assert.equal(await sql('select result_checkpoint is not null from private.es02_branch_trial_operations'),'t');
 assert.equal(await sql('select spent_baisa from ai_budget_accounts'),'12');
 await sql('update private.es02_branch_trial_operations set native_session_id=null');
 assert.equal(JSON.parse(await sql("set role service_role;set fixture.session_closed='true';"+checkpoint())).ok,true);
 assert.equal(await sql('select spent_baisa from ai_budget_accounts'),'13');
 assert.equal(JSON.parse(await sql('set role service_role;'+checkpoint(a,c,payload.replace('Saved answer','Changed answer')))).code,'EXECUTION_CONFLICT');
 // Transport/persistence failure after provider success preserves recoverable result.
 assert.equal(JSON.parse(await sql("set role service_role;set fixture.record_fails='true';"+recover())).ok,false);
 assert.equal(await sql('select count(*) from private.es02_branch_assistant_trials'),'0');
 assert.equal(await sql('select spent_baisa from ai_budget_accounts'),'13');
 const status=JSON.parse(await sql(`set role authenticated;select public.es02_read_owned_branch_trial_recovery('${a}','${c}','${b}')`));
 assert.equal(status.operation.recoverable,true);assert(!JSON.stringify(status).includes('Saved answer'));
 assert.equal(JSON.parse(await sql('set role service_role;'+recover(a,c,b))).code,'FORBIDDEN');
 const replies=await Promise.all([1,2].map(()=>sql('set role service_role;'+recover(a,c,'44444444-4444-4444-8444-444444444444')).then(JSON.parse)));
 assert(replies.every(x=>x.ok));assert.equal(await sql('select count(*) from private.es02_branch_assistant_trials'),'1');assert.equal(await sql('select spent_baisa from ai_budget_accounts'),'13');
 await sql(`delete from private.es02_branch_assistant_trials;`);
 assert.equal(JSON.parse(await sql("set role service_role;set fixture.context_stale='true';"+recover())).discarded,true);
 assert.equal(await sql('select spent_baisa from ai_budget_accounts'),'13');
 assert.equal(await sql('select count(*) from private.es02_branch_assistant_trials'),'0');
 assert.equal(JSON.parse(await sql('set role service_role;'+recover())).discarded,true);
 assert.equal(JSON.parse(await sql(`set role authenticated;select public.es02_read_owned_branch_trial_recovery('${a}','${c}','${b}')`)).operation,null);
 console.log('PASS: closed-session checkpoint accounting, stale context terminal reconciliation, native checkpoint/recovery ACL, scope/session rejection, immutable replay, persistence failure then new-session concurrent recovery once; accounting/auth/context ports doubled, no provider.');
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'setup-trial-recovery');assert.equal(state.HostConfig.NetworkMode,'none');assert.equal(state.Name,'/'+name);assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
