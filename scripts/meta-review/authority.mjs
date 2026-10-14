// Offline SQL contract tests in the labelled, network-isolated disposable Postgres fixture.
import assert from 'node:assert/strict';
import {bootstrap,cleanup,sql,file,lit} from '../instagram-connection/postgres.mjs';
const migration='supabase/migrations/20261013162534_meta_review_manual_authority.sql';
const id=n=>`abcdefab-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=(user=11)=>`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:id(user),session_id:id(user+10),role:'authenticated'}))};`;
const server="set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
try{
 await bootstrap(migration);
 assert.equal(await sql("select to_regprocedure('public.admin_grant_channel_review(uuid,text,text,text,text,text[],text)') is not null"),'t','review authority API must be installed');
 // Local platform helper contract doubles. Real installed platform helpers remain untouched in production.
 await sql(`create table public.platform_admins(user_id uuid primary key,role text,status text);
 create function private.require_platform_admin() returns uuid language plpgsql as $$begin if not exists(select 1 from public.platform_admins where user_id=auth.uid() and status='active') then raise insufficient_privilege;end if;return auth.uid();end;$$;
 create function private.can_admin_company(cid uuid,cap text) returns boolean language sql as $$select exists(select 1 from public.platform_admins where user_id=auth.uid() and status='active' and role='owner')$$;
 insert into auth.users(id,email,email_confirmed_at) values('${id(11)}','owner@synthetic.invalid',now()),('${id(12)}','staff@synthetic.invalid',now()),('${id(15)}','admin@synthetic.invalid',now());
 insert into auth.sessions(id,user_id) values('${id(21)}','${id(11)}'),('${id(22)}','${id(12)}'),('${id(25)}','${id(15)}');
 insert into private.app_session_activity(session_id,user_id,last_activity_at) select id,user_id,now() from auth.sessions;
 insert into public.companies values('${id(1)}','Reviewer','active'),('${id(2)}','Other','active');
 insert into public.company_members(company_id,user_id,role,status) values('${id(1)}','${id(11)}','owner','active'),('${id(1)}','${id(12)}','staff','active');
 insert into public.platform_admins values('${id(15)}','owner','active');`);
 await sql(`create function public.fixture_reserve(g uuid,c uuid,u uuid,ch text,a text,r text,i uuid,t uuid) returns jsonb language sql security definer as $$select private.reserve_channel_review(g,c,u,ch,a,r,i,t)$$;grant execute on function public.fixture_reserve(uuid,uuid,uuid,text,text,text,uuid,uuid) to service_role;`);
 const grantArgs=`'${id(1)}','whatsapp','3391832644330595','1261345677073276','2057350774985092',array['96890000000'],'${'a'.repeat(64)}'`;
 await assert.rejects(sql(`${actor()}select public.admin_grant_channel_review(${grantArgs})`),/permission|privilege/i);
 const issued=JSON.parse(await sql(`${actor(15)}select public.admin_grant_channel_review(${grantArgs})`));
 assert.equal(issued.ok,true);const grant=issued.grant.id;
 assert.equal(issued.grant.send_limit,50);assert.equal(issued.grant.used_count,0);
 const reader=JSON.parse(await sql(`${actor()}select public.read_channel_review_access('${id(1)}','whatsapp')`));
 assert.equal(reader.ok,true);assert.equal(reader.grant.id,grant);
 for(const user of [12,15])assert.equal(JSON.parse(await sql(`${actor(user)}select public.read_channel_review_access('${id(1)}','whatsapp')`)).ok,false);
 const reserve=(n,owner=11,recipient='96890000000',asset='1261345677073276',company=1)=>sql(`${server}select public.fixture_reserve('${grant}','${id(company)}','${id(owner)}','whatsapp','${asset}','${recipient}','${id(100+n)}','${id(200+n)}')`).then(JSON.parse);
 for(const args of [[1,12],[1,11,'96890000001'],[1,11,'96890000000','another'],[1,11,'96890000000','1261345677073276',2]])await assert.rejects(reserve(...args),/REVIEW_DENIED/);
 assert.equal((await reserve(1)).grant_id,grant);
 assert.equal((await reserve(1)).grant_id,grant); // replay consumes no second slot
 assert.equal(await sql(`select used_count from private.channel_review_grants where id='${grant}'`),'1');
 await assert.rejects(sql(`${server}select public.fixture_reserve('${grant}','${id(1)}','${id(11)}','whatsapp','1261345677073276','96890000000','${id(101)}','${id(999)}')`),/REVIEW_DENIED/);
 for(let n=2;n<=50;n++)await reserve(n);
 await assert.rejects(reserve(51),/REVIEW_DENIED/);
 assert.equal(await sql(`select used_count from private.channel_review_grants where id='${grant}'`),'50');
 // Revocation fences even an earlier reserved dispatch; expiry is checked at use, not by a scheduler.
 const revoked=JSON.parse(await sql(`${actor(15)}select public.admin_revoke_channel_review('${grant}')`));assert.equal(revoked.ok,true);
 await assert.rejects(reserve(1),/REVIEW_DENIED/);
 assert.equal(await sql(`select count(*) from public.admin_audit_logs where action='channel_review.granted'`),'1');
 console.log('PASS: native admin issuance, owner isolation, asset/recipient binding, replay, 50-send cap and revocation');
}finally{await cleanup();}
