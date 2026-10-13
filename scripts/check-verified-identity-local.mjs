// Offline PostgreSQL fixture; pass the existing local PGlite module entry path.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.argv[2]) throw Error('Pass the absolute local @electric-sql/pglite entry path.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const actor='f1000000-0000-4000-8000-000000000001',other='f1000000-0000-4000-8000-000000000002';
const session='f3000000-0000-4000-8000-000000000001';
let assertions=0;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);assertions++;};
const file=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
async function role(name){await db.exec('set role '+name);}
async function path(value){await db.query("select set_config('request.path',$1,false)",[value]);}
async function rpc(){return db.query("select id from public.upsert_owner_company('Fixture')");}
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;
 create schema auth;create schema private;create schema storage;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth,storage to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz default clock_timestamp());
 insert into auth.users(id,email) values('${actor}','unverified@fixture.invalid'),('${other}','other@fixture.invalid');
 insert into auth.sessions(id,user_id) values('${session}','${actor}');`);
 await db.exec(await file('supabase/migrations/20261004070000_vel005a_companies.sql'));
 await db.exec(await file('supabase/migrations/20261004210000_vel007a_profiles.sql'));
 const overrides=await file('supabase/migrations/20261008020000_vel_authorization_scope_fixes.sql');
 await db.exec(overrides.slice(overrides.indexOf('create or replace function private.upsert_owner_company('),overrides.indexOf('create or replace function public.get_whatsapp_company_link(')));
 await db.exec(`revoke all on function public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text) from public,anon;
 grant execute on function public.upsert_selected_owner_company(uuid,text,text,text,text,text,text,text,text,text) to authenticated;
 create table public.identity_channel_fixture(id integer primary key,value text);
 create table storage.objects(id integer primary key,value text);
 alter table public.identity_channel_fixture enable row level security;alter table storage.objects enable row level security;
 grant select,insert,update on public.identity_channel_fixture,storage.objects to authenticated;
 create policy fixture on public.identity_channel_fixture to authenticated using(true) with check(true);
 create policy fixture on storage.objects to authenticated using(true) with check(true);
 insert into public.identity_channel_fixture values(1,'channel');insert into storage.objects values(1,'object');`);
 await db.exec(await file('supabase/migrations/20261008010000_vel_session_idle_policy.sql'));
 await db.exec("update private.app_session_settings set enabled=true");
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:session,role:'authenticated',user_metadata:{email_verified:true}})]);
 await role('authenticated');await path('/rpc/upsert_owner_company');
 await db.exec('select public.app_session_pre_request()');
 const company=(await rpc()).rows[0].id;
 eq((await db.query('select count(*)::int n from companies')).rows[0].n,1); // Baseline bypass.
 await db.exec('reset role');
 await db.exec(await file('supabase/migrations/20261013225228_vel_verified_identity_authority.sql'));
 await role('authenticated');
 await rejects(()=>db.exec('select public.app_session_pre_request()'),/APP_IDENTITY_UNVERIFIED/);
 await rejects(rpc,/APP_IDENTITY_UNVERIFIED/);
 await rejects(()=>db.query("select id from public.upsert_selected_owner_company($1,'Changed')",[company]),/APP_IDENTITY_UNVERIFIED/);
 for(const table of ['companies','company_members','identity_channel_fixture','storage.objects']) {
  eq((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
 }
 eq((await db.query("update companies set city='blocked' returning id")).rows.length,0);
 await rejects(()=>db.query("insert into identity_channel_fixture values(2,'blocked')"),/row-level security/);
 await rejects(()=>db.query("insert into storage.objects values(2,'blocked')"),/row-level security/);
 await path('/profiles');await db.exec('select public.app_session_pre_request()');
 await db.query("update profiles set full_name='Recovery name' where user_id=$1",[actor]);
 eq((await db.query('select full_name from profiles')).rows[0].full_name,'Recovery name');
 await path('/rpc/check_app_session');await db.exec('select public.app_session_pre_request()');
 eq((await db.query('select check_app_session(false) result')).rows[0].result.ok,true);
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1',[actor]);
 await role('authenticated');await path('/rpc/upsert_owner_company');await db.exec('select public.app_session_pre_request()');
 eq((await rpc()).rows[0].id,company);
 eq((await db.query("select id from upsert_selected_owner_company($1,'Verified fixture')",[company])).rows[0].id,company);
 eq((await db.query('select count(*)::int n from company_members')).rows[0].n,1);
 eq((await db.query('select count(*)::int n from identity_channel_fixture')).rows[0].n,1);
 eq((await db.query('select count(*)::int n from storage.objects')).rows[0].n,1);
 await db.exec('begin read only');await db.exec('select public.app_session_pre_request()');
 eq((await db.query('select count(*)::int n from companies')).rows[0].n,1);await db.exec('commit');
 await db.exec('reset role');
 await db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1',[other]);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:other,role:'authenticated'})]);
 await role('authenticated');
 eq((await db.query('select count(*)::int n from companies')).rows[0].n,0);
 await rejects(()=>db.query("select id from upsert_selected_owner_company($1,'Foreign owner')",[company]),/forbidden/);
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:session,role:'authenticated'})]);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[actor]);
 await role('authenticated');eq((await db.query('select app_identity_is_verified() result')).rows[0].result,false);
 await rejects(rpc,/APP_IDENTITY_UNVERIFIED/); // Same JWT cannot retain verification.
 await db.exec('reset role');await db.query('update auth.users set phone_confirmed_at=clock_timestamp() where id=$1',[actor]);
 await role('authenticated');eq((await db.query('select app_identity_is_verified() result')).rows[0].result,true);
 await db.exec('reset role');await db.query("update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where session_id=$1",[session]);
 await role('authenticated');await path('/profiles');
 await rejects(()=>db.exec('select public.app_session_pre_request()'),/APP_SESSION_EXPIRED/);
 eq((await db.query('select count(*)::int n from companies')).rows[0].n,0);
 await db.exec('reset role');
 eq((await db.query("select has_function_privilege('anon','public.app_identity_is_verified()','EXECUTE') allowed")).rows[0].allowed,false);
 eq((await db.query("select has_function_privilege('authenticated','private.upsert_owner_company(text,text,text,text,text,text,text,text,text)','EXECUTE') allowed")).rows[0].allowed,false);
 eq((await db.query("select count(*)::int n from pg_policies where policyname='velora_verified_identity' and tablename='profiles'")).rows[0].n,0);
 eq((await db.query("select rolconfig from pg_roles where rolname='authenticator'")).rows[0].rolconfig.includes('pgrst.db_pre_request=public.app_session_pre_request'),true);
 console.log(`Verified identity PostgreSQL fixture passed: ${assertions} assertions.`);
} catch(error) {console.error(error.message);process.exitCode=1;} finally {await db.close();}
