// Native PostgreSQL projection contract tests. Auth/capability dependencies are
// explicit doubles; this does not prove the production broker or billing policy.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
if(process.env.WA_MESSAGE_EVIDENCE_TESTS!=='1')throw Error('OPT_IN_REQUIRED');
const container='velora-f48-billing-null';
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const info=JSON.parse(run(['inspect',container]))[0];
if(info.Config.Labels['velora.task']!=='f48-billing-null'||info.HostConfig.NetworkMode!=='none'||Object.keys(info.HostConfig.PortBindings??{}).length)throw Error('WRONG_ISOLATE');
const database='f50_evidence_'+Date.now();
run(['exec','-u','postgres',container,'createdb','-U','postgres',database]);
const sql=s=>run(['exec','-i','-u','postgres',container,'psql','-X','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],s);
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [u,s,c,l,conv,msg,intent]=[1,2,3,4,5,6,7].map(id);
sql(`create schema auth;create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
create function public.has_company_capability(uuid,text) returns boolean language sql as $$select current_setting('fixture.capability',true)='yes'$$;
create table auth.users(id uuid,email_confirmed_at timestamptz,phone_confirmed_at timestamptz);
create table auth.sessions(id uuid,user_id uuid);
create table private.app_session_activity(session_id uuid,user_id uuid,expired_at timestamptz,last_activity_at timestamptz);
create table public.companies(id uuid,status text);
create table public.company_members(company_id uuid,user_id uuid,role text,status text);
create table public.whatsapp_company_links(id uuid,company_id uuid,status text,generation bigint,provider_phone_number_id text,inbound_tested_at timestamptz,outbound_tested_at timestamptz);
create table public.whatsapp_messages(id uuid,company_id uuid,conversation_id uuid,wa_message_id text,direction text,delivery_state text,received_at timestamptz);
create table public.whatsapp_send_intents(id uuid,company_id uuid,conversation_id uuid,message_id uuid,wa_message_id text,phone_number_id text,recipient_wa_id text,link_id uuid,link_generation bigint,outcome text,attempt_started_at timestamptz);
create table public.whatsapp_delivery_statuses(company_id uuid,message_id uuid,wa_message_id text,phone_number_id text,recipient_wa_id text,occurred_at timestamptz,status text,link_state text);
insert into auth.users values('${u}',now(),null);insert into auth.sessions values('${s}','${u}');
insert into private.app_session_activity values('${s}','${u}',null,now()-interval '1 minute');
insert into public.companies values('${c}','active');insert into public.company_members values('${c}','${u}','owner','active');
insert into public.whatsapp_company_links values('${l}','${c}','verified',1,'phone',null,null);
insert into public.whatsapp_messages values('${msg}','${c}','${conv}','provider-mid','outbound','delivered',now()-interval '2 minutes');
insert into public.whatsapp_messages values('${id(8)}','${c}','${conv}','inbound-mid','inbound',null,now()-interval '1 minute');
insert into public.whatsapp_send_intents values('${intent}','${c}','${conv}','${msg}','provider-mid','phone','recipient','${l}',1,'accepted',now()-interval '3 minutes');
insert into public.whatsapp_delivery_statuses values('${c}','${msg}','provider-mid','phone','recipient',now()-interval '2 minutes','delivered','applied');`);
sql(readFileSync('supabase/migrations/20261102072318_whatsapp_message_delivery_evidence.sql','utf8'));
const auth=`set local role authenticated;set local "request.jwt.claim.sub"='${u}';set local "request.jwt.claims"='${JSON.stringify({sub:u,session_id:s})}';set local "fixture.capability"='yes';`;
let passed=0;
function test(name,patch,expected,{company=c,link=l,claims=''}={}){
 const result=JSON.parse(sql(`begin;${patch}${auth}${claims}select public.whatsapp_read_message_evidence('${company}','${link}');rollback;`));
 if(!expected(result))throw Error(name+':'+JSON.stringify(result));passed++;console.log('PASS '+name);
}
test('current-link-delivery-and-company-inbound','',r=>r.ok&&r.current_link_delivered_at&&r.latest_company_inbound_at);
for(const [name,patch] of [
 ['old-generation',`update public.whatsapp_send_intents set link_generation=2;`],
 ['wrong-phone',`update public.whatsapp_send_intents set phone_number_id='other';`],
 ['wrong-recipient',`update public.whatsapp_delivery_statuses set recipient_wa_id='other';`],
 ['acceptance-not-delivery',`update public.whatsapp_messages set delivery_state='accepted';`],
 ['unmatched-status',`update public.whatsapp_delivery_statuses set link_state='unmatched';`],
 ['future-status',`update public.whatsapp_delivery_statuses set occurred_at=now()+interval '1 day';`],
 ['unaccepted-intent',`update public.whatsapp_send_intents set outcome='unknown';`],
 ['foreign-inbound',`update public.whatsapp_messages set company_id='${id(99)}' where direction='inbound';`],
])test(name,patch,r=>r.ok&&(name==='foreign-inbound'?r.latest_company_inbound_at===null:r.current_link_delivered_at===null));
for(const [name,patch] of [
 ['staff-denied',"update public.company_members set role='staff';"],
 ['inactive-member',"update public.company_members set status='inactive';"],
 ['suspended-company',"update public.companies set status='suspended';"],
 ['expired-session',"update private.app_session_activity set expired_at=now();"],
 ['idle-session',"update private.app_session_activity set last_activity_at=now()-interval '3 hours';"],
])test(name,patch,r=>!r.ok&&r.code==='forbidden');
test('capability-denied','',r=>!r.ok&&r.code==='forbidden',{claims:"set local \"fixture.capability\"='no';"});
test('foreign-company','',r=>!r.ok&&r.code==='forbidden',{company:id(99)});
test('wrong-link','',r=>!r.ok&&r.code==='scope_changed',{link:id(99)});
test('disconnected-link',"update public.whatsapp_company_links set status='disconnected';",r=>!r.ok&&r.code==='scope_changed');
const safe=JSON.parse(sql(`select jsonb_build_object('anon',has_function_privilege('anon','public.whatsapp_read_message_evidence(uuid,uuid)','EXECUTE'),'service',has_function_privilege('service_role','public.whatsapp_read_message_evidence(uuid,uuid)','EXECUTE'),'untouched',not exists(select 1 from public.whatsapp_company_links where inbound_tested_at is not null or outbound_tested_at is not null));`));
if(safe.anon||safe.service||!safe.untouched)throw Error('ACL_OR_LEGACY_MARKERS');passed++;
console.log(JSON.stringify({passed,database,dependencies:'explicit auth/capability doubles; native SQL projection and ACL',providerCalls:0}));
