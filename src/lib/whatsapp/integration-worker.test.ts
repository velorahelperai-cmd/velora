import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/billing/entitlement",()=>({readCompanyEntitlement:()=>({paid:false}),entitlementAllowsAutomation:()=>false}));
import {runInboundWorkerAnswer} from "./inbound-worker";
import type {IntegrationFrame} from "./integration-worker";
const input={jobId:"job",claimToken:"claim",companyId:"company",locale:"en" as const};
function setup(){
 const frame:IntegrationFrame={job_id:"job",company_id:"company",message_id:"message",conversation_id:"conversation",phone_number_id:"phone",recipient_wa_id:"recipient",
 automation_generation:0,link_id:"link",link_generation:1,question:"Question",ai_status:null as string|null,reply_text:null as string|null,
 ai_attempt_id:null, intent_id:null,staged_citations:null};
 const chunks=[{sourceId:"source",title:"Title",contentVersion:1,text:"Approved content"}];
 const intent={id:"intent",outcome:"attempting",company_id:"company",conversation_id:"conversation",phone_number_id:"phone",recipient_wa_id:"recipient",body:"Answer"};
 const ports={enabled:true,frame:vi.fn(async()=>frame),context:vi.fn(async()=>chunks),verify:vi.fn(async()=>true),secret:vi.fn(async()=>"synthetic-token"),
 reserve:vi.fn(async()=>true),answer:vi.fn(async()=>({ok:true,complete:true,text:"Answer",attempts:[{id:"attempt"}]})),
 stage:vi.fn(async()=>"intent"),claimSend:vi.fn(async()=>({ok:true,claimed:true,attempt_token:"send-claim",intent})),
 send:vi.fn(async()=>({ok:true,waMessageId:"synthetic-wamid"})),finalize:vi.fn(async()=>true),finish:vi.fn(async()=>"accepted"),
 repair:vi.fn(async()=>true),retry:vi.fn(async()=>{}),heartbeat:vi.fn(async()=>true)};
 return {frame,chunks,ports,intent};
}
describe("persisted WhatsApp integration worker",()=>{
 it("completes only after durable accepted evidence, without claiming delivery",async()=>{
 const {ports}=setup();const result=await runInboundWorkerAnswer(input,ports);
 expect(result).toMatchObject({ok:true,jobCompleted:true,sendAccepted:true,delivered:false});expect(ports.send).toHaveBeenCalledTimes(1);
 });
 it("does no work when rollout is disabled",async()=>{const {ports}=setup();ports.enabled=false;
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"WORKER_DISABLED"});expect(ports.frame).not.toHaveBeenCalled();});
 it("rejects a wrong tenant before reservation/provider work",async()=>{const {frame,ports}=setup();frame.company_id="other";
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();});
 it("does not regenerate a persisted uncertain execution",async()=>{const {frame,ports}=setup();frame.ai_status="uncertain";
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(ports.answer).not.toHaveBeenCalled();expect(ports.send).not.toHaveBeenCalled();});
 it("recovers the original saved draft without another paid generation",async()=>{const {frame,ports,chunks}=setup();frame.ai_status="success";frame.reply_text="Answer";frame.ai_attempt_id="attempt";
 frame.staged_citations=chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion}));
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:true});expect(ports.answer).not.toHaveBeenCalled();});
 it("retains ambiguous send outcome without a retry or false completion",async()=>{const {ports}=setup();ports.send.mockResolvedValue({ok:false,code:"AMBIGUOUS"} as never);ports.finish.mockResolvedValue("unknown");
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,jobCompleted:false,sendAccepted:false});expect(ports.send).toHaveBeenCalledTimes(1);
 expect(ports.finalize).toHaveBeenCalledWith("intent","send-claim","unknown",null);});
 it("stops when human takeover occurs while generating",async()=>{const {ports}=setup();ports.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(ports.send).not.toHaveBeenCalled();});
 it("acknowledges stored acceptance after repair without another Graph send",async()=>{const {ports,frame,intent}=setup();frame.intent_id="intent";
 ports.claimSend.mockResolvedValue({ok:true,claimed:false,attempt_token:null,intent:{...intent,outcome:"accepted"}} as never);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:true});expect(ports.send).not.toHaveBeenCalled();expect(ports.repair).toHaveBeenCalledTimes(1);});
 it("repairs retained acceptance before settling quota when finalizer display persistence was pending",async()=>{
 const {ports}=setup();let repaired=false;ports.repair.mockImplementation(async()=>{repaired=true;return true;});
 ports.finish.mockImplementation(async()=>repaired?"accepted":"unknown");
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:true,sendAccepted:true});expect(ports.send).toHaveBeenCalledTimes(1);expect(ports.repair).toHaveBeenCalledTimes(1);
 });
});
