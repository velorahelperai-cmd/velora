import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedPostgres} from '../account-deletion/postgres.mjs';

// Actual deployed invitation migrations; only surrounding Auth/session and setup
// boundaries are synthetic. No enterprise branch tables/functions are installed.
export async function installProductionTeamBaseline(db) {
 await db.sql(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema auth;revoke all on schema private from public;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create function public.app_session_is_valid() returns boolean language sql as $$select auth.uid() is not null and coalesce(current_setting('request.session_valid',true),'true')<>'false'$$;
 create function public.check_app_session(boolean) returns jsonb language sql as $$select jsonb_build_object('ok',public.app_session_is_valid())$$;
 create function private.write_admin_audit(uuid,uuid,text,jsonb,jsonb) returns void language sql as $$select$$;
 `);
 const companies=readFileSync('supabase/migrations/20261004070000_vel005a_companies.sql','utf8');
 await db.sql(companies.slice(0,companies.indexOf('alter table public.companies enable')));
 const grants=readFileSync('supabase/migrations/20261006120000_vel_access_management_01.sql','utf8');
 const start=grants.indexOf('create table if not exists public.company_member_grants');
 await db.sql(grants.slice(start,grants.indexOf('-- Conversion snapshot:',start)));
 await db.sql(`create function public.has_company_capability(cid uuid,cap text) returns boolean language sql security definer set search_path='' as $$select public.app_session_is_valid() and exists(select 1 from public.company_members m where m.company_id=cid and m.user_id=auth.uid() and m.status='active' and (m.role='owner' or exists(select 1 from public.company_member_grants g where g.company_id=cid and g.user_id=m.user_id and g.status='active' and cap=any(g.capabilities))))$$;`);
 await db.sql(`create table public.company_branches(id uuid primary key,company_id uuid references public.companies(id),name text,status text,is_primary boolean,unique(company_id,id));
 create table private.es02_branch_slot_rights(company_id uuid,branch_id uuid,employees integer);
 create function public.es02_read_owned_branch_setup(uid uuid,cid uuid,bid uuid) returns jsonb language sql as $$select jsonb_build_object('ok',public.app_session_is_valid() and auth.uid()=uid and exists(select 1 from public.company_members where company_id=cid and user_id=uid and role='owner' and status='active') and exists(select 1 from public.company_branches where id=bid and company_id=cid and status in ('setup','active')),'code','FORBIDDEN')$$;`);
 await db.sql(readFileSync('supabase/migrations/20261008070000_vel_staff_invitations.sql','utf8'));
 await db.sql('begin;'+readFileSync('supabase/migrations/20261011160000_vel_staff_invitation_recovery.sql','utf8')+'commit;');
}
export async function installTeamMigration(db) {
 await db.sql(readFileSync('supabase/migrations/20261028171538_es02_branch_team.sql','utf8'));
}
if (!process.env.VITEST) test('team migration installs on production authority without enterprise prerequisites', {timeout:120000}, async()=>{
 const db=await isolatedPostgres();
 try {
  await installProductionTeamBaseline(db);await installTeamMigration(db);
  assert.equal(await db.sql("select to_regprocedure('public.es02_invite_owned_branch_team(uuid,uuid,uuid,integer,uuid,text,text,text[],text)') is not null"),'t');
  assert.equal(await db.sql("select to_regclass('public.company_branch_accounts') is null and to_regclass('public.company_branch_grants') is null and not exists(select 1 from pg_proc where proname='enterprise_invite')"),'t');
 } finally {await db.close();}
});
