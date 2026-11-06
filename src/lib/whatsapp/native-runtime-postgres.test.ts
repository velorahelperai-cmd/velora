import {createHmac,randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import type {AnswerCitation} from "@/lib/answers/types";
import type {IntegrationFrame,IntegrationPorts} from "./integration-worker";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({
 admin:null as unknown,
 model:vi.fn(),
 send:vi.fn(),
 hookPorts:null as null|((ports:IntegrationPorts)=>IntegrationPorts)
}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>state.admin}));
vi.mock("@/lib/answers/runtime/provider",()=>({callRealModel:state.model}));
vi.mock("@/lib/whatsapp/send",()=>({sendWhatsappText:state.send}));
// The local Windows database cannot load Supabase Vault. All other worker
// ports remain real; this only supplies a synthetic provider credential.
vi.mock("@/lib/whatsapp/integration-store",async(importOriginal)=>{
 const original=await importOriginal<typeof import("@/lib/whatsapp/integration-store")>();
 return {
  ...original,
  createIntegrationPorts:(...args:Parameters<typeof original.createIntegrationPorts>)=>{
   const ports=original.createIntegrationPorts(...args);
   const wrapped={...ports,secret:async()=>"synthetic-local-provider-token"};
   return state.hookPorts?state.hookPorts(wrapped):wrapped;
  }
 };
});
// @ts-expect-error This opt-in helper accepts only the task's isolated cluster.
import {nativeIngressFixture} from "../../../scripts/whatsapp-integration/native-ingress-fixture.mjs";
import {POST as receive} from "@/app/api/whatsapp/webhook/route";
import {POST as consume} from "@/app/api/internal/whatsapp/worker/route";

