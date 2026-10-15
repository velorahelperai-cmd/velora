// Native Smart + canonical Master creation, networkless owned tmpfs PostgreSQL.
// Preconfirmed Auth rows are offline facts, financial tables are empty schema
// dependencies. This never executes GoTrue, SMS, payments or providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {verify,session,lit} from '../instagram-connection/postgres.mjs';
const db='smart_master_creation_'+randomBytes(6).toString('hex');
const id=n=>`bb000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const verified=id(1),noPhone=id(2),sid=id(101),noPhoneSid=id(102);
const sql=async q=>{await verify();return session(q,{db}).done;};
const file=path=>sql(readFileSync(path,'utf8').replaceAll('\r\n','\n'));
const actor=user=>`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:user,session_id:user===verified?sid:noPhoneSid,role:'authenticated',exp:4102444800}))};`;
const create=(user,attempt,name='Composed business')=>sql(actor(user)+`select public.create_smart_business(${lit(user)},${lit(id(attempt))},${lit(name)},'retail','OM')`).then(JSON.parse);
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
await verify();await session(`create database ${db}`,{db:'postgres'}).done;
try{
 await sql(`create schema auth;create schema private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_change text not null default '',phone_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,raw_user_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default clock_timestamp(),not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema public,auth to authenticated;grant execute on function auth.jwt(),auth.uid() to authenticated;
 create function public.app_identity_is_verified() returns boolean language sql as $$select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)$$;
 create function public.is_platform_admin() returns boolean language sql as $$select false$$;
 do $$begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin;end if;end;$$;
 insert into auth.users(id,email_confirmed_at,phone,phone_confirmed_at) values(${lit(verified)},now(),'96890000001',now()),(${lit(noPhone)},now(),null,null);
 insert into auth.sessions(id,user_id,not_after) values(${lit(sid)},${lit(verified)},now()+interval '1 hour'),(${lit(noPhoneSid)},${lit(noPhone)},now()+interval '1 hour');`);
 for(const path of ['20261004070000_vel005a_companies.sql','20261008010000_vel_session_idle_policy.sql','20261008011000_vel_session_idle_clock_lock_fix.sql','20261014015904_master_personal_phone_authority.sql','20261013225246_vel_setup_drafts.sql'])await file('supabase/migrations/'+path);
 await sql(`create table private.billing_proven_entitlement_grants(id uuid primary key,company_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz);
 create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select false$$;
 create table public.billing_settlement_outcomes(id uuid primary key,company_id uuid,outcome text,provider_environment text);
 create table public.knowledge_sources(id uuid primary key,company_id uuid,kind text,storage_path text);`);
 for(const path of ['20261014015933_master_setup_draft_lifecycle.sql','20261014015934_master_business_authority.sql','20261014080108_smart_setup_foundation.sql','20261014080155_smart_profile_and_branch_attempts_v2.sql'])await file('supabase/migrations/'+path);
 eq((await create(noPhone,201)).code,'PHONE_REQUIRED');
 eq(await sql(`select count(*) from public.companies`),'0');
 const created=await create(verified,202);eq(created.ok,true);eq(created.data.company.version,1);
 eq(await sql(`select count(*) from private.company_creation_attempts where user_id=${lit(verified)} and company_id=${lit(created.data.companyId)}`),'1');
 eq(await sql(`select count(*) from public.company_setup_drafts where user_id=${lit(verified)} and company_id=${lit(created.data.companyId)} and state='active'`),'1');
 eq(await create(verified,202),created);
 eq((await create(verified,202,'Changed')).code,'OPERATION_CONFLICT');
 eq((await create(verified,203)).code,'FORBIDDEN');
 eq(await sql(`select count(*) from public.companies`),'1');
 await sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${lit(sid)}`);eq((await create(verified,202)).code,'FORBIDDEN');
 eq(await sql(`select has_function_privilege('authenticated','public.upsert_owner_company(text,text,text,text,text,text,text,text,text)','execute')`),'f');
 console.log(`SMART_MASTER_CREATION_NATIVE_PASS:${checks}; NO_SMS_OR_PAYMENT_EXECUTION`);
}finally{await session(`drop database if exists ${db} with(force)`,{db:'postgres'}).done;}
