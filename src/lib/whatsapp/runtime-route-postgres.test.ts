import {afterEach,beforeAll,describe,expect,it,vi} from "vitest";
import {createHmac} from "node:crypto";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({client:null as unknown,model:vi.fn(),send:vi.fn(),rollout:true}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>state.client}));
vi.mock("@/lib/answers/guards",()=>({isLiveAnsweringEnabled:()=>state.rollout}));
vi.mock("@/lib/answers/runtime/provider",()=>({callRealModel:state.model}));
vi.mock("./send",()=>({sendWhatsappText:state.send}));
// @ts-expect-error Test-only local PostgreSQL adapter.
import {databaseAdapter} from "../../../scripts/whatsapp-integration/app-adapter.mjs";
// @ts-expect-error Strict opt-in offline database helper.
import {sql,rows,lit,verify} from "../../../scripts/whatsapp-integration/postgres.mjs";
import {POST as receive} from "@/app/api/whatsapp/webhook/route";
import {POST as consume} from "@/app/api/internal/whatsapp/worker/route";
const enabled=process.env.C2_RUNTIME_POSTGRES_TESTS==="1";
const appSecret="synthetic-meta-hmac-fixture-only",workerSecret="synthetic-worker-secret-for-local-fixtures-only";
const worker=()=>new Request("http://localhost.invalid/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:`Bearer ${workerSecret}`}});
type Tenant={company:string;conversation:string;knowledge:string;link:string;phone:string;waba:string;recipient:string};
async function prepare():Promise<Tenant>{vi.stubEnv("WHATSAPP_ROUTING_MODE","tenant_registry");vi.stubEnv("WHATSAPP_APP_SECRET",appSecret);vi.stubEnv("WHATSAPP_WORKER_SECRET",workerSecret);vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND","true");
 const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(true,10);"));
 const assets=(await rows(`SELECT l.provider_phone_number_id phone,l.provider_waba_id waba,c.customer_wa_id recipient FROM whatsapp_company_links l JOIN whatsapp_conversations c ON c.company_id=l.company_id WHERE l.id=${lit(f.link)}::uuid AND c.id=${lit(f.conversation)}::uuid`))[0];
 await sql(`SET ROLE service_role;SELECT test_fixture.ai_budget(${lit(f.company)}::uuid,10);`);state.client=databaseAdapter();state.rollout=true;
 state.model.mockImplementation(async({model,system,prompt}:{model:string;system:string;prompt:string})=>{expect(system).toMatch(/نورا|Noura/);expect(system).not.toMatch(/Leila|ليلى/);expect(prompt).toContain("Synthetic verified answer");return {status:"success",text:"Synthetic verified answer",actualModelId:model,requestId:"synthetic-runtime-request",responseId:"synthetic-runtime-response",latencyMs:2,usage:{promptTokens:20,completionTokens:10,cachedTokens:5,cacheWriteTokens:3,reasoningTokens:4,totalTokens:30}};});
 state.send.mockImplementation(async()=>({ok:true,waMessageId:`synthetic-runtime-out-${crypto.randomUUID()}`}));return {...f,...assets};}
function packet(f:Tenant,ids:string[],statuses?:{id:string;status:string;recipient:string}[]){return JSON.stringify({object:"whatsapp_business_account",entry:[{id:f.waba,changes:[{field:"messages",value:{messaging_product:"whatsapp",metadata:{phone_number_id:f.phone},messages:ids.map((id,index)=>({id,from:f.recipient,type:"text",timestamp:String(Math.floor(Date.now()/1000)),text:{body:`Synthetic verified answer ${index+1}`}})),statuses:statuses?.map(s=>({id:s.id,status:s.status,recipient_id:s.recipient,timestamp:String(Math.floor(Date.now()/1000))}))}}]}]});}
const request=(body:string,valid=true)=>new Request("http://localhost.invalid/api/whatsapp/webhook",{method:"POST",body,headers:{"x-hub-signature-256":valid?`sha256=${createHmac("sha256",appSecret).update(body).digest("hex")}`:"sha256=invalid"}});
afterEach(()=>{vi.unstubAllEnvs();state.model.mockReset();state.send.mockReset();state.rollout=true;});
describe.skipIf(!enabled)("actual webhook to durable HTTP worker",()=>{
 beforeAll(async()=>{await verify();await sql("CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;");},30_000);
 it("rejects invalid signature and unauthorized consumer before persistence or paid work",async()=>{const f=await prepare(),id=`synthetic-invalid-${crypto.randomUUID()}`;expect((await receive(request(packet(f,[id]),false))).status).toBe(401);expect(await rows(`SELECT id FROM whatsapp_messages WHERE wa_message_id=${lit(id)}`)).toHaveLength(0);expect((await consume(new Request("http://localhost.invalid/worker",{method:"POST",headers:{authorization:"Bearer wrong"}}))).status).toBe(401);expect(state.model).not.toHaveBeenCalled();},30_000);
 it("runs duplicate/FIFO ingestion through actual routes, accepts twice and applies only bound delivery",async()=>{const f=await prepare(),ids=[`synthetic-route-${crypto.randomUUID()}`,`synthetic-route-${crypto.randomUUID()}`],body=packet(f,ids);
  expect((await receive(request(body))).status).toBe(200);expect((await receive(request(body))).status).toBe(200);
  expect(await rows(`SELECT id FROM whatsapp_inbound_jobs WHERE company_id=${lit(f.company)}::uuid`)).toHaveLength(2);
  for(let i=0;i<2;i++){const response=await consume(worker());expect(response.status).toBe(200);expect(await response.json()).toEqual({processed:1,accepted:1,delivered:0});}
  expect(state.model).toHaveBeenCalledTimes(2);expect(state.send).toHaveBeenCalledTimes(2);
  const saved=await rows(`SELECT m.wa_message_id,j.status,j.usage_status FROM whatsapp_inbound_jobs j JOIN whatsapp_messages m ON m.id=j.message_id WHERE j.company_id=${lit(f.company)}::uuid ORDER BY m.arrival_sequence`);expect(saved.map((r:{wa_message_id:string})=>r.wa_message_id)).toEqual(ids);expect(saved.every((r:{status:string;usage_status:string})=>r.status==="completed"&&r.usage_status==="accepted")).toBe(true);
  const outbound=(await rows(`SELECT wa_message_id,delivery_state FROM whatsapp_messages WHERE company_id=${lit(f.company)}::uuid AND direction='outbound' ORDER BY arrival_sequence`))[0];expect(outbound.delivery_state).toBe("accepted");
  expect((await receive(request(packet(f,[],[{id:outbound.wa_message_id,status:"read",recipient:f.recipient}])))).status).toBe(200);
  expect((await rows(`SELECT delivery_state FROM whatsapp_messages WHERE wa_message_id=${lit(outbound.wa_message_id)}`))[0].delivery_state).toBe("read");
  expect((await receive(request(packet(f,[],[{id:outbound.wa_message_id,status:"failed",recipient:"synthetic-wrong-recipient"}])))).status).toBe(500);
  expect((await rows(`SELECT delivery_state FROM whatsapp_messages WHERE wa_message_id=${lit(outbound.wa_message_id)}`))[0].delivery_state).toBe("read");
 },60_000);
 it("keeps a possible Meta acceptance unknown without regenerating or resending on another worker tick",async()=>{const f=await prepare(),id=`synthetic-unknown-${crypto.randomUUID()}`;expect((await receive(request(packet(f,[id])))).status).toBe(200);state.send.mockResolvedValue({ok:false,code:"AMBIGUOUS"});
  expect(await (await consume(worker())).json()).toEqual({processed:1,accepted:0,delivered:0});await consume(worker());expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
  expect((await rows(`SELECT outcome FROM whatsapp_send_intents WHERE company_id=${lit(f.company)}::uuid`))[0].outcome).toBe("unknown");
 },60_000);
 it("production gate off performs only receipt repair and leaves inbound pending",async()=>{const f=await prepare(),id=`synthetic-disabled-${crypto.randomUUID()}`;expect((await receive(request(packet(f,[id])))).status).toBe(200);state.rollout=false;
  expect(await (await consume(worker())).json()).toEqual({code:"CUSTOMER_ANSWERING_DISABLED",repairOnly:true});expect(state.model).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
  expect((await rows(`SELECT status FROM whatsapp_inbound_jobs WHERE company_id=${lit(f.company)}::uuid`))[0].status).toBe("pending");
 },30_000);
});
