import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({admin:null as unknown,session:null as unknown,access:vi.fn(),model:vi.fn(),send:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>state.admin}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>state.session}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:state.access}));
vi.mock("@/lib/answers/guards",()=>({isLiveAnsweringEnabled:()=>true}));
vi.mock("@/lib/answers/runtime/provider",()=>({callRealModel:state.model}));
vi.mock("./send",()=>({sendWhatsappText:state.send}));
// @ts-expect-error Test-only SQL transport.
import {databaseAdapter} from "../../../scripts/whatsapp-integration/app-adapter.mjs";
// @ts-expect-error Test-only authenticated SQL transport.
import {sessionAdapter} from "../../../scripts/integration/session-adapter.mjs";
// @ts-expect-error Isolated synthetic database helper.
import {sql,rows,lit,verify} from "../../../scripts/whatsapp-integration/postgres.mjs";
import {loadWhatsappInboxInitialPage} from "./inbox";
import {loadWhatsappThreadPage,loadWhatsappConnectionStatus,markWhatsappThreadRead} from "./inbox-contracts";
import {controlWhatsappConversation} from "./actions";
import {createIntegrationPorts} from "./integration-store";
import {runInboundWorkerAnswer} from "./inbound-worker";
import {buildCustomerReadiness} from "@/lib/tenancy/customer-readiness";
import type {KnowledgeSourceRecord} from "@/lib/knowledge/types";
const enabled=process.env.C2_RUNTIME_POSTGRES_TESTS==="1";
afterEach(()=>{vi.unstubAllEnvs();state.model.mockReset();state.send.mockReset();state.access.mockReset();});
describe.skipIf(!enabled)("C2 complete synthetic company data journey",()=>{
 it("runs owner session → dashboard/knowledge/subscription/connection → Noura → inbox/read → human takeover → actual usage",async()=>{
  await verify();const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(true,10);"));
  const other=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(false);"));
  const actor=(await rows(`SELECT u.id,u.email,u.email_confirmed_at,s.id session_id FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id WHERE u.id=${lit(f.user)}::uuid`))[0];expect(actor.email_confirmed_at).toBeTruthy();
  await sql(`INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(actor.session_id)}::uuid,${lit(actor.id)}::uuid,clock_timestamp()) ON CONFLICT(session_id) DO UPDATE SET last_activity_at=excluded.last_activity_at;`);
  state.session=sessionAdapter({actorId:actor.id,sessionId:actor.session_id});state.admin=databaseAdapter();
  const company=(await rows(`SELECT * FROM companies WHERE id=${lit(f.company)}::uuid`))[0],membership=(await rows(`SELECT * FROM company_members WHERE company_id=${lit(f.company)}::uuid AND user_id=${lit(actor.id)}::uuid`))[0];
  state.access.mockResolvedValue({ok:true,context:{userId:actor.id,company,membership}});
  const initial=await loadWhatsappInboxInitialPage();expect(initial.ok).toBe(true);if(!initial.ok)throw Error(initial.code);expect(initial.page.companyId).toBe(f.company);expect(initial.page.kind).toBe("partial");
  const client=state.session as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>};
  expect((await client.rpc("whatsapp_inbox_page",{p_company_id:other.company,p_limit:40,p_before:null})).data).toMatchObject({ok:false});
  const knowledge=await rows(`SELECT * FROM knowledge_sources WHERE company_id=${lit(f.company)}::uuid`),subscription=(await rows(`SELECT status,paid_through FROM billing_subscriptions WHERE company_id=${lit(f.company)}::uuid AND environment='live'`))[0];
  const connection=await loadWhatsappConnectionStatus({companyId:f.company});expect(connection.ok).toBe(true);if(!connection.ok)throw Error(connection.code);expect(connection.data).toMatchObject({companyId:f.company,receiveReady:true,authorizationStatus:"active"});
  const dashboard=buildCustomerReadiness({fullName:"Synthetic fixture owner",email:actor.email,needsProfileName:false,role:"owner",companyId:f.company,companyName:company.display_name,companyStatus:company.status,knowledge:{loadFailed:false,sources:knowledge as KnowledgeSourceRecord[],approvalFoundation:"ready"},whatsapp:{loadFailed:false,status:"verified",suspended:false,liveOpsReady:false},review:{loadFailed:false,status:null},subscription:{loadFailed:false,status:subscription.status,paidThrough:subscription.paid_through}});
  expect(dashboard.items.find(i=>i.id==="knowledge")?.detail).toBe("knowledge_ready");expect(dashboard.items.find(i=>i.id==="subscription")?.detail).toBe("subscription_active");expect(dashboard.items.find(i=>i.id==="whatsapp")?.detail).toBe("wa_verified_not_live");
  vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND","true");vi.stubEnv("WHATSAPP_ROUTING_MODE","tenant_registry");
  const job=await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(f))}::jsonb);`);await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(job)}::uuid,120);SELECT test_fixture.ai_budget(${lit(f.company)}::uuid,10);`);
  // Fetch the retained claim without exposing it in assertions or reports.
  const token=(await rows(`SELECT claim_token FROM whatsapp_inbound_jobs WHERE id=${lit(job)}::uuid`))[0].claim_token;
  state.model.mockImplementation(async({model,system,prompt}:{model:string;system:string;prompt:string})=>{expect(system).toMatch(/نورا|Noura/);expect(prompt).toContain("Synthetic verified answer");return {status:"success",text:"Synthetic verified answer",actualModelId:model,requestId:"synthetic-journey-request",responseId:"synthetic-journey-response",latencyMs:2,usage:{promptTokens:20,completionTokens:10,cachedTokens:5,cacheWriteTokens:3,reasoningTokens:4,totalTokens:30}};});
  state.send.mockResolvedValue({ok:true,waMessageId:`synthetic-journey-out-${crypto.randomUUID()}`});
  const input={jobId:job,claimToken:token,companyId:f.company};expect(await runInboundWorkerAnswer(input,createIntegrationPorts(input))).toMatchObject({ok:true,sendAccepted:true,delivered:false});
  const inbox=await loadWhatsappInboxInitialPage();expect(inbox.ok).toBe(true);if(!inbox.ok)throw Error(inbox.code);expect(inbox.page.unreadTotal).toBe(1);expect(inbox.conversations.every(c=>c.id!==other.conversation)).toBe(true);
  const thread=await loadWhatsappThreadPage({companyId:f.company,conversationId:f.conversation,limit:40});expect(thread.ok).toBe(true);if(!thread.ok)throw Error(thread.code);expect(thread.data.messages).toHaveLength(2);
  const boundary=thread.data.displayedInboundMessageId;expect(boundary).toBeTruthy();expect(await markWhatsappThreadRead({companyId:f.company,conversationId:f.conversation,displayedInboundMessageId:boundary!})).toMatchObject({ok:true});
  expect(await controlWhatsappConversation({conversationId:f.conversation,action:"take_over",expectedRevision:thread.data.conversation.revision!})).toMatchObject({ok:true});
  const controlled=(await rows(`SELECT automation_allowed,status FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid`))[0];expect(controlled).toMatchObject({automation_allowed:false,status:"handed_over"});
  const usage=(await rows(`SELECT status,company_id,total_tokens,actual_model_id,cost_baisa FROM ai_usage_ledger WHERE worker_job_id=${lit(job)}::uuid`))[0];expect(usage).toMatchObject({status:"success",company_id:f.company,total_tokens:30});expect(Number(usage.cost_baisa)).toBeGreaterThan(0);expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
 },90_000);
});
