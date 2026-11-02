import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-tick-${randomUUID().slice(0,8)}`; let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',x=>o+=x);p.stderr.on('data',x=>e+=x);p.on('close',c=>c?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=worker-tick','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();
 for(let n=0;n<40;n++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql('create role anon;create role authenticated;create role service_role;create schema private;create schema extensions;create extension pgcrypto schema extensions;');
 await sql(await readFile('supabase/migrations/20261102110024_whatsapp_worker_tick_capability.sql','utf8'));
 const token=await sql('select private.whatsapp_issue_worker_tick()');assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal(await sql(`set role service_role;select public.whatsapp_redeem_worker_tick('${token}')`),'t');
 assert.equal(await sql(`set role service_role;select public.whatsapp_redeem_worker_tick('${token}')`),'f');
 assert.equal(await sql("set role service_role;select public.whatsapp_redeem_worker_tick('invalid')"),'f');
 const exp=await sql('select private.whatsapp_issue_worker_tick()');await sql('update private.whatsapp_worker_ticks set expires_at=now()-interval \'1 second\'');
 assert.equal(await sql(`set role service_role;select public.whatsapp_redeem_worker_tick('${exp}')`),'f');
 await assert.rejects(sql('set role authenticated;select private.whatsapp_issue_worker_tick()'),/permission denied/);
 await assert.rejects(sql(`set role anon;select public.whatsapp_redeem_worker_tick('${exp}')`),/permission denied/);
 const rival=await sql('select private.whatsapp_issue_worker_tick()');const results=await Promise.all([sql(`set role service_role;select public.whatsapp_redeem_worker_tick('${rival}')`),sql(`set role service_role;select public.whatsapp_redeem_worker_tick('${rival}')`)]);assert.deepEqual(results.sort(),['f','t']);
 await sql(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);`);
 await sql(`create schema net;create table net.test_requests(url text,headers jsonb,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.test_requests values(url,headers,body);return 1;end$$;`);
 assert.equal(await sql('select private.whatsapp_schedule_worker_tick()'),'f','disabled scheduler does not enqueue');
 assert.equal(await sql('select count(*) from net.test_requests'),'0');
 await sql("update private.whatsapp_worker_scheduler_settings set enabled=true,endpoint='https://www.velorahelper.com/api/internal/whatsapp/worker'");
 await assert.rejects(sql('select private.whatsapp_schedule_worker_tick()'),/WORKER_TICK_SIGNING_KEY_REQUIRED/);
 await sql("insert into vault.decrypted_secrets values('whatsapp_worker_tick_hmac_v1','synthetic-test-worker-secret-at-least-thirty-two-characters')");
 assert.equal(await sql('select private.whatsapp_schedule_worker_tick()'),'t');
 assert.equal(await sql("select count(*) from net.test_requests where url='https://www.velorahelper.com/api/internal/whatsapp/worker' and headers->>'Authorization' ~ '^Bearer tick\\.[0-9a-f]{64}\\.[0-9a-f]{64}$'"),'1');
 assert.equal(await sql('select count(*) from private.whatsapp_worker_tick_runs where request_id=1'),'1','queued request has a non-secret monitoring receipt');
 assert.equal(await sql("select count(*) from information_schema.columns where table_schema='private' and table_name='whatsapp_worker_tick_runs' and column_name like '%token%'"),'0','monitoring receipt must not store capabilities');
 await sql("insert into vault.decrypted_secrets values('whatsapp_worker_tick_hmac_v1','another-synthetic-key-with-thirty-two-characters')");
 await assert.rejects(sql('select private.whatsapp_schedule_worker_tick()'),/WORKER_TICK_SIGNING_KEY_REQUIRED/,'duplicate keys fail closed');
 assert.equal(await sql('select count(*) from net.test_requests'),'1','duplicate key cannot enqueue');
 await assert.rejects(sql("update private.whatsapp_worker_scheduler_settings set endpoint='https://evil.example/'"),/check constraint/);
 await assert.rejects(sql('set role service_role;select private.whatsapp_schedule_worker_tick()'),/permission denied/);
 console.log('PASS: one-use, expiry, invalid token, concurrent redemption, and privilege checks on isolated PostgreSQL');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
