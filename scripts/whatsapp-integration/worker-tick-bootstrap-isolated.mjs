// Verify installing the dormant worker schedule on a fresh isolated Supabase DB.
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-bootstrap-${randomUUID().slice(0,8)}`;let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',x=>o+=x);p.stderr.on('data',x=>e+=x);p.on('close',c=>c?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=bootstrap-isolated','--network','none','--log-driver','none','--memory','768m','-e','POSTGRES_PASSWORD=synthetic-only','supabase/postgres:17.6.1.136'],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<120;n++){const h=await exec('docker',['inspect','--format','{{.State.Health.Status}}',id],{windowsHide:true}).catch(()=>({stdout:''}));if(h.stdout.trim()==='healthy'){try{await sql('select 1');ready=true;break}catch{}}await new Promise(r=>setTimeout(r,300));}assert(ready,'POSTGRES_READY');
 await sql(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;create schema if not exists private;create schema if not exists extensions;create extension if not exists pgcrypto with schema extensions;create extension if not exists pg_cron;`);
 assert.equal(await sql("select count(*) from pg_extension where extname='pg_net'"),'0','test begins without pg_net');
 await sql(await readFile('supabase/migrations/20261102110024_whatsapp_worker_tick_capability.sql','utf8'));
 await sql(await readFile('supabase/migrations/20261102112954_whatsapp_worker_cron_schedule.sql','utf8'));
 assert.equal(await sql("select count(*) from pg_extension where extname='pg_net'"),'1');
 assert.equal(await sql("select count(*) from cron.job where jobname='velora-whatsapp-worker-v1' and active=false"),'1');
 assert.equal(await sql('select enabled from private.whatsapp_worker_scheduler_settings'),'f');
 assert.equal(await sql('select count(*) from private.whatsapp_worker_tick_runs'),'0');
 console.log('PASS: missing pg_net is installed and cron stays disabled with no queued requests');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
