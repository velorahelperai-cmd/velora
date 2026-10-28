// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is allowance/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-worker-language-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=worker-language','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');



 await sql(`create role anon;create role authenticated;create role service_role;create schema private;
 create table company_branches(id uuid primary key,company_id uuid);
 create table whatsapp_inbound_jobs(id uuid primary key,company_id uuid,message_id uuid,wa_message_id text);
 create table whatsapp_messages(id uuid primary key,company_id uuid,wa_message_id text,direction text,sender text,conversation_id uuid);
 create table whatsapp_conversations(id uuid primary key,company_id uuid,phone_number_id text);
 create table whatsapp_company_links(id uuid primary key,company_id uuid,provider_phone_number_id text,generation bigint,status text,authorization_status text,authorization_expires_at timestamptz);
 create table private.es02_b3_connection_links(company_id uuid,branch_id uuid,channel text,legacy_link_id uuid,legacy_generation bigint,verified boolean,status text,revoked_at timestamptz);
 create table private.es02_branch_reply_language_confirmations(company_id uuid,branch_id uuid,reply_language text,revision bigint);
 -- Existing native paid/profile authorization is doubled; scope joins below are real candidate SQL.
 create function private.whatsapp_answer_profile(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${a}'::uuid,'company_id','${c}','job_id',$1,'authority','es02','es02_branch_id','${b}')$$;
 insert into company_branches values('${b}','${c}');
 insert into whatsapp_inbound_jobs values('${a}','${c}','${a}','native-message');
 insert into whatsapp_messages values('${a}','${c}','native-message','inbound','customer','${a}');
 insert into whatsapp_conversations values('${a}','${c}','test-phone');
 insert into whatsapp_company_links values('${a}','${c}','test-phone',1,'verified','active',null);
 insert into private.es02_b3_connection_links values('${c}','${b}','whatsapp','${a}',1,true,'active',null);`);
 await sql(await readFile('supabase/migrations/20261028173318_es02_worker_reply_language.sql','utf8'));
 const read=(company=c,claim=a)=>`select public.es02_read_claimed_reply_language('${company}','${a}','${claim}')`;
 await assert.rejects(sql('set role authenticated;'+read()),/permission denied/);
 assert.equal(JSON.parse(await sql('set role service_role;'+read())).code,'REPLY_LANGUAGE_UNCONFIRMED');
 // A different branch's confirmed preference cannot be borrowed.
 await sql(`insert into private.es02_branch_reply_language_confirmations values('${c}','${a}','ar',7)`);
 assert.equal(JSON.parse(await sql('set role service_role;'+read())).code,'REPLY_LANGUAGE_UNCONFIRMED');
 await sql(`insert into private.es02_branch_reply_language_confirmations values('${c}','${b}','en',2)`);
 assert.deepEqual(JSON.parse(await sql('set role service_role;'+read())),{ok:true,company_id:c,job_id:a,branch_id:b,reply_language:'en',revision:2});
 assert.equal(JSON.parse(await sql('set role service_role;'+read(a))).code,'CLAIM_BINDING_REJECTED');
 assert.equal(JSON.parse(await sql('set role service_role;'+read(c,b))).ok,false);
 await sql(`update whatsapp_messages set direction='outbound'`);
 assert.equal(JSON.parse(await sql('set role service_role;'+read())).code,'REPLY_LANGUAGE_UNCONFIRMED');
 await sql(`update whatsapp_messages set direction='inbound',company_id='${a}'`);
 assert.equal(JSON.parse(await sql('set role service_role;'+read())).code,'REPLY_LANGUAGE_UNCONFIRMED');
 await sql(`update whatsapp_messages set company_id='${c}';update private.es02_branch_reply_language_confirmations set reply_language='both',revision=3 where branch_id='${b}'`);
 const fresh=JSON.parse(await sql('set role service_role;'+read()));assert.equal(fresh.reply_language,'both');assert.equal(fresh.revision,3);
 for(const change of ["verified=false","status='revoked'","revoked_at=clock_timestamp()","legacy_generation=2","branch_id='${a}'"]){
  await sql(`update private.es02_b3_connection_links set ${change.replace('${a}',a)}`);
  assert.equal(JSON.parse(await sql('set role service_role;'+read())).code,'REPLY_LANGUAGE_UNCONFIRMED');
  await sql(`update private.es02_b3_connection_links set verified=true,status='active',revoked_at=null,legacy_generation=1,branch_id='${b}'`);
 }
 await sql(`update whatsapp_company_links set authorization_expires_at=clock_timestamp()-interval '1 second'`);
 assert.equal(JSON.parse(await sql('set role service_role;'+read())).code,'REPLY_LANGUAGE_UNCONFIRMED');
 console.log('PASS native worker language: service-only ACL, claimed scope, stored inbound chain, confirmed exact branch only, no fallback, revision reread; native paid authorization explicitly doubled.');
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'worker-language');assert.equal(state.HostConfig.NetworkMode,'none');assert.equal(state.Name,'/'+name);assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
