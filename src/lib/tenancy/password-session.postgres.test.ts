import {beforeAll,afterAll,beforeEach,expect,it} from 'vitest';
// @ts-expect-error Guarded disposable networkless PostgreSQL, never cloud Auth.
import {bootstrap,cleanup,file,sql,lit,session} from '../../../scripts/instagram-connection/postgres.mjs';
const id=(n:number)=>`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=(uid=1,sid=101)=>`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:id(uid),session_id:id(sid),role:'authenticated'}))};`;
let originalOid:string,checkOid:string;
beforeAll(async()=>{
 await bootstrap('supabase/migrations/20261013225246_vel_setup_drafts.sql');
 await sql(`alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
 create table public.password_epoch_fixture(id integer);insert into public.password_epoch_fixture values(1);
 alter table public.password_epoch_fixture enable row level security;grant select on public.password_epoch_fixture to authenticated;
 create policy existing_session_policy on public.password_epoch_fixture for select to authenticated using((select public.app_session_is_valid()));`);
 originalOid=await sql(`select 'public.app_session_is_valid()'::regprocedure::oid`);
 checkOid=await sql(`select 'public.check_app_session(boolean)'::regprocedure::oid`);
 await file('supabase/migrations/20261014033007_master_password_session_revocation.sql');
},30000);
afterAll(cleanup);
beforeEach(async()=>{await sql(`truncate private.master_account_session_revocations,private.app_session_activity,auth.sessions,auth.users cascade;
 insert into auth.users(id,email_confirmed_at) values('${id(1)}',clock_timestamp()),('${id(2)}',clock_timestamp());
 insert into auth.sessions(id,user_id,created_at) values('${id(101)}','${id(1)}',clock_timestamp()-interval '1 hour'),('${id(102)}','${id(1)}',clock_timestamp()-interval '2 hours'),('${id(103)}','${id(2)}',clock_timestamp()-interval '1 hour');
 update private.app_session_settings set enabled=false;`);});
it('preserves pre-existing policy OIDs while rejecting both old devices and keeping another user',async()=>{
 expect(await sql(`select 'public.app_session_is_valid()'::regprocedure::oid`)).toBe(originalOid);
 expect(await sql(`select 'public.check_app_session(boolean)'::regprocedure::oid`)).toBe(checkOid);
 expect(await sql(actor()+`select count(*) from public.password_epoch_fixture`)).toBe('1');
 expect(await sql(actor()+`select public.master_revoke_account_sessions('${id(1)}')`)).toBe('t');
 expect(await sql(actor()+`select count(*) from public.password_epoch_fixture`)).toBe('0');
 expect(await sql(actor(1,102)+`select count(*) from public.password_epoch_fixture`)).toBe('0');
 expect(await sql(actor(2,103)+`select count(*) from public.password_epoch_fixture`)).toBe('1');
 expect(JSON.parse(await sql(actor()+`select public.check_app_session(true)`))).toMatchObject({ok:false,code:'UNAUTHENTICATED'});
 expect(await sql(`select count(*) from private.app_session_activity where user_id='${id(1)}' and expired_at is null`)).toBe('0');
 // The application never deletes or modifies managed Auth rows itself.
 expect(await sql('select count(*) from auth.sessions')).toBe('3');
});
it('accepts a real new session after the epoch but never a fabricated session or wrong account',async()=>{
 expect(await sql(actor()+`select public.master_revoke_account_sessions('${id(2)}')`)).toBe('f');
 await sql(actor()+`select public.master_revoke_account_sessions('${id(1)}')`);
 await sql(`insert into auth.sessions(id,user_id) values('${id(104)}','${id(1)}')`);
 expect(await sql(actor(1,104)+'select public.app_session_is_valid()')).toBe('t');
 expect(JSON.parse(await sql(actor(1,104)+'select public.check_app_session(false)'))).toMatchObject({ok:true});
 expect(await sql(actor(1,999)+'select public.app_session_is_valid()')).toBe('f');
});
it('native revocation, ban and idle expiry remain enforced after replacing the kernel',async()=>{
 await sql(`update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${id(1)}'`);
 expect(await sql(actor()+'select public.app_session_is_valid()')).toBe('f');
 await sql(`update auth.users set banned_until=null;update private.app_session_settings set enabled=true;
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(101)}','${id(1)}',clock_timestamp()-interval '2 hours');`);
 expect(await sql(actor()+'select public.app_session_is_valid()')).toBe('f');
});
it('read-only checks on both devices do not deadlock simultaneous global revocation',async()=>{
 await sql(`update private.app_session_settings set enabled=true;insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(101)}','${id(1)}',clock_timestamp()),('${id(102)}','${id(1)}',clock_timestamp());`);
 const first=session(`begin;${actor()}select public.check_app_session(false);select pg_sleep(0.25);select public.master_revoke_account_sessions('${id(1)}');commit;`);
 const second=session(`begin;${actor(1,102)}select public.check_app_session(false);select pg_sleep(0.25);select public.master_revoke_account_sessions('${id(1)}');commit;`);
 const outputs=await Promise.all([first.done,second.done]);
 expect(outputs.every((o:string)=>o.includes('t')||o.includes('f'))).toBe(true);
 expect(await sql(actor()+'select public.app_session_is_valid()')).toBe('f');
 expect(await sql(actor(1,102)+'select public.app_session_is_valid()')).toBe('f');
},20000);
