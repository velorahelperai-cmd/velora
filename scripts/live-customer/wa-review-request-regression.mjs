// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is review receipt/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-wa-review-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}


const sid='44444444-4444-4444-8444-444444444444',newSid='77777777-7777-4777-8777-777777777777',attempt='55555555-5555-4555-8555-555555555555';
const call=(request=true,generation=17,branch=b,session=sid)=>`select public.wa_owned_checkpoint_review_request('${a}','${session}','${c}','${branch}','${attempt}',${generation},${request})`;
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=wa-review-request','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready);
 await sql(`create role authenticated;create role anon;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select coalesce(nullif(current_setting('test.actor',true),''),'${a}')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',coalesce(nullif(current_setting('test.session',true),''),'${sid}'))$$;
 create table auth.users(id uuid primary key);create table public.companies(id uuid primary key);create table public.company_branches(id uuid primary key,company_id uuid,unique(company_id,id));
 insert into auth.users values('${a}');insert into public.companies values('${c}');insert into public.company_branches values('${b}','${c}');
 create table private.es02_b3_connection_attempts(id uuid primary key,account_id uuid,session_id uuid,company_id uuid,branch_id uuid,generation integer,channel text,flow text,status text,expires_at timestamptz);
 create table private.es02_b3_whatsapp_signup_checkpoints(attempt_id uuid primary key,token_secret_id uuid);
 -- Explicit authority dependencies; actual pending receipt RPC below.
 create function private.es02_b3_session_open(uuid,uuid) returns boolean language sql as $$select $1='${a}'::uuid and $2 in ('${sid}'::uuid,'${newSid}'::uuid)$$;
 create function private.es02_b3_current_binding(uuid,uuid,uuid,text) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 create function private.es02_b3_pin_matches(private.es02_b3_connection_attempts,jsonb) returns boolean language sql as $$select true$$;
 insert into private.es02_b3_connection_attempts values('${attempt}','${a}','${sid}','${c}','${b}',17,'whatsapp','wa_new_number','unknown',now()-interval '1 hour');
 insert into private.es02_b3_whatsapp_signup_checkpoints values('${attempt}',gen_random_uuid());`);
 await sql(await readFile('supabase/migrations/20261028172343_wa_checkpoint_review_request.sql','utf8'));
 const original=await sql('select row_to_json(a) from private.es02_b3_connection_attempts a');
 const checkpoint=await sql('select row_to_json(c) from private.es02_b3_whatsapp_signup_checkpoints c');
 assert.equal(JSON.parse(await sql(`set role authenticated;${call(false)}`)).receipt,null);
 for(const query of [call(true,16),call(true,17,c),call(true,17,b,c)])assert.equal(JSON.parse(await sql(`set role authenticated;${query}`)).ok,false);
 await assert.rejects(sql(`set role anon;${call()}`),/permission denied/);
 const concurrent=await Promise.all([1,2].map(()=>sql(`set role authenticated;${call()}`).then(JSON.parse)));
 assert.equal(concurrent[0].ok,true);assert.deepEqual(concurrent[0],concurrent[1]);
 assert.deepEqual(JSON.parse(await sql(`set role authenticated;${call(false)}`)),concurrent[0]);

 // A fresh native owner session may request/read; original authorization is never resumed.
 for(const request of [false,true])assert.deepEqual(JSON.parse(await sql(`set role authenticated;set test.session='${newSid}';${call(request,17,b,newSid)}`)),concurrent[0]);
 assert.equal(JSON.parse(await sql(`set role authenticated;set test.actor='${b}';set test.session='${newSid}';${call(true,17,b,newSid)}`)).ok,false);
 assert.equal(await sql('select original_session_id from private.wa_checkpoint_review_requests'),sid);
 for(const table of ['auth.users','public.companies','public.company_branches','private.es02_b3_connection_attempts'])await assert.rejects(sql(`delete from ${table}`),/foreign key constraint/);
 assert.equal(await sql('select count(*) from private.wa_checkpoint_review_requests'),'1');
 assert.equal(await sql('select row_to_json(a) from private.es02_b3_connection_attempts a'),original);
 assert.equal(await sql('select row_to_json(c) from private.es02_b3_whatsapp_signup_checkpoints c'),checkpoint);
 await assert.rejects(sql('set role authenticated;select * from private.wa_checkpoint_review_requests'),/permission denied/);
 console.log('PASS actual pending receipt RPC: explicit absence, stale generation/foreign branch/session/anon denial, concurrent idempotency/read, new owner session resume, wrong actor denial, restrictive parent FKs, private table denial, attempt/checkpoint unchanged. Authority dependencies doubled; no provider.');
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'wa-review-request');assert.equal(state.Name,'/'+name);assert.equal(state.HostConfig.NetworkMode,'none');assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