const enabled=process.env.WA_NATIVE_INGRESS_TESTS==="1";
const appSecret="synthetic-local-webhook-secret",workerSecret="synthetic-local-worker-secret-at-least-32-characters";
let fixture:Awaited<ReturnType<typeof nativeIngressFixture>>,paid:Awaited<ReturnType<typeof fixture.legacyPaidTenant>>;
function packet(id:string,recipient=paid.asset.recipient){return JSON.stringify({object:"whatsapp_business_account",entry:[{id:paid.asset.waba,changes:[{field:"messages",value:{messaging_product:"whatsapp",metadata:{phone_number_id:paid.asset.phone},messages:[{id,from:recipient,type:"text",timestamp:String(Math.floor(Date.now()/1000)),text:{body:"Synthetic verified answer"}}]}}]}]});}
function webhook(body:string){return new Request("http://localhost.invalid/api/whatsapp/webhook",{method:"POST",headers:{"x-hub-signature-256":`sha256=${createHmac("sha256",appSecret).update(body).digest("hex")}`},body});}
function worker(){return new Request("http://localhost.invalid/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:`Bearer ${workerSecret}`}});}

describe.skipIf(!enabled)("legacy WhatsApp runtime with isolated partial PostgreSQL replay",()=>{
 beforeAll(async()=>{
  fixture=await nativeIngressFixture();paid=await fixture.legacyPaidTenant();state.admin=fixture.adapter;
  for(const [name,value] of Object.entries({WHATSAPP_RECEIVE_ENABLED:"true",WHATSAPP_APP_SECRET:appSecret,WHATSAPP_ROUTING_MODE:"tenant_registry",WHATSAPP_CONFIGURATION_MODE:"live",WHATSAPP_WORKER_ENABLED:"true",WHATSAPP_WORKER_SECRET:workerSecret,WHATSAPP_ALLOW_EXTERNAL_SEND:"true",AI_LIVE_ANSWERING:"true"}))vi.stubEnv(name,value);
  state.model.mockImplementation(async({model,prompt}:{model:string;prompt:string})=>{
   expect(prompt).toContain("Synthetic verified answer");
   return {status:"success",text:"Synthetic verified answer",actualModelId:model,requestId:"synthetic-request",responseId:"synthetic-response",latencyMs:2,usage:{promptTokens:20,completionTokens:10,cachedTokens:5,cacheWriteTokens:3,reasoningTokens:4,totalTokens:30}};
  });
  state.send.mockResolvedValue({ok:true,waMessageId:`synthetic-output-${randomUUID()}`});
  vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{throw Error("EXTERNAL_NETWORK_FORBIDDEN");});
 },30_000);
 afterAll(async()=>{await fixture?.close();vi.unstubAllEnvs();vi.restoreAllMocks();});
 it("runs signed ingress through worker and persists an accepted reply",async()=>{
  const id=`synthetic-runtime-${randomUUID()}`;
  expect((await receive(webhook(packet(id)))).status).toBe(200);
  const response=await consume(worker());const result=await response.json();
  if(process.env.WA_NATIVE_VERBOSE==="1")console.info("SYNTHETIC_WORKER_RESULT",result);
  expect(result).toMatchObject({processed:1,accepted:1,completed:1,delivered:0});
  expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
  const job=await fixture.db.query("select status,usage_status from public.whatsapp_inbound_jobs where wa_message_id=$1",[id]);
  expect(job.rows[0]).toEqual({status:"completed",usage_status:"accepted"});
  const durable=await fixture.db.query("select l.status ai_status,l.source_citations,i.outcome,i.wa_message_id from public.whatsapp_inbound_jobs j join public.ai_usage_ledger l on l.worker_job_id=j.id join public.whatsapp_send_intents i on i.id=j.send_intent_id where j.wa_message_id=$1",[id]);
  expect(durable.rows).toHaveLength(1);expect(durable.rows[0]).toMatchObject({ai_status:"success",outcome:"accepted"});
  expect(durable.rows[0].source_citations).toEqual(expect.arrayContaining([expect.objectContaining({sourceId:paid.tenant.knowledge,contentVersion:1})]));
  expect(durable.rows[0].wa_message_id).toMatch(/^synthetic-output-/);
  expect((await receive(webhook(packet(id)))).status).toBe(200);await consume(worker());
  expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
 },60_000);
 it("retains an unknown provider result without generating or sending twice",async()=>{
  state.model.mockClear();state.send.mockReset();state.send.mockResolvedValue({ok:false,code:"AMBIGUOUS"});
  const id=`synthetic-unknown-${randomUUID()}`;
  expect((await receive(webhook(packet(id)))).status).toBe(200);
  const response=await consume(worker());expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({processed:1,accepted:0,code:"RECONCILIATION_REQUIRED"});
  const saved=await fixture.db.query("select j.status,j.usage_status,i.outcome from public.whatsapp_inbound_jobs j join public.whatsapp_send_intents i on i.id=j.send_intent_id where j.wa_message_id=$1",[id]);
  expect(saved.rows[0]).toEqual({status:"review_required",usage_status:"unknown",outcome:"unknown"});
  await consume(worker());expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
 },60_000);
 it("blocks an automatic send when a human takes over during model generation",async()=>{
  state.model.mockReset();state.send.mockReset();
  const id=`synthetic-takeover-${randomUUID()}`,recipient=`synthetic-recipient-${randomUUID()}`,conversation=randomUUID();
  await fixture.db.query("insert into public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,automation_allowed) values($1,$2,$3,$4,true)",[conversation,paid.tenant.company,paid.asset.phone,recipient]);
  state.model.mockImplementation(async({model}:{model:string})=>{
   await fixture.db.query("begin");
   try{
    await fixture.db.query("select set_config('velora.conversation_control','1',true)");
    await fixture.db.query("update public.whatsapp_conversations set automation_allowed=false,status='handed_over',automation_generation=automation_generation+1 where id=$1",[conversation]);
    await fixture.db.query("commit");
   }catch(error){await fixture.db.query("rollback");throw error;}
   return {status:"success",text:"Synthetic verified answer",actualModelId:model,requestId:"synthetic-request",responseId:"synthetic-response",latencyMs:2,usage:{promptTokens:20,completionTokens:10,cachedTokens:5,cacheWriteTokens:3,reasoningTokens:4,totalTokens:30}};
  });
  expect((await receive(webhook(packet(id,recipient)))).status).toBe(200);
  const response=await consume(worker());const result=await response.json();
  expect(result.accepted).toBe(0);expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).not.toHaveBeenCalled();
  const saved=await fixture.db.query("select j.status,j.usage_status,c.automation_allowed,(select count(*)::int from public.whatsapp_send_intents i where i.original_job_id=j.id) intents,(select count(*)::int from public.ai_usage_ledger l where l.worker_job_id=j.id) ledger_entries from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id join public.whatsapp_conversations c on c.id=m.conversation_id where j.wa_message_id=$1",[id]);
  expect(saved.rows[0]).toMatchObject({automation_allowed:false,intents:0,ledger_entries:1});
 },60_000);
 it("resumes pre-transport failure via abortSend without duplicate generation or deduction",async()=>{
  state.model.mockClear();state.send.mockReset();
  state.send.mockResolvedValue({ok:true,waMessageId:`synthetic-output-${randomUUID()}`});
  const id=`synthetic-pretransport-${randomUUID()}`;
  expect((await receive(webhook(packet(id)))).status).toBe(200);

  let verifyCount=0;
  state.hookPorts=(ports:IntegrationPorts)=>({
   ...ports,
   verify:async(f:IntegrationFrame,citations:AnswerCitation[])=>{
    verifyCount++;
    // v1 (call 1), v2 (call 2), v3 (call 3, post-claimSend before transport)
    if(verifyCount===3){
     return {ok:false,code:"WORKER_UNAVAILABLE"};
    }
    return ports.verify(f,citations);
   }
  });

  const resp1=await consume(worker());
  expect(resp1.status).toBe(503);
  const res1=await resp1.json();
  expect(res1.outcomes?.WORKER_UNAVAILABLE).toBe(1);
  expect(state.model).toHaveBeenCalledTimes(1);
  expect(state.send).toHaveBeenCalledTimes(0);

  // Verify on PostgreSQL: status is retry_wait, answer is preserved, send intent reverted to ready
  const midJob=await fixture.db.query("select status,usage_status,staged_reply from public.whatsapp_inbound_jobs where wa_message_id=$1",[id]);
  expect(midJob.rows[0].status).toBe("retry_wait");
  expect(midJob.rows[0].staged_reply).toBeTruthy();

  const midIntent=await fixture.db.query("select outcome,attempt_token from public.whatsapp_send_intents where original_job_id=(select id from public.whatsapp_inbound_jobs where wa_message_id=$1)",[id]);
  expect(midIntent.rows[0]).toEqual({outcome:"ready",attempt_token:null});

  // Clear hook and make immediately claimable
  state.hookPorts=null;
  await fixture.db.query("update public.whatsapp_inbound_jobs set next_attempt_at=now()-interval '1 second' where wa_message_id=$1",[id]);

  // Recovery run: resumes same job, single send, NO duplicate model generation
  const resp2=await consume(worker());
  expect(resp2.status).toBe(200);
  const res2=await resp2.json();
  expect(res2.outcomes?.ACCEPTED).toBe(1);

  expect(state.model).toHaveBeenCalledTimes(1);
  expect(state.send).toHaveBeenCalledTimes(1);

  const finalJob=await fixture.db.query(
   "select j.status,j.usage_status,(select count(*)::int from public.ai_usage_ledger l where l.worker_job_id=j.id) ledgers,(select count(*)::int from public.whatsapp_send_intents i where i.original_job_id=j.id) intents from public.whatsapp_inbound_jobs j where j.wa_message_id=$1",
   [id]
  );
  expect(finalJob.rows[0]).toEqual({status:"completed",usage_status:"accepted",ledgers:1,intents:1});
 },60_000);
 it("prevents an old attempt token from finalizing after ownership cancellation",async()=>{
  const testIntentId=randomUUID();
  const token1=randomUUID(),token2=randomUUID();
  await fixture.db.query(
   "insert into public.whatsapp_send_intents(id,client_op_id,sender_kind,company_id,conversation_id,link_id,link_generation,phone_number_id,recipient_wa_id,body,outcome,attempt_token,attempt_started_at,attempt_expires_at) values($1,$2,'assistant',$3,$4,$5,(select generation from public.whatsapp_company_links where id=$5),$6,$7,'Test body','attempting',$8,now(),now()+interval '1 minute')",
   [testIntentId,'op-'+randomUUID(),paid.tenant.company,paid.tenant.conversation,paid.tenant.link,paid.asset.phone,paid.asset.recipient,token1]
  );

  // Abort token1 using the adapter from('whatsapp_send_intents').update(...)
  const abortOk=await fixture.adapter.from("whatsapp_send_intents")
   .update({outcome:"ready",attempt_token:null,attempt_started_at:null,attempt_expires_at:null})
   .eq("id",testIntentId)
   .eq("attempt_token",token1)
   .eq("outcome","attempting")
   .select("id");
  expect(abortOk.data).toHaveLength(1);

  // Stale attempt with token1 must fail to finalize
  const staleFinalize=await fixture.adapter.rpc("finalize_whatsapp_send_attempt",{
   p_intent_id:testIntentId,
   p_attempt_token:token1,
   p_result:"accepted",
   p_wa_message_id:"fake-wa-id",
   p_error_code:null,
   p_actor_user_id:null
  });
  expect(staleFinalize.data?.ok).toBe(false);

  const intentAfter=await fixture.db.query("select outcome,attempt_token from public.whatsapp_send_intents where id=$1",[testIntentId]);
  expect(intentAfter.rows[0]).toEqual({outcome:"ready",attempt_token:null});

  // New attempt claims with token2
  await fixture.db.query("update public.whatsapp_send_intents set outcome='attempting',attempt_token=$1,attempt_started_at=now(),attempt_expires_at=now()+interval '1 minute' where id=$2",[token2,testIntentId]);

  // Token1 still rejected
  const staleAgain=await fixture.adapter.rpc("finalize_whatsapp_send_attempt",{
   p_intent_id:testIntentId,
   p_attempt_token:token1,
   p_result:"accepted",
   p_wa_message_id:"fake-wa-id",
   p_error_code:null,
   p_actor_user_id:null
  });
  expect(staleAgain.data?.ok).toBe(false);

  // Token2 succeeds
  const validFinalize=await fixture.adapter.rpc("finalize_whatsapp_send_attempt",{
   p_intent_id:testIntentId,
   p_attempt_token:token2,
   p_result:"accepted",
   p_wa_message_id:"valid-wa-id",
   p_error_code:null,
   p_actor_user_id:null
  });
  expect(validFinalize.data?.ok).toBe(true);
 },60_000);
 it("fails closed to review_required when abortSend fails, preserving accepted and unknown intents",async()=>{
  const acceptedIntentId=randomUUID(),unknownIntentId=randomUUID();
  await fixture.db.query(
   "insert into public.whatsapp_send_intents(id,client_op_id,sender_kind,company_id,conversation_id,link_id,link_generation,phone_number_id,recipient_wa_id,body,outcome) values($1,$2,'assistant',$3,$4,$5,(select generation from public.whatsapp_company_links where id=$5),$6,$7,'Body 1','accepted')",
   [acceptedIntentId,'op-'+randomUUID(),paid.tenant.company,paid.tenant.conversation,paid.tenant.link,paid.asset.phone,paid.asset.recipient]
  );
  await fixture.db.query(
   "insert into public.whatsapp_send_intents(id,client_op_id,sender_kind,company_id,conversation_id,link_id,link_generation,phone_number_id,recipient_wa_id,body,outcome) values($1,$2,'assistant',$3,$4,$5,(select generation from public.whatsapp_company_links where id=$5),$6,$7,'Body 2','unknown')",
   [unknownIntentId,'op-'+randomUUID(),paid.tenant.company,paid.tenant.conversation,paid.tenant.link,paid.asset.phone,paid.asset.recipient]
  );

  // Attempting abortSend on 'accepted' or 'unknown' must return 0 rows (cannot be hijacked)
  const abortAccepted=await fixture.adapter.from("whatsapp_send_intents")
   .update({outcome:"ready",attempt_token:null,attempt_started_at:null,attempt_expires_at:null})
   .eq("id",acceptedIntentId)
   .eq("attempt_token",randomUUID())
   .eq("outcome","attempting")
   .select("id");
  expect(abortAccepted.data).toHaveLength(0);

  const abortUnknown=await fixture.adapter.from("whatsapp_send_intents")
   .update({outcome:"ready",attempt_token:null,attempt_started_at:null,attempt_expires_at:null})
   .eq("id",unknownIntentId)
   .eq("attempt_token",randomUUID())
   .eq("outcome","attempting")
   .select("id");
  expect(abortUnknown.data).toHaveLength(0);

  const check1=await fixture.db.query("select outcome from public.whatsapp_send_intents where id=$1",[acceptedIntentId]);
  expect(check1.rows[0].outcome).toBe("accepted");
  const check2=await fixture.db.query("select outcome from public.whatsapp_send_intents where id=$1",[unknownIntentId]);
  expect(check2.rows[0].outcome).toBe("unknown");

  // Worker failure: when abortSend fails, worker marks job uncertain (review_required)
  state.model.mockClear();state.send.mockReset();
  const id=`synthetic-abortfail-${randomUUID()}`;
  expect((await receive(webhook(packet(id)))).status).toBe(200);

  let vCount=0;
  state.hookPorts=(ports:IntegrationPorts)=>({
   ...ports,
   verify:async(f:IntegrationFrame,citations:AnswerCitation[])=>{
    vCount++;
    if(vCount===3)return {ok:false,code:"WORKER_UNAVAILABLE"};
    return ports.verify(f,citations);
   },
   abortSend:async()=>false
  });

  const resp=await consume(worker());
  expect(resp.status).toBe(202);
  const res=await resp.json();
  expect(res.code).toBe("RECONCILIATION_REQUIRED");

  const failedJob=await fixture.db.query("select status from public.whatsapp_inbound_jobs where wa_message_id=$1",[id]);
  expect(failedJob.rows[0].status).toBe("review_required");

  state.hookPorts=null;
 },60_000);
});
