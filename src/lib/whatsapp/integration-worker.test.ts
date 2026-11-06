import {afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/billing/entitlement",()=>({readCompanyEntitlement:()=>({paid:false}),entitlementAllowsAutomation:()=>false}));
import {runInboundWorkerAnswer} from "./inbound-worker";
import type {IntegrationFrame,IntegrationPorts} from "./integration-worker";
import {WorkerInputError} from "./integration-worker";
const input={jobId:"job",claimToken:"claim",companyId:"company",locale:"en" as const};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
function setup(){
 const frame:IntegrationFrame={job_id:"job",company_id:"company",message_id:"message",conversation_id:"conversation",phone_number_id:"phone",recipient_wa_id:"recipient",
 automation_generation:0,link_id:"link",link_generation:1,question:"Question",ai_status:null as string|null,reply_text:null as string|null,
 ai_attempt_id:null, intent_id:null,staged_citations:null};
 const chunks=[{sourceId:"source",title:"Title",contentVersion:1,text:"Approved content"}];
 const intent={id:"intent",outcome:"attempting",company_id:"company",conversation_id:"conversation",phone_number_id:"phone",recipient_wa_id:"recipient",body:"Answer"};
 const ports={enabled:true,frame:vi.fn(async()=>frame),context:vi.fn(async()=>chunks),verify:vi.fn<IntegrationPorts["verify"]>(async()=>true),secret:vi.fn(async()=>"synthetic-token"),
 reserve:vi.fn(async()=>true),answer:vi.fn(async()=>({ok:true,complete:true,text:"Answer",attempts:[{id:"attempt"}]})),
 stage:vi.fn(async()=>"intent"),claimSend:vi.fn(async()=>({ok:true,claimed:true,attempt_token:"send-claim",intent})),
 abortSend:vi.fn(async()=>true),
 send:vi.fn(async()=>({ok:true,waMessageId:"synthetic-wamid"})),finalize:vi.fn(async()=>true),finish:vi.fn(async()=>"accepted"),
 repair:vi.fn(async()=>true),retry:vi.fn<IntegrationPorts["retry"]>(async()=>{}),heartbeat:vi.fn(async()=>true)};
 return {frame,chunks,ports,intent};
}
describe("persisted WhatsApp integration worker",()=>{
 it("records execution stages only for a newly accepted provider response",async()=>{
 const {ports,frame}=setup(),jobId="12345678-1234-4234-8234-123456789abc";frame.job_id=jobId;
 vi.stubEnv("WHATSAPP_WORKER_TIMING_ENABLED","true");const log=vi.spyOn(console,"info").mockImplementation(()=>{});
 expect(await runInboundWorkerAnswer({...input,jobId},ports)).toMatchObject({ok:true});
 const stages=log.mock.calls.map(([line])=>JSON.parse(String(line)).stage);
 expect(stages).toEqual(["provider_accepted_at"]);
 expect(JSON.stringify(log.mock.calls)).not.toContain("Question");expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-token");
 });
 it("does not report provider acceptance for an unknown send",async()=>{
 const {ports,frame}=setup(),jobId="12345678-1234-4234-8234-123456789abc";frame.job_id=jobId;
 ports.send.mockResolvedValue({ok:false,code:"AMBIGUOUS"} as never);ports.finish.mockResolvedValue("unknown");
 vi.stubEnv("WHATSAPP_WORKER_TIMING_ENABLED","true");const log=vi.spyOn(console,"info").mockImplementation(()=>{});
 await runInboundWorkerAnswer({...input,jobId},ports);
 expect(log.mock.calls.map(([line])=>JSON.parse(String(line)).stage)).not.toContain("provider_accepted_at");
 });
 it("completes only after durable accepted evidence, without claiming delivery",async()=>{
 const {ports}=setup();const result=await runInboundWorkerAnswer(input,ports);
 expect(result).toMatchObject({ok:true,jobCompleted:true,sendAccepted:true,delivered:false});expect(ports.send).toHaveBeenCalledTimes(1);
 });
 it("retains known acceptance without retry when accounting is unavailable",async()=>{
 const {ports}=setup();ports.finish.mockRejectedValue(new Error("Synthetic accounting failure"));
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"ACCEPTANCE_ACCOUNTING_PENDING",sendAccepted:true,jobCompleted:false});
 expect(ports.send).toHaveBeenCalledTimes(1);expect(ports.repair).not.toHaveBeenCalled();expect(ports.retry).not.toHaveBeenCalled();
 });
 it("settles a retained accepted receipt before failed repair without model or provider execution",async()=>{
 const {ports,frame,intent}=setup();frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";frame.intent_id="intent";
 ports.claimSend.mockResolvedValue({ok:true,claimed:false,attempt_token:null,intent:{...intent,outcome:"accepted"}} as never);
 const order:string[]=[];ports.finish.mockImplementation(async()=>{order.push("quota");return "accepted";});ports.repair.mockImplementation(async()=>{order.push("display");return false;});
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"ACCEPTANCE_PERSIST_PENDING",sendAccepted:true,jobCompleted:true});expect(order).toEqual(["quota","display"]);
 expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();expect(ports.retry).not.toHaveBeenCalled();
 });
 it("retains settled acceptance when display repair throws without scheduling retry",async()=>{
 const {ports}=setup();ports.repair.mockRejectedValue(Error("Synthetic repair transport outage"));
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"ACCEPTANCE_PERSIST_PENDING",sendAccepted:true,jobCompleted:true});
 expect(ports.send).toHaveBeenCalledTimes(1);expect(ports.retry).not.toHaveBeenCalled();
 });
 it("does no work when rollout is disabled",async()=>{const {ports}=setup();ports.enabled=false;
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"WORKER_DISABLED"});expect(ports.frame).not.toHaveBeenCalled();});
 it("rejects a wrong tenant before reservation/provider work",async()=>{const {frame,ports}=setup();frame.company_id="other";
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();});
 it.each(["I want a refund", "I need the manager", "أريد استرجاع المبلغ"])("hands off a flagged request before model cost or send: %s",async question=>{
 const {frame,ports}=setup();frame.question=question;
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"HUMAN_REVIEW_REQUIRED"});
 expect(ports.retry).toHaveBeenCalledWith("HUMAN_REVIEW_REQUIRED",false,true);
 expect(ports.context).not.toHaveBeenCalled();expect(ports.reserve).not.toHaveBeenCalled();expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();
 });
 it("does not claim human review was recorded when disposition persistence fails",async()=>{
 const {frame,ports}=setup();frame.question="I want a refund";ports.retry.mockRejectedValue(Error("synthetic claim rejection"));
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"WORKER_UNAVAILABLE"});
 expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();
 });
 it("does not regenerate a persisted uncertain execution",async()=>{const {frame,ports}=setup();frame.ai_status="uncertain";
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();});
 it("recovers the original saved draft without another paid generation",async()=>{const {frame,ports,chunks}=setup();frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";
 frame.staged_citations=chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion}));
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:true});expect(ports.answer).not.toHaveBeenCalled();});
 it("retains ambiguous send outcome without a retry or false completion",async()=>{const {ports}=setup();ports.send.mockResolvedValue({ok:false,code:"AMBIGUOUS"} as never);ports.finish.mockResolvedValue("unknown");
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,jobCompleted:false,sendAccepted:false});expect(ports.send).toHaveBeenCalledTimes(1);
 expect(ports.finalize).toHaveBeenCalledWith("intent","send-claim","unknown",null);expect(ports.finish).not.toHaveBeenCalled();});
 it("preserves confirmed OAuth rejection for atomic credential cleanup in the original finalizer",async()=>{
 const {ports}=setup();ports.send.mockResolvedValue({ok:false,code:"GRAPH_REJECTED",detail:"graph_190"} as never);ports.finish.mockResolvedValue("released");
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_REJECTED"});
 expect(ports.finalize).toHaveBeenCalledWith("intent","send-claim","rejected",null,"graph_190");
 expect(ports.send).toHaveBeenCalledTimes(1);
 });
 it.each(["unknown","accepted"])("does not report a settled rejection if accounting returns %s",async status=>{
 const {ports}=setup();ports.send.mockResolvedValue({ok:false,code:"GRAPH_REJECTED"} as never);ports.finish.mockResolvedValue(status);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_PERSIST_REQUIRES_RECONCILIATION"});
 expect(ports.send).toHaveBeenCalledTimes(1);expect(ports.retry).not.toHaveBeenCalled();
 });
 it("retains a provider rejection for reconciliation if accounting is unavailable",async()=>{
 const {ports}=setup();ports.send.mockResolvedValue({ok:false,code:"GRAPH_REJECTED"} as never);ports.finish.mockRejectedValue(Error("synthetic"));
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_PERSIST_REQUIRES_RECONCILIATION"});expect(ports.retry).not.toHaveBeenCalled();
 });
 it("stops when human takeover occurs while generating",async()=>{const {ports}=setup();ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(ports.send).not.toHaveBeenCalled();});
 it("records a confirmed rejected send and released usage after last-moment takeover",async()=>{
 const {ports}=setup();ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);ports.finish.mockResolvedValue("released");
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"AUTOMATION_CHANGED_BEFORE_SEND"});
 expect(ports.finalize).toHaveBeenCalledWith("intent","send-claim","rejected",null);expect(ports.finish).toHaveBeenCalledWith("intent");expect(ports.send).not.toHaveBeenCalled();
 });
 it.each(["finalize_false","finalize_throw","finish_throw","finish_unknown"])("requires reconciliation if takeover disposition is unconfirmed: %s",async failure=>{
 const {ports}=setup();ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 if(failure==="finalize_false")ports.finalize.mockResolvedValue(false);
 if(failure==="finalize_throw")ports.finalize.mockRejectedValue(Error("synthetic failure"));
 if(failure==="finish_throw")ports.finish.mockRejectedValue(Error("synthetic failure"));
 if(failure==="finish_unknown")ports.finish.mockResolvedValue("unknown");
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_PERSIST_REQUIRES_RECONCILIATION"});
 expect(ports.send).not.toHaveBeenCalled();expect(ports.retry).not.toHaveBeenCalled();
 if(failure.startsWith("finalize"))expect(ports.finish).not.toHaveBeenCalled();
 });
 it("acknowledges stored acceptance after repair without another Graph send",async()=>{const {ports,frame,intent}=setup();frame.intent_id="intent";
 ports.claimSend.mockResolvedValue({ok:true,claimed:false,attempt_token:null,intent:{...intent,outcome:"accepted"}} as never);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:true});expect(ports.send).not.toHaveBeenCalled();expect(ports.repair).toHaveBeenCalledTimes(1);});
 it("preserves reconciliation of a previously accepted sensitive reply",async()=>{const {ports,frame,intent}=setup();
 frame.question="I want a refund";frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";frame.intent_id="intent";
 ports.claimSend.mockResolvedValue({ok:true,claimed:false,attempt_token:null,intent:{...intent,outcome:"accepted"}} as never);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:true,sendAccepted:true});expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();expect(ports.retry).not.toHaveBeenCalled();
 });
 it("rejects an unsent staged sensitive reply before transport and hands off",async()=>{const {ports,frame}=setup();
 frame.question="I want a refund";frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";frame.intent_id="intent";
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"HUMAN_REVIEW_REQUIRED"});
 expect(ports.finalize).toHaveBeenCalledWith("intent","send-claim","rejected",null);
 expect(ports.retry).toHaveBeenCalledWith("HUMAN_REVIEW_REQUIRED",false,true);expect(ports.send).not.toHaveBeenCalled();expect(ports.answer).not.toHaveBeenCalled();
 });
 it("settles accepted quota before display repair and retains acceptance when repair is unavailable",async()=>{
 const {ports}=setup();const order:string[]=[];
 ports.finish.mockImplementation(async()=>{order.push("quota");return "accepted";});
 ports.repair.mockImplementation(async()=>{order.push("display");return false;});
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"ACCEPTANCE_PERSIST_PENDING",sendAccepted:true,jobCompleted:true});
 expect(order).toEqual(["quota","display"]);expect(ports.send).toHaveBeenCalledTimes(1);expect(ports.retry).not.toHaveBeenCalled();
 });

 it("concurrent denied capacity prevents generation, staging and send",async()=>{
  const {ports}=setup();ports.reserve.mockResolvedValue(false);
  const results=await Promise.all(Array.from({length:8},()=>runInboundWorkerAnswer(input,ports)));
  expect(results.every(r=>!r.ok&&r.code==="ENTITLEMENT_OR_USAGE_DENIED")).toBe(true);
  expect(ports.answer).not.toHaveBeenCalled();expect(ports.stage).not.toHaveBeenCalled();expect(ports.claimSend).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();expect(ports.finish).not.toHaveBeenCalled();
 });
 it("saved Premium draft cannot bypass revoked/downgraded plan reservation",async()=>{
  const {ports,frame,chunks}=setup();frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";frame.staged_citations=chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion}));ports.reserve.mockResolvedValue(false);
  expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"ENTITLEMENT_OR_USAGE_DENIED"});
  expect(ports.answer).not.toHaveBeenCalled();expect(ports.stage).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();
 });
 it("eight persisted unknown send replays do not send or release capacity",async()=>{
  const {ports,frame,intent}=setup();frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";frame.intent_id="intent";
  ports.claimSend.mockResolvedValue({ok:true,claimed:false,attempt_token:null,intent:{...intent,outcome:"unknown"}} as never);
  const results=await Promise.all(Array.from({length:8},()=>runInboundWorkerAnswer(input,ports)));
  expect(results.every(r=>!r.ok&&!r.jobCompleted)).toBe(true);
  expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();expect(ports.finalize).not.toHaveBeenCalled();expect(ports.finish).not.toHaveBeenCalled();
  expect(ports.retry.mock.calls.every(([,uncertain])=>uncertain===true)).toBe(true);
 });
 it("in-flight outbound hold never triggers settlement or another send",async()=>{
  const {ports,frame,intent}=setup();frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";frame.intent_id="intent";
  ports.claimSend.mockResolvedValue({ok:true,claimed:false,attempt_token:null,intent:{...intent,outcome:"attempting"}} as never);
  expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_IN_PROGRESS_REQUIRES_REVIEW"});
  expect(ports.send).not.toHaveBeenCalled();expect(ports.finalize).not.toHaveBeenCalled();expect(ports.finish).not.toHaveBeenCalled();expect(ports.retry).not.toHaveBeenCalled();
 });
 it("keeps job pending without send or permanent rejection when verify is unavailable before external send", async () => {
  const { ports, frame } = setup();
  frame.ai_status = "success";
  frame.reply_text = "Answer";
  frame.ai_attempt_id = "attempt";
  frame.intent_id = "intent";
  ports.verify
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, code: "WORKER_UNAVAILABLE" });
  const result = await runInboundWorkerAnswer(input, ports);
  expect(result).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE", jobCompleted: false, sendAccepted: false });
  expect(ports.send).not.toHaveBeenCalled();
  expect(ports.finalize).not.toHaveBeenCalled();
  expect(ports.finish).not.toHaveBeenCalled();
  expect(ports.retry).toHaveBeenCalledWith("WORKER_UNAVAILABLE", false, false);
 });
 it("finalizes as rejected but retains safe retry when verify is disabled before external send", async () => {
  const { ports, frame } = setup();
  frame.ai_status = "success";
  frame.reply_text = "Answer";
  frame.ai_attempt_id = "attempt";
  frame.intent_id = "intent";
  ports.finish.mockResolvedValue("released");
  ports.verify
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, code: "WORKER_DISABLED" });
  const result = await runInboundWorkerAnswer(input, ports);
  expect(result).toMatchObject({ ok: false, code: "WORKER_DISABLED", jobCompleted: false, sendAccepted: false });
  expect(ports.send).not.toHaveBeenCalled();
  expect(ports.finalize).toHaveBeenCalledWith("intent", "send-claim", "rejected", null);
  expect(ports.finish).toHaveBeenCalledWith("intent");
  expect(ports.retry).toHaveBeenCalledWith("WORKER_DISABLED", false, false);
 });
 it("suspends job safely with WORKER_UNAVAILABLE at initial gate without dead letter", async () => {
  const { ports } = setup();
  ports.verify.mockResolvedValue({ ok: false, code: "WORKER_UNAVAILABLE" });
  const result = await runInboundWorkerAnswer(input, ports);
  expect(result).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE" });
  expect(ports.retry).toHaveBeenCalledWith("WORKER_UNAVAILABLE", false, false);
  expect(ports.answer).not.toHaveBeenCalled();
  expect(ports.send).not.toHaveBeenCalled();
 });
 it("suspends job safely with WORKER_DISABLED at initial gate without dead letter", async () => {
  const { ports } = setup();
  ports.verify.mockResolvedValue({ ok: false, code: "WORKER_DISABLED" });
  const result = await runInboundWorkerAnswer(input, ports);
  expect(result).toMatchObject({ ok: false, code: "WORKER_DISABLED" });
  expect(ports.retry).toHaveBeenCalledWith("WORKER_DISABLED", false, false);
  expect(ports.answer).not.toHaveBeenCalled();
  expect(ports.send).not.toHaveBeenCalled();
 });
 it("proves resumption under actual DB SQL contracts: pre-send WORKER_UNAVAILABLE unclaims send intent, retries to retry_wait, and attempt 2 sends exactly once without duplicate AI generation or review_required escalation", async () => {
  const db = {
   job: { id: "job", status: "claimed", attempt_count: 1, send_intent_id: null as string | null },
   aiLedger: null as { id: string; status: string; response_text: string } | null,
   sendIntent: null as { id: string; outcome: "ready" | "attempting" | "accepted" | "rejected" | "unknown"; attempt_token: string | null } | null,
  };

  let killSwitchActive = false;
  let totalAiGenerations = 0;
  let totalExternalSends = 0;

  const sqlClaimAssistantJobSend = () => {
   if (!db.sendIntent || db.sendIntent.outcome !== "ready") {
    return { ok: true, claimed: false, attempt_token: null, intent: db.sendIntent ? { ...db.sendIntent, company_id: "company", conversation_id: "conversation", phone_number_id: "phone", recipient_wa_id: "recipient", body: "Answer" } : undefined };
   }
   const token = "claim-token-" + Math.random().toString(36).slice(2);
   db.sendIntent.outcome = "attempting";
   db.sendIntent.attempt_token = token;
   return {
    ok: true,
    claimed: true,
    attempt_token: token,
    intent: { ...db.sendIntent, company_id: "company", conversation_id: "conversation", phone_number_id: "phone", recipient_wa_id: "recipient", body: "Answer" },
   };
  };

  const sqlRetryInboundJob = (_code: string, uncertainParam: boolean, terminalParam: boolean) => {
   const uncertain = uncertainParam ||
    (db.aiLedger !== null && ["reserved", "running", "uncertain"].includes(db.aiLedger.status)) ||
    (db.sendIntent !== null && ["attempting", "unknown"].includes(db.sendIntent.outcome));
   const terminal = terminalParam || uncertain || db.job.attempt_count >= 5;
   const nextstatus = uncertain ? "review_required" : terminal ? "dead_letter" : "retry_wait";
   db.job.status = nextstatus;
   return { ok: true, status: nextstatus };
  };

  const createWorkerPorts = (): IntegrationPorts => ({
   enabled: true,
   frame: async (): Promise<IntegrationFrame> => ({
    job_id: db.job.id,
    company_id: "company",
    message_id: "message",
    conversation_id: "conversation",
    phone_number_id: "phone",
    recipient_wa_id: "recipient",
    automation_generation: 0,
    link_id: "link",
    link_generation: 1,
    question: "Question",
    ai_status: db.aiLedger?.status ?? null,
    reply_text: db.aiLedger?.response_text ?? null,
    ai_attempt_id: db.aiLedger?.id ?? null,
    intent_id: db.job.send_intent_id,
    staged_citations: [{ sourceId: "source", title: "Title", contentVersion: 1 }],
   }),
   context: async () => [{ sourceId: "source", title: "Title", contentVersion: 1, text: "Content" }],
   verify: async () => {
    if (!killSwitchActive) return { ok: false as const, code: "WORKER_UNAVAILABLE" as const };
    return { ok: true as const };
   },
   secret: async () => "synthetic-secret",
   reserve: async () => true,
   answer: async () => {
    totalAiGenerations++;
    db.aiLedger = { id: "ai-attempt-1", status: "success", response_text: "Answer" };
    return { ok: true, complete: true, text: "Answer", attempts: [{ id: "ai-attempt-1" }] };
   },
   stage: async () => {
    const intentId = "intent-1";
    db.job.send_intent_id = intentId;
    db.sendIntent = { id: intentId, outcome: "ready", attempt_token: null };
    return intentId;
   },
   claimSend: async () => sqlClaimAssistantJobSend(),
   abortSend: async (id, token) => {
    if (db.sendIntent && db.sendIntent.id === id && db.sendIntent.attempt_token === token && db.sendIntent.outcome === "attempting") {
     db.sendIntent.outcome = "ready";
     db.sendIntent.attempt_token = null;
     return true;
    }
    return false;
   },
   send: async () => {
    totalExternalSends++;
    return { ok: true, waMessageId: "wamid-test" };
   },
   finalize: async (id, token, result) => {
    if (db.sendIntent && db.sendIntent.id === id && db.sendIntent.attempt_token === token) {
     db.sendIntent.outcome = result;
     return true;
    }
    return false;
   },
   finish: async () => {
    db.job.status = "completed";
    return "accepted";
   },
   repair: async () => true,
   retry: async (code, uncertain, permanent) => {
    sqlRetryInboundJob(code, uncertain, permanent ?? false);
   },
   heartbeat: async () => true,
  });

  let verifyCallCount = 0;
  const ports1 = createWorkerPorts();
  ports1.verify = vi.fn<IntegrationPorts["verify"]>(async () => {
   verifyCallCount++;
   if (verifyCallCount === 3) {
    return { ok: false as const, code: "WORKER_UNAVAILABLE" as const };
   }
   return { ok: true as const };
  });

  const attempt1Result = await runInboundWorkerAnswer(input, ports1);

  expect(attempt1Result).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE", jobCompleted: false, sendAccepted: false });
  expect(totalAiGenerations).toBe(1);
  expect(totalExternalSends).toBe(0);
  expect(db.aiLedger).toMatchObject({ id: "ai-attempt-1", status: "success" });
  expect(db.sendIntent?.outcome).toBe("ready");
  expect(db.job.status).toBe("retry_wait");

  killSwitchActive = true;
  db.job.attempt_count = 2;
  db.job.status = "claimed";
  const ports2 = createWorkerPorts();

  const attempt2Result = await runInboundWorkerAnswer(input, ports2);

  expect(attempt2Result).toMatchObject({ ok: true, code: "ACCEPTED", jobCompleted: true, sendAccepted: true });
  expect(totalAiGenerations).toBe(1);
  expect(totalExternalSends).toBe(1);
  expect(db.sendIntent?.outcome).toBe("accepted");
  expect(db.job.status).toBe("completed");
 });
 it("enforces attempt limit: transitions to dead_letter when attempt_count >= 5 without getting stuck in review_required", async () => {
  const db = {
   job: { id: "job", status: "claimed", attempt_count: 5, send_intent_id: "intent-1" },
   aiLedger: { id: "ai-1", status: "success", response_text: "Answer" },
   sendIntent: { id: "intent-1", outcome: "ready" as const, attempt_token: null as string | null },
  };

  const sqlRetryInboundJob = (_code: string, uncertainParam: boolean, terminalParam: boolean) => {
   const uncertain = uncertainParam ||
    (db.aiLedger !== null && ["reserved", "running", "uncertain"].includes(db.aiLedger.status)) ||
    (db.sendIntent !== null && ["attempting", "unknown"].includes(db.sendIntent.outcome));
   const terminal = terminalParam || uncertain || db.job.attempt_count >= 5;
   const nextstatus = uncertain ? "review_required" : terminal ? "dead_letter" : "retry_wait";
   db.job.status = nextstatus;
   return { ok: true, status: nextstatus };
  };

  const ports: IntegrationPorts = {
   enabled: true,
   frame: async () => ({
    job_id: db.job.id, company_id: "company", message_id: "msg", conversation_id: "conv", phone_number_id: "phone",
    recipient_wa_id: "recip", automation_generation: 0, link_id: "link", link_generation: 1, question: "Q",
    ai_status: "success", reply_text: "Answer", ai_attempt_id: "ai-1", intent_id: "intent-1", staged_citations: [],
   }),
   context: async () => [{ sourceId: "source", title: "Title", contentVersion: 1, text: "Content" }],
   verify: vi.fn(async () => ({ ok: false, code: "WORKER_UNAVAILABLE" as const })),
   secret: async () => "token",
   reserve: async () => true,
   answer: vi.fn(),
   stage: vi.fn(),
   claimSend: vi.fn(),
   abortSend: vi.fn(async () => true),
   send: vi.fn(),
   finalize: vi.fn(),
   finish: vi.fn(async () => "accepted"),
   repair: vi.fn(async () => true),
   retry: vi.fn(async (code, uncertain, permanent) => {
    sqlRetryInboundJob(code, uncertain, permanent ?? false);
   }),
   heartbeat: vi.fn(async () => true),
  };

  const result = await runInboundWorkerAnswer(input, ports);
  expect(result).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE" });
  expect(db.job.status).toBe("dead_letter");
 });

 it.each([
  ["UNSUPPORTED_MESSAGE", true],
  ["SERVICE_WINDOW_CLOSED", true],
  ["LINK_UNAVAILABLE", false],
  ["SERVICE_WINDOW_AUTHORIZATION_UNAVAILABLE", false],
 ])("handles pre-send WorkerInputError(%s) distinguishing transient unavailability (permanent=%s)", async (code, expectedPermanent) => {
  const { ports } = setup();
  ports.frame.mockRejectedValue(new WorkerInputError(code));
  const result = await runInboundWorkerAnswer(input, ports);
  expect(result).toMatchObject({ ok: false, code, jobCompleted: false, sendAccepted: false });
  expect(ports.retry).toHaveBeenCalledWith(code, false, expectedPermanent);
  expect(ports.answer).not.toHaveBeenCalled();
  expect(ports.send).not.toHaveBeenCalled();
 });

  it("fails closed with SEND_PERSIST_REQUIRES_RECONCILIATION and marks retry uncertain when abortSend fails", async () => {
    const { ports, intent } = setup();
    ports.claimSend.mockResolvedValue({ ok: true, claimed: true, attempt_token: "token-1", intent });
    ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce({ ok: false, code: "WORKER_UNAVAILABLE" });
    ports.abortSend = vi.fn().mockResolvedValue(false);

    const result = await runInboundWorkerAnswer(input, ports);
    expect(result).toMatchObject({ ok: false, code: "SEND_PERSIST_REQUIRES_RECONCILIATION", jobCompleted: false, sendAccepted: false });
    expect(ports.abortSend).toHaveBeenCalledWith(intent.id, "token-1");
    expect(ports.retry).toHaveBeenCalledWith("SEND_PERSIST_REQUIRES_RECONCILIATION", true, false);
    expect(ports.send).not.toHaveBeenCalled();
  });

  it("fails closed with SEND_PERSIST_REQUIRES_RECONCILIATION when ports lacks abortSend", async () => {
    const { ports, intent } = setup();
    ports.claimSend.mockResolvedValue({ ok: true, claimed: true, attempt_token: "token-1", intent });
    ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce({ ok: false, code: "WORKER_UNAVAILABLE" });
    delete (ports as unknown as { abortSend?: unknown }).abortSend;

    const result = await runInboundWorkerAnswer(input, ports);
    expect(result).toMatchObject({ ok: false, code: "SEND_PERSIST_REQUIRES_RECONCILIATION", jobCompleted: false, sendAccepted: false });
    expect(ports.retry).toHaveBeenCalledWith("SEND_PERSIST_REQUIRES_RECONCILIATION", true, false);
  });

  it("finalizes intent as rejected and finishes job without redundant retry when WORKER_DISABLED after claim", async () => {
    const { ports, intent } = setup();
    ports.claimSend.mockResolvedValue({ ok: true, claimed: true, attempt_token: "token-1", intent });
    ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce({ ok: false, code: "WORKER_DISABLED" });
    ports.finalize.mockResolvedValue(true);
    ports.finish.mockResolvedValue("released");

    const result = await runInboundWorkerAnswer(input, ports);
    expect(result).toMatchObject({ ok: false, code: "WORKER_DISABLED", jobCompleted: false, sendAccepted: false });
    expect(ports.finalize).toHaveBeenCalledWith(intent.id, "token-1", "rejected", null);
    expect(ports.finish).toHaveBeenCalledWith(intent.id);
    expect(ports.retry).toHaveBeenCalledWith("WORKER_DISABLED", false, false);
    expect(ports.send).not.toHaveBeenCalled();
  });

  it("terminates job immediately with CLAIM_BINDING_REJECTED when frame cannot be loaded, preventing infinite loop", async () => {
    const { ports } = setup();
    ports.frame.mockResolvedValue(null as unknown as IntegrationFrame);
    const result = await runInboundWorkerAnswer(input, ports);
    expect(result).toMatchObject({ ok: false, code: "CLAIM_BINDING_REJECTED", jobCompleted: false, sendAccepted: false });
    expect(ports.retry).toHaveBeenCalledWith("CLAIM_BINDING_REJECTED", false, true);
    expect(ports.answer).not.toHaveBeenCalled();
    expect(ports.send).not.toHaveBeenCalled();
  });
});
