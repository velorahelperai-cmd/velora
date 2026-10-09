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
 async function prepare(options:{paid?:boolean;cap?:number}={}){await verify();vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND","true");vi.stubEnv("WHATSAPP_ROUTING_MODE","tenant_registry");
 const f=JSON.parse(await sql(`SET ROLE service_role;SELECT test_fixture.company(${options.paid??true},${options.cap??2});`));const j=await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);
 const c=JSON.parse(await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(j)}::uuid,120);`));
 await sql(`SET ROLE service_role;SELECT test_fixture.ai_budget(${lit(f.company)}::uuid,10);`);
 state.client=databaseAdapter();const input={jobId:j,claimToken:c.claim_token,companyId:f.company};const ports=createIntegrationPorts(input);
 // Actual local Vault/RPC supplies the synthetic tenant credential. Only providers are mocked.
 state.send.mockImplementation(async()=>({ok:true,waMessageId:`synthetic-app-${crypto.randomUUID()}`}));
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
 it.each([{paid:false,cap:2,reason:"inactive subscription"},{paid:true,cap:0,reason:"exhausted message quota"}])("blocks paid work for $reason without reserving cost",async options=>{
 const {input,ports}=await prepare(options);const result=await runInboundWorkerAnswer(input,ports);
 expect(result).toMatchObject({ok:false,sendAccepted:false});expect(state.model).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
 expect(await rows(`SELECT id FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`)).toHaveLength(0);
 const jobs=await rows(`SELECT usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(input.jobId)}::uuid`);expect(jobs[0].usage_status).not.toBe("reserved");
 },60_000);
 it("retains unknown paid cost after a model timeout and never falls back blindly",async()=>{
 const {input,ports}=await prepare();state.model.mockResolvedValue({status:"uncertain",text:"",errorCode:"PROVIDER_NETWORK_ERROR",latencyMs:15});
 const result=await runInboundWorkerAnswer(input,ports);expect(result).toMatchObject({ok:false});expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).not.toHaveBeenCalled();
 expect(await rows(`SELECT status,cost_baisa FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`)).toMatchObject([{status:"uncertain",cost_baisa:null}]);
 expect(await rows(`SELECT status,usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(input.jobId)}::uuid`)).toMatchObject([{status:"review_required",usage_status:"unknown"}]);
 },60_000);
 it("persists a confirmed AI rejection without claiming a sent reply or consuming quota",async()=>{
 const {input,ports}=await prepare();state.model.mockResolvedValue({status:"rejected",text:"",errorCode:"PROVIDER_HTTP_401",latencyMs:5});
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).not.toHaveBeenCalled();
 expect(await rows(`SELECT status,cost_baisa FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`)).toMatchObject([{status:"rejected",cost_baisa:0}]);
 expect(await rows(`SELECT usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(input.jobId)}::uuid`)).toMatchObject([{usage_status:"released"}]);
 },60_000);
 it("settles known AI cost but suppresses send when the paid subscription expires during generation",async()=>{
 const {f,input,ports}=await prepare(),normal=state.model.getMockImplementation()!;
 state.model.mockImplementation(async args=>{await sql(`SET ROLE service_role;UPDATE billing_subscriptions SET paid_through=clock_timestamp()-interval '1 second',status='ended' WHERE id=${lit(f.subscription)}::uuid;`);return normal(args);});
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(state.send).not.toHaveBeenCalled();
 const ledger=await rows(`SELECT status,cost_baisa FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`);expect(ledger[0].status).toBe("success");expect(Number(ledger[0].cost_baisa)).toBeGreaterThan(0);
 },60_000);
 it("blocks a revoked tenant authorization before paid work",async()=>{
 const {f,input,ports}=await prepare();await sql(`SET ROLE service_role;UPDATE whatsapp_company_links SET status='error',authorization_status='revoked' WHERE id=${lit(f.link)}::uuid;`);
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false});expect(state.model).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
 },60_000);
 it("atomically persists confirmed Meta token rejection and revokes only its original grant",async()=>{
 const {f,input,ports}=await prepare();state.send.mockResolvedValue({ok:false,code:"GRAPH_REJECTED",detail:"graph_190"});
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_REJECTED"});expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
 expect(await rows(`SELECT outcome,provider_error_code FROM whatsapp_send_intents WHERE original_job_id=${lit(input.jobId)}::uuid`)).toMatchObject([{outcome:"rejected",provider_error_code:"graph_190"}]);
 expect(await rows(`SELECT authorization_status,access_secret_id FROM whatsapp_company_links WHERE id=${lit(f.link)}::uuid`)).toMatchObject([{authorization_status:"revoked",access_secret_id:null}]);
 },60_000);
 it("retains unknown Meta send outcome and rejects replay without another paid call or send",async()=>{
 const {input,ports}=await prepare();state.send.mockResolvedValue({ok:false,code:"AMBIGUOUS"});
 expect(await runInboundWorkerAnswer(input,ports)).toMatchObject({ok:false,code:"SEND_REQUIRES_RECONCILIATION"});
 expect(await rows(`SELECT outcome FROM whatsapp_send_intents WHERE original_job_id=${lit(input.jobId)}::uuid`)).toMatchObject([{outcome:"unknown"}]);
 expect(await runInboundWorkerAnswer(input,createIntegrationPorts(input))).toMatchObject({ok:false});
 expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
 expect(await rows(`SELECT status,usage_status FROM whatsapp_inbound_jobs WHERE id=${lit(input.jobId)}::uuid`)).toMatchObject([{status:"review_required",usage_status:"unknown"}]);
 },60_000);
 it("recovers an expired process lease after known AI completion without a second paid generation",async()=>{
 const {input,ports}=await prepare(),frame=await ports.frame();expect(frame).not.toBeNull();const chunks=await ports.context(frame!);expect(chunks?.length).toBeGreaterThan(0);
 // Persisted known-cost response exists, then the process disappears before staging/sending.
 expect(await ports.reserve()).toBe(true);expect(await ports.answer(frame!,chunks!)).toMatchObject({ok:true,complete:true});
 await sql(`SET ROLE service_role;UPDATE whatsapp_inbound_jobs SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE id=${lit(input.jobId)}::uuid;`);
 const claim=JSON.parse(await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(input.jobId)}::uuid,120);`));expect(claim.ok).toBe(true);expect(claim.claim_token).not.toBe(input.claimToken);
 const recovered={...input,claimToken:claim.claim_token};expect(await runInboundWorkerAnswer(recovered,createIntegrationPorts(recovered))).toMatchObject({ok:true,sendAccepted:true,delivered:false});
 expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);expect(await rows(`SELECT id FROM ai_usage_ledger WHERE worker_job_id=${lit(input.jobId)}::uuid`)).toHaveLength(1);
 },60_000);
 it("processes two companies concurrently with distinct source snapshots, credentials and costs",async()=>{
 const a=await prepare(),b=await prepare();const results=await Promise.all([runInboundWorkerAnswer(a.input,a.ports),runInboundWorkerAnswer(b.input,b.ports)]);
 expect(results.map(r=>r.ok),JSON.stringify(results)).toEqual([true,true]);expect(state.model).toHaveBeenCalledTimes(2);expect(state.send).toHaveBeenCalledTimes(2);
 const ledger=await rows(`SELECT company_id,source_citations FROM ai_usage_ledger WHERE worker_job_id IN (${lit(a.input.jobId)}::uuid,${lit(b.input.jobId)}::uuid)`);
 expect(ledger).toHaveLength(2);expect(ledger.find((r:{company_id:string})=>r.company_id===a.f.company).source_citations[0].sourceId).toBe(a.f.knowledge);expect(ledger.find((r:{company_id:string})=>r.company_id===b.f.company).source_citations[0].sourceId).toBe(b.f.knowledge);
 const sends=state.send.mock.calls.map(([i])=>i);expect(new Set(sends.map(i=>i.phoneNumberId)).size).toBe(2);expect(new Set(sends.map(i=>i.accessToken)).size).toBe(2);
 },120_000);
});
