import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPostgres} from '../account-deletion/postgres.mjs';

// Real PostgreSQL role/ACL tests with a minimal RLS and definer-RPC fixture.
// This exercises migration compatibility, not complete hosted WhatsApp journeys.
let db;
const tables=['whatsapp_conversations','whatsapp_messages'];
before(async()=>{
 db=await isolatedPostgres();
 await db.sql(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create table public.whatsapp_conversations(id integer primary key,visible boolean,state text);
 create table public.whatsapp_messages(id integer primary key,visible boolean,delivery_state text);
 alter table public.whatsapp_conversations enable row level security;
 alter table public.whatsapp_messages enable row level security;
 create policy conversation_read on public.whatsapp_conversations for select to authenticated using(visible);
 create policy message_read on public.whatsapp_messages for select to authenticated using(visible);
 grant all on public.whatsapp_conversations,public.whatsapp_messages to authenticated,service_role;
 insert into public.whatsapp_conversations values(1,true,'open'),(2,false,'open');
 insert into public.whatsapp_messages values(1,true,'sent'),(2,false,'sent');
 create function public.synthetic_control_conversation(p_id integer) returns void language plpgsql security definer set search_path='' as $$
 begin
  if p_id<>1 then raise exception 'FORBIDDEN' using errcode='42501';end if;
  update public.whatsapp_conversations set state='controlled' where id=p_id;
 end;$$;
 revoke all on function public.synthetic_control_conversation(integer) from public;
 grant execute on function public.synthetic_control_conversation(integer) to authenticated;
 `);
},{timeout:120000});
after(async()=>{await db?.close();},{timeout:30000});

test('legacy TRUNCATE bypasses RLS locally; migration removes excess privileges without changing rows or policies',async()=>{
 assert.equal(await db.sql('begin;set local role authenticated;truncate public.whatsapp_messages;select count(*) from public.whatsapp_messages;rollback;'),'0');
 const beforeRows=await db.sql('select json_agg(t order by id)::text from public.whatsapp_messages t');
 const beforePolicies=await db.sql("select json_agg(p order by tablename,policyname)::text from pg_policies p where schemaname='public'");
 const beforeService=await db.sql("select json_agg(array[has_table_privilege('service_role',oid,'SELECT'),has_table_privilege('service_role',oid,'INSERT'),has_table_privilege('service_role',oid,'UPDATE'),has_table_privilege('service_role',oid,'DELETE'),has_table_privilege('service_role',oid,'TRUNCATE')] order by relname)::text from pg_class where oid in ('public.whatsapp_messages'::regclass,'public.whatsapp_conversations'::regclass)");
 await db.file('supabase/migrations/20261029010107_security_whatsapp_client_privileges.sql');
 assert.equal(await db.sql('select json_agg(t order by id)::text from public.whatsapp_messages t'),beforeRows);
 assert.equal(await db.sql("select json_agg(p order by tablename,policyname)::text from pg_policies p where schemaname='public'"),beforePolicies);
 assert.equal(await db.sql("select json_agg(array[has_table_privilege('service_role',oid,'SELECT'),has_table_privilege('service_role',oid,'INSERT'),has_table_privilege('service_role',oid,'UPDATE'),has_table_privilege('service_role',oid,'DELETE'),has_table_privilege('service_role',oid,'TRUNCATE')] order by relname)::text from pg_class where oid in ('public.whatsapp_messages'::regclass,'public.whatsapp_conversations'::regclass)"),beforeService);
 for(const table of tables){
  assert.equal(await db.sql(`select has_table_privilege('authenticated','public.${table}','SELECT') and not has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`),'t');
  assert.equal(await db.sql(`select has_table_privilege('anon','public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`),'f');
  await assert.rejects(db.sql(`set role authenticated;truncate public.${table}`),/permission denied/);
  await assert.rejects(db.sql(`set role authenticated;delete from public.${table} where id=1`),/permission denied/);
 }
},{timeout:30000});

test('authenticated SELECT remains conversation scoped and anonymous reads stay denied',async()=>{
 for(const table of tables){
  assert.equal(await db.sql(`set role authenticated;select id from public.${table}`),'1');
  await assert.rejects(db.sql(`set role anon;select * from public.${table}`),/permission denied/);
 }
},{timeout:30000});

test('service writers and existing definer RPC execution remain available',async()=>{
 assert.equal(await db.sql("set role service_role;insert into public.whatsapp_messages values(3,false,'sent');update public.whatsapp_messages set delivery_state='delivered' where id=3;select delivery_state from public.whatsapp_messages where id=3"),'delivered');
 assert.equal(await db.sql("set role service_role;insert into public.whatsapp_conversations values(3,false,'open');update public.whatsapp_conversations set state='closed' where id=3;select state from public.whatsapp_conversations where id=3"),'closed');
 await db.sql('set role authenticated;select public.synthetic_control_conversation(1)');
 assert.equal(await db.sql('set role authenticated;select state from public.whatsapp_conversations where id=1'),'controlled');
 await assert.rejects(db.sql('set role authenticated;select public.synthetic_control_conversation(2)'),/FORBIDDEN/);
},{timeout:30000});
