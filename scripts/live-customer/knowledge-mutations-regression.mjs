// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is knowledge mutation/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-knowledge-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}

const source='44444444-4444-4444-8444-444444444444',page='55555555-5555-4555-8555-555555555555';
const mutate=(version,action='edit',branch=b,title='New')=>`select public.es02_mutate_owned_branch_knowledge_source('${a}','${c}','${branch}','${source}',${version},'${action}','${title}','Answer')`;
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=knowledge-mutations','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready);
 await sql(`create role authenticated;create role anon;create role service_role;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${a}'::uuid$$;
 create table public.knowledge_sources(id uuid primary key,company_id uuid,kind text,title text,content text,status text,storage_path text,file_name text,content_type text,content_version integer,approved_for_answers boolean,approved_version integer,approved_at timestamptz,approved_by uuid);
 create table private.es02_branch_knowledge_sources(source_id uuid,company_id uuid,branch_id uuid);
 create table private.es02_branch_website_pages(id uuid primary key,company_id uuid,branch_id uuid,version integer,title text,url text,extracted_text text,status text);
 -- Explicit authority/read doubles: actual mutation/revision/approval-trigger bodies below.
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid)$$;
 create function public.es02_read_owned_branch_knowledge(uuid,uuid,uuid) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
 insert into knowledge_sources values('${source}','${c}','text','Old','Answer','ready','retained/object.txt',null,null,1,true,1,now(),'${a}');
 insert into private.es02_branch_knowledge_sources values('${source}','${c}','${b}');
 insert into private.es02_branch_website_pages values('${page}','${c}','${b}',1,'Page','https://example.com','Page text','indexed');`);
 const foundation=await readFile('supabase/migrations/20261005093000_vel_knowledge_answer_foundation.sql','utf8');
 const trigger=foundation.match(/create or replace function public\.knowledge_sources_version_and_approval[\s\S]*?execute function public\.knowledge_sources_version_and_approval\(\);/i);
 // Function name is resolved from the actual migration, never a synthetic trigger.
 const start=foundation.indexOf('create or replace function',foundation.indexOf('-- Denied'));
 const stop=foundation.indexOf('execute function',start);const end=foundation.indexOf(';',stop)+1;
 await sql(trigger?trigger[0]:foundation.slice(start,end));
 await sql(await readFile('supabase/migrations/20261028171327_es02_branch_knowledge_mutations.sql','utf8'));
 const revision=()=>sql(`select private.es02_branch_knowledge_revision('${c}','${b}')`);
 const initial=await revision();
 assert.equal(JSON.parse(await sql(`set role authenticated;${mutate(2)}`)).code,'CONFLICT');
 assert.equal(JSON.parse(await sql(`set role authenticated;${mutate(1,'edit',c)}`)).ok,false);
 await assert.rejects(sql(`set role anon;${mutate(1)}`),/permission denied/);
 const concurrent=await Promise.all(['One','Two'].map(title=>sql(`set role authenticated;${mutate(1,'edit',b,title)}`).then(JSON.parse)));
 assert.equal(concurrent.filter(x=>x.ok===true).length,1);assert.equal(concurrent.filter(x=>x.code==='CONFLICT').length,1);
 assert.equal(await sql("select content_version||':'||approved_for_answers from knowledge_sources"),'2:false');assert.notEqual(await revision(),initial);
 await sql("set velora.knowledge_approval='1';update knowledge_sources set approved_for_answers=true,approved_version=content_version;");
 const beforeUnlink=await revision();
 await sql(`set role authenticated;${mutate(2,'remove')}`);
 assert.notEqual(await revision(),beforeUnlink);
 assert.equal(await sql('select count(*) from private.es02_branch_knowledge_sources'),'0');
 assert.equal(await sql('select storage_path from knowledge_sources'),'retained/object.txt');
 assert.equal(JSON.parse(await sql(`set role authenticated;${mutate(2,'remove')}`)).code,'CONFLICT');
 const removePage=version=>`select public.es02_remove_owned_branch_knowledge_page('${a}','${c}','${b}','${page}',${version})`;
 assert.equal(JSON.parse(await sql(`set role authenticated;${removePage(2)}`)).code,'CONFLICT');
 const beforeDelete=await revision();assert.equal(JSON.parse(await sql(`set role authenticated;${removePage(1)}`)).ok,true);assert.notEqual(await revision(),beforeDelete);
 console.log('PASS actual mutation/revision RPC and canonical approval trigger: stale/foreign/anon denial, concurrent edit CAS, approval invalidation, unlink preserves storage, page delete revision. Authority/read fixture doubles; hosted NOT_RUN.');
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'knowledge-mutations');assert.equal(state.Name,'/'+name);assert.equal(state.HostConfig.NetworkMode,'none');assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
