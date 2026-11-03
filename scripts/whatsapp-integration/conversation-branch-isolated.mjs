// Isolated PostgreSQL tests for authoritative branch mapping and ambiguity.
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-branch-${randomUUID().slice(0,8)}`;let id;const c='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',x='33333333-3333-4333-8333-333333333333',y='44444444-4444-4444-8444-444444444444';
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',z=>o+=z);p.stderr.on('data',z=>e+=z);p.on('close',n=>n?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=branch-bind','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();for(let n=0;n<40;n++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.company_branches(company_id uuid,id uuid,unique(company_id,id));
 create table public.whatsapp_company_links(id uuid primary key,company_id uuid,provider_phone_number_id text,status text,generation bigint);
 create table private.es02_b3_connection_links(company_id uuid,branch_id uuid,legacy_link_id uuid,legacy_generation bigint,channel text,status text,verified boolean,revoked_at timestamptz,created_at timestamptz);
 create table public.whatsapp_conversations(id uuid primary key,company_id uuid,phone_number_id text,created_at timestamptz default now(),inbox_sequence bigint,customer_name text);
 insert into public.company_branches values('${c}','${a}'),('${c}','${b}'),('${other}','${b}');
 insert into public.whatsapp_company_links values('${x}','${c}','phone-one','verified',1),('${y}','${c}','phone-ambiguous','verified',1);
 insert into private.es02_b3_connection_links values('${c}','${a}','${x}',1,'whatsapp','active',true,null,now()-interval '1 day'),('${c}','${a}','${y}',1,'whatsapp','active',true,null,now()-interval '1 day'),('${c}','${b}','${y}',1,'whatsapp','active',true,null,now()-interval '1 day');
 insert into public.whatsapp_conversations(id,company_id,phone_number_id,created_at,inbox_sequence) values('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${c}','phone-one',now(),1),('11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${c}','phone-ambiguous',now(),2),('11111111-cccc-4ccc-8ccc-cccccccccccc','${c}','unknown',now(),3),('11111111-dddd-4ddd-8ddd-dddddddddddd','${c}','phone-one',now()-interval '2 days',4);`);
 await sql(await readFile('supabase/migrations/20261102122830_whatsapp_conversation_branch_binding.sql','utf8'));
 assert.equal(await sql("select branch_id from public.whatsapp_conversations where inbox_sequence=1"),a,'unique previously verified link binds correct branch');
 assert.equal(await sql('select count(*) from public.whatsapp_conversations where inbox_sequence in (2,3,4) and branch_id is null'),'3','ambiguous, unmatched and predating proof remain unbound');
 await sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,inbox_sequence) values(gen_random_uuid(),'${c}','phone-one',5)`);assert.equal(await sql('select branch_id from public.whatsapp_conversations where inbox_sequence=5'),a);
 await assert.rejects(sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,branch_id,inbox_sequence) values(gen_random_uuid(),'${c}','phone-one','${b}',6)`),/CONVERSATION_BRANCH_BINDING_INVALID/);
 await assert.rejects(sql(`update public.whatsapp_conversations set branch_id='${b}' where inbox_sequence=1`),/IMMUTABLE_CONVERSATION_BRANCH/);
 await assert.rejects(sql("update public.whatsapp_conversations set phone_number_id='other' where inbox_sequence=1"),/IMMUTABLE_CONVERSATION_IDENTITY/);
 await sql("update public.whatsapp_conversations set customer_name='changed' where inbox_sequence=1");assert.equal(await sql('select branch_id from public.whatsapp_conversations where inbox_sequence=1'),a);
 await sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,inbox_sequence) values(gen_random_uuid(),'${other}','phone-one',7)`);assert.equal(await sql('select branch_id is null from public.whatsapp_conversations where inbox_sequence=7'),'t','cross-company links never bind');
 await assert.rejects(sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,branch_id,inbox_sequence) values(gen_random_uuid(),'${c}','unknown','${b}',8)`),/CONVERSATION_BRANCH_BINDING_INVALID/);
 assert.equal(await sql("select has_function_privilege('anon','private.whatsapp_resolve_conversation_branch(uuid,text,timestamptz)','execute')"),'f');
 console.log('PASS: branch proof, historical timing, ambiguity, cross-company isolation and immutable binding in isolated PostgreSQL');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
