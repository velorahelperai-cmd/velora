import {sql,rows,lit} from "./postgres.mjs";
import {overlap} from "./concurrency.mjs";
const json=output=>JSON.parse(output.split("\n").find(line=>line.startsWith("{")));
const assert=(condition,message)=>{if(!condition)throw Error(message);};
async function fixture(){
 const f=json(await sql("SET ROLE service_role;SELECT test_fixture.company();"));
 const sid=(await rows(`SELECT id FROM auth.sessions WHERE user_id=${lit(f.user)}::uuid LIMIT 1`))[0].id;
 await sql(`INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(sid)}::uuid,${lit(f.user)}::uuid,clock_timestamp());`);
 const auth=`SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(f.user)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:f.user,session_id:sid,role:"authenticated"}))};`;
 return {...f,auth};
}
export async function runInboxConcurrency(){
 const results=[];
 async function test(name,body){try{await body();results.push({name,status:"PASS"});console.log(`PASS|${name}`);}catch(e){results.push({name,status:"FAIL",error:e.message});console.log(`FAIL|${name}|${e.message}`);}}
 await test("same-thread insert serialization assigns arrival order before a later commit can pass it",async()=>{
  const f=await fixture(),source=lit(JSON.stringify(f));
  const save=`SELECT test_fixture.job(${source}::jsonb)`;
  const [first,second]=await overlap(save,save);
  const a=first.split("\n").find(line=>/^[0-9a-f-]{36}$/.test(line)),b=second.trim();
  const messages=await rows(`SELECT j.id,m.arrival_sequence FROM whatsapp_inbound_jobs j JOIN whatsapp_messages m ON m.id=j.message_id WHERE j.id IN (${lit(a)}::uuid,${lit(b)}::uuid)`);
  assert(messages.length===2&&Number(messages.find(x=>x.id===a).arrival_sequence)<Number(messages.find(x=>x.id===b).arrival_sequence),"late lower sequence could hide behind read cursor");
 });
 await test("concurrent read acknowledgement and new displayed inbound keep the new message unread",async()=>{
  const f=await fixture();
  await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);
  const displayed=json(await sql(`BEGIN;${f.auth}SELECT whatsapp_thread_page(${lit(f.company)}::uuid,${lit(f.conversation)}::uuid,100,null);COMMIT;`));
  assert(displayed.ok&&displayed.displayed_inbound_message_id,"initial displayed boundary not issued");
  const ack=`${f.auth}SELECT whatsapp_mark_thread_read(${lit(f.company)}::uuid,${lit(f.conversation)}::uuid,${lit(displayed.displayed_inbound_message_id)}::uuid)`;
  const incoming=`BEGIN;SET LOCAL ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);${f.auth}SELECT whatsapp_thread_page(${lit(f.company)}::uuid,${lit(f.conversation)}::uuid,100,null);COMMIT;`;
  const [oldAck,newPage]=await overlap(ack,incoming);
  assert(json(oldAck).unread_count===0&&json(newPage).unread_count===1,"new inbound disappeared behind older read acknowledgement");
  const replay=json(await sql(`BEGIN;${ack};COMMIT;`));assert(replay.code==="display_changed","stale rendered tab consumed newer displayed boundary");
 });
 console.log("INBOX_CONCURRENCY_RESULTS",JSON.stringify({passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,notRun:0}));
 return results;
}
