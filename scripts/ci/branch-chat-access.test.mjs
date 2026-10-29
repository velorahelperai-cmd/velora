import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isolatedPostgres} from '../account-deletion/postgres.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const fixture=name=>readFile(`scripts/ci/fixtures/${name}.sql`,'utf8');
const claims=(user=1,session=11)=>`set role authenticated;set request.jwt.claims='${JSON.stringify({sub:id(user),session_id:id(session),role:'authenticated'})}';`;
const inbox=async({user=1,session=11,company=21,branch=31,channel='whatsapp',conversation=null}={})=>JSON.parse(await db.sql(claims(user,session)+`select public.es02_read_branch_inbox('${id(company)}','${id(branch)}','${channel}',${conversation?`'${id(conversation)}'`:'null'});`));
before(async()=>{
 db=await isolatedPostgres();
 await db.sql((await fixture('branch-chat-identities')).replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)));
 await db.sql(await fixture('branch-chat-data'));
 await db.sql('set check_function_bodies=off;'+await fixture('branch-isolation-catalog')+await fixture('branch-chat-catalog')+await fixture('branch-chat-rls-catalog'));
 await db.sql(`revoke all on all functions in schema public,private,auth from public;grant execute on function public.es02_read_branch_inbox(uuid,uuid,text,uuid,bigint,integer) to authenticated;
 create function public.synthetic_company_gate(cid uuid) returns boolean language sql security definer set search_path='' as $$select private.billing_chat_access(cid,'whatsapp')$$;
 revoke all on function public.synthetic_company_gate(uuid) from public;grant execute on function public.synthetic_company_gate(uuid) to authenticated;`);
 // Red baseline: exact Production inbox refuses otherwise-authorized branch staff.
 assert.deepEqual(await inbox(),{ok:false,code:'FORBIDDEN'});
 await db.sql(`alter table public.whatsapp_conversations enable row level security;alter table public.whatsapp_messages enable row level security;
 grant select on public.whatsapp_conversations,public.whatsapp_messages to authenticated;
 grant execute on function private.conversation_readable(uuid,uuid),private.billing_chat_access(uuid,text),private.billing_history_account_allowed(uuid,text,text),public.app_session_is_valid() to authenticated;
 create policy whatsapp_conversations_select on public.whatsapp_conversations for select to authenticated using(private.conversation_readable(company_id,assigned_to) and private.billing_chat_access(company_id,'whatsapp') and private.billing_history_account_allowed(company_id,'whatsapp',phone_number_id));
 create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated using(exists(select 1 from public.whatsapp_conversations c where c.id=whatsapp_messages.conversation_id and c.company_id=whatsapp_messages.company_id and private.conversation_readable(c.company_id,c.assigned_to)));
 create policy session_guard on public.whatsapp_conversations as restrictive for all to authenticated using(public.app_session_is_valid());
 create policy session_guard on public.whatsapp_messages as restrictive for all to authenticated using(public.app_session_is_valid());`);
 await db.file('supabase/migrations/20261029014606_branch_staff_chat_scope.sql');
},{timeout:120000});
after(async()=>{await db?.close();},{timeout:30000});

test('full inbox allows both channels list, selected conversation and messages for each isolated identity',async()=>{
 for(const [user,session,company,branch,conversation] of [[1,11,21,31,41],[2,12,22,32,42]])for(const channel of ['whatsapp','instagram']){
  const list=await inbox({user,session,company,branch,channel});assert.equal(list.ok,true);assert.deepEqual(list.conversations.map(c=>c.id),[id(conversation)]);
  const selected=await inbox({user,session,company,branch,channel,conversation});assert.equal(selected.ok,true);assert.equal(selected.conversation.id,id(conversation));assert.deepEqual(selected.messages.map(m=>m.id),[id(conversation+10)]);
 }
},{timeout:30000});

test('full inbox rejects foreign company, branch, session and account conversations',async()=>{
 for(const channel of ['whatsapp','instagram']){
  for(const args of [{company:22,branch:32},{branch:32},{branch:33},{session:12}])assert.equal((await inbox({...args,channel})).ok,false);
  for(const conversation of [42,43])assert.deepEqual(await inbox({channel,conversation}),{ok:false,code:'NOT_FOUND'});
 }
},{timeout:30000});

test('revoked membership, grant, session and branch link fail closed with recovery',async()=>{
 for(const [disable,restore] of [
  ["update public.company_members set status='inactive' where user_id='"+id(1)+"'","update public.company_members set status='branch_active' where user_id='"+id(1)+"'"],
  ["update private.es02_branch_member_grants set status='revoked' where user_id='"+id(1)+"'","update private.es02_branch_member_grants set status='active' where user_id='"+id(1)+"'"],
  [`insert into private.master_account_session_revocations values('${id(1)}',clock_timestamp())`,'delete from private.master_account_session_revocations'],
  [`update private.es02_b3_connection_links set revoked_at=clock_timestamp() where company_id='${id(21)}'`,'update private.es02_b3_connection_links set revoked_at=null'],
  [`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where user_id='${id(1)}'`,`update private.app_session_activity set last_activity_at=clock_timestamp(),expired_at=null where user_id='${id(1)}'`]
 ]){
  await db.sql(disable);for(const channel of ['whatsapp','instagram'])assert.equal((await inbox({channel})).ok,false);
  await db.sql(restore);assert.equal((await inbox()).ok,true);
 }
},{timeout:30000});

