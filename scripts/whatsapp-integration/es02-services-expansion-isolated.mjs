import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name='velora-search-'+randomUUID().slice(0,8);let id;
function sql(q){return new Promise((resolve,reject)=>{let p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true}),o='',e='';p.stdout.on('data',x=>o+=x);p.stderr.on('data',x=>e+=x);p.on('close',n=>n?reject(Error(e)):resolve(o.trim()));p.stdin.end(q);});}
try{id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=search-expansion','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();for(let n=0;n<60;n++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
await sql(`create schema private;create function private.knowledge_search_text(text) returns text language sql immutable as $$select $1$$;
create function private.es02_select_knowledge_passages(uuid,uuid,text) returns jsonb language sql as $$select case when $3 like '%بتقدم%' then '{"ok":true,"sources":[{"id":"approved"}]}'::jsonb else '{"ok":false,"code":"NO_KNOWLEDGE"}'::jsonb end$$;
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text) returns jsonb language plpgsql as $$declare g jsonb:='{"branch_id":"11111111-1111-4111-8111-111111111111"}';selected_context jsonb;begin
selected_context:=private.es02_select_knowledge_passages(p_company_id,(g->>'branch_id')::uuid,p_question);
return selected_context;end$$;`);
const u='22222222-2222-4222-8222-222222222222',call=q=>`select public.whatsapp_retrieve_approved_knowledge('${u}','${u}','${u}','${q}')`;
assert.equal(JSON.parse(await sql(call('ما الخدمات'))).code,'NO_KNOWLEDGE');
await sql((await readFile('supabase/migrations/20261102184813_es02_services_query_expansion.sql','utf8')).replaceAll('\r\n','\n'));
assert.equal(JSON.parse(await sql(call('ما الخدمات'))).ok,true);assert.equal(JSON.parse(await sql(call('what are your services'))).ok,true);assert.equal(JSON.parse(await sql(call('unknownwidget'))).code,'NO_KNOWLEDGE');
console.log('PASS: expands service queries only after no match; unrelated queries stay unchanged');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
