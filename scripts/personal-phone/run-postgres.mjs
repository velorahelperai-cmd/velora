// Actual PostgreSQL in the existing guarded, networkless tmpfs test container.
// Auth users are synthetic. This proves database contracts, not GoTrue/SMS execution.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { verify, session, lit } from "../instagram-connection/postgres.mjs";
const database = `master_phone_fixture_${randomBytes(6).toString("hex")}`;
const id = n => `f1000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner = id(1), other = id(2), unverified = id(3), sid = id(11), otherSid = id(12);
const phone = "+96891234567";
const sql = async query => { await verify(); return session(query, { db: database }).done; };
const prefix = (user = owner, sessionId = sid) => `set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:user,session_id:sessionId,role:"authenticated"}))};`;
const rpc = async (name, args="", user=owner, sessionId=sid) => JSON.parse(await sql(prefix(user,sessionId)+`select public.${name}(${args})`));
const reserve = (target=phone,key=id(21),user=owner,sessionId=sid) => rpc("master_reserve_personal_phone",`${lit(user)}::uuid,${lit(target)},${lit(key)}::uuid`,user,sessionId);
const claim = intent => rpc("master_claim_personal_phone_verify",`${lit(owner)}::uuid,${lit(intent)}::uuid`);
const hook = (user,target,event) => sql(`set role service_role;select public.master_consume_personal_phone_sms('${user}',${lit(target)},${lit(event)})`).then(JSON.parse);
async function authorizeSend(intent,user=owner){const r=await hook(user,phone,`hook_${intent}`);assert.equal(r.ok,true);if(r.data.dispatch)await sql(`set role service_role;select public.master_settle_personal_phone_sms('${intent}','${r.data.deliveryReceipt}',true)`);}
const sent = async (intent,user=owner,s=sid) => {await authorizeSend(intent,user);return rpc("master_personal_phone_send_result",`${lit(user)}::uuid,${lit(intent)}::uuid,true`,user,s);};
const finish = (intent,lease,success=true) => rpc("master_finish_personal_phone_verify",`${lit(owner)}::uuid,${lit(intent)}::uuid,${lit(lease)}::uuid,${success}`);
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual,expected); checks++; };
async function reset() {
  await sql(`truncate private.master_personal_phone_events,private.master_personal_phone_intents,private.app_session_activity,auth.sessions,auth.users cascade;
    update private.master_personal_phone_settings set enabled=false,pre_send_hook_attested=false;
    insert into auth.users(id,email,email_confirmed_at) values('${owner}','one@example.invalid',now()),('${other}','two@example.invalid',now()),('${unverified}','unverified@example.invalid',null);
    insert into auth.sessions(id,user_id) values('${sid}','${owner}'),('${otherSid}','${other}'),('${id(13)}','${unverified}');
    insert into private.app_session_activity(session_id,user_id,last_activity_at) select id,user_id,now() from auth.sessions;
    update private.app_session_settings set enabled=true;`);
}
async function enabled() { await sql("update private.master_personal_phone_settings set enabled=true,pre_send_hook_attested=true"); }
async function initial() { await enabled(); const r=await reserve(); eq(r.ok,true); await sent(r.data.intentId); return r.data.intentId; }
await verify();
await session(`create database ${database}`,{db:"postgres"}).done;
try {
  await sql(readFileSync("scripts/instagram-connection/bootstrap.sql","utf8"));
  await sql("do $$begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin;end if;end;$$");
  await sql("alter table auth.users add column phone text,add column phone_change text not null default '',add column deleted_at timestamptz,add column banned_until timestamptz;");
  await sql(readFileSync("supabase/migrations/20261008010000_vel_session_idle_policy.sql","utf8"));
  await sql(readFileSync("supabase/migrations/20261014015904_master_personal_phone_authority.sql","utf8"));
  await sql("create function public.fixture_can_create(p_uid uuid) returns boolean language sql security definer set search_path='' as $$ select private.master_account_can_create_company(p_uid) $$;");
  await reset();
  eq((await rpc("master_personal_phone_status")).data.phoneVerified,false);
  eq((await reserve()).code,"UNCONFIGURED");
  eq(await sql("select count(*) from private.master_personal_phone_intents"),"0");
  await sql("update private.master_personal_phone_settings set enabled=true");eq((await reserve()).code,"UNCONFIGURED");
  await enabled();
  eq((await reserve("96891234567")).code,"INVALID_INPUT");
  eq((await reserve(phone,id(21),unverified,id(13))).code,"EMAIL_REQUIRED");
  eq((await reserve(phone,id(21),owner,otherSid)).code,"UNAUTHENTICATED");
  const r=await reserve(); eq(r.ok,true); eq(r.data.executeProvider,true);
  eq((await reserve()).data.executeProvider,false);
  eq((await reserve(phone,id(22))).code,"COOLDOWN");
  eq(await sql(prefix()+`select public.fixture_can_create('${owner}')`),"f");
  await assert.rejects(sql(`update auth.users set phone='96891234567',phone_confirmed_at=now() where id='${owner}'`),/MASTER_PHONE_ENROLLMENT_REQUIRED/); checks++;
  await authorizeSend(r.data.intentId);await sql(`update auth.users set phone_change='96891234567' where id='${owner}'`);
  await sent(r.data.intentId);
  const verifyReceipt=await claim(r.data.intentId); eq(verifyReceipt.ok,true);
  eq((await claim(r.data.intentId)).code,"BUSY");
  eq((await finish(r.data.intentId,verifyReceipt.data.leaseId)).code,"VERIFICATION_INCOMPLETE");
  const secondClaim=await claim(r.data.intentId);
  await sql(`update auth.users set phone='96891234567',phone_confirmed_at=now(),phone_change='' where id='${owner}'`);
  eq((await finish(r.data.intentId,secondClaim.data.leaseId)).data.verified,true);
  eq((await finish(r.data.intentId,secondClaim.data.leaseId)).data.verified,true);
  eq((await rpc("master_personal_phone_status")).data.phoneVerified,true);
  eq(await sql(prefix()+`select public.fixture_can_create('${owner}')`),"t");
  eq(await sql(prefix(other,otherSid)+`select public.fixture_can_create('${owner}')`),"f");
  eq((await reserve("+96892345678",id(23))).code,"REVIEW_REQUIRED");
  eq((await reserve(phone,id(23),other,otherSid)).code,"PHONE_IN_USE");
  await assert.rejects(sql(`update auth.users set phone='96892345678' where id='${owner}'`),/MASTER_PHONE_CHANGE_REVIEW_REQUIRED/); checks++;
  await assert.rejects(sql(`update auth.users set phone_change='96892345678' where id='${owner}'`),/MASTER_PHONE_CHANGE_REVIEW_REQUIRED/); checks++;
  await sql(`update auth.users set banned_until=now()+interval '1 day' where id='${owner}'`);
  eq((await rpc("master_personal_phone_status")).code,"UNAUTHENTICATED");
  await reset(); const exp=await initial(); await sql("update private.master_personal_phone_intents set expires_at=now()-interval '1 second'"); eq((await claim(exp)).code,"EXPIRED");
  await reset(); const attempts=await initial();
  for(let n=0;n<5;n++){const c=await claim(attempts);eq(c.ok,true);eq((await finish(attempts,c.data.leaseId,false)).code,n===4?"ATTEMPTS_EXHAUSTED":"CODE_INVALID");}
  eq((await claim(attempts)).code,"ATTEMPTS_EXHAUSTED");
  await reset(); const revoked=await initial(); const c=await claim(revoked); await sql(`delete from auth.sessions where id='${sid}'`);
  await assert.rejects(sql(`update auth.users set phone='96891234567',phone_confirmed_at=now() where id='${owner}'`),/MASTER_PHONE_ENROLLMENT_REQUIRED/);checks++;
  eq((await finish(revoked,c.data.leaseId)).code,"UNAUTHENTICATED");
  await reset(); const rotating=await initial(); const rotationClaim=await claim(rotating);
  await sql(`update auth.users set phone='96891234567',phone_confirmed_at=now(),phone_change='' where id='${owner}';
    insert into auth.sessions(id,user_id) values('${id(15)}','${owner}');insert into private.app_session_activity values('${id(15)}','${owner}',now(),null)`);
  const rotatedFinish=await rpc("master_finish_personal_phone_verify",`${lit(owner)}::uuid,${lit(rotating)}::uuid,${lit(rotationClaim.data.leaseId)}::uuid,true`,owner,id(15));
  eq(rotatedFinish.ok,true);eq(rotatedFinish.data.verified,true);
  eq((await rpc("master_personal_phone_status","",owner,id(15))).data.intent.id,rotating);
  await reset(); const oldSessionIntent=await initial();await sql(`insert into auth.sessions(id,user_id,created_at) values('${id(16)}','${owner}',now()-interval '1 minute');insert into private.app_session_activity values('${id(16)}','${owner}',now(),null)`);
  const oldClaim=await claim(oldSessionIntent);await sql(`update auth.users set phone='96891234567',phone_confirmed_at=now(),phone_change='' where id='${owner}'`);
  eq((await rpc("master_finish_personal_phone_verify",`${lit(owner)}::uuid,${lit(oldSessionIntent)}::uuid,${lit(oldClaim.data.leaseId)}::uuid,true`,owner,id(16))).code,"UNAUTHENTICATED");
  await reset();const revokedRotation=await initial();const revokedClaim=await claim(revokedRotation);
  await sql(`update auth.users set phone='96891234567',phone_confirmed_at=now(),phone_change='' where id='${owner}';insert into auth.sessions(id,user_id) values('${id(17)}','${owner}');insert into private.app_session_activity values('${id(17)}','${owner}',now(),null);delete from auth.sessions where id='${sid}'`);
  eq((await rpc("master_finish_personal_phone_verify",`${lit(owner)}::uuid,${lit(revokedRotation)}::uuid,${lit(revokedClaim.data.leaseId)}::uuid,true`,owner,id(17))).code,"UNAUTHENTICATED");
  await reset(); const nativeExpiry=await initial(); await claim(nativeExpiry); await sql(`update auth.sessions set not_after=now()-interval '1 second' where id='${sid}'`);
  await assert.rejects(sql(`update auth.users set phone='96891234567',phone_confirmed_at=now() where id='${owner}'`),/MASTER_PHONE_ENROLLMENT_REQUIRED/);checks++;
  eq((await rpc("master_personal_phone_status")).code,"UNAUTHENTICATED");
  await reset(); const idleExpiry=await initial(); await sql("update private.app_session_activity set last_activity_at=now()-interval '2 hours'");eq((await claim(idleExpiry)).code,"UNAUTHENTICATED");
  await reset(); const deleted=await initial(); await claim(deleted); await sql(`update auth.users set deleted_at=now() where id='${owner}'`);
  await assert.rejects(sql(`update auth.users set phone='96891234567',phone_confirmed_at=now() where id='${owner}'`),/MASTER_PHONE_ENROLLMENT_REQUIRED/);checks++;
  await reset(); const wrongSession=await initial(); await sql(`insert into auth.sessions(id,user_id) values('${id(14)}','${owner}');insert into private.app_session_activity values('${id(14)}','${owner}',now(),null)`);
  eq((await rpc("master_claim_personal_phone_verify",`${lit(owner)}::uuid,${lit(wrongSession)}::uuid`,owner,id(14))).code,"UNAUTHENTICATED");
  await reset(); await enabled();
  const parallel=await Promise.all([reserve(),reserve()]);eq(parallel.filter(r=>r.ok&&r.data.executeProvider).length,1);eq(parallel.filter(r=>r.ok&&!r.data.executeProvider).length,1);
  eq(await sql("select count(*) from private.master_personal_phone_intents"),"1");
  await reset(); await enabled();
  const ownerIntent=(await reserve()).data.intentId,otherIntent=(await reserve(phone,id(22),other,otherSid)).data.intentId;
  await sent(ownerIntent);await sent(otherIntent,other,otherSid);
  await claim(ownerIntent);await rpc("master_claim_personal_phone_verify",`${lit(other)}::uuid,${lit(otherIntent)}::uuid`,other,otherSid);
  const nativeRaces=await Promise.allSettled([sql(`update auth.users set phone='96891234567',phone_confirmed_at=now() where id='${owner}'`),sql(`update auth.users set phone='+96891234567',phone_confirmed_at=now() where id='${other}'`)]);
  eq(nativeRaces.filter(r=>r.status==="fulfilled").length,1);eq(nativeRaces.filter(r=>r.status==="rejected").length,1);
  eq(await sql("select count(*) from auth.users where phone_confirmed_at is not null"),"1");
  await reset(); const authNative=await initial(); await claim(authNative);
  await sql("grant usage on schema auth to supabase_auth_admin;grant select,update on auth.users to supabase_auth_admin");
  await sql(`set role supabase_auth_admin;update auth.users set phone='96891234567',phone_confirmed_at=now(),phone_change='' where id='${owner}'`);checks++;
  await reset();const activityLock=await initial();await claim(activityLock);
  const held=session(`begin;select 1 from private.app_session_activity where session_id='${sid}' for update;select 'PHONE_ACTIVITY_LOCKED';`,{db:database,keepOpen:true});
  for(let n=0;n<100&&!held.output().includes("PHONE_ACTIVITY_LOCKED");n++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(held.output().includes("PHONE_ACTIVITY_LOCKED"));checks++;
  try { await sql(`set role supabase_auth_admin;update auth.users set phone='96891234567',phone_confirmed_at=now(),phone_change='' where id='${owner}'`);checks++; }
  finally { held.child.stdin.end("commit;\n");await held.done; }
  await reset(); await enabled();
  for(let n=0;n<5;n++){eq((await reserve(phone,id(30+n))).ok,true);await sql("update private.master_personal_phone_intents set created_at=now()-interval '2 minutes',resend_at=now()-interval '1 second'");}
  eq((await reserve(phone,id(40))).code,"RATE_LIMITED");
  await reset();await enabled();eq((await hook(owner,phone,"hook_no_reservation")).code,"UNAUTHENTICATED");
  const hookIntent=(await reserve()).data.intentId;
  eq((await rpc("master_personal_phone_send_result",`${lit(owner)}::uuid,${lit(hookIntent)}::uuid,true`)).code,"VERIFICATION_INCOMPLETE");
  eq((await hook(owner,"+96892345678","hook_wrong_phone")).code,"UNAUTHENTICATED");
  const hookRaces=await Promise.all([hook(owner,phone,"hook_parallel"),hook(owner,phone,"hook_parallel")]);
  eq(hookRaces.filter(r=>r.ok&&r.data.dispatch).length,1);eq(hookRaces.filter(r=>r.ok&&!r.data.dispatch).length,1);
  const hookReceipt=hookRaces.find(r=>r.data.dispatch).data;
  eq((await hook(owner,phone,"hook_second_request")).code,"UNAUTHENTICATED");
  eq((await hook(other,phone,"hook_parallel")).code,"UNAUTHENTICATED");
  eq((await hook(owner,phone,"hook_parallel")).data.accepted,false);
  await sql(`set role service_role;select public.master_settle_personal_phone_sms('${hookIntent}','${hookReceipt.deliveryReceipt}',false)`);
  eq((await hook(owner,phone,"hook_parallel")).data.accepted,false);
  await sql(`set role service_role;select public.master_settle_personal_phone_sms('${hookIntent}','${hookReceipt.deliveryReceipt}',true)`);
  eq((await hook(owner,phone,"hook_parallel")).data.accepted,false);
  await reset();const acceptedHook=(await (enabled().then(()=>reserve()))).data.intentId;await authorizeSend(acceptedHook);
  eq((await hook(owner,phone,`hook_${acceptedHook}`)).data.accepted,true);eq((await hook(owner,phone,`hook_${acceptedHook}`)).data.dispatch,false);
  for(const role of ["anon","authenticated"]){await assert.rejects(sql(`set role ${role};select public.master_consume_personal_phone_sms('${owner}','${phone}','hook_illegal')`),/permission denied/);checks++;
   await assert.rejects(sql(`set role ${role};select public.master_settle_personal_phone_sms('${acceptedHook}','${id(50)}',true)`),/permission denied/);checks++;}
  eq(await sql("select count(*) from information_schema.columns where table_schema='private' and table_name in ('master_personal_phone_intents','master_personal_phone_events') and column_name~'(otp|token|body|payload)'"),"0");
  for(const role of ["anon","authenticated","service_role"]){for(const table of ["master_personal_phone_intents","master_personal_phone_events","master_personal_phone_settings"]){await assert.rejects(sql(`set role ${role};select * from private.${table}`),/permission denied/);checks++;}}
  eq(await sql("select bool_and(relrowsecurity) from pg_class where oid in ('private.master_personal_phone_intents'::regclass,'private.master_personal_phone_events'::regclass,'private.master_personal_phone_settings'::regclass)"),"t");
  await assert.rejects(sql("set role anon;select public.master_personal_phone_status()"),/permission denied/);checks++;
  console.log(`Personal phone: ${checks} actual local PostgreSQL assertions passed; no SMS execution.`);
} finally { await session(`drop database ${database} with(force)`,{db:"postgres"}).done; }
