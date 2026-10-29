import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPostgres} from '../account-deletion/postgres.mjs';

// Disposable, network-isolated metadata fixture. Membership/capability/session
// helpers below are explicit doubles; this verifies actual PostgreSQL privileges
// and the current receipt policy, not a complete Production tenant journey.
let db;
const company='10000000-0000-4000-8000-000000000001';
before(async()=>{
 db=await isolatedPostgres();
 await db.sql(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema private;
 create function private.is_active_company_member(uuid) returns boolean language sql stable as $$select $1='${company}'::uuid$$;
 create function public.lifecycle_native_has_company_capability(uuid,text) returns boolean language sql stable as $$select $1='${company}'::uuid and $2='wa.conversations.read'$$;
 create function private.can_admin_company(uuid,text) returns boolean language sql stable as $$select false$$;
 create table public.whatsapp_delivery_statuses(id uuid primary key,company_id uuid,phone_number_id text,wa_message_id text,status text,recipient_wa_id text,occurred_at timestamptz,created_at timestamptz,message_id uuid,link_state text);
 alter table public.whatsapp_delivery_statuses enable row level security;
 create policy whatsapp_delivery_statuses_select on public.whatsapp_delivery_statuses for select to authenticated using ((private.is_active_company_member(company_id) and lifecycle_native_has_company_capability(company_id,'wa.conversations.read')) or private.can_admin_company(company_id,'wa.conversations.read'));
 grant all on public.whatsapp_delivery_statuses to authenticated,service_role;
 insert into public.whatsapp_delivery_statuses(id,company_id,recipient_wa_id) values ('10000000-0000-4000-8000-000000000011','${company}','assigned-recipient'),('10000000-0000-4000-8000-000000000012','${company}','other-staff-recipient');
 create table public.whatsapp_messages(id uuid primary key,delivery_state text,visible boolean);
 alter table public.whatsapp_messages enable row level security;
 create policy message_projection on public.whatsapp_messages for select to authenticated using(visible);
 grant select on public.whatsapp_messages to authenticated;
 insert into public.whatsapp_messages values ('10000000-0000-4000-8000-000000000021','delivered',true),('10000000-0000-4000-8000-000000000022','read',false);
 `);
}, {timeout:120000});
after(async()=>{await db?.close();},{timeout:30000});

test('receipt policy exposes unrelated metadata before fix; raw client reads are denied after revocation',async()=>{
 assert.equal(await db.sql('set role authenticated;select count(*) from public.whatsapp_delivery_statuses'),'2');
 const beforeRows=await db.sql('select json_agg(t order by id)::text from public.whatsapp_delivery_statuses t');
 const serviceAcl=await db.sql("select array[has_table_privilege('service_role','public.whatsapp_delivery_statuses','SELECT'),has_table_privilege('service_role','public.whatsapp_delivery_statuses','INSERT'),has_table_privilege('service_role','public.whatsapp_delivery_statuses','UPDATE')]");
 await db.file('supabase/migrations/20261029004627_security_delivery_status_privileges.sql');
 assert.equal(await db.sql('select json_agg(t order by id)::text from public.whatsapp_delivery_statuses t'),beforeRows);
 assert.equal(await db.sql("select array[has_table_privilege('service_role','public.whatsapp_delivery_statuses','SELECT'),has_table_privilege('service_role','public.whatsapp_delivery_statuses','INSERT'),has_table_privilege('service_role','public.whatsapp_delivery_statuses','UPDATE')]"),serviceAcl);
 for(const role of ['anon','authenticated']){
  await assert.rejects(db.sql(`set role ${role};select * from public.whatsapp_delivery_statuses`),/permission denied/);
  assert.equal(await db.sql(`select has_table_privilege('${role}','public.whatsapp_delivery_statuses','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`),'f');
 }
},{timeout:30000});

test('trusted service writes and status-only receipt reconciliation still work',async()=>{
 assert.equal(await db.sql(`set role service_role;insert into public.whatsapp_delivery_statuses(id,company_id,status) values ('10000000-0000-4000-8000-000000000013','${company}','sent');update public.whatsapp_delivery_statuses set status='delivered' where id='10000000-0000-4000-8000-000000000013';select status from public.whatsapp_delivery_statuses where id='10000000-0000-4000-8000-000000000013'`),'delivered');
},{timeout:30000});

test('authorized message delivery projection remains readable and hidden messages stay denied',async()=>{
 assert.equal(await db.sql('set role authenticated;select delivery_state from public.whatsapp_messages'),'delivered');
},{timeout:30000});

