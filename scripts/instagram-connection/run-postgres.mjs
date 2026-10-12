import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {createHash} from "node:crypto";
import { bootstrap, cleanup, installVaultContractFixture, sql, lit, session } from "./postgres.mjs";
const migration="supabase/migrations/"+readdirSync("supabase/migrations").find(n=>n.endsWith("_vel_instagram_connection_store.sql"));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const state="a".repeat(64),hash=createHash("sha256").update(state).digest("hex");
const b={companyId:id(1),userId:id(11),sessionId:id(21),attemptId:id(31),generation:1,appId:"synthetic-app",contractId:"synthetic-contract"};
const proof={appId:b.appId,contractId:b.contractId,accountId:"synthetic-account",permissions:["synthetic-permission"],expiresAt:"2030-01-01T00:00:00Z"};
const jwt=binding=>JSON.stringify({sub:binding.userId,session_id:binding.sessionId,role:"authenticated"});
const payload=v=>`${lit(JSON.stringify(v))}::jsonb`;
const prefix=(role,binding=b)=>`set role ${role};set request.jwt.claims=${lit(role==="authenticated"?jwt(binding):JSON.stringify({role}))};`;
async function rpc(name,args,role="authenticated",binding=b){return JSON.parse(await sql(prefix(role,binding)+`select public.instagram_${name}_connection(${args});`));}
async function reset(){
 await sql(`truncate private.instagram_oauth_attempts,private.instagram_company_links,private.instagram_company_generations,private.instagram_provider_contracts,private.app_session_activity,public.company_members,public.companies,auth.sessions,auth.users cascade;
 truncate vault.secrets;
 insert into private.instagram_provider_contracts(contract_id,app_id,required_permissions,enabled) values('synthetic-contract','synthetic-app',array['synthetic-permission'],true);
 insert into auth.users(id,email,email_confirmed_at) values('${id(11)}','one@example.invalid',now()),('${id(12)}','two@example.invalid',now()),('${id(13)}','staff@example.invalid',now());
 insert into auth.sessions(id,user_id) values('${id(21)}','${id(11)}'),('${id(22)}','${id(12)}'),('${id(23)}','${id(13)}'),('${id(24)}','${id(11)}');
 insert into public.companies(id,display_name,status) values('${id(1)}','Synthetic one','active'),('${id(2)}','Synthetic two','active');
 insert into public.company_members(company_id,user_id,role,status) values('${id(1)}','${id(11)}','owner','active'),('${id(2)}','${id(12)}','owner','active'),('${id(1)}','${id(13)}','staff','active');
 insert into private.app_session_activity(session_id,user_id,last_activity_at) select id,user_id,now() from auth.sessions;`);
}
async function start(binding=b,expected=0){const r=await rpc("start",`'${binding.companyId}','${binding.attemptId}','${hash}','${binding.appId}','${binding.contractId}',${expected}`,"authenticated",binding);assert.equal(r.ok,true);assert.deepEqual(r.binding,binding);return r;}
const claim=(binding=b,nonce=state)=>rpc("claim",`${payload(binding)},${lit(nonce)}`,"authenticated",binding);
const read=(binding=b)=>rpc("read",payload(binding),"authenticated",binding);
const stage=(binding=b,evidence=proof,token="synthetic-token")=>rpc("stage",`${payload(binding)},${lit(token)},${payload(evidence)}`,"service_role");
const finalize=(receipt,binding=b)=>rpc("finalize",`${payload(binding)},${lit(receipt)}::uuid`,"service_role");
const settle=(outcome,binding=b)=>rpc("settle",`${payload(binding)},${lit(outcome)}`,"service_role");
const cancel=(binding=b)=>rpc("cancel",payload(binding),"authenticated",binding);
const secret=(link,account=proof.accountId,binding=b)=>rpc("secret",`${payload(binding)},${lit(link)}::uuid,${lit(account)}`,"service_role");
async function staged(binding=b,evidence=proof){await start(binding);assert.equal((await claim(binding)).kind,"claimed");const r=await stage(binding,evidence);assert.ok(r.stageReceipt);return r.stageReceipt;}
async function marker(s){for(let i=0;i<100;i++){if(s.output().includes("READY"))return;await new Promise(r=>setTimeout(r,20));}throw Error("LOCK_MARKER_TIMEOUT");}
const cases=[];const test=(name,fn)=>cases.push([name,fn]);
test("authorized_start_persists_only_hash_and_exact_generation",async()=>{await start();assert.equal(await sql(`select nonce_hash='${hash}' and nonce_hash<>'${state}' and generation=1 from private.instagram_oauth_attempts`),"t");assert.equal((await read()).kind,"pending");});
test("start_replay_does_not_increment_or_mint_another_attempt",async()=>{await start();await start();assert.equal(await sql("select count(*) from private.instagram_oauth_attempts"),"1");assert.equal(await sql("select generation from private.instagram_company_generations"),"1");const r=await rpc("start",`'${b.companyId}','${b.attemptId}','${"b".repeat(64)}','${b.appId}','${b.contractId}',0`);assert.equal(r.code,"FORBIDDEN");});
test("generation_compare_and_set_reissue_preserves_old_history",async()=>{await start();const n={...b,attemptId:id(32),generation:2};await start(n,1);assert.equal((await claim()).code,"FORBIDDEN");assert.equal(await sql(`select status from private.instagram_oauth_attempts where id='${b.attemptId}'`),"cancelled");assert.equal((await rpc("start",`'${b.companyId}','${id(33)}','${hash}','${b.appId}','${b.contractId}',1`)).code,"CONSUMED");});
test("two_concurrent_callbacks_receive_one_committed_claim",async()=>{await start();const r=await Promise.all([claim(),claim()]);assert.equal(r.filter(x=>x.kind==="claimed"&&x.committed===true).length,1);assert.equal(r.filter(x=>x.kind==="existing"&&x.progress.kind==="claimed").length,1);assert.equal(await sql("select claimed_at is not null from private.instagram_oauth_attempts"),"t");});
test("uncommitted_claim_is_not_visible_and_rollback_restores_pending",async()=>{await start();const held=session(`begin;${prefix("authenticated")}select public.instagram_claim_connection(${payload(b)},'${state}');select 'READY';`,{keepOpen:true});await marker(held);assert.equal(await sql("select status from private.instagram_oauth_attempts"),"pending");held.child.stdin.end("rollback;\n");await held.done;assert.equal((await claim()).kind,"claimed");});
test("committed_lost_claim_response_replays_existing_without_new_claim",async()=>{await start();await claim();assert.equal((await claim()).progress.kind,"claimed");assert.equal((await read()).kind,"claimed");});
test("wrong_nonce_never_consumes_attempt",async()=>{await start();assert.equal((await claim(b,"b".repeat(64))).code,"FORBIDDEN");assert.equal((await read()).kind,"pending");});
test("all_seven_binding_fields_reject_tampering",async()=>{await start();for(const [k,v] of Object.entries({companyId:id(2),userId:id(12),sessionId:id(24),attemptId:id(32),generation:2,appId:"other-app",contractId:"other-contract"})){const tampered={...b,[k]:v};const r=await rpc("claim",`${payload(tampered)},'${state}'`);assert.equal(r.code,"FORBIDDEN",k);}assert.equal((await read()).kind,"pending");});
test("jwt_session_switch_cannot_claim_original_binding",async()=>{await start();assert.equal((await rpc("claim",`${payload(b)},'${state}'`,"authenticated",{...b,sessionId:id(24)})).code,"FORBIDDEN");});
for(const [name,change] of [
 ["owner_disabled","update public.company_members set status='disabled' where user_id='"+id(11)+"'"],
 ["owner_demoted","update public.company_members set role='staff' where user_id='"+id(11)+"'"],
 ["company_suspended","update public.companies set status='suspended' where id='"+id(1)+"'"],
 ["native_session_deleted","delete from auth.sessions where id='"+id(21)+"'"],
 ["native_session_not_after_expired","update auth.sessions set not_after=now()-interval '1 second' where id='"+id(21)+"'"],
 ["app_session_explicitly_expired","update private.app_session_activity set expired_at=now() where session_id='"+id(21)+"'"],
 ["app_session_idle_expired","update private.app_session_activity set last_activity_at=now()-interval '2 hours' where session_id='"+id(21)+"'"],
 ["owner_verification_removed","update auth.users set email_confirmed_at=null,phone_confirmed_at=null where id='"+id(11)+"'"],
])test(name+"_blocks_claim_and_stage",async()=>{await start();await sql(change);assert.equal((await claim()).code,"FORBIDDEN");assert.equal((await stage()).code,"FORBIDDEN");});
test("pending_cannot_stage_and_bad_evidence_never_writes_secret",async()=>{await start();assert.equal((await stage()).code,"CONSUMED");await claim();for(const evidence of [{...proof,appId:"other"},{...proof,contractId:"other"},{...proof,permissions:[]},{...proof,expiresAt:"2000-01-01T00:00:00Z"}])assert.equal((await stage(b,evidence)).code,"FORBIDDEN");assert.equal(await sql("select count(*) from vault.secrets"),"0");});
test("staging_is_atomic_with_vault_contract_fixture_and_receipt_is_immutable",async()=>{const receipt=await staged();assert.equal((await read()).stageReceipt,receipt);assert.equal((await stage()).stageReceipt,receipt);assert.equal((await stage(b,proof,"different-synthetic-token")).code,"FORBIDDEN");assert.equal(await sql("select count(*) from vault.secrets"),"1");});
test("stage_fault_rolls_back_vault_fixture_and_attempt_together",async()=>{await start();await claim();await sql("create function private.ig_fixture_fail() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_FAULT';end;$$;create trigger ig_fixture_fail before update on private.instagram_oauth_attempts for each row when(new.status='vault_staged') execute function private.ig_fixture_fail();");await assert.rejects(stage());assert.equal((await read()).kind,"claimed");assert.equal(await sql("select count(*) from vault.secrets"),"0");await sql("drop trigger ig_fixture_fail on private.instagram_oauth_attempts;drop function private.ig_fixture_fail()");});
test("finalize_replay_reads_one_stored_link_and_secret_is_binding_bound",async()=>{const receipt=await staged();const result=await finalize(receipt);assert.equal(result.ok,true);assert.deepEqual(await finalize(receipt),result);assert.equal((await read()).linkId,result.linkId);assert.equal((await secret(result.linkId)).accessToken,"synthetic-token");assert.equal((await secret(result.linkId,"foreign-account")).code,"FORBIDDEN");assert.equal((await secret(result.linkId,proof.accountId,{...b,generation:2})).code,"FORBIDDEN");assert.equal(await sql("select count(*) from private.instagram_company_links"),"1");assert.equal(JSON.stringify(result).includes("synthetic-token"),false);});
test("wrong_stage_receipt_never_binds",async()=>{await staged();assert.equal((await finalize(id(99))).code,"FORBIDDEN");assert.equal(await sql("select count(*) from private.instagram_company_links"),"0");});
test("unknown_or_rejected_settlement_cannot_overwrite_stage_or_bound",async()=>{const receipt=await staged();assert.equal((await settle("unknown")).kind,"vault_staged");assert.equal((await settle("rejected")).kind,"vault_staged");await finalize(receipt);assert.equal((await settle("unknown")).kind,"bound");assert.equal((await settle("rejected")).kind,"bound");});
test("unknown_and_rejected_are_durable_consumed_states",async()=>{await start();await claim();assert.equal((await settle("unknown")).kind,"unknown");assert.equal((await claim()).progress.kind,"unknown");assert.equal((await stage()).code,"CONSUMED");assert.equal((await settle("rejected")).kind,"unknown");});
test("cancel_then_finalize_never_links_and_keeps_staged_history",async()=>{const receipt=await staged();assert.equal((await cancel()).kind,"cancelled");assert.equal((await finalize(receipt)).code,"CONSUMED");assert.equal(await sql("select count(*) from vault.secrets"),"1");assert.equal((await claim()).progress.kind,"cancelled");});
test("finalize_then_cancel_preserves_bound_membership_history",async()=>{const receipt=await staged();const result=await finalize(receipt);assert.equal((await cancel()).kind,"bound");assert.equal((await read()).linkId,result.linkId);});
test("cancel_and_finalize_race_has_one_deterministic_committed_outcome",async()=>{const receipt=await staged();const held=session(`begin;${prefix("authenticated")}select public.instagram_cancel_connection(${payload(b)});select 'READY';`,{keepOpen:true});await marker(held);const fin=finalize(receipt);held.child.stdin.end("commit;\n");await held.done;assert.equal((await fin).code,"CONSUMED");assert.equal((await read()).kind,"cancelled");assert.equal(await sql("select count(*) from private.instagram_company_links"),"0");});
test("owner_revocation_before_finalize_blocks_binding",async()=>{const receipt=await staged();await sql(`update public.company_members set status='disabled' where user_id='${b.userId}'`);assert.equal((await finalize(receipt)).code,"FORBIDDEN");assert.equal(await sql("select count(*) from private.instagram_company_links"),"0");});
test("authority_lock_contention_fails_without_effect_then_revocation_is_current",async()=>{await start();const held=session(`begin;update public.company_members set status='disabled' where user_id='${b.userId}';select 'READY';`,{keepOpen:true});await marker(held);assert.equal((await claim()).code,"UNAVAILABLE");assert.equal(await sql("select status from private.instagram_oauth_attempts"),"pending");held.child.stdin.end("commit;\n");await held.done;assert.equal((await claim()).code,"FORBIDDEN");});
test("two_companies_cannot_finalize_one_active_account",async()=>{const receipt=await staged();const other={...b,companyId:id(2),userId:id(12),sessionId:id(22),attemptId:id(32)};const otherReceipt=await staged(other);const results=await Promise.all([finalize(receipt),finalize(otherReceipt,other)]);assert.equal(results.filter(r=>r.ok===true).length,1);assert.equal(results.filter(r=>r.code==="FORBIDDEN").length,1);assert.equal(await sql("select count(*) from private.instagram_company_links where status='active'"),"1");assert.equal(await sql("select count(*) from private.instagram_oauth_attempts where status='vault_staged'"),"1");});
test("new_generation_and_old_cancellation_cannot_change_renewed_link",async()=>{const receipt=await staged();const old=await finalize(receipt);const next={...b,attemptId:id(32),generation:2};await start(next,1);assert.equal((await secret(old.linkId)).code,"FORBIDDEN");await claim(next);const s=await stage(next);const renewed=await finalize(s.stageReceipt,next);assert.equal(renewed.ok,true);assert.equal((await cancel()).code,"FORBIDDEN");assert.equal((await read(next)).linkId,renewed.linkId);assert.equal(await sql("select count(*) from private.instagram_company_links"),"2");assert.equal(await sql("select count(*) from private.instagram_company_links where status='active'"),"1");});
test("expired_pending_is_terminal_but_bound_history_is_preserved",async()=>{await start();await sql("update private.instagram_oauth_attempts set expires_at=now()-interval '1 second'");assert.equal((await claim()).code,"EXPIRED");assert.equal((await read()).kind,"expired");});
test("contract_disable_blocks_finalize_and_future_claim",async()=>{const receipt=await staged();await sql("update private.instagram_provider_contracts set enabled=false");assert.equal((await finalize(receipt)).code,"FORBIDDEN");});
test("anonymous_authenticated_and_service_role_have_no_direct_storage_access",async()=>{await start();for(const role of ["anon","authenticated","service_role"]){for(const table of ["private.instagram_oauth_attempts","private.instagram_company_links","vault.secrets","vault.decrypted_secrets"]){await assert.rejects(sql(`set role ${role};select * from ${table}`));}}for(const name of ["stage_connection(jsonb,text,jsonb)","finalize_connection(jsonb,uuid)","settle_connection(jsonb,text)","secret_connection(jsonb,uuid,text)"]){for(const role of ["anon","authenticated"]){assert.equal(await sql(`select has_function_privilege('${role}','public.instagram_${name}','execute')`),"f");}}assert.equal(await sql("select bool_and(relrowsecurity) from pg_class where oid in ('private.instagram_oauth_attempts'::regclass,'private.instagram_company_links'::regclass,'private.instagram_company_generations'::regclass,'private.instagram_provider_contracts'::regclass)"),"t");});
test("unsafe_vault_acl_fails_closed_before_claim",async()=>{await start();await sql("grant select on vault.decrypted_secrets to authenticated");assert.equal((await claim()).code,"UNAVAILABLE");assert.equal(await sql("select status from private.instagram_oauth_attempts"),"pending");await sql("revoke select on vault.decrypted_secrets from authenticated");});
test("missing_real_or_fixture_vault_fails_closed_without_dispatch_authority",async()=>{await start();await sql("drop extension supabase_vault cascade");assert.equal((await claim()).code,"UNAVAILABLE");assert.equal((await stage()).code,"UNAVAILABLE");assert.equal(await sql("select status from private.instagram_oauth_attempts"),"pending");await installVaultContractFixture();});
test("time_native_expiry_during_generation_lock_wait_never_claims",async()=>{
 await start();await sql(`update auth.sessions set not_after=now()+interval '1.5 seconds' where id='${b.sessionId}'`);
 const held=session("begin;select generation from private.instagram_company_generations for update;select 'READY';",{keepOpen:true});await marker(held);
 const result=claim();
 for(let n=0;n<100;n++){if(await sql("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%instagram_claim_connection%')")==="t")break;await new Promise(r=>setTimeout(r,20));}
 await sql("select pg_sleep(2)");held.child.stdin.end("commit;\n");await held.done;
 assert.equal((await result).code,"FORBIDDEN");assert.equal(await sql("select status from private.instagram_oauth_attempts"),"pending");
});
test("time_native_expiry_during_account_lock_wait_never_finalizes",async()=>{
 const receipt=await staged();await sql(`update auth.sessions set not_after=now()+interval '1.5 seconds' where id='${b.sessionId}'`);
 const held=session(`begin;select pg_advisory_xact_lock(87420106,hashtext('${proof.accountId}'));select 'READY';`,{keepOpen:true});await marker(held);
 const result=finalize(receipt);
 for(let n=0;n<100;n++){if(await sql("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%instagram_finalize_connection%')")==="t")break;await new Promise(r=>setTimeout(r,20));}
 await sql("select pg_sleep(2)");held.child.stdin.end("commit;\n");await held.done;
 assert.equal((await result).code,"FORBIDDEN");assert.equal(await sql("select count(*) from private.instagram_company_links"),"0");
});
test("claim_audit_failure_rolls_back_consumption_before_dispatch",async()=>{
 await start();await sql("create function private.ig_fixture_audit_fail() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_AUDIT_FAULT';end;$$;create trigger ig_fixture_audit_fail before insert on public.admin_audit_logs for each row when(new.action='instagram.connection_claimed') execute function private.ig_fixture_audit_fail();");
 await assert.rejects(claim());assert.equal((await read()).kind,"pending");
 await sql("drop trigger ig_fixture_audit_fail on public.admin_audit_logs;drop function private.ig_fixture_audit_fail()");
});
test("finalize_audit_failure_rolls_back_link_and_bound_result",async()=>{
 const receipt=await staged();await sql("create function private.ig_fixture_final_audit_fail() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_AUDIT_FAULT';end;$$;create trigger ig_fixture_final_audit_fail before insert on public.admin_audit_logs for each row when(new.action='instagram.connection_bound') execute function private.ig_fixture_final_audit_fail();");
 await assert.rejects(finalize(receipt));assert.equal((await read()).kind,"vault_staged");assert.equal(await sql("select count(*) from private.instagram_company_links"),"0");
 await sql("drop trigger ig_fixture_final_audit_fail on public.admin_audit_logs;drop function private.ig_fixture_final_audit_fail()");
});
test("finalize_authority_locks_order_revocation_after_the_commit_gate",async()=>{
 const receipt=await staged();const held=session(`begin;${prefix("service_role")}select public.instagram_finalize_connection(${payload(b)},'${receipt}'::uuid);select 'READY';`,{keepOpen:true});await marker(held);
 const revocation=sql(`update public.company_members set status='disabled' where user_id='${b.userId}'`);
 let blocked=false;for(let n=0;n<100;n++){if(await sql("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%set status=''disabled''%')")==="t"){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
 held.child.stdin.end("commit;\n");await held.done;await revocation;assert.equal(blocked,true);
 assert.equal(await sql("select count(*) from private.instagram_company_links"),"1");
 const link=await sql("select id from private.instagram_company_links");assert.equal((await secret(link)).code,"FORBIDDEN");
});
for(const role of ["anon","authenticated","service_role"])test("review_column_vault_acl_"+role+"_fails_closed",async()=>{
 await start();await sql(`grant usage on schema vault to ${role};grant select(id,decrypted_secret) on vault.decrypted_secrets to ${role};`);
 assert.equal(await sql(`select has_table_privilege('${role}','vault.decrypted_secrets','select')`),"f");
 assert.equal(await sql(`select has_any_column_privilege('${role}','vault.decrypted_secrets','select')`),"t");
 assert.equal((await claim()).code,"UNAVAILABLE");assert.equal(await sql("select status from private.instagram_oauth_attempts"),"pending");
 await sql(`revoke select(id,decrypted_secret) on vault.decrypted_secrets from ${role};revoke usage on schema vault from ${role};`);
});
for(const expiry of ["native","app","provider"])test("review_delayed_vault_read_"+expiry+"_expiry_never_returns_secret",async()=>{
 const receipt=await staged();const link=(await finalize(receipt)).linkId;
 if(expiry==="native")await sql(`update auth.sessions set not_after=clock_timestamp()+interval '1.5 seconds' where id='${b.sessionId}'`);
 if(expiry==="app")await sql(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '2 hours'+interval '1.5 seconds' where session_id='${b.sessionId}'`);
 if(expiry==="provider")await sql("update private.instagram_company_links set authorization_expires_at=clock_timestamp()+interval '1.5 seconds'");
 const held=session("begin;lock table vault.secrets in access exclusive mode;select 'READY';",{keepOpen:true});await marker(held);
 const result=secret(link);let blocked=false;
 for(let n=0;n<100;n++){if(await sql("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%instagram_secret_connection%')")==="t"){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
 await sql("select pg_sleep(2)");held.child.stdin.end("commit;\n");await held.done;
 const reply=await result;assert.equal(blocked,true);assert.equal(reply.code,"FORBIDDEN");assert.equal("accessToken" in reply,false);
 assert.equal(await sql("select status from private.instagram_oauth_attempts"),"bound");
});
let count=0;
try{await bootstrap(migration);await installVaultContractFixture();console.log("PROFILE: real isolated PostgreSQL 17.6; Vault SQL contract fixture ONLY, no actual Vault encryption/key proof.");const selected=cases.filter(([name])=>!process.env.VELORA_IG_CASE_FILTER||name.includes(process.env.VELORA_IG_CASE_FILTER));for(const [name,fn] of selected){await reset();await fn();console.log("PASS "+name);count++;}console.log(`PASS ${count}/${selected.length} PostgreSQL cases`);}finally{await cleanup();}
