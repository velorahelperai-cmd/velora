import {sql,rows,lit,session} from "./postgres.mjs";
const json=output=>JSON.parse(output.split("\n").find(line=>line.startsWith("{")));
const assert=(condition,message)=>{if(!condition)throw Error(message);};
async function observe(name,predicate){for(let i=0;i<100;i++){const state=await rows(`SELECT pid,wait_event_type,wait_event FROM pg_stat_activity WHERE application_name=${lit(name)}`);if(state[0]&&predicate(state[0]))return state[0];await new Promise(resolve=>setTimeout(resolve,40));}throw Error("REAL_RECOVERY_LOCK_NOT_OBSERVED");}
async function acceptedPending(){
 const f=json(await sql("SET ROLE service_role;SELECT test_fixture.company();")),source=lit(JSON.stringify(f));
 const j=await sql(`SET ROLE service_role;SELECT test_fixture.job(${source}::jsonb);`),claim=json(await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(j)}::uuid,120);`));
 await sql(`SET ROLE service_role;SELECT whatsapp_reserve_job_usage(${lit(j)}::uuid,${lit(claim.claim_token)}::uuid);SELECT test_fixture.draft(${source}::jsonb,${lit(j)}::uuid,${lit(claim.claim_token)}::uuid);`);
 const draft=(await rows(`SELECT id,source_citations FROM ai_usage_ledger WHERE worker_job_id=${lit(j)}::uuid`))[0];
 const staged=json(await sql(`SET ROLE service_role;SELECT whatsapp_stage_job_reply(${lit(j)}::uuid,${lit(claim.claim_token)}::uuid,${lit(draft.id)}::uuid,${lit(JSON.stringify(draft.source_citations))}::jsonb);`));
 const sending=json(await sql(`SET ROLE service_role;SELECT whatsapp_claim_assistant_job_send(${lit(j)}::uuid,${lit(claim.claim_token)}::uuid);`));
 const pending=json(await sql(`BEGIN;
 CREATE FUNCTION pg_temp.reject_recovery_display() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF new.sender='assistant' THEN RAISE EXCEPTION 'synthetic retained acceptance test';END IF;RETURN new;END;$$;
 CREATE TRIGGER synthetic_recovery_outage BEFORE INSERT ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_recovery_display();
 SET LOCAL ROLE service_role;SELECT finalize_whatsapp_send_attempt(${lit(staged.intent_id)}::uuid,${lit(sending.attempt_token)}::uuid,'accepted',${lit(`synthetic-recovery-${crypto.randomUUID()}`)},null,null);RESET ROLE;
 DROP TRIGGER synthetic_recovery_outage ON whatsapp_messages;DROP FUNCTION pg_temp.reject_recovery_display();COMMIT;`));
 assert(pending.ok===true&&pending.persist_pending===true,"synthetic accepted receipt was not retained");return {f,j,intent:staged.intent_id};
}
export async function runRecoveryConcurrency(){
 const name="accepted-receipt repair and worker locks cannot deadlock or duplicate the saved response";
 const prepared=await acceptedPending(),tag=crypto.randomUUID().slice(0,8),left=`recovery_worker_${tag}`,right=`recovery_receipt_${tag}`;
 let first,second;
 try{
  first=session(`BEGIN;SET LOCAL ROLE service_role;SELECT id FROM companies WHERE id=${lit(prepared.f.company)}::uuid FOR NO KEY UPDATE;SELECT pg_sleep(3);SELECT id FROM whatsapp_conversations WHERE id=${lit(prepared.f.conversation)}::uuid FOR UPDATE;SELECT id FROM whatsapp_send_intents WHERE id=${lit(prepared.intent)}::uuid FOR UPDATE;COMMIT;`,left);
  const a=await observe(left,s=>s.wait_event==="PgSleep");
  second=session("SET ROLE service_role;SELECT whatsapp_repair_accepted_jobs(50);",right);
  // Attach both rejection handlers immediately, including the intentionally red deadlock case.
  const completed=Promise.allSettled([first.done,second.done]);
  const b=await observe(right,s=>s.wait_event_type==="Lock");assert(a.pid!==b.pid,"recovery test reused a backend");console.log("REAL_RECOVERY_LOCK",JSON.stringify({worker:a.pid,repair:b.pid,wait:b.wait_event_type}));
  const result=await completed;for(const row of result)if(row.status==="rejected")throw row.reason;
  assert(json(result[1].value).ok===true,"receipt repair did not complete");
  const state=(await rows(`SELECT i.outcome,i.message_id,j.status,j.usage_status,(SELECT count(*) FROM whatsapp_messages m WHERE m.wa_message_id=i.wa_message_id) AS messages FROM whatsapp_send_intents i JOIN whatsapp_inbound_jobs j ON j.id=i.original_job_id WHERE i.id=${lit(prepared.intent)}::uuid`))[0];
  assert(state.outcome==="accepted"&&state.message_id&&state.status==="completed"&&state.usage_status==="accepted"&&state.messages===1,"recovery duplicated/lost accepted response or usage");
  console.log(`PASS|${name}`);return [{name,status:"PASS"}];
 }catch(error){await Promise.allSettled([first?.done,second?.done].filter(Boolean));console.log(`FAIL|${name}|${error.message}`);return [{name,status:"FAIL",error:error.message}];}
}
