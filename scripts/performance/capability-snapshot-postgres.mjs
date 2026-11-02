// Offline native-authority parity. Existing isolated database; everything rolls back.
import {readFileSync} from 'node:fs';
import {sql,verify} from '../whatsapp-integration/postgres.mjs';
await verify();
const fixture=readFileSync('scripts/whatsapp-integration/inbox-contracts.sql','utf8').split('set local role authenticated;')[0];
if(!fixture.includes('begin;')||!fixture.includes('grant select on inbox_fixture'))throw Error('FIXTURE_PRELUDE_CHANGED');
const migration=readFileSync('supabase/migrations/20261102052500_company_capability_snapshot.sql','utf8');
// Optional exact top-level definition observed on hosted at05:20Z. Dependencies
// are still the local native chain; this is not a full hosted-schema clone.
const hostedEntry=process.env.PERF_CAPABILITY_CHAIN==='hosted'?`
create or replace function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean language sql stable security definer set search_path='' as $$select public.lifecycle_native_has_company_capability(p_company_id,p_capability)
 and case when p_capability like 'wa.conversations.%' then private.billing_chat_access(p_company_id,'whatsapp') and (p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id))
 when p_capability like 'ig.conversations.%' then private.billing_chat_access(p_company_id,'instagram') and (p_capability='ig.conversations.read' or private.billing_chat_send(p_company_id)) else true end$$;
`:'';

const checks=String.raw`
${process.env.PERF_CAPABILITY_JIT === 'off' ? 'set local jit=off;' : ''}
create temporary table capability_timings(path text,ms numeric);
grant select,insert on capability_timings to authenticated;
create function pg_temp.check_snapshot() returns void language plpgsql as $$
declare f record; company uuid; caps text[]:=array['wa.conversations.read','wa.conversations.reply','wa.conversations.assign','wa.conversations.take_over','wa.conversations.resume','wa.conversations.close','ig.conversations.read','unknown.capability']; r jsonb;c text;
begin
 select * into f from inbox_fixture;
 foreach company in array array[f.company,f.other_company] loop
  r:=public.company_capability_snapshot(company,caps);
  if r->>'company_id'<>company::text then raise exception 'company binding';end if;
  foreach c in array caps loop
   if (r->'capabilities'->>c)::boolean is distinct from coalesce(public.has_company_capability(company,c),false) then raise exception 'native parity %',c;end if;
  end loop;
 end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',owner::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner_session)::text,true) from inbox_fixture;
select pg_temp.check_snapshot();
do $$ declare f record;t timestamptz;caps text[]:=array['wa.conversations.reply','wa.conversations.assign','wa.conversations.take_over','wa.conversations.resume','wa.conversations.close']; c text; result jsonb;begin
 select * into f from inbox_fixture;
 for i in 1..2 loop
  t:=clock_timestamp();foreach c in array caps loop perform public.has_company_capability(f.company,c);end loop;
  insert into capability_timings values('direct',extract(epoch from clock_timestamp()-t)*1000);
  t:=clock_timestamp();result:=public.company_capability_snapshot(f.company,caps);
  insert into capability_timings values('batch',extract(epoch from clock_timestamp()-t)*1000);
 end loop;
end $$;
do $$ declare f record;begin select * into f from inbox_fixture;if public.company_capability_snapshot(f.company,array['wa.conversations.read'])->'capabilities'->>'wa.conversations.read'<>'true' then raise exception 'positive owner fixture required';end if;end $$;
select set_config('request.jwt.claim.sub',staff::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',staff_session)::text,true) from inbox_fixture;
select pg_temp.check_snapshot();
select set_config('request.jwt.claim.sub',outsider::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'session_id',outsider_session)::text,true) from inbox_fixture;
select pg_temp.check_snapshot();
reset role;
update public.company_member_grants set status='disabled' where user_id=(select staff from inbox_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',staff::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',staff_session)::text,true) from inbox_fixture;
select pg_temp.check_snapshot();
do $$ declare f record;begin select * into f from inbox_fixture;
 if public.company_capability_snapshot(f.company,array['wa.conversations.read'])->'capabilities'->>'wa.conversations.read'<>'false' then raise exception 'revoked grant';end if;
 begin perform public.company_capability_snapshot(f.company,array_fill('wa.conversations.read'::text,array[33]));raise exception 'unbounded input';exception when invalid_parameter_value then null;end;
 begin perform public.company_capability_snapshot(f.company,array[null]::text[]);raise exception 'null capability';exception when invalid_parameter_value then null;end;
end $$;
reset role;
update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where session_id=(select owner_session from inbox_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',owner::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner_session)::text,true) from inbox_fixture;
select pg_temp.check_snapshot();
reset role;
do $$ begin
 if (select prosecdef from pg_proc where oid='public.company_capability_snapshot(uuid,text[])'::regprocedure) then raise exception 'elevated wrapper';end if;
 if has_function_privilege('anon','public.company_capability_snapshot(uuid,text[])','execute') or has_function_privilege('service_role','public.company_capability_snapshot(uuid,text[])','execute') then raise exception 'unexpected grant';end if;
end $$;
select 'TIMING|'||path||'|'||ms from capability_timings;
rollback;
select 'PASS: native parity 5 authority states x 2 companies x 8 capabilities; revoked grant; bounded input; invoker/ACL';
`;
const result=await sql(fixture+ '\n'+hostedEntry+'\n'+migration+'\n'+checks,'perf_capability_snapshot');
console.log(result.split('\n').filter(line=>line.startsWith('PASS:')||line.startsWith('TIMING|')).join('\n'));
