// Uses actual Supabase PostgreSQL/pg_net in a dedicated network-isolated container.
// It cannot contact the production URL; a failed connect is the expected endpoint outcome.
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-pgnet-${randomUUID().slice(0,8)}`;let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',x=>o+=x);p.stderr.on('data',x=>e+=x);p.on('close',c=>c?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=pgnet-isolated','--network','none','--log-driver','none','--memory','768m','-e','POSTGRES_PASSWORD=synthetic-only','supabase/postgres:17.6.1.136'],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<120;n++){const health=await exec('docker',['inspect','--format','{{.State.Health.Status}}',id],{windowsHide:true}).catch(()=>({stdout:''}));if(health.stdout.trim()==='healthy'){try{await sql('select 1');ready=true;break}catch{}}await new Promise(r=>setTimeout(r,300));}assert(ready,'POSTGRES_READY');
 await sql(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;create schema if not exists private;create schema if not exists extensions;create extension if not exists pgcrypto with schema extensions;create extension if not exists pg_net with schema extensions;`);
 await sql("create extension if not exists supabase_vault cascade;select vault.create_secret('synthetic-test-worker-secret-at-least-thirty-two-characters','whatsapp_worker_tick_hmac_v1')");
 await sql(await readFile('supabase/migrations/20261102110024_whatsapp_worker_tick_capability.sql','utf8'));
 assert.equal(await sql('select private.whatsapp_schedule_worker_tick()'),'f');
 await sql("update private.whatsapp_worker_scheduler_settings set enabled=true,endpoint='https://www.velorahelper.com/api/internal/whatsapp/worker'");
 assert.equal(await sql('select private.whatsapp_schedule_worker_tick()'),'t');
 assert.equal(await sql('select count(*) from private.whatsapp_worker_tick_runs'),'1');
 let observed=false;for(let n=0;n<60;n++){const v=await sql('select count(*) from net._http_response r join private.whatsapp_worker_tick_runs t on t.request_id=r.id');if(v==='1'){observed=true;break}await new Promise(r=>setTimeout(r,500));}
 assert(observed,'PG_NET_RESPONSE_NOT_OBSERVED');
 const outcome=await sql('select (status_code is null and error_msg is not null)::text from net._http_response r join private.whatsapp_worker_tick_runs t on t.request_id=r.id');
 assert.equal(outcome,'true','network isolation must prevent external delivery');
 await sql('create extension if not exists pg_cron');
 await sql('update private.whatsapp_worker_scheduler_settings set enabled=false');
 await sql(await readFile('supabase/migrations/20261102112954_whatsapp_worker_cron_schedule.sql','utf8'));
 assert.equal(await sql("select count(*) from cron.job where jobname='velora-whatsapp-worker-v1' and active=false and schedule='30 seconds'"),'1','production schedule installs disabled');
 const health=JSON.parse(await sql('select private.whatsapp_worker_scheduler_health()'));assert.equal(health.enabled,false);assert.equal(health.cron_active,false);assert.equal(health.failures_15m,1);assert.equal(health.queued_15m,1);assert(!JSON.stringify(health).includes('tick.'),'health contains no capability');
 await sql(`insert into private.whatsapp_worker_tick_runs(request_id) values(900001),(900002),(900003);insert into net._http_response(id,status_code,content) values(900001,200,'{"code":"WORKER_BATCH_BLOCKED"}'),(900002,202,'{"code":"RECONCILIATION_REQUIRED"}'),(900003,200,'not json');`);
 const detail=JSON.parse(await sql('select private.whatsapp_worker_scheduler_health()'));assert.equal(detail.blocked_15m,1,'200 response with blocked work is visible');assert.equal(detail.reconciliation_15m,1,'202 response requiring review is visible');assert.equal(detail.invalid_response_15m,1,'malformed response is visible');
 await assert.rejects(sql(await readFile('supabase/migrations/20261102112954_whatsapp_worker_cron_schedule.sql','utf8')),/WHATSAPP_WORKER_SCHEDULE_PREREQUISITE_MISMATCH/);
 assert.equal(await sql("select count(*) from cron.job where jobname='velora-whatsapp-worker-v1' and active=false"),'1','repeat installation does not enable or duplicate cron');
 await sql('update private.whatsapp_worker_scheduler_settings set enabled=true');
 await sql("select cron.alter_job(job_id:=(select jobid from cron.job where jobname='velora-whatsapp-worker-v1'),schedule:='5 seconds',active:=true)");
 let cronObserved=false;for(let n=0;n<40;n++){if(Number(await sql('select count(*) from private.whatsapp_worker_tick_runs'))>=2){cronObserved=true;break}await new Promise(r=>setTimeout(r,500));}
 assert(cronObserved,'PG_CRON_TICK_NOT_OBSERVED');
 console.log('PASS: real pg_net queues the scoped tick; pg_cron queues another; network isolation prevents external delivery');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
