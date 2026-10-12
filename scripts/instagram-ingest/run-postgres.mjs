import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bootstrap, cleanup, file, installVaultContractFixture, lit, session, sql } from "../instagram-connection/postgres.mjs";

// Real isolated PG only. No provider/cloud/client credentials. The unchanged
// guarded store fixture verifies the no-network tmpfs container before any SQL.
export const migration = "supabase/migrations/20261011193914_vel_instagram_webhook_store.sql";
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const message = (mid="mid.1", account="100", sender="200", text="synthetic") => ({ kind:"message",professionalAccountId:account,senderId:sender,recipientId:account,messageId:mid,direction:"inbound",isEcho:null,content:{kind:"text",text},rawTimestamp:"opaque",rawEntryTimestamp:1 });
export const echo = (mid="mid.out", account="100", recipient="200") => ({...message(mid,account),senderId:account,recipientId:recipient,direction:"outbound",isEcho:true});
export const read = (mid="mid.out", account="100", sender="200") => ({kind:"read",professionalAccountId:account,senderId:sender,recipientId:account,messageId:mid,rawTimestamp:999});
export const batch = events => ({events,rawBodySha256:"a".repeat(64),localReceivedAt:"2026-10-11T00:00:00.000Z"});
export const ingest = events => sql(`set role service_role;select public.instagram_ingest_webhook(${lit(JSON.stringify(batch(events)))}::jsonb)`).then(JSON.parse);
export async function setup() {
 await bootstrap("supabase/migrations/20261011184625_vel_instagram_connection_store.sql");await installVaultContractFixture();
 // Reproduce inspected real public default function grants; add hostile private
 // table defaults too to prove explicit object revocations without shared changes.
 await sql("grant usage on schema private to service_role;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;alter default privileges in schema private grant all on tables to anon,authenticated,service_role;");
 await file(migration);
}
export async function reset() {
 if(await sql("select to_regclass('private.instagram_webhook_quarantine') is not null")==="t") await sql("truncate private.instagram_webhook_quarantine,private.instagram_webhook_receipts,private.instagram_messages,private.instagram_conversations cascade");
 await sql(`truncate private.instagram_oauth_attempts,private.instagram_company_links,private.instagram_company_generations,private.instagram_provider_contracts,private.app_session_activity,public.company_members,public.companies,auth.sessions,auth.users cascade;truncate vault.secrets;
 insert into private.instagram_provider_contracts values('synthetic-contract','synthetic-app',array['synthetic-permission'],true);
 insert into auth.users(id,email,email_confirmed_at) values('${id(11)}','a@example.invalid',now()),('${id(12)}','b@example.invalid',now());
 insert into auth.sessions(id,user_id) values('${id(21)}','${id(11)}'),('${id(22)}','${id(12)}');
 insert into public.companies(id,display_name,status) values('${id(1)}','Synthetic A','active'),('${id(2)}','Synthetic B','active');
 insert into public.company_members(company_id,user_id,role,status) values('${id(1)}','${id(11)}','owner','active'),('${id(2)}','${id(12)}','owner','active');
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${id(21)}','${id(11)}',now()),('${id(22)}','${id(12)}',now());`);
 await bind();
}
export async function bind(company=1,account="100",generation=1) {
 const b={companyId:id(company),userId:id(company+10),sessionId:id(company+20),attemptId:id(company*100+generation),generation,appId:"synthetic-app",contractId:"synthetic-contract"};
 const state="b".repeat(64),hash=createHash("sha256").update(state).digest("hex");
 const prefix=`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:b.userId,session_id:b.sessionId,role:"authenticated"}))};`;
 await sql(`${prefix}select public.instagram_start_connection('${b.companyId}','${b.attemptId}','${hash}','${b.appId}','${b.contractId}',${generation-1});select public.instagram_claim_connection(${lit(JSON.stringify(b))}::jsonb,'${state}');`);
 const proof={appId:b.appId,contractId:b.contractId,accountId:account,permissions:["synthetic-permission"],expiresAt:"2030-01-01T00:00:00Z"};
 const stage=JSON.parse(await sql(`set role service_role;select public.instagram_stage_connection(${lit(JSON.stringify(b))}::jsonb,'synthetic-token',${lit(JSON.stringify(proof))}::jsonb)`));
 assert.ok(stage.stageReceipt,"fixture staging committed");
 const fin=JSON.parse(await sql(`set role service_role;select public.instagram_finalize_connection(${lit(JSON.stringify(b))}::jsonb,'${stage.stageReceipt}'::uuid)`));
 assert.equal(fin.ok,true,"fixture finalize committed");return fin.linkId;
}
async function transfer() {await sql("update private.instagram_company_links set status='retired' where account_id='100'");return bind(2,"100");}
async function scalar(query,value){assert.equal(await sql(query),String(value));}
async function quarantine(reason){await scalar("select count(*) from private.instagram_messages",0);await scalar(`select count(*) from private.instagram_webhook_quarantine where reason='${reason}'`,1);}
const cases=[];const test=(name,fn)=>cases.push([name,fn]);
test("atomic_inbound_conversation_message_db_binding",async()=>{
 assert.deepEqual(await ingest([message()]),{status:"committed"});
 await scalar("select count(*) from private.instagram_messages",1);await scalar("select count(*) from private.instagram_conversations",1);
 await scalar(`select company_id='${id(1)}' and account_id='100' and counterparty_id='200' and message_count=1 from private.instagram_conversations`,"t");
 await scalar("select generation=1 and content_text='synthetic' and direction='inbound' from private.instagram_messages","t");
});
test("concurrent_duplicate_mid_exactly_one_message_update",async()=>{
 const replies=await Promise.all(Array.from({length:12},()=>ingest([message()])));assert.ok(replies.every(r=>r.status==="committed"));
 await scalar("select count(*) from private.instagram_messages",1);await scalar("select message_count from private.instagram_conversations",1);
});
test("concurrent_distinct_mids_one_conversation_with_exact_count",async()=>{
 await Promise.all(Array.from({length:8},(_,n)=>ingest([message(`mid.${n}`)])));
 await scalar("select count(*) from private.instagram_conversations",1);await scalar("select message_count from private.instagram_conversations",8);await scalar("select count(*) from private.instagram_messages",8);
});
test("duplicate_with_different_timestamp_never_resets_ingress_or_count",async()=>{
 await ingest([message()]);const before=await sql("select received_at::text from private.instagram_messages");
 await ingest([{...message(),rawTimestamp:999,rawEntryTimestamp:null}]);await scalar("select message_count from private.instagram_conversations",1);await scalar("select received_at::text from private.instagram_messages",before);
});
test("same_mid_conflicting_content_quarantined_without_overwrite",async()=>{
 await ingest([message()]);await ingest([message("mid.1","100","200","changed")]);await scalar("select content_text from private.instagram_messages","synthetic");await scalar("select reason from private.instagram_webhook_quarantine","MESSAGE_ID_CONFLICT");await scalar("select message_count from private.instagram_conversations",1);
});
test("same_mid_foreign_participant_never_reassigns_conversation",async()=>{
 await ingest([message()]);await ingest([message("mid.1","100","300")]);await scalar("select counterparty_id from private.instagram_conversations","200");await scalar("select reason from private.instagram_webhook_quarantine","MESSAGE_ID_CONFLICT");
});
test("same_counterparty_and_mid_are_account_scoped",async()=>{
 await bind(2,"101");await ingest([message(),message("mid.1","101")]);await scalar("select count(*) from private.instagram_messages",2);await scalar("select count(*) from private.instagram_conversations",2);await scalar("select count(distinct company_id) from private.instagram_messages",2);
});
test("different_counterparties_have_independent_conversations",async()=>{
 await ingest([message(),message("mid.2","100","201")]);await scalar("select count(*) from private.instagram_conversations",2);
});
test("non_text_marker_only",async()=>{
 await ingest([{...message(),content:{kind:"non_text"}}]);await scalar("select content_kind='non_text' and content_text is null from private.instagram_messages","t");
});
test("raw_timestamp_scalars_preserved_without_units_or_window_claim",async()=>{
 await ingest([message(),{...message("mid.2"),rawTimestamp:null,rawEntryTimestamp:"unknown-unit"}]);await scalar("select raw_timestamp::text from private.instagram_messages where provider_mid='mid.1'",'"opaque"');await scalar("select raw_entry_timestamp::text from private.instagram_messages where provider_mid='mid.2'",'"unknown-unit"');
});
test("unknown_professional_account_only_quarantine_metadata",async()=>{
 await ingest([message("mid.unknown","999")]);await quarantine("NO_ACTIVE_BINDING");
 await scalar("select count(*) from information_schema.columns where table_schema='private' and table_name='instagram_webhook_quarantine' and column_name in ('payload','content_text','access_token','company_id','sender_id')",0);
});
for(const [name,change,reason] of [
 ["suspended_company","update public.companies set status='suspended' where id='"+id(1)+"'","INACTIVE_BINDING"],
 ["stale_generation","update private.instagram_company_generations set generation=2","INACTIVE_BINDING"],
 ["expired_provider","update private.instagram_company_links set authorization_expires_at=clock_timestamp()-interval '1 second'","INACTIVE_BINDING"],
 ["disabled_contract","update private.instagram_provider_contracts set enabled=false","INACTIVE_BINDING"],
 ["missing_permission","update private.instagram_company_links set permissions=array[]::text[]","INACTIVE_BINDING"],
])test(name+"_never_authorizes_new_message",async()=>{await sql(change);await ingest([message()]);await quarantine(reason);});
test("native_oauth_session_expiry_does_not_create_browser_webhook_authority",async()=>{
 await sql("update auth.sessions set not_after=clock_timestamp()-interval '1 second'");await ingest([message()]);await scalar("select count(*) from private.instagram_messages",1);
});
test("same_company_reconnect_uses_db_current_generation_preserves_old_messages",async()=>{
 await ingest([message()]);const old=await sql("select link_id from private.instagram_messages");await bind(1,"100",2);await ingest([message("mid.new")]);await scalar("select generation from private.instagram_messages where provider_mid='mid.new'",2);await scalar("select link_id from private.instagram_messages where provider_mid='mid.1'",old);await scalar("select count(*) from private.instagram_conversations",1);
});
test("after_company_transfer_unknown_new_mid_quarantined",async()=>{
 await transfer();await ingest([message()]);await quarantine("ACCOUNT_HISTORY_AMBIGUOUS");
});
test("historical_duplicate_after_transfer_never_moves_company",async()=>{
 await ingest([message()]);await transfer();await ingest([message()]);await scalar("select company_id from private.instagram_messages",id(1));await scalar("select count(*) from private.instagram_messages",1);await scalar("select count(*) from private.instagram_webhook_quarantine",0);
});
test("unknown_read_retained_unassigned_without_current_company_guess",async()=>{
 await ingest([read()]);await scalar("select count(*) from private.instagram_webhook_receipts",1);await scalar("select company_id is null and message_id is null from private.instagram_webhook_receipts","t");await scalar("select count(*) from private.instagram_messages",0);
});
test("out_of_order_read_attaches_only_to_exact_historical_outbound_identity",async()=>{
 await ingest([read(),echo()]);await scalar("select company_id from private.instagram_webhook_receipts",id(1));await scalar("select read_observed_at is not null from private.instagram_messages","t");
});
test("read_for_inbound_mid_does_not_fabricate_outbound_receipt",async()=>{
 await ingest([message(),read("mid.1")]);await scalar("select message_id is null from private.instagram_webhook_receipts","t");await scalar("select read_observed_at is null from private.instagram_messages","t");
});
test("foreign_read_participant_retained_unassigned",async()=>{
 await ingest([echo(),read("mid.out","100","300")]);await scalar("select message_id is null from private.instagram_webhook_receipts","t");await scalar("select read_observed_at is null from private.instagram_messages","t");
});
test("receipt_after_company_transfer_retains_historical_company_link",async()=>{
 await ingest([echo()]);const old=await sql("select link_id from private.instagram_messages");await transfer();await ingest([read()]);await scalar("select company_id from private.instagram_webhook_receipts",id(1));await scalar("select link_id from private.instagram_webhook_receipts",old);
});
test("duplicate_read_stable_identity_dedup_not_raw_timestamp",async()=>{
 await ingest([echo(),read()]);await ingest([{...read(),rawTimestamp:1000}]);await scalar("select count(*) from private.instagram_webhook_receipts",1);
});
test("read_unknown_account_retained_without_access_to_company",async()=>{
 await ingest([read("mid.unknown","999")]);await scalar("select company_id is null from private.instagram_webhook_receipts","t");
});
test("whole_batch_fault_rolls_back_conversation_message_and_quarantine",async()=>{
 await sql("create function private.ig_ingest_fixture_fault() returns trigger language plpgsql as $$begin if new.provider_mid='mid.fail' then raise exception 'SYNTHETIC_FAULT';end if;return new;end;$$;create trigger ig_ingest_fixture_fault before insert on private.instagram_messages for each row execute function private.ig_ingest_fixture_fault()");
 try{await assert.rejects(ingest([message("mid.unknown","999"),message(),message("mid.fail")]));await scalar("select count(*) from private.instagram_messages",0);await scalar("select count(*) from private.instagram_conversations",0);await scalar("select count(*) from private.instagram_webhook_quarantine",0);}finally{await sql("drop trigger ig_ingest_fixture_fault on private.instagram_messages;drop function private.ig_ingest_fixture_fault()");}
});
test("forged_company_generation_extra_fields_rejected_before_writes",async()=>{
 const payload={...batch([{...message(),companyId:id(2),generation:42}]),companyId:id(2)};
 const result=JSON.parse(await sql(`set role service_role;select public.instagram_ingest_webhook(${lit(JSON.stringify(payload))}::jsonb)`));assert.equal(result.status,"retryable");await scalar("select count(*) from private.instagram_messages",0);
});
test("malformed_supported_neighbor_never_partially_commits",async()=>{
 assert.equal((await ingest([message(),{...message("mid.bad"),recipientId:"300"}])).status,"retryable");await scalar("select count(*) from private.instagram_messages",0);
});
test("default_acl_replica_revoked_on_rpc_and_private_tables",async()=>{
 for(const role of ["anon","authenticated"]){await scalar(`select has_function_privilege('${role}','public.instagram_ingest_webhook(jsonb)','execute')`,"f");await assert.rejects(sql(`set role ${role};select public.instagram_ingest_webhook('{}')`));}
 await scalar("select has_function_privilege('service_role','public.instagram_ingest_webhook(jsonb)','execute')","t");
 for(const role of ["anon","authenticated","service_role"]){for(const table of ["instagram_conversations","instagram_messages","instagram_webhook_receipts","instagram_webhook_quarantine"]){await scalar(`select has_table_privilege('${role}','private.${table}','select,insert,update,delete')`,"f");await assert.rejects(sql(`set role ${role};select * from private.${table}`));}}
 await scalar("select bool_and(relrowsecurity) from pg_class where relnamespace='private'::regnamespace and relname in ('instagram_conversations','instagram_messages','instagram_webhook_receipts','instagram_webhook_quarantine')","t");
 await scalar("select prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='public.instagram_ingest_webhook(jsonb)'::regprocedure","t");
});
test("rls_defense_in_depth_denies_even_accidental_authenticated_read_grant",async()=>{
 await ingest([message()]);await sql("grant usage on schema private to authenticated;grant select on private.instagram_messages to authenticated");
 try{await scalar("set role authenticated;select count(*) from private.instagram_messages",0);}finally{await sql("revoke select on private.instagram_messages from authenticated;revoke usage on schema private from authenticated");}
});
test("authority_contention_retryable_no_partial_effect",async()=>{
 const held=session("begin;select generation from private.instagram_company_generations for update;select 'READY';",{keepOpen:true});
 await marker(held);try{assert.equal((await ingest([message()])).status,"retryable");await scalar("select count(*) from private.instagram_messages",0);}finally{held.child.stdin.end("rollback;\n");await held.done;}
});
test("account_gate_wait_rechecks_provider_expiry_before_storage",async()=>{
 await sql("update private.instagram_company_links set authorization_expires_at=clock_timestamp()+interval '1 second'");
 const held=session("begin;select pg_advisory_xact_lock(87420106,hashtext('100'));select 'READY';",{keepOpen:true});await marker(held);const pending=ingest([message()]);
 await sql("select pg_sleep(1.2)");held.child.stdin.end("commit;\n");await held.done;assert.equal((await pending).status,"committed");await quarantine("INACTIVE_BINDING");
});
test("cross_account_reversed_batches_serialize_without_deadlock",async()=>{
 await bind(2,"101");const replies=await Promise.all([ingest([message("a","100"),message("b","101")]),ingest([message("b","101"),message("a","100")])]);assert.ok(replies.every(r=>r.status==="committed"));await scalar("select count(*) from private.instagram_messages",2);
});
test("expiry_during_storage_wait_rolls_back_whole_batch",async()=>{
 await sql("update private.instagram_company_links set authorization_expires_at=clock_timestamp()+interval '1 second';create function private.ig_ingest_fixture_delay() returns trigger language plpgsql as $$begin perform pg_sleep(1.2);return new;end;$$;create trigger ig_ingest_fixture_delay before insert on private.instagram_messages for each row execute function private.ig_ingest_fixture_delay()");
 try{assert.equal((await ingest([message("mid.unknown","999"),message()])).status,"retryable");await scalar("select count(*) from private.instagram_messages",0);await scalar("select count(*) from private.instagram_conversations",0);await scalar("select count(*) from private.instagram_webhook_quarantine",0);}finally{await sql("drop trigger ig_ingest_fixture_delay on private.instagram_messages;drop function private.ig_ingest_fixture_delay()");}
});
test("earlier_account_expiry_during_later_storage_rolls_back_whole_batch",async()=>{
 await bind(2,"101");
 await sql("update private.instagram_company_links set authorization_expires_at=clock_timestamp()+interval '1 second' where account_id='100';create function private.ig_ingest_fixture_later_delay() returns trigger language plpgsql as $$begin if new.account_id='101' then perform pg_sleep(1.2);end if;return new;end;$$;create trigger ig_ingest_fixture_later_delay before insert on private.instagram_messages for each row execute function private.ig_ingest_fixture_later_delay()");
 try{assert.equal((await ingest([message("mid.first","100"),message("mid.later","101")])).status,"retryable");await scalar("select count(*) from private.instagram_messages",0);await scalar("select count(*) from private.instagram_conversations",0);}finally{await sql("drop trigger ig_ingest_fixture_later_delay on private.instagram_messages;drop function private.ig_ingest_fixture_later_delay()");}
});
export async function marker(held){for(let n=0;n<150;n++){if(held.output().includes("READY"))return;await new Promise(r=>setTimeout(r,10));}throw Error("LOCAL_LOCK_MARKER_TIMEOUT");}
export async function run(){let count=0;const selected=cases.filter(([name])=>!process.env.VELORA_IG_INGEST_CASE_FILTER||name.includes(process.env.VELORA_IG_INGEST_CASE_FILTER));try{await setup();console.log("PROFILE: isolated PostgreSQL17.6; reviewed connection/Vault SQL double for synthetic binding only, not actual Vault/Auth/provider proof.");for(const [name,fn] of selected){await reset();await fn();console.log("PASS "+name);count++;}console.log(`PASS ${count}/${selected.length} ingestion PostgreSQL cases`);}finally{await cleanup();}}
if(process.argv[1]?.endsWith("run-postgres.mjs"))await run();
