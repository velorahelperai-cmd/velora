import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPostgres} from '../account-deletion/postgres.mjs';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const run=(user=1,session=11,company=21,branch=31,cap='wa.conversations.read')=>`set role authenticated;set request.jwt.claims='${JSON.stringify({sub:id(user),session_id:id(session),role:'authenticated'})}';select public.es02_has_branch_capability('${id(company)}','${id(branch)}','${cap}');`;
// Real captured authorization/session bodies. Only the surrounding table shape
// and claims are synthetic; this does not test token signatures or GoTrue/HTTP.
before(async()=>{
 db=await isolatedPostgres();
 await db.sql(`create role authenticated;create schema auth;create schema private;
 create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
 create table private.ad_operations(target uuid,fenced boolean);
 create table private.app_session_settings(singleton boolean,enabled boolean);
 create table private.app_session_activity(session_id uuid,user_id uuid,expired_at timestamptz,last_activity_at timestamptz);
 create table private.master_account_session_revocations(user_id uuid,revoked_before timestamptz);
 create table private.master_identity_session_boundaries(user_id uuid,survivor_session_id uuid,revoked_before timestamptz);
 create table public.companies(id uuid primary key,status text);
 create table public.company_branches(id uuid primary key,company_id uuid,status text);
 create table public.company_members(company_id uuid,user_id uuid,role text,status text,es02_branch_only boolean);
 create table private.es02_branch_member_grants(company_id uuid,user_id uuid,branch_id uuid,status text,capabilities text[]);
 insert into auth.users(id) values('${id(1)}'),('${id(2)}');
 insert into auth.sessions values('${id(11)}','${id(1)}',clock_timestamp()-interval '1 minute',null),('${id(12)}','${id(2)}',clock_timestamp()-interval '1 minute',null);
 insert into private.app_session_settings values(true,true);
 insert into private.app_session_activity values('${id(11)}','${id(1)}',null,clock_timestamp()),('${id(12)}','${id(2)}',null,clock_timestamp());
 insert into public.companies values('${id(21)}','active'),('${id(22)}','active');
 insert into public.company_branches values('${id(31)}','${id(21)}','active'),('${id(32)}','${id(22)}','active'),('${id(33)}','${id(21)}','active');
 insert into public.company_members values('${id(21)}','${id(1)}','staff','branch_active',true),('${id(22)}','${id(2)}','staff','branch_active',true);
 insert into private.es02_branch_member_grants values('${id(21)}','${id(1)}','${id(31)}','active',array['wa.conversations.read']),('${id(22)}','${id(2)}','${id(32)}','active',array['wa.conversations.read']);
 `);
 await db.sql('set check_function_bodies=off;'+await (await import('node:fs/promises')).readFile('scripts/ci/fixtures/branch-isolation-catalog.sql','utf8'));
 await db.sql(`revoke all on all functions in schema public,private,auth from public;grant execute on function public.es02_has_branch_capability(uuid,uuid,text) to authenticated;
 create function public.synthetic_billing_probe(cid uuid) returns boolean language sql security definer set search_path='' as $$select private.billing_chat_access(cid,'whatsapp')$$;
 revoke all on function public.synthetic_billing_probe(uuid) from public;grant execute on function public.synthetic_billing_probe(uuid) to authenticated;`);
},{timeout:120000});
after(async()=>{await db?.close();},{timeout:30000});

test('actual production predicates allow each account only its company, branch and granted capability',async()=>{
 assert.equal(await db.sql(run()),'t');assert.equal(await db.sql(run(2,12,22,32)),'t');
 for(const args of [[1,11,22,32],[2,12,21,31],[1,11,21,32],[1,11,22,31],[1,11,21,33],[1,11,21,31,'ig.conversations.read']])assert.equal(await db.sql(run(...args)),'f');
},{timeout:30000});

test('actual native session and deletion predicates reject foreign session, revoked and idle identities',async()=>{
 assert.equal(await db.sql(run(1,12)),'f');
 await db.sql(`insert into private.master_account_session_revocations values('${id(1)}',clock_timestamp());`);
 assert.equal(await db.sql(run()),'f');
 await db.sql('delete from private.master_account_session_revocations;');
 await db.sql(`insert into private.ad_operations values('${id(1)}',true);`);
 assert.equal(await db.sql(run()),'f');
 await db.sql('delete from private.ad_operations;');
 await db.sql(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where user_id='${id(1)}';`);
 assert.equal(await db.sql(run()),'f');
 await db.sql(`update private.app_session_activity set last_activity_at=clock_timestamp() where user_id='${id(1)}';`);
 assert.equal(await db.sql(run()),'t');
},{timeout:30000});

test('actual branch revocation closes capability while billing gate exposes the remaining branch-staff blocker',async()=>{
 await db.sql(`update private.es02_branch_member_grants set status='revoked' where user_id='${id(1)}';`);
 assert.equal(await db.sql(run()),'f');
 await db.sql(`update private.es02_branch_member_grants set status='active' where user_id='${id(1)}';`);
 assert.equal(await db.sql(run()),'t');
 // Intentional known-failure evidence: the real billing helper excludes
 // branch_active before entering its unavailable lifecycle dependency graph.
 const probe=run().replace(/select public.es02_has_branch_capability[^;]+;/,`select public.synthetic_billing_probe('${id(21)}');`);
 assert.equal(await db.sql(probe),'f');
},{timeout:30000});
