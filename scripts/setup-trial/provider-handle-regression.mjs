// Actual new RPC bodies on isolated PostgreSQL; session/owner dependencies are fixtures.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile),a=randomUUID(),c=randomUUID(),b=randomUUID(),op=randomUUID(),session=randomUUID(),fresh=randomUUID();let id;
function sql(query){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));p.stdin.end(query);});}
const scope=`'${op}','${a}','${session}','${c}','${b}'`;
const handle=JSON.stringify({id:'int_fixture',modelId:'gemini-3.8-flash',startedAt:1,promptChars:1,contextChars:1,sourceCount:1});
const attach=(h=handle)=>`select public.es02_attach_trial_provider(${scope},'${h}','Q')`;
const run=async q=>JSON.parse(await sql(`set role service_role;${q}`));
try{
 id=(await exec('docker',['run','--detach','--label','velora.task=provider-handle','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();
 for(let n=0;n<30;n++){try{await sql('select 1');break;}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;
 create table companies(id uuid,status text);create table company_members(company_id uuid,user_id uuid,role text,status text);
 create table ai_budget_accounts(scope text,company_id uuid);insert into ai_budget_accounts values('admin_test',null);
 create table ai_usage_ledger(id uuid,status text,usage_mode text,pricing_snapshot jsonb,reserved_baisa numeric,cost_baisa numeric,finished_at timestamptz,error_code text);
 create table private.es02_branch_trial_operations(operation_id uuid,account_id uuid,company_id uuid,branch_id uuid,native_session_id_snapshot uuid,model_id text,question_hash text,result_checkpoint jsonb,result_discarded_at timestamptz,created_at timestamptz);
 create table private.es02_branch_assistant_trials(execution_id uuid,company_id uuid,branch_id uuid,origin text);
 create function private.es02_b3_session_open(uuid,uuid) returns boolean language sql as $$select $1='${a}'::uuid and $2 in ('${session}'::uuid,'${fresh}'::uuid)$$;
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 insert into companies values('${c}','setup');insert into company_members values('${c}','${a}','owner','active');
 create function public.ai_settle_admin_attempt(uuid,text,numeric,numeric,jsonb,text,text,integer,text,text) returns boolean language plpgsql security definer as $$begin if $2<>'uncertain' or $3 is not null or $4 is not null then raise exception 'INVALID_FIXTURE_SETTLEMENT';end if;update public.ai_usage_ledger set status=$2,error_code=$7,finished_at=now() where id=$1;return true;end$$;
 insert into ai_usage_ledger values('${op}','running','setup_trial','{}',4.494810,null,null,null);
 insert into private.es02_branch_trial_operations values('${op}','${a}','${c}','${b}','${session}','gemini-3.8-flash',md5('Q'),null,null,now());`);
 if(!process.argv.includes('--baseline'))await sql(await readFile('supabase/migrations/20261101054146_es02_trial_provider_handles.sql','utf8'));
 assert.equal((await run(attach())).ok,true);assert.equal((await run(attach())).ok,true);
 assert.equal((await run(attach(handle.replace('int_fixture','int_other')))).code,'EXECUTION_CONFLICT');
 const load=await run(`select public.es02_load_trial_provider('${op}','${a}','${fresh}','${c}','${b}')`);
 assert.equal(load.data.handle.id,'int_fixture');assert.equal(load.data.sessionId,session,'original session is available only to trusted checkpoint writer');
 assert.equal((await run(`select public.es02_load_trial_provider('${op}','${a}','${fresh}','${c}','${randomUUID()}')`)).code,'FORBIDDEN');
 await assert.rejects(sql(`set role authenticated;${attach()}`),/permission denied/);
 await assert.rejects(sql(`set role authenticated;select public.es02_load_trial_provider(${scope})`),/permission denied/);
 const projection=JSON.parse(await sql(`set role authenticated;select public.es02_read_owned_branch_trial_recovery('${a}','${c}','${b}')`));
 assert.equal(projection.operation.pollable,true);assert(!JSON.stringify(projection).includes('int_fixture'),'provider ID must not reach browser');
 await sql(`update ai_usage_ledger set status='uncertain',error_code='GEMINI_INCOMPLETE_RESPONSE',finished_at=now()-interval '10 minutes';`);
 const failure=JSON.parse(await sql(`set role authenticated;select public.es02_read_owned_branch_trial_recovery('${a}','${c}','${b}')`));
 assert.equal(failure.operation.pollable,false);assert.equal(failure.operation.providerFailed,true);assert.equal(failure.operation.blocksNewRequests,false);
 await sql(`update ai_usage_ledger set status='running';update private.es02_branch_trial_operations set provider_handle=null,created_at=now()-interval '6 minutes';`);
 assert.equal((await run(`select public.es02_load_trial_provider(${scope})`)).submissionUnknown,true,'abandoned creation is classified without releasing its hold');
 assert.equal(await sql('select status from ai_usage_ledger'),'uncertain');
 assert.equal(await sql('select reserved_baisa::text||\',\'||coalesce(cost_baisa::text,\'unknown\') from ai_usage_ledger'),'4.494810,unknown');
 for(const field of ['provider_handle','result_checkpoint']){
  await sql(`update ai_usage_ledger set status='running';update private.es02_branch_trial_operations set provider_handle=null,result_checkpoint=null,created_at=now()-interval '6 minutes';`);
  const value=field==='provider_handle'?handle:'{}';
  const writer=sql(`begin;update private.es02_branch_trial_operations set ${field}='${value}';select pg_advisory_lock(4242);select pg_sleep(1);commit;`);
  let locked=false;
  for(let n=0;n<30;n++){if(await sql("select count(*) from pg_locks where locktype='advisory' and objid=4242")==='1'){locked=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert(locked,'concurrent writer acquired the operation lock');
  const recovered=await run(`select public.es02_load_trial_provider(${scope})`);await writer;
  assert.notEqual(recovered.submissionUnknown,true,`${field} committed while load waited must prevent stale expiry`);
  assert.equal(await sql('select status from ai_usage_ledger'),'running');
 }
 // New read-only stream RPC, with current-context/session dependencies explicitly mocked.
 await sql(`alter table private.es02_branch_trial_operations add column native_session_id uuid;
 create function private.es02_trial_context_current(op private.es02_branch_trial_operations) returns boolean language sql as $$select op.native_session_id='${fresh}'::uuid and op.branch_id='${b}'::uuid$$;
 update ai_usage_ledger set status='running';update private.es02_branch_trial_operations set provider_handle='${handle}',result_checkpoint=null;`);
 const streamMigration=await readFile('supabase/migrations/20261101063228_es02_flash_lite_stream.sql','utf8');
 await sql(streamMigration.slice(streamMigration.indexOf('create function public.es02_read_trial_stream')).replace(/commit;\s*$/, ''));
 const readStream=(account=a,branch=b)=>`select public.es02_read_trial_stream('${op}','${account}','${fresh}','${c}','${branch}')`;
 assert.equal((await run(readStream())).handle.modelId,'gemini-3.8-flash');
 assert.equal((await run(readStream(randomUUID()))).ok,false);
 assert.equal((await run(readStream(a,randomUUID()))).ok,false);
 await assert.rejects(sql(`set role authenticated;${readStream()}`),/permission denied/);
 await sql(`update private.es02_branch_trial_operations set provider_handle=jsonb_set(provider_handle,'{modelId}','"gemini-3.5-flash-lite"');`);
 assert.equal((await run(readStream())).handle.modelId,'gemini-3.5-flash-lite');
 await sql(`update ai_usage_ledger set status='uncertain';`);
 assert.equal((await run(readStream())).handle,null);
 assert.equal(await sql('select reserved_baisa::text||\',\'||coalesce(cost_baisa::text,\'unknown\') from ai_usage_ledger'),'4.494810,unknown');
 await sql(`alter table ai_usage_ledger add column model_id text default 'gemini-3.8-flash',add column provider text default 'google',add column worker_job_id uuid;
 alter table ai_usage_ledger add constraint ai_usage_ledger_model_id_check check(model_id='gemini-3.8-flash');
 alter table ai_usage_ledger add constraint ai_attempt_provider_model_pair check(provider='google');`);
 await sql(streamMigration.slice(streamMigration.indexOf('alter table public.ai_usage_ledger'),streamMigration.indexOf('-- Exact deployed-body guard')));
 await sql(`update ai_usage_ledger set model_id='gemini-3.5-flash-lite';`);
 await assert.rejects(sql(`update ai_usage_ledger set usage_mode='company_live'`),/ai_attempt_provider_model_pair/);
 await assert.rejects(sql(`update ai_usage_ledger set worker_job_id='${randomUUID()}'`),/ai_attempt_provider_model_pair/);
 await assert.rejects(sql(`update ai_usage_ledger set provider='openai'`),/ai_attempt_provider_model_pair/);
 assert.equal(await sql('select reserved_baisa::text||\',\'||coalesce(cost_baisa::text,\'unknown\') from ai_usage_ledger'),'4.494810,unknown');
 console.log('PASS actual RPCs: immutable handle, current-owner recovery, session binding, browser ACL, no handle disclosure, terminal projection, original hold/cost preserved, concurrent attachment/checkpoint expiry. Auth dependencies are fixtures.');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
