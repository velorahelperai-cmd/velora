import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isolatedPostgres} from '../account-deletion/postgres.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=name=>readFile(`scripts/ci/fixtures/${name}.sql`,'utf8');
let db;
const claims=user=>`set role authenticated;set request.jwt.claims='${JSON.stringify({sub:id(user),session_id:id(user+10),role:'authenticated'})}';`;
const control=async(user,action,revision)=>JSON.parse(await db.sql(claims(user)+`select public.control_whatsapp_conversation('${id(41)}','${action}',${revision},null);`));
before(async()=>{
 db=await isolatedPostgres();
 await db.sql((await fixture('branch-chat-identities')).replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)));
 await db.sql(await fixture('branch-chat-data'));
 await db.sql(`alter table public.companies add name text;update public.companies set name='VELORA QA' where id='${id(21)}';
 alter table public.company_branches add name text;update public.company_branches set name=case when id='${id(31)}' then 'QA Main' else 'QA Branch 2' end where company_id='${id(21)}';
 insert into auth.users(id,email) values('${id(3)}','velorahelperai+meta-review@gmail.com');
 insert into auth.sessions values('${id(13)}','${id(3)}',now()-interval '1 minute',null);
 insert into private.app_session_activity values('${id(13)}','${id(3)}',null,now());
 insert into public.company_members values('${id(21)}','${id(3)}','owner','active',false);
 alter table public.whatsapp_conversations add status text default 'open',add automation_allowed boolean default true,add automation_generation integer default 1,add control_revision integer default 0,add control_actor_id uuid,add control_acted_at timestamptz,add customer_wa_id text default 'SYNTHETIC_QA';
 create table public.whatsapp_conversation_events(company_id uuid,conversation_id uuid,actor_user_id uuid,action text,revision integer,automation_generation integer);
 create table public.whatsapp_send_intents(client_op_id text,company_id uuid,conversation_id uuid,phone_number_id text,recipient_wa_id text,body text,sender_kind text,actor_user_id uuid,outcome text,expected_automation_generation integer,link_id uuid,link_generation bigint);
 alter table public.billing_subscriptions add id uuid,add plan_version_id uuid,add status text;
 create table private.billing_proven_entitlement_grants(id uuid,subscription_id uuid,company_id uuid,plan_version_id uuid,provider_environment text,applied_paid_through timestamptz);
 -- Fail-closed adapter for an unexercised receipt-verification dependency.
 -- No paid receipt is fabricated: tests exercise legacy/no-receipt and paid-without-receipt denial.
 create function private.billing_service_receipt_eligible(gid uuid) returns boolean language sql as $$select false$$;
 update private.synthetic_receipts set receipt=null;`);
 await db.sql('set check_function_bodies=off;'+await fixture('branch-isolation-catalog')+await fixture('branch-chat-catalog')+await fixture('branch-chat-rls-catalog')+await fixture('branch-chat-qa-catalog')+await fixture('branch-chat-qa-live-scope'));
 await db.sql(`revoke all on all functions in schema public,private,auth from public;
 grant execute on function public.control_whatsapp_conversation(uuid,text,integer,uuid),public.create_whatsapp_send_intent(text,uuid,text,text,text,integer,uuid,bigint),public.es02_read_branch_inbox(uuid,uuid,text,uuid,bigint,integer) to authenticated;`);
 await db.sql(await fixture('branch-chat-qa-rls'));
},{timeout:120000});
after(async()=>{await db?.close();},{timeout:30000});