test('actual billing policy denies expired history and mismatched Instagram history binding',async()=>{
 await db.sql("update private.synthetic_receipts set receipt=jsonb_build_object('expiredAt',clock_timestamp()-interval '31 days');");
 for(const channel of ['whatsapp','instagram'])assert.equal((await inbox({channel})).ok,false);
 await db.sql("update private.synthetic_receipts set receipt=jsonb_build_object('expiredAt',clock_timestamp()+interval '1 day');");
 await db.sql(`update private.instagram_company_generations set bound_account_id='foreign' where company_id='${id(21)}';`);
 assert.equal((await inbox({channel:'instagram'})).ok,false);
 await db.sql(`update private.instagram_company_generations set bound_account_id='ig21' where company_id='${id(21)}';`);
 assert.equal((await inbox({channel:'instagram'})).ok,true);
 assert.equal(await db.sql(claims()+`select public.synthetic_company_gate('${id(21)}');`),'f');
},{timeout:30000});

test('RLS permits all assignments only in granted branch and preserves legacy assigned_only',async()=>{
 await db.sql(`insert into public.whatsapp_conversations values('${id(44)}','${id(21)}','wa21',4,null,null),('${id(45)}','${id(21)}','wa21',5,'${id(2)}','${id(2)}');
 insert into private.instagram_conversations select id,company_id,'ig21',inbox_sequence,assigned_to,assigned_user_id from public.whatsapp_conversations where id in ('${id(44)}','${id(45)}');`);
 for(const channel of ['whatsapp','instagram']){
  assert.deepEqual((await inbox({channel})).conversations.map(c=>c.id),[id(45),id(44),id(41)]);
  for(const conversation of [44,45])assert.equal((await inbox({channel,conversation})).ok,true);
 }
 const rows=()=>db.sql(claims()+`select coalesce(json_agg(id order by id),'[]') from public.whatsapp_conversations;`);
 assert.deepEqual(JSON.parse(await rows()),[id(41),id(44),id(45)]);
 assert.deepEqual(JSON.parse(await db.sql(claims()+`select json_agg(id) from public.whatsapp_messages;`)),[id(51)]);
 assert.equal(await db.sql(claims(2,12)+`select count(*) from public.whatsapp_conversations where company_id='${id(21)}';`),'0');
 assert.equal(await db.sql(claims(1,12)+`select count(*) from public.whatsapp_conversations;`),'0');
 for(const [disable,restore] of [
  [`update private.es02_branch_member_grants set status='revoked' where user_id='${id(1)}'`,`update private.es02_branch_member_grants set status='active' where user_id='${id(1)}'`],
  [`update private.es02_b3_connection_links set revoked_at=clock_timestamp() where company_id='${id(21)}'`,'update private.es02_b3_connection_links set revoked_at=null'],
  [`update public.company_members set status='inactive' where user_id='${id(1)}'`,`update public.company_members set status='branch_active' where user_id='${id(1)}'`]
 ]){await db.sql(disable);assert.deepEqual(JSON.parse(await rows()),[]);await db.sql(restore);}
 for(const command of ["insert into public.whatsapp_conversations(id) values(gen_random_uuid())","update public.whatsapp_conversations set assigned_to=null","delete from public.whatsapp_conversations","truncate public.whatsapp_conversations","insert into public.whatsapp_messages(id) values(gen_random_uuid())","update public.whatsapp_messages set arrival_sequence=0","delete from public.whatsapp_messages","truncate public.whatsapp_messages"]){await assert.rejects(db.sql(claims()+command),/permission denied/);}
 await assert.rejects(db.sql(claims()+'select * from private.instagram_conversations'),/permission denied/);
 await db.sql(`update public.company_members set status='active',es02_branch_only=false where user_id='${id(1)}';insert into public.company_member_grants values('${id(21)}','${id(1)}',array['wa.conversations.read'],'active',null,'assigned_only');`);
 assert.deepEqual(JSON.parse(await rows()),[id(41)]);
 await db.sql(`delete from public.company_member_grants;update public.company_members set status='branch_active',es02_branch_only=true where user_id='${id(1)}';`);
},{timeout:30000});

test('real lifecycle policy preserves unpaid-history and reconnection checks behind receipt adapter',async()=>{
 await db.sql('update private.synthetic_receipts set receipt=null;');
 assert.equal((await inbox()).ok,true);
 await db.sql(`insert into public.billing_subscriptions values('${id(21)}','live',now());`);
 assert.equal((await inbox()).ok,false);
 await db.sql(`delete from public.billing_subscriptions;update private.synthetic_receipts set receipt=jsonb_build_object('expiredAt',now()+interval '1 day');insert into private.billing_expiry_episodes values('${id(21)}',now());`);
 assert.equal((await inbox()).ok,true);
 await db.sql(`update public.whatsapp_company_links set authorization_status='revoked' where company_id='${id(21)}';`);
 assert.equal((await inbox()).ok,false);
 await db.sql(`update public.whatsapp_company_links set authorization_status='active' where company_id='${id(21)}';update private.instagram_company_links set authorization_expires_at=now()-interval '1 minute' where company_id='${id(21)}';`);
 assert.equal((await inbox({channel:'instagram'})).ok,false);
 await db.sql(`update private.instagram_company_links set authorization_expires_at=now()+interval '1 day' where company_id='${id(21)}';`);
 assert.equal((await inbox({channel:'instagram'})).ok,true);
},{timeout:30000});
