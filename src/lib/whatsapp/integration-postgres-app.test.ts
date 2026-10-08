import {afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));const state=vi.hoisted(()=>({client:null as unknown,model:vi.fn(),send:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>state.client}));vi.mock("@/lib/answers/guards",()=>({isLiveAnsweringEnabled:()=>true}));
vi.mock("@/lib/answers/runtime/provider",()=>({callRealModel:state.model}));vi.mock("./send",()=>({sendWhatsappText:state.send}));
// @ts-expect-error Dependency-free JavaScript harness is test-only.
import {databaseAdapter} from "../../../scripts/whatsapp-integration/app-adapter.mjs";
// @ts-expect-error Explicit opt-in isolated PostgreSQL helper.
import {sql,rows,lit,verify} from "../../../scripts/whatsapp-integration/postgres.mjs";
import {createIntegrationPorts} from "./integration-store";import {runInboundWorkerAnswer} from "./inbound-worker";
const enabled=process.env.WHATSAPP_INTEGRATION_POSTGRES_TESTS==="1";
afterEach(()=>{vi.unstubAllEnvs();state.model.mockReset();state.send.mockReset();});
describe.skipIf(!enabled)("real SQL-backed P3/P4 application integration",()=>{
 async function prepare(){await verify();vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND","true");vi.stubEnv("WHATSAPP_ROUTING_MODE","tenant_registry");
 const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company();"));const j=await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);
 const c=JSON.parse(await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(j)}::uuid,120);`));
 await sql(`SET ROLE service_role;INSERT INTO ai_budget_accounts(scope,company_id,limit_baisa,enabled)VALUES('company_live',${lit(f.company)}::uuid,10,true);`);
 state.client=databaseAdapter();const input={jobId:j,claimToken:c.claim_token,companyId:f.company};const ports=createIntegrationPorts(input);
 // Actual local Vault/RPC supplies the synthetic tenant credential. Only providers are mocked.
 state.send.mockResolvedValue({ok:true,waMessageId:`synthetic-app-${crypto.randomUUID()}`});
 if(process.env.WHATSAPP_INTEGRATION_VERBOSE==="1")for(const key of ["frame","context","verify","reserve","answer"] as const){
 const port=ports[key] as (...args:unknown[])=>Promise<unknown>;
 (ports as unknown as Record<string,unknown>)[key]=async(...args:unknown[])=>{try{return await port(...args);}catch(e){console.error("LOCAL_PORT_ERROR",key,e instanceof Error?e.message:"unknown");throw e;}};
 }
 state.model.mockImplementation(async({model}:{model:string})=>({status:"success",text:"Synthetic persisted answer",actualModelId:model,requestId:"synthetic-request",responseId:"synthetic-response",latencyMs:5,
 usage:{promptTokens:20,completionTokens:10,cachedTokens:5,cacheWriteTokens:3,reasoningTokens:4,totalTokens:30}}));return {f,input,ports};}
 it("runs actual reservations/model accounting/staging/acceptance once and preserves source snapshot",async()=>{
 const {input,ports}=await prepare();const result=await runInboundWorkerAnswer(input,ports);expect(result.ok,result.code).toBe(true);expect(result).toMatchObject({sendAccepted:true,delivered:false});
 expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
 const ledger=await rows(`SELECT status,total_tokens,cache_write_tokens,cost_baisa,source_citations FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`);
 expect(ledger).toHaveLength(1);expect(ledger[0]).toMatchObject({status:"success",total_tokens:30,cache_write_tokens:3});expect(Number(ledger[0].cost_baisa)).toBeGreaterThan(0);
 expect(await rows(`SELECT status,usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(input.jobId)}::uuid`)).toMatchObject([{status:"completed",usage_status:"accepted"}]);
 },60_000);
 it("charges known generation but suppresses outbound intent/send after takeover during provider work",async()=>{
 const {f,input,ports}=await prepare();const normal=state.model.getMockImplementation()!;
 state.model.mockImplementation(async args=>{await sql(`SET ROLE service_role;SELECT set_config('velora.conversation_control','1',false);UPDATE whatsapp_conversations SET automation_allowed=false,status='handed_over',automation_generation=automation_generation+1 WHERE id=${lit(f.conversation)}::uuid;`);return normal(args);});
 const result=await runInboundWorkerAnswer(input,ports);expect(state.model,result.code).toHaveBeenCalledTimes(1);expect(result).toMatchObject({ok:false,sendAccepted:false});expect(state.send).not.toHaveBeenCalled();
 const ledger=await rows(`SELECT status,cost_baisa FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`);expect(ledger[0].status).toBe("success");expect(Number(ledger[0].cost_baisa)).toBeGreaterThan(0);
 expect(await rows(`SELECT id FROM whatsapp_send_intents WHERE original_job_id=${lit(input.jobId)}::uuid`)).toHaveLength(0);
 },60_000);
});
