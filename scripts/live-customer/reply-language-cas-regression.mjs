// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is allowance/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-language-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=language-cas','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');


 await sql(`create role anon;create role authenticated;create schema private;
 create table companies(id uuid primary key,name text,display_name text,reply_language text);
 create table company_branches(id uuid primary key,company_id uuid,name text);
 create table private.es02_branch_reply_language_confirmations(company_id uuid,branch_id uuid,reply_language text,revision bigint,confirmed_at timestamptz,primary key(company_id,branch_id));
 create table private.es02_branch_launch_confirmations(company_id uuid,branch_id uuid);
 -- Authority dependency double: this proves RPC CAS, not hosted Auth/RLS.
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid,'code','FORBIDDEN')$$;
 insert into companies values('${c}','Fixture',null,'both');insert into company_branches values('${b}','${c}','Fixture');`);
 const baseline=await readFile('supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql','utf8');
 const begin=baseline.indexOf('create or replace function public.es02_read_owned_branch_reply_language(');
 await sql(baseline.slice(begin,baseline.indexOf('$$;',baseline.indexOf('as $$',begin))+3));
 await sql(await readFile('supabase/migrations/20261028172913_es02_reply_language_cas.sql','utf8'));
 const sig='public.es02_confirm_owned_branch_reply_language(uuid,uuid,uuid,bigint,text)';await sql(`revoke all on function ${sig} from public,anon;grant execute on function ${sig} to authenticated;`);
 const save=(revision,lang='en',actor=a)=>`select public.es02_confirm_owned_branch_reply_language('${actor}','${c}','${b}',${revision},'${lang}')`;
 assert.equal(JSON.parse(await sql(`select public.es02_read_owned_branch_reply_language('${a}','${c}','${b}')`)).data.snapshot.version,1);
 for(const revision of ['null','0','-1','9007199254740992']) assert.equal(JSON.parse(await sql('set role authenticated;'+save(revision))).code,'INVALID_INPUT');
 assert.equal(JSON.parse(await sql('set role authenticated;'+save(99))).code,'CONFLICT');
 assert.equal(JSON.parse(await sql('set role authenticated;'+save(1,'en',c))).code,'FORBIDDEN');
 await assert.rejects(sql('set role anon;'+save(1)),/permission denied/);
 assert.equal(await sql('select count(*) from private.es02_branch_reply_language_confirmations'),'0');
 const results=await Promise.all(['ar','en'].map(lang=>sql('set role authenticated;'+save(1,lang)).then(JSON.parse)));
 assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.filter(x=>x.code==='CONFLICT').length,1);
 assert.equal(await sql('select revision from private.es02_branch_reply_language_confirmations'),'2');
 await sql(`insert into private.es02_branch_launch_confirmations values('${c}','${b}')`);
 assert.equal(JSON.parse(await sql('set role authenticated;'+save(1,'both'))).code,'CONFLICT');
 assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'1');
 const saved=JSON.parse(await sql('set role authenticated;'+save(2,'both')));assert.equal(saved.data.snapshot.version,3);assert.equal(saved.data.snapshot.replyLanguage,'both');
 assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'0');
 console.log('PASS native language CAS: initial version1, required revisions, owner/ACL rejection, concurrent first save exactly one winner/version2, stale no mutation, next save version3 invalidates launch. Authority dependency doubled.');
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'language-cas');assert.equal(state.HostConfig.NetworkMode,'none');assert.equal(state.Name,'/'+name);assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