test('branch read-only staff cannot take over, assign, resume, close or create a send intent',async()=>{
 assert.equal(await db.sql(`select count(*) from public.company_branches where company_id='${id(21)}' and name in ('QA Main','QA Branch 2');`),'2');
 await db.sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,inbox_sequence,assigned_to) values('${id(44)}','${id(21)}','wa21',4,null),('${id(45)}','${id(21)}','wa21',5,'${id(3)}');`);
 const read=JSON.parse(await db.sql(claims(1)+`select public.es02_read_branch_inbox('${id(21)}','${id(31)}','whatsapp');`));
 assert.deepEqual(read.conversations.map(c=>c.id),[id(45),id(44),id(41)]);
 const direct=JSON.parse(await db.sql(claims(1)+'select json_agg(id order by id) from public.whatsapp_conversations;'));
 assert.deepEqual(direct,[id(41),id(44),id(45)]); // Hides foreign company42 and same-company foreign account43.
 assert.deepEqual(JSON.parse(await db.sql(claims(1)+'select json_agg(id order by id) from public.whatsapp_messages;')),[id(51)]);
 for(const table of ['whatsapp_conversations','whatsapp_messages']){
  await assert.rejects(db.sql(claims(1)+`delete from public.${table};`),/permission denied/);
  await assert.rejects(db.sql(claims(1)+`update public.${table} set id=id;`),/permission denied/);
 }
 await db.sql(`update private.app_session_activity set expired_at=now() where user_id='${id(1)}';`);
 assert.equal(await db.sql(claims(1)+'select count(*) from public.whatsapp_conversations;'),'0');
 await db.sql(`update private.app_session_activity set expired_at=null where user_id='${id(1)}';`);
 const otherBranch=JSON.parse(await db.sql(claims(1)+`select public.es02_read_branch_inbox('${id(21)}','${id(33)}','whatsapp');`));assert.deepEqual(otherBranch,{ok:false,code:'FORBIDDEN'});
 for(const action of ['take_over','assign','resume','close'])assert.deepEqual(await control(1,action,0),{ok:false,code:'forbidden'});
 const send=JSON.parse(await db.sql(claims(1)+`select public.create_whatsapp_send_intent('qa-local-send-001','${id(41)}','Synthetic QA only','wa21');`));
 assert.deepEqual(send,{ok:false,code:'forbidden'});
 assert.equal(await db.sql('select count(*) from public.whatsapp_send_intents;'),'0');
 assert.equal(await db.sql('select count(*) from public.whatsapp_conversation_events;'),'0');
 assert.equal(await db.sql(`select control_revision from public.whatsapp_conversations where id='${id(41)}';`),'0');
},{timeout:30000});

test('local authorized owner takes over then resumes with revision conflict protection and audit events',async()=>{
 const taken=await control(3,'take_over',0);assert.equal(taken.ok,true);
 assert.equal(taken.conversation.status,'handed_over');assert.equal(taken.conversation.automation_allowed,false);assert.equal(taken.conversation.control_revision,1);assert.equal(taken.conversation.automation_generation,2);assert.equal(taken.conversation.assigned_to,id(1));
 const read=JSON.parse(await db.sql(claims(1)+`select public.es02_read_branch_inbox('${id(21)}','${id(31)}','whatsapp','${id(41)}');`));assert.equal(read.ok,true);assert.deepEqual(read.messages.map(m=>m.id),[id(51)]);
 const stale=await control(3,'resume',0);assert.equal(stale.code,'conflict');assert.equal(stale.conversation.control_revision,1);
 const resumed=await control(3,'resume',1);assert.equal(resumed.ok,true);assert.equal(resumed.conversation.status,'open');assert.equal(resumed.conversation.automation_allowed,true);assert.equal(resumed.conversation.control_revision,2);assert.equal(resumed.conversation.automation_generation,2);assert.equal(resumed.conversation.assigned_to,null);
 assert.equal(await db.sql('select string_agg(action,\',\' order by revision) from public.whatsapp_conversation_events;'),'take_over,resume');
},{timeout:30000});

test('billing paid history without receipt denies owner controls and send with no mutation',async()=>{
 await db.sql(`insert into public.billing_subscriptions(company_id,environment,paid_through) values('${id(21)}','live',now()-interval '1 day');`);
 assert.deepEqual(await control(3,'take_over',2),{ok:false,code:'forbidden'});
 const send=JSON.parse(await db.sql(claims(3)+`select public.create_whatsapp_send_intent('qa-local-send-002','${id(41)}','Synthetic QA only','wa21');`));
 assert.deepEqual(send,{ok:false,code:'forbidden'});
 assert.equal(await db.sql('select count(*) from public.whatsapp_send_intents;'),'0');
 assert.equal(await db.sql('select count(*) from public.whatsapp_conversation_events;'),'2');
 assert.equal(await db.sql(`select control_revision from public.whatsapp_conversations where id='${id(41)}';`),'2');
},{timeout:30000});
