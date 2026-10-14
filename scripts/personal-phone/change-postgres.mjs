// Isolated networkless tmpfs PostgreSQL. Auth/SMS response facts are synthetic;
// SQL authority is actual migration source, no GoTrue/SMS/provider execution.
import assert from "node:assert/strict";import {randomBytes} from "node:crypto";import {readFileSync} from "node:fs";
import {verify,session,lit} from "../instagram-connection/postgres.mjs";
const db=`phone_change_fixture_${randomBytes(6).toString("hex")}`,id=n=>`b1000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const uid=id(1),other=id(2),sid=id(11),fresh=id(12),newSid=id(13),oldPhone="+96891234567",newPhone="+96892345678";
const sql=async q=>{await verify();return session(q,{db}).done;};
const actor=(s=sid,user=uid)=>`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({role:"authenticated",sub:user,session_id:s}))};`;
const rpc=(fn,args="",s=sid,user=uid)=>sql(actor(s,user)+`select public.${fn}(${args})`).then(JSON.parse);
const server=(fn,args)=>sql(`set role service_role;select public.${fn}(${args})`).then(JSON.parse);
const begin=(phone=newPhone,key=id(21))=>rpc("master_begin_phone_change",`'${uid}',${lit(phone)},'${key}'`);
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function sms(intent,phone,s=sid,record=true){const h=await server("master_consume_personal_phone_sms",`'${uid}',${lit(phone)},'hook-${intent}'`);eq(h.ok,true);await server("master_settle_personal_phone_sms",`'${intent}','${h.data.deliveryReceipt}',true`);return record?rpc("master_personal_phone_send_result",`'${uid}','${intent}',true`,s):h;}
await verify();await session(`create database ${db}`,{db:"postgres"}).done;
try{
 await sql(readFileSync("scripts/instagram-connection/bootstrap.sql","utf8"));await sql("do $$begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin;end if;end;$$;");
 await sql(`alter table auth.users add column phone text,add column phone_change text default '',add column deleted_at timestamptz,add column banned_until timestamptz;
 insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values('${uid}','one@example.invalid',now(),'96891234567',now()-interval '1 day'),('${other}','two@example.invalid',now(),'96893456789',now()-interval '1 day');
 insert into auth.sessions(id,user_id) values('${sid}','${uid}');create table public.platform_admins(user_id uuid primary key,role text,status text);insert into public.platform_admins values('${other}','owner','active');`);
 await sql(readFileSync("supabase/migrations/20261008010000_vel_session_idle_policy.sql","utf8"));await sql(`insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${sid}','${uid}',now()) on conflict do nothing;`);
 await sql(readFileSync("supabase/migrations/20261014015904_master_personal_phone_authority.sql","utf8"));await sql(readFileSync("supabase/migrations/20261014033007_master_password_session_revocation.sql","utf8"));await sql(readFileSync("supabase/migrations/20261014033009_master_identity_recovery.sql","utf8"));
 eq((await begin()).code,"UNCONFIGURED");eq(await sql("select count(*) from private.master_personal_phone_changes"),"0");
 await sql("update private.master_personal_phone_settings set enabled=true,pre_send_hook_attested=true");
 eq((await begin("+96893456789")).code,"PHONE_IN_USE");
 const old=await begin();eq(old.ok,true);eq(old.data.phone,oldPhone);eq((await begin()).data.executeProvider,false);
 const change=old.data.changeId,oldIntent=old.data.intentId;eq((await rpc("master_send_replacement_phone",`'${uid}','${change}','${id(22)}'`)).code,"REVIEW_REQUIRED");
 eq((await rpc("master_resend_current_phone",`'${uid}','${change}','${id(23)}'`)).code,"COOLDOWN");
 await assert.rejects(sql(`update auth.users set phone_change='96892345678' where id='${uid}'`),/MASTER_PHONE_CHANGE_REVIEW_REQUIRED/);checks++;
 await sms(oldIntent,oldPhone);const claimed=await rpc("master_claim_phone_change_verify",`'${uid}','${oldIntent}'`);eq(claimed.ok,true);
 await assert.rejects(sql(actor()+`select public.master_finish_phone_change_verify('${uid}','${oldIntent}','${claimed.data.leaseId}','${sid}')`),/permission denied/);checks++;
 eq((await rpc("master_finish_personal_phone_verify",`'${uid}','${oldIntent}','${claimed.data.leaseId}',true`)).code,"INVALID_INPUT");
 eq((await server("master_finish_phone_change_verify",`'${uid}','${oldIntent}','${claimed.data.leaseId}','${sid}'`)).code,"UNAUTHENTICATED");
 await sql(`insert into auth.sessions(id,user_id) values('${fresh}','${uid}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${fresh}','${uid}',now());`);
 eq((await server("master_reconcile_phone_change_native",`'${uid}','${fresh}'`)).data.reconciled,false);
 eq((await server("master_finish_phone_change_verify",`'${uid}','${oldIntent}','${claimed.data.leaseId}','${fresh}'`)).data.step,"old_verified");
 const replacement=await rpc("master_send_replacement_phone",`'${uid}','${change}','${id(22)}'`,fresh);eq(replacement.ok,true);
 await assert.rejects(sql(`update auth.users set phone_change='96892345678' where id='${uid}'`),/MASTER_PHONE_CHANGE_REVIEW_REQUIRED/);checks++;
 await sms(replacement.data.intentId,newPhone,fresh,false);await sql(`update auth.users set phone_change='96892345678' where id='${uid}'`);await rpc("master_personal_phone_send_result",`'${uid}','${replacement.data.intentId}',true`,fresh);eq(await sql(`select phone from auth.users where id='${uid}'`),"96891234567");
 // Native ConfirmPhone during SMS login changes only the confirmation time.
 // A pending approved replacement must not block unchanged old-phone access.
 await sql(`update auth.users set phone_confirmed_at=now() where id='${uid}'`);eq(await sql(`select phone from auth.users where id='${uid}'`),"96891234567");
 const newLease=await rpc("master_claim_phone_change_verify",`'${uid}','${replacement.data.intentId}'`,fresh);eq(newLease.ok,true);
 await sql(`update auth.users set phone='96892345678',phone_confirmed_at=now(),phone_change='' where id='${uid}';insert into auth.sessions(id,user_id) values('${newSid}','${uid}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${newSid}','${uid}',now());`);
 eq((await server("master_reconcile_phone_change_native",`'${other}','${newSid}'`)).code,"UNAUTHENTICATED");
 const finished=await server("master_reconcile_phone_change_native",`'${uid}','${newSid}'`);eq(finished.data.step,"complete");
 eq((await rpc("master_phone_change_status","",newSid)).data.change.step,"complete");eq((await rpc("master_personal_phone_status")).code,"UNAUTHENTICATED");
 eq((await server("master_finish_phone_change_verify",`'${uid}','${replacement.data.intentId}','${newLease.data.leaseId}','${newSid}'`)).data.step,"complete");
 eq(await sql(`select count(*) from auth.users where id='${uid}' and phone='96892345678'`),"1");
 const review=await rpc("master_open_identity_recovery_review",`'${uid}','lost_phone','${id(60)}'`,newSid);eq(review.ok,true);eq(review.data.state,"review");
 eq((await rpc("master_open_identity_recovery_review",`'${uid}','lost_phone','${id(60)}'`,newSid)).data.id,review.data.id);
 await assert.rejects(sql(actor(newSid)+`select public.admin_decide_identity_recovery('${review.data.id}','approve_review','${id(61)}')`),/privilege|permission denied/);checks++;
 await sql(`insert into auth.sessions(id,user_id) values('${id(14)}','${other}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(14)}','${other}',now()) on conflict do nothing;`);
 const admin=(fn,args)=>sql(actor(id(14),other)+`select public.${fn}(${args})`).then(JSON.parse);
 eq((await admin("admin_decide_identity_recovery",`'${review.data.id}','approve_review','${id(61)}'`)).code,"UNCONFIGURED");
 eq((await server("master_attest_identity_recovery_evidence",`'${review.data.id}','unapproved','opaque-ref','${uid}'`)).code,"UNCONFIGURED");
 eq((await admin("admin_decide_identity_recovery",`'${review.data.id}','request_evidence','${id(62)}'`)).data.state,"needs_evidence");
 eq(await sql(`select phone from auth.users where id='${uid}'`),"96892345678");
 await assert.rejects(sql(`insert into auth.users(id,email,phone) values('${id(90)}','squatting@example.invalid','96894567890')`),/MASTER_PHONE_ENROLLMENT_REQUIRED/);checks++;
 await sql(`insert into auth.users(id,email,phone) values('${id(91)}','email-only@example.invalid',null)`);eq(await sql(`select phone is null from auth.users where id='${id(91)}'`),"t");
 // The native enrollment UPDATE and its authorization must commit before a
 // global revocation can publish its cutoff. Auth facts remain synthetic.
 const enrollmentUser=id(91),enrollmentSession=id(94),enrollmentPhone="+96895678901";
 await sql(`update auth.users set email_confirmed_at=now() where id='${enrollmentUser}';insert into auth.sessions(id,user_id) values('${enrollmentSession}','${enrollmentUser}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${enrollmentSession}','${enrollmentUser}',now());`);
 const enrollment=await rpc("master_reserve_personal_phone",`'${enrollmentUser}',${lit(enrollmentPhone)},'${id(95)}'`,enrollmentSession,enrollmentUser);
 const hook=await server("master_consume_personal_phone_sms",`'${enrollmentUser}',${lit(enrollmentPhone)},'enrollment-revocation-hook'`);
 await server("master_settle_personal_phone_sms",`'${enrollment.data.intentId}','${hook.data.deliveryReceipt}',true`);
 await sql(`update auth.users set phone_change='96895678901' where id='${enrollmentUser}'`);
 await rpc("master_personal_phone_send_result",`'${enrollmentUser}','${enrollment.data.intentId}',true`,enrollmentSession,enrollmentUser);
 await rpc("master_claim_personal_phone_verify",`'${enrollmentUser}','${enrollment.data.intentId}'`,enrollmentSession,enrollmentUser);
 const nativeEnrollment=session(`begin;update auth.users set phone='96895678901',phone_confirmed_at=now(),phone_change='' where id='${enrollmentUser}';select 'ENROLLMENT_AUTH_UPDATE_HELD';`,{db,keepOpen:true});
 const deadline=Date.now()+4000;while(!nativeEnrollment.output().includes("ENROLLMENT_AUTH_UPDATE_HELD")&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.match(nativeEnrollment.output(),/ENROLLMENT_AUTH_UPDATE_HELD/);
 const revocation=session(`set application_name='phone-enrollment-revocation-fixture';${actor(enrollmentSession,enrollmentUser)}select public.master_revoke_account_sessions('${enrollmentUser}');`,{db});
 let revocationWaits=false;
 try{const until=Date.now()+3000;while(Date.now()<until){revocationWaits=await sql("select exists(select 1 from pg_stat_activity where application_name='phone-enrollment-revocation-fixture' and wait_event='advisory')")==="t";if(revocationWaits)break;await new Promise(r=>setTimeout(r,20));}}
 finally{nativeEnrollment.child.stdin.end("commit;\n");await nativeEnrollment.done;}
 const revoked=await revocation.done;eq(revocationWaits,true);eq(revoked,"t");eq(await sql(actor(enrollmentSession,enrollmentUser)+"select public.app_session_is_valid()"),"f");eq(await sql(`select phone from auth.users where id='${enrollmentUser}'`),"96895678901");
 await sql("update private.master_identity_recovery_policy set enabled=true,criteria_version='offline-test-policy',approval_reference='offline-only';insert into private.master_identity_recovery_sources(source,independence_group,criteria_version,approval_reference,enabled) values('source-a','group-a','offline-test-policy','offline-only',true),('source-b','group-a','offline-test-policy','offline-only',true),('source-c','group-b','offline-test-policy','offline-only',true)");
 const evidence=(source,ref,subject=uid)=>server("master_attest_identity_recovery_evidence",`'${review.data.id}',${lit(source)},${lit(ref)},'${subject}'`);
 eq((await evidence("source-a","wrong-subject",other)).code,"REVIEW_REQUIRED");
 eq((await evidence("source-a","opaque-a")).ok,true);eq((await evidence("source-a","opaque-a")).data.replayed,true);eq((await evidence("source-b","opaque-b")).ok,true);
 eq((await admin("admin_decide_identity_recovery",`'${review.data.id}','approve_review','${id(63)}'`)).code,"INDEPENDENT_EVIDENCE_REQUIRED");
 eq((await evidence("source-c","opaque-c")).ok,true);
 eq((await admin("admin_decide_identity_recovery",`'${review.data.id}','approve_review','${id(63)}'`)).data.state,"approved_for_manual_recovery");
 eq((await admin("admin_decide_identity_recovery",`'${review.data.id}','approve_review','${id(63)}'`)).data.replayed,true);
 eq(await sql(`select count(*) from private.master_identity_recovery_decisions where case_id='${review.data.id}' and decision='approve_review'`),"1");
 await assert.rejects(sql(`update private.master_identity_recovery_evidence set user_id='${other}' where case_id='${review.data.id}'`),/IDENTITY_RECOVERY_EVIDENCE_IMMUTABLE/);checks++;
 eq(await sql(`select phone from auth.users where id='${uid}'`),"96892345678");
 await sql(`update public.platform_admins set status='disabled' where user_id='${other}'`);await assert.rejects(admin("admin_read_identity_recovery_reviews",""),/privilege/);checks++;
 // Hold the same lock as enrollment. Native state changing during the wait
 // must be checked again, not accepted from the original JWT/session read.
 const lock=session(`begin;select pg_advisory_xact_lock(hashtextextended('${uid}:personal-phone',0));select pg_sleep(1.5);commit`,{db});
 await new Promise(r=>setTimeout(r,150));
 const waited=rpc("master_begin_phone_change",`'${uid}','+96894567890','${id(92)}'`,newSid);
 await new Promise(r=>setTimeout(r,150));await sql(`update auth.users set banned_until=now()+interval '1 hour' where id='${uid}'`);await lock.done;
 eq((await waited).code,"UNAUTHENTICATED");eq(await sql(`select count(*) from private.master_personal_phone_changes where request_key='${id(92)}'`),"0");
 await sql(`update auth.users set banned_until=null where id='${uid}';update auth.sessions set not_after=now()-interval '1 second' where id='${newSid}'`);
 eq((await rpc("master_open_identity_recovery_review",`'${uid}','lost_phone','${id(93)}'`,newSid).catch(()=>({code:"UNAUTHENTICATED"}))).code,"UNAUTHENTICATED");
 console.log(`Phone change/recovery: ${checks} actual PostgreSQL assertions passed; Auth/provider facts are offline fixtures.`);
}finally{await session(`drop database ${db} with(force)`,{db:"postgres"}).done;}
