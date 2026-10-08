import {sql,rows,session,lit} from "./postgres.mjs";
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const json=output=>JSON.parse(output.split("\n").find(x=>x.startsWith("{")));
async function wait(name,predicate){for(let n=0;n<100;n++){const r=await rows(`SELECT pid,wait_event_type,wait_event FROM pg_stat_activity WHERE application_name=${lit(name)}`);if(r[0]&&predicate(r[0]))return r[0];await new Promise(r=>setTimeout(r,40));}throw Error("LOCK_EVIDENCE_TIMEOUT");}
export async function overlap(first,second){
 const id=crypto.randomUUID().slice(0,8),an=`wa_a_${id}`,bn=`wa_b_${id}`;
 const a=session(`BEGIN;SET LOCAL ROLE service_role;${first};SELECT pg_sleep(3);COMMIT;`,an);
 const pa=await wait(an,x=>x.wait_event==="PgSleep");const b=session(`SET ROLE service_role;${second};`,bn);
 const pb=await wait(bn,x=>x.wait_event_type==="Lock");assert(pa.pid!==pb.pid,"not independent PostgreSQL sessions");
 console.log("REAL_PG_LOCK",JSON.stringify({first:pa.pid,second:pb.pid,wait:pb.wait_event_type}));
 return Promise.all([a.done,b.done]);
}
async function tenant(cap=2){return json(await sql(`SET ROLE service_role;SELECT test_fixture.company(true,${cap});`));}
async function job(f){return (await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`)).trim();}
const claim=j=>`SELECT public.claim_whatsapp_inbound_job(${lit(j)}::uuid,120)`;
async function secondConversation(f){const c=crypto.randomUUID();await sql(`SET ROLE service_role;INSERT INTO whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,automation_allowed)
 SELECT ${lit(c)}::uuid,company_id,phone_number_id,'synthetic-other-recipient',true FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid;`);return {...f,conversation:c};}
const results=[];async function test(name,body){try{await body();results.push({name,status:"PASS"});console.log(`PASS|${name}`);}catch(e){results.push({name,status:"FAIL",error:e.message});console.log(`FAIL|${name}|${e.message}`);}}
export async function runConcurrency(){
 await test("concurrent duplicate inbound creates one original message/job/conversation",async()=>{
 const f=await tenant(),phone=(await rows(`SELECT phone_number_id FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid`))[0].phone_number_id;
 const wamid=`synthetic-duplicate-${crypto.randomUUID()}`;
 const save=`SELECT save_whatsapp_inbound(${lit(f.company)}::uuid,${lit(phone)},'synthetic-new-customer','',${lit(wamid)},'Synthetic question','text',clock_timestamp())`;
 const [a,b]=await overlap(save,save);const ra=json(a),rb=json(b);assert(ra.message_id===rb.message_id&&ra.job_id===rb.job_id,"duplicate split logical identity");
 const counts=(await rows(`SELECT (SELECT count(*) FROM whatsapp_messages WHERE wa_message_id=${lit(wamid)}) AS messages,(SELECT count(*) FROM whatsapp_inbound_jobs WHERE wa_message_id=${lit(wamid)}) AS jobs`))[0];assert(counts.messages===1&&counts.jobs===1,"duplicate durable rows");
 });
 await test("concurrent same-conversation claims preserve FIFO and one active job",async()=>{
 const f=await tenant(),a=await job(f),b=await job(f);const [x,y]=await overlap(claim(a),claim(b));assert(json(x).ok===true&&json(y).ok===false,"parallel conversation execution allowed");
 });
 await test("two conversations race for the last message slot without quota overspend",async()=>{
 const f=await tenant(1),f2=await secondConversation(f),a=await job(f),b=await job(f2);
 const ca=json(await sql(`SET ROLE service_role;${claim(a)};`)),cb=json(await sql(`SET ROLE service_role;${claim(b)};`));
 const reserve=(j,c)=>`SELECT whatsapp_reserve_job_usage(${lit(j)}::uuid,${lit(c.claim_token)}::uuid)`;
 const [x,y]=await overlap(reserve(a,ca),reserve(b,cb));assert(json(x).ok===true&&json(y).code==="usage_limit_reached","concurrent capacity exceeded");
 });
 await test("two independent AI reservations cannot exceed one company's configured budget",async()=>{
 const f=await tenant(2),f2=await secondConversation(f),a=await job(f),b=await job(f2);
 const ca=json(await sql(`SET ROLE service_role;${claim(a)};`)),cb=json(await sql(`SET ROLE service_role;${claim(b)};`));
 for(const [j,c] of [[a,ca],[b,cb]])await sql(`SET ROLE service_role;SELECT whatsapp_reserve_job_usage(${lit(j)}::uuid,${lit(c.claim_token)}::uuid);`);
 await sql(`SET ROLE service_role;INSERT INTO ai_budget_accounts(scope,company_id,limit_baisa,enabled) VALUES('company_live',${lit(f.company)}::uuid,10,true);`);
 const citations=lit(JSON.stringify([{sourceId:f.knowledge,title:"Synthetic knowledge",contentVersion:1}]));
 const reserve=(j,c)=>`SELECT ai_reserve_whatsapp_attempt(${lit(crypto.randomUUID())}::uuid,${lit(j)}::uuid,${lit(c.claim_token)}::uuid,1,'gpt-6-luna','openai',6,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',${citations}::jsonb)`;
 const [x,y]=await overlap(reserve(a,ca),reserve(b,cb));assert(json(x).ok===true&&json(y).code==="BUDGET_EXCEEDED","AI budget overspent");
 const budget=(await rows(`SELECT spent_baisa+held_baisa<=limit_baisa AS safe FROM ai_budget_accounts WHERE company_id=${lit(f.company)}::uuid`))[0];assert(budget.safe,"invalid durable budget state");
 });
 await test("human takeover committed during send claim lock wait prevents dispatch",async()=>{
 const f=await tenant(),j=await job(f),c=json(await sql(`SET ROLE service_role;${claim(j)};`));
 await sql(`SET ROLE service_role;SELECT whatsapp_reserve_job_usage(${lit(j)}::uuid,${lit(c.claim_token)}::uuid);SELECT test_fixture.draft(${lit(JSON.stringify(f))}::jsonb,${lit(j)}::uuid,${lit(c.claim_token)}::uuid);`);
 const a=(await rows(`SELECT id,source_citations FROM ai_usage_ledger WHERE worker_job_id=${lit(j)}::uuid`))[0];
 await sql(`SET ROLE service_role;SELECT whatsapp_stage_job_reply(${lit(j)}::uuid,${lit(c.claim_token)}::uuid,${lit(a.id)}::uuid,${lit(JSON.stringify(a.source_citations))}::jsonb);`);
 const takeover=`SELECT set_config('velora.conversation_control','1',true);UPDATE whatsapp_conversations SET automation_allowed=false,status='handed_over',automation_generation=automation_generation+1 WHERE id=${lit(f.conversation)}::uuid`;
 const [,result]=await overlap(takeover,`SELECT whatsapp_claim_assistant_job_send(${lit(j)}::uuid,${lit(c.claim_token)}::uuid)`);
 assert(json(result).ok===false,"send survived takeover generation fence");
 });
 console.log("CONCURRENCY_RESULTS",JSON.stringify({passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,notRun:0,results}));
 if(results.some(x=>x.status==="FAIL"))process.exitCode=1;return results;
}
