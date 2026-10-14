import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
// @ts-expect-error guarded owned disposable PostgreSQL port, never a cloud target
import {verify,session,lit} from '../../../scripts/instagram-connection/postgres.mjs';
const db='master_business_'+randomBytes(6).toString('hex');
const user='a1000000-0000-4000-8000-000000000001',sid='a3000000-0000-4000-8000-000000000001';
const other='a1000000-0000-4000-8000-000000000002';
const key=(n:number)=>`a4000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const business={name:'Store',type:'store',replyLanguage:'both',country:'OM',city:'',hours:'',contactPhone:'',contactEmail:''};
const sql=async(q:string)=>{await verify();return session(q,{db}).done;};
async function actor(q:string,uid=user,s=sid){return JSON.parse(await sql(`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:uid,session_id:s,role:'authenticated'}))};${q}`));}
const create=(n:number,patch={})=>actor(`select public.create_owner_company_attempt('${user}','${key(n)}',${lit(JSON.stringify({...business,...patch}))}::jsonb);`);
beforeAll(async()=>{
 await verify();await session(`create database ${db}`,{db:'postgres'}).done;
 await sql(`create schema auth;create schema private;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_change text not null default '',phone_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,raw_user_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default clock_timestamp(),not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema public,auth to authenticated;grant execute on function auth.jwt(),auth.uid() to authenticated;
 create function public.app_identity_is_verified() returns boolean language sql as $$select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)$$;
 create function public.is_platform_admin() returns boolean language sql as $$select false$$;
 do $$begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin;end if;end;$$;
 insert into auth.users(id,email_confirmed_at,phone,phone_confirmed_at) values('${user}',now(),'96890000001',now()),('${other}',now(),null,null);
 insert into auth.sessions(id,user_id,not_after) values('${sid}','${user}',now()+interval '1 hour'),('${key(998)}','${other}',now()+interval '1 hour');`);
 await sql(readFileSync('supabase/migrations/20261004070000_vel005a_companies.sql','utf8'));
 await sql(readFileSync('supabase/migrations/20261008010000_vel_session_idle_policy.sql','utf8'));
 await sql(readFileSync('supabase/migrations/20261014015904_master_personal_phone_authority.sql','utf8'));
 await sql(readFileSync('supabase/migrations/20261013225246_vel_setup_drafts.sql','utf8'));
 // Financial dependencies are schema ports; these tests never confirm a payment.
 await sql(`create table private.billing_proven_entitlement_grants(id uuid primary key,company_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz);
 create function private.billing_service_receipt_eligible(uuid) returns boolean language sql as $$select false$$;
 create table public.billing_settlement_outcomes(id uuid primary key,company_id uuid,outcome text,provider_environment text);
 create table public.knowledge_sources(id uuid primary key,company_id uuid,kind text,storage_path text);`);
 await sql(readFileSync('supabase/migrations/20261014015933_master_setup_draft_lifecycle.sql','utf8'));
 await sql(readFileSync('supabase/migrations/20261014015934_master_business_authority.sql','utf8'));
},30000);
afterAll(async()=>{await session(`drop database if exists ${db} with(force)`,{db:'postgres'}).done;});
it('requires verified personal identity at direct RPC and rejects a revoked session',async()=>{
 expect((await actor(`select public.create_owner_company_attempt('${other}','${key(1)}',${lit(JSON.stringify(business))}::jsonb);`,other,key(998))).code).toBe('PHONE_REQUIRED');
 expect((await actor(`select public.create_owner_company_attempt('${user}','${key(1)}',${lit(JSON.stringify(business))}::jsonb);`,user,key(999))).code).toBe('UNAUTHENTICATED');
});
it('creates minimal profiles once, returns the lost receipt and refuses same-key changed payload',async()=>{
 const a=await create(2);expect(a.ok).toBe(true);expect(a.data.hours).toBe('');
 const b=await create(2);expect(b.data.id).toBe(a.data.id);
 expect((await create(2,{name:'Changed'})).code).toBe('CONFLICT');
 expect(await sql(`select count(*) from public.companies where created_by='${user}'`)).toBe('1');
});
it('allows another business after setup while active-draft scope prevents concurrent creation',async()=>{
 await sql(`update public.company_setup_drafts set state='completed' where user_id='${user}'`);
 const a=await create(3);expect(a.ok).toBe(true);
 expect((await create(4)).code).toBe('DRAFT_ACTIVE');
 await sql(`update public.company_setup_drafts set state='completed' where company_id='${a.data.id}'`);
 expect((await create(4)).ok).toBe(true);
 expect(await sql(`select count(*) from public.company_members where user_id='${user}' and role='owner'`)).toBe('3');
});
it('CAS rejects old profile writes and direct column updates; country changes require review',async()=>{
 await sql(`update public.company_setup_drafts set state='completed' where user_id='${user}'`);
 const a=await create(5),id=a.data.id;
 const save=(v:number,patch={})=>actor(`select public.update_owner_company_profile('${user}','${id}',${v},${lit(JSON.stringify({...business,...patch}))}::jsonb);`);
 expect((await save(1,{name:'Saved'})).data.version).toBe(2);
 expect((await save(1,{name:'Old'})).code).toBe('CONFLICT');
 expect((await save(2,{country:'AE'})).code).toBe('REVIEW_REQUIRED');
 expect(await sql(`select country from public.companies where id='${id}'`)).toBe('OM');
 expect(await sql(`select has_column_privilege('authenticated','public.companies','display_name','update')`)).toBe('f');
 expect((await actor(`select public.update_owner_company_profile('${other}','${id}',2,${lit(JSON.stringify(business))}::jsonb);`)).code).toBe('FORBIDDEN');
});
it('serializes simultaneous creation requests and attaches one actual draft atomically',async()=>{
 await sql(`update public.company_setup_drafts set state='completed' where user_id='${user}'`);
 const [a,b]=await Promise.all([create(6),create(6)]);
 expect(a.ok).toBe(true);expect(b.ok).toBe(true);expect(a.data.id).toBe(b.data.id);
 expect(await sql(`select count(*) from public.company_setup_drafts where user_id='${user}' and state='active' and company_id='${a.data.id}'`)).toBe('1');
 expect(await sql(`select count(*) from public.companies where id='${a.data.id}'`)).toBe('1');
});
