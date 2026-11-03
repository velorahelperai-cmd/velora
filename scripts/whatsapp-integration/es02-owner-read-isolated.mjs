import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name='velora-owner-read-'+randomUUID().slice(0,8);let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',n=>n?reject(Error(err)):resolve(out.trim()));p.stdin.end(q);});}
const company='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',staff='33333333-3333-4333-8333-333333333333';
try{id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=owner-read','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();for(let i=0;i<60;i++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
await sql(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
create table public.company_members(company_id uuid,user_id uuid,role text,status text);
create table public.whatsapp_company_links(company_id uuid,status text,provider_phone_number_id text);
create table private.fixture_active(company_id uuid,active boolean);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function public.lifecycle_native_has_company_capability(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.company_members where company_id=$1 and user_id=auth.uid() and status='active')$$;
create function private.billing_chat_access(uuid,text) returns boolean language sql stable as $$select false$$;
create function private.billing_chat_send(uuid) returns boolean language sql stable as $$select false$$;
create function private.es02_b3_current_binding(uuid,uuid,uuid,text) returns jsonb language plpgsql security definer set search_path='' as $body$ begin
${Array.from({length:10},()=>`perform 1 from private.fixture_active where company_id=$2 for update;`).join('\n')}
return jsonb_build_object('ok',(select active from private.fixture_active where company_id=$2));end;$body$;
create function private.es02_active_whatsapp_ingress(p_company uuid,p_phone text) returns boolean language plpgsql security definer set search_path='' as $body$ declare b jsonb;begin b:=private.es02_b3_current_binding(null,p_company,null,'whatsapp');return p_phone='123' and b->>'ok'='true';end;$body$;
create function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean language sql stable security definer set search_path='' as $body$select public.lifecycle_native_has_company_capability(p_company_id,p_capability)
 and case when p_capability like 'wa.conversations.%' then private.billing_chat_access(p_company_id,'whatsapp') and (p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id))
 when p_capability like 'ig.conversations.%' then private.billing_chat_access(p_company_id,'instagram') and (p_capability='ig.conversations.read' or private.billing_chat_send(p_company_id)) else true end$body$;
insert into public.company_members values('${company}','${owner}','owner','active'),('${company}','${staff}','staff','active');
insert into public.whatsapp_company_links values('${company}','verified','123');insert into private.fixture_active values('${company}',true);`);
const signatures=['private.es02_b3_current_binding(uuid,uuid,uuid,text)','private.es02_active_whatsapp_ingress(uuid,text)','public.has_company_capability(uuid,text)'];
const pins=['85e62cef7b2056486dc6ed8ccf013129','43582810265a8f462d8c3d8574fdb6c4','647e9619f8273a0340772aa61bc5fc82'];
let migration=await readFile('supabase/migrations/20261102193756_es02_owner_whatsapp_read_access.sql','utf8');
for(let i=0;i<pins.length;i++)migration=migration.replace(pins[i],await sql(`select md5(pg_get_functiondef('${signatures[i]}'::regprocedure))`));
await sql(migration);
const can=(actor,cap)=>sql(`set test.actor='${actor}';select public.has_company_capability('${company}','${cap}')`);
assert.equal(await can(owner,'wa.conversations.read'),'t');assert.equal(await can(staff,'wa.conversations.read'),'f');
assert.equal(await can(owner,'wa.conversations.reply'),'f');assert.equal(await can(owner,'ig.conversations.read'),'f');
await sql('update private.fixture_active set active=false');assert.equal(await can(owner,'wa.conversations.read'),'f');
assert.equal(await sql("select has_function_privilege('authenticated','private.es02_active_whatsapp_readonly(uuid,text)','execute')"),'f');
console.log('PASS: owner read only, staff/send/Instagram denied, inactive entitlement denied, internal helper restricted');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
