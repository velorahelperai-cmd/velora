import {sql,rows,lit,session} from "./postgres.mjs";
import {overlap} from "./concurrency.mjs";
const json=output=>JSON.parse(output.split("\n").find(line=>line.startsWith("{")));
const assert=(condition,message)=>{if(!condition)throw Error(message);};
async function observe(name,predicate){for(let i=0;i<100;i++){const activity=await rows(`SELECT pid,wait_event_type,wait_event FROM pg_stat_activity WHERE application_name=${lit(name)}`);if(activity[0]&&predicate(activity[0]))return activity[0];await new Promise(resolve=>setTimeout(resolve,40));}throw Error("REAL_LOCK_EVIDENCE_MISSING");}

export async function runMetaConcurrency(){
 const results=[];
 async function test(name,body){try{await body();results.push({name,status:"PASS"});console.log(`PASS|${name}`);}catch(e){results.push({name,status:"FAIL",error:e.message});console.log(`FAIL|${name}|${e.message}`);}}
 await test("two Auth connections cannot consume the same signup code attempt twice",async()=>{
  const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(false);"));
  const session=(await rows(`SELECT id FROM auth.sessions WHERE user_id=${lit(f.user)}::uuid ORDER BY created_at DESC LIMIT 1`))[0].id;
  await sql(`INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(session)}::uuid,${lit(f.user)}::uuid,clock_timestamp()) ON CONFLICT(session_id) DO UPDATE SET last_activity_at=excluded.last_activity_at;`);
  const attempt=crypto.randomUUID(),nonce=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
  const auth=`SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${lit(f.user)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:f.user,session_id:session,role:"authenticated"}))};`;
  const started=json(await sql(`BEGIN;${auth} SELECT whatsapp_start_embedded_signup(${lit(f.company)}::uuid,${lit(attempt)}::uuid,${lit(nonce)},false,'111','444','v25.0');COMMIT;`));
  assert(started.ok,"signup not started");
  const claim=`${auth}SELECT whatsapp_claim_embedded_signup(${lit(f.company)}::uuid,${lit(attempt)}::uuid,${lit(nonce)})`;
  // overlap() provides independent backend PIDs and observes a real Lock wait.
  const [a,b]=await overlap(claim,`BEGIN;${claim};COMMIT;`);
  assert(json(a).ok===true&&json(b).code==="CONSUMED","both connections consumed the code");
 });
 await test("credential replacement committed during old token revocation prevents deleting the renewed grant",async()=>{
  const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(false);"));
  const l=(await rows(`SELECT generation,provider_phone_number_id FROM whatsapp_company_links WHERE id=${lit(f.link)}::uuid`))[0];
  // This synthetic Vault rotation uses the real link generation trigger.
  const rotate=`UPDATE whatsapp_company_links SET access_secret_id=vault.create_secret('synthetic-renewed-credential') WHERE id=${lit(f.link)}::uuid`;
  const reject=`SELECT to_jsonb(whatsapp_revoke_failed_credential(${lit(f.company)}::uuid,${lit(f.link)}::uuid,${lit(l.provider_phone_number_id)},${l.generation},190))`;
  const [,output]=await overlap(rotate,reject);
  assert(output.trim()==="false","old response revoked a new generation");
  const current=(await rows(`SELECT status,generation,access_secret_id FROM whatsapp_company_links WHERE id=${lit(f.link)}::uuid`))[0];
  assert(current.status==="verified"&&Number(current.generation)===Number(l.generation)+1&&current.access_secret_id,"renewed credential was damaged");
 });
 await test("confirmed token rejection follows company-before-intent order alongside usage settlement",async()=>{
  const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company();"));
  const j=await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);
  const claim=json(await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(j)}::uuid,120);`));
  await sql(`SET ROLE service_role;SELECT whatsapp_reserve_job_usage(${lit(j)}::uuid,${lit(claim.claim_token)}::uuid);SELECT test_fixture.draft(${lit(JSON.stringify(f))}::jsonb,${lit(j)}::uuid,${lit(claim.claim_token)}::uuid);`);
  const a=(await rows(`SELECT id,source_citations FROM ai_usage_ledger WHERE worker_job_id=${lit(j)}::uuid`))[0];
  const staged=json(await sql(`SET ROLE service_role;SELECT whatsapp_stage_job_reply(${lit(j)}::uuid,${lit(claim.claim_token)}::uuid,${lit(a.id)}::uuid,${lit(JSON.stringify(a.source_citations))}::jsonb);`));
  const sending=json(await sql(`SET ROLE service_role;SELECT whatsapp_claim_assistant_job_send(${lit(j)}::uuid,${lit(claim.claim_token)}::uuid);`));
  const prefix=crypto.randomUUID().slice(0,8),left=`meta_usage_${prefix}`,right=`meta_receipt_${prefix}`;
  const first=session(`BEGIN;SET LOCAL ROLE service_role;SELECT id FROM companies WHERE id=${lit(f.company)}::uuid FOR UPDATE;SELECT pg_sleep(3);SELECT id FROM whatsapp_send_intents WHERE id=${lit(staged.intent_id)}::uuid FOR UPDATE;COMMIT;`,left);
  const pa=await observe(left,x=>x.wait_event==="PgSleep");
  const second=session(`SET ROLE service_role;SELECT finalize_whatsapp_send_attempt(${lit(staged.intent_id)}::uuid,${lit(sending.attempt_token)}::uuid,'rejected',null,'graph_190',null);`,right);
  const pb=await observe(right,x=>x.wait_event_type==="Lock");
  assert(pa.pid!==pb.pid,"same PostgreSQL connection reused");console.log("REAL_PG_FINALIZER_LOCK",JSON.stringify({companyLocker:pa.pid,finalizer:pb.pid,wait:pb.wait_event_type}));
  const [,output]=await Promise.all([first.done,second.done]);assert(json(output).ok===true,"confirmed rejection did not finish");
  assert((await rows(`SELECT outcome,provider_error_code FROM whatsapp_send_intents WHERE id=${lit(staged.intent_id)}::uuid`))[0].provider_error_code==="graph_190","confirmed error evidence changed");
 });
 console.log("META_CONCURRENCY_RESULTS",JSON.stringify({passed:results.filter(r=>r.status==="PASS").length,failed:results.filter(r=>r.status==="FAIL").length,notRun:0}));
 return results;
}
