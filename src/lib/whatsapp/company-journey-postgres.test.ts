import {afterEach,describe,expect,it,vi} from "vitest";
import {createHmac,randomBytes,randomUUID} from "node:crypto";
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
import {POST as receive} from "@/app/api/whatsapp/webhook/route";
import {loadWhatsappInboxInitialPage} from "./inbox";
import {loadWhatsappThreadPage,loadWhatsappConnectionStatus,markWhatsappThreadRead} from "./inbox-contracts";
import {controlWhatsappConversation} from "./actions";
import {finishEmbeddedSignup,type SignupCompletionInput} from "./embedded-signup-flow";
import {createSignupPorts,type SignupRpcClient} from "./embedded-signup-store";
import type {MetaSignupConfig} from "./embedded-signup-meta";
import {createIntegrationPorts} from "./integration-store";
import {runInboundWorkerAnswer} from "./inbound-worker";
import {buildCustomerReadiness} from "@/lib/tenancy/customer-readiness";
import type {KnowledgeSourceRecord} from "@/lib/knowledge/types";

const enabled=process.env.C2_RUNTIME_POSTGRES_TESTS==="1";
const numericAsset=(prefix:string)=>prefix+BigInt(`0x${randomBytes(12).toString("hex")}`).toString();

/** Every allowed Graph request is synthetic. No unmatched request reaches HTTP. */
function syntheticMetaHttp(config:MetaSignupConfig,input:SignupCompletionInput,accessToken:string){
 const steps=[
  ["GET","oauth/access_token"],["GET","debug_token"],["GET",input.wabaId],
  ["GET",`${input.wabaId}/phone_numbers`],["GET",input.phoneNumberId],
  ["POST",`${input.wabaId}/subscribed_apps`],["POST",`${input.phoneNumberId}/register`],
  ["GET",input.phoneNumberId],["GET",`${input.wabaId}/subscribed_apps`],["GET","debug_token"],
 ];
 let step=0,subscribed=false,registered=false;
 const scopes=["whatsapp_business_management","whatsapp_business_messaging"];
 const phone=()=>({id:input.phoneNumberId,display_phone_number:"synthetic-display",code_verification_status:"VERIFIED",platform_type:"CLOUD_API",status:registered?"CONNECTED":"PENDING",is_on_biz_app:false});
 return vi.fn(async(url:string,init?:RequestInit)=>{
  const request=new URL(url),expected=steps[step];
  if(request.origin!=="https://graph.facebook.com"||!expected||init?.method!==expected[0]||request.pathname!==`/${config.graphVersion}/${expected[1]}`)throw Error("UNEXPECTED_SYNTHETIC_PROVIDER_REQUEST");
  step++;
  const auth=new Headers(init?.headers).get("Authorization");
  if(expected[1]==="oauth/access_token"){
   expect(auth).toBeNull();expect(Object.fromEntries(request.searchParams)).toEqual({client_id:config.appId,client_secret:config.appSecret,code:input.code});
   return Response.json({access_token:accessToken});
  }
  if(expected[1]==="debug_token"){
   expect(auth).toBe(`Bearer ${config.systemUserToken}`);expect(Object.fromEntries(request.searchParams)).toEqual({input_token:accessToken});
   return Response.json({data:{app_id:config.appId,is_valid:true,expires_at:0,data_access_expires_at:0,scopes,granular_scopes:scopes.map(scope=>({scope,target_ids:[input.wabaId]}))}});
  }
  expect(auth).toBe(`Bearer ${accessToken}`);
  if(expected[0]==="POST"){
   expect(request.search).toBe("");
   if(expected[1].endsWith("/register")){expect(JSON.parse(String(init?.body))).toEqual({messaging_product:"whatsapp",pin:input.pin});registered=true;}
   else {expect(JSON.parse(String(init?.body))).toEqual({});subscribed=true;}
   return Response.json({success:true});
  }
  if(expected[1]===input.wabaId){expect(Object.fromEntries(request.searchParams)).toEqual({fields:"id"});return Response.json({id:input.wabaId});}
  if(expected[1]===input.phoneNumberId){expect(Object.fromEntries(request.searchParams)).toEqual({fields:"id,display_phone_number,code_verification_status,platform_type,status,is_on_biz_app"});return Response.json(phone());}
  expect(Object.fromEntries(request.searchParams)).toEqual({limit:"100"});
  if(expected[1].endsWith("/phone_numbers"))return Response.json({data:[phone()]});
  return Response.json({data:subscribed?[{whatsapp_business_api_data:{id:config.appId,name:"Synthetic fixture app"}}]:[]});
 });
}

function inboundBody(wabaId:string,phoneNumberId:string,recipient:string,messageId:string){
 return JSON.stringify({object:"whatsapp_business_account",entry:[{id:wabaId,changes:[{field:"messages",value:{messaging_product:"whatsapp",metadata:{phone_number_id:phoneNumberId},contacts:[{wa_id:recipient,profile:{name:"Synthetic customer"}}],messages:[{id:messageId,from:recipient,type:"text",timestamp:String(Math.floor(Date.now()/1000)),text:{body:"Synthetic question"}}]}}]}]});
}
function signedRequest(body:string,appSecret:string){
 return new Request("http://localhost.invalid/api/whatsapp/webhook",{method:"POST",body,headers:{"x-hub-signature-256":`sha256=${createHmac("sha256",appSecret).update(body).digest("hex")}`}});
}

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();state.model.mockReset();state.send.mockReset();state.access.mockReset();state.admin=null;state.session=null;});
describe.skipIf(!enabled)("C2 complete synthetic company data journey",()=>{
 it("runs owner session → paid knowledge/dashboard → verified Meta signup/Vault → signed ingress → Noura/accounting → inbox/read → human takeover",async()=>{
  // Provider/WhatsApp/AI boundaries are mocked; PostgreSQL, Vault, RLS and RPCs are real.
  vi.stubGlobal("fetch",async()=>{throw Error("HTTP_OUTSIDE_SYNTHETIC_JOURNEY");});
  await verify();
  const f=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(true,10);"));
  const other=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(false);"));
  const actor=(await rows(`SELECT u.id,u.email,u.email_confirmed_at,s.id session_id FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id WHERE u.id=${lit(f.user)}::uuid`))[0];
  expect(actor.email_confirmed_at).toBeTruthy();
  await sql(`INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(actor.session_id)}::uuid,${lit(actor.id)}::uuid,clock_timestamp()) ON CONFLICT(session_id) DO UPDATE SET last_activity_at=excluded.last_activity_at;`);
  const client=sessionAdapter({actorId:actor.id,sessionId:actor.session_id}) as SignupRpcClient;
  const admin=databaseAdapter() as SignupRpcClient;state.session=client;state.admin=admin;
  const company=(await rows(`SELECT * FROM companies WHERE id=${lit(f.company)}::uuid`))[0];
  const membership=(await rows(`SELECT * FROM company_members WHERE company_id=${lit(f.company)}::uuid AND user_id=${lit(actor.id)}::uuid`))[0];
  state.access.mockResolvedValue({ok:true,context:{userId:actor.id,company,membership}});
  const originalConversation=(await rows(`SELECT id,company_id,phone_number_id,customer_wa_id FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid`))[0];
  const originalLink=(await rows(`SELECT generation,access_secret_id,provider_phone_number_id,provider_waba_id FROM whatsapp_company_links WHERE id=${lit(f.link)}::uuid`))[0];
  const initial=await loadWhatsappInboxInitialPage();expect(initial.ok).toBe(true);if(!initial.ok)throw Error(initial.code);
  expect(initial.page.companyId).toBe(f.company);expect(initial.page.kind).toBe("partial");
  expect((await client.rpc("whatsapp_inbox_page",{p_company_id:other.company,p_limit:40,p_before:null})).data).toMatchObject({ok:false});

  const knowledge=await rows(`SELECT * FROM knowledge_sources WHERE company_id=${lit(f.company)}::uuid`);
  expect(knowledge).toHaveLength(1);expect(knowledge[0]).toMatchObject({id:f.knowledge,approved_for_answers:true,content_version:1,approved_version:1});
  const subscription=(await rows(`SELECT status,paid_through FROM billing_subscriptions WHERE id=${lit(f.subscription)}::uuid AND company_id=${lit(f.company)}::uuid AND environment='live'`))[0];
  expect(subscription.status).toBe("active");expect(Date.parse(subscription.paid_through)).toBeGreaterThan(Date.now());
  expect((await client.rpc("billing_read_company_operational_entitlement",{p_company_id:f.company})).data).toMatchObject({ok:true,active:true,environment:"live"});

  const config={enabled:true,appId:numericAsset("1"),configId:numericAsset("4"),appSecret:"synthetic-journey-app-secret",systemUserToken:`synthetic-system-token-${randomUUID()}`,graphVersion:"v25.0"};
  const identity={companyId:f.company,userId:actor.id,sessionId:actor.session_id};
  const signup={attemptId:randomUUID(),nonce:randomBytes(32).toString("hex"),code:`synthetic-one-time-code-${randomUUID()}`,wabaId:numericAsset("2"),phoneNumberId:numericAsset("3"),pin:"123456"};
  const startArgs={p_company_id:f.company,p_attempt_id:signup.attemptId,p_nonce:signup.nonce,p_keep_on_phone:false,p_app_id:config.appId,p_config_id:config.configId,p_graph_version:config.graphVersion};
  expect((await client.rpc("whatsapp_start_embedded_signup",{...startArgs,p_company_id:other.company})).data).toMatchObject({ok:false,code:"FORBIDDEN"});
  expect((await client.rpc("whatsapp_start_embedded_signup",startArgs)).data).toMatchObject({ok:true,attempt_id:signup.attemptId,nonce:signup.nonce});
  expect((await client.rpc("whatsapp_claim_embedded_signup",{p_company_id:other.company,p_attempt_id:signup.attemptId,p_nonce:signup.nonce})).data).toMatchObject({ok:false,code:"FORBIDDEN"});
  const accessToken=`synthetic-journey-business-token-${randomUUID()}`,http=syntheticMetaHttp(config,signup,accessToken);
  vi.stubGlobal("fetch",http);
  const ports=createSignupPorts(identity,signup,config,client,admin);
  expect(await finishEmbeddedSignup(identity,signup,config,ports)).toEqual({ok:true});
  expect(http).toHaveBeenCalledTimes(10);
  expect(await finishEmbeddedSignup(identity,signup,config,ports)).toEqual({ok:false,code:"CONSUMED"});
  expect(http).toHaveBeenCalledTimes(10);
  expect((await rows(`SELECT status,user_id,session_id FROM whatsapp_embedded_signup_attempts WHERE id=${lit(signup.attemptId)}::uuid`))[0]).toMatchObject({status:"completed",user_id:actor.id,session_id:actor.session_id});

  const link=(await rows(`SELECT * FROM whatsapp_company_links WHERE id=${lit(f.link)}::uuid`))[0];
  expect(link).toMatchObject({company_id:f.company,provider_waba_id:signup.wabaId,provider_phone_number_id:signup.phoneNumberId,verified_display_number:"synthetic-display",status:"verified",authorization_status:"active",authorization_app_id:config.appId,authorization_user_id:actor.id,authorization_session_id:actor.session_id,authorization_non_expiring:true});
  expect(Number(link.generation)).toBe(Number(originalLink.generation)+1);expect(link.access_secret_id).toBeTruthy();expect(link.access_secret_id).not.toBe(originalLink.access_secret_id);
  expect(JSON.stringify(link)).not.toContain(accessToken);
  const vault=(await rows(`SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE id=${lit(link.access_secret_id)}::uuid) saved,EXISTS(SELECT 1 FROM vault.secrets WHERE id=${lit(link.access_secret_id)}::uuid AND secret=${lit(accessToken)}) plaintext,EXISTS(SELECT 1 FROM vault.secrets WHERE id=${lit(originalLink.access_secret_id)}::uuid) old_secret_retained`))[0];
  expect(vault).toEqual({saved:true,plaintext:false,old_secret_retained:false});
  const secretArgs={p_company_id:f.company,p_link_id:f.link,p_phone_number_id:signup.phoneNumberId,p_link_generation:Number(link.generation)};
  expect((await admin.rpc("whatsapp_read_link_access_secret",secretArgs)).data).toMatchObject({ok:true,access_token:accessToken});
  expect((await admin.rpc("whatsapp_read_link_access_secret",{...secretArgs,p_link_generation:Number(originalLink.generation)})).data).toMatchObject({ok:false});
  expect((await admin.rpc("whatsapp_read_link_access_secret",{...secretArgs,p_company_id:other.company})).data).toMatchObject({ok:false});
  const connection=await loadWhatsappConnectionStatus({companyId:f.company});expect(connection.ok).toBe(true);if(!connection.ok)throw Error(connection.code);
  expect(connection.data).toMatchObject({companyId:f.company,status:"verified",displayNumber:"synthetic-display",receiveReady:true,authorizationStatus:"active"});
  if(connection.data.status!=="verified")throw Error("SYNTHETIC_CONNECTION_NOT_VERIFIED");
  const dashboard=buildCustomerReadiness({fullName:"Synthetic fixture owner",email:actor.email,needsProfileName:false,role:"owner",companyId:f.company,companyName:company.display_name,companyStatus:company.status,knowledge:{loadFailed:false,sources:knowledge as KnowledgeSourceRecord[],approvalFoundation:"ready"},whatsapp:{loadFailed:false,status:connection.data.status,suspended:false,liveOpsReady:false},review:{loadFailed:false,status:null},subscription:{loadFailed:false,status:subscription.status,paidThrough:subscription.paid_through}});
  expect(dashboard.items.find(i=>i.id==="knowledge")?.detail).toBe("knowledge_ready");expect(dashboard.items.find(i=>i.id==="subscription")?.detail).toBe("subscription_active");expect(dashboard.items.find(i=>i.id==="whatsapp")?.detail).toBe("wa_verified_not_live");

  vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND","true");vi.stubEnv("WHATSAPP_ROUTING_MODE","tenant_registry");vi.stubEnv("WHATSAPP_APP_SECRET",config.appSecret);
  const messageId=`synthetic-journey-in-${randomUUID()}`,body=inboundBody(signup.wabaId,signup.phoneNumberId,originalConversation.customer_wa_id,messageId);
  expect((await receive(signedRequest(body,config.appSecret))).status).toBe(200);
  expect((await receive(signedRequest(body,config.appSecret))).status).toBe(200);
  const inbound=await rows(`SELECT j.id job_id,m.id message_id,m.company_id,m.conversation_id,c.phone_number_id,c.customer_wa_id,c.automation_allowed,c.control_revision FROM whatsapp_inbound_jobs j JOIN whatsapp_messages m ON m.id=j.message_id JOIN whatsapp_conversations c ON c.id=m.conversation_id WHERE m.wa_message_id=${lit(messageId)}`);
  expect(inbound).toHaveLength(1);const incoming=inbound[0],conversationId=incoming.conversation_id,job=incoming.job_id;
  expect(incoming).toMatchObject({company_id:f.company,phone_number_id:signup.phoneNumberId,customer_wa_id:originalConversation.customer_wa_id,automation_allowed:false});expect(conversationId).not.toBe(f.conversation);
  expect((await rows(`SELECT id,company_id,phone_number_id,customer_wa_id FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid`))[0]).toEqual(originalConversation);
  expect((await rows(`SELECT company_id,conversation_id,waba_id,phone_number_id FROM private.whatsapp_meta_inbound_evidence WHERE message_id=${lit(incoming.message_id)}::uuid`))[0]).toMatchObject({company_id:f.company,conversation_id:conversationId,waba_id:signup.wabaId,phone_number_id:signup.phoneNumberId});
  const foreignInbound={p_company_id:other.company,p_waba_id:signup.wabaId,p_phone_number_id:signup.phoneNumberId,p_customer_wa_id:originalConversation.customer_wa_id,p_customer_name:"Synthetic customer",p_wa_message_id:`synthetic-cross-tenant-${randomUUID()}`,p_body:"Synthetic question",p_message_type:"text",p_received_at:new Date().toISOString()};
  expect((await admin.rpc("whatsapp_store_meta_inbound",foreignInbound)).data).toMatchObject({ok:false,code:"binding_mismatch"});
  expect(await rows(`SELECT id FROM whatsapp_messages WHERE wa_message_id=${lit(foreignInbound.p_wa_message_id)}`)).toHaveLength(0);
  // New conversations deliberately require the owner's real automation control.
  expect(await controlWhatsappConversation({conversationId,action:"resume",expectedRevision:Number(incoming.control_revision)})).toMatchObject({ok:true});
  await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(job)}::uuid,120);SELECT test_fixture.ai_budget(${lit(f.company)}::uuid,10);`);
  // Retain the actual lease locally; it never crosses an assertion/report boundary.
  const token=(await rows(`SELECT claim_token FROM whatsapp_inbound_jobs WHERE id=${lit(job)}::uuid`))[0].claim_token;
  state.model.mockImplementation(async({model,system,prompt}:{model:string;system:string;prompt:string})=>{expect(system).toMatch(/نورا|Noura/);expect(prompt).toContain("Synthetic verified answer");return {status:"success",text:"Synthetic verified answer",actualModelId:model,requestId:"synthetic-journey-request",responseId:"synthetic-journey-response",latencyMs:2,usage:{promptTokens:20,completionTokens:10,cachedTokens:5,cacheWriteTokens:3,reasoningTokens:4,totalTokens:30}};});
  state.send.mockImplementation(async({toWaId,phoneNumberId,accessToken:sentToken,body:sentBody}:{toWaId:string;phoneNumberId:string;accessToken:string;body:string})=>{expect(toWaId).toBe(originalConversation.customer_wa_id);expect(phoneNumberId).toBe(signup.phoneNumberId);expect(sentToken).toBe(accessToken);expect(sentBody).toBe("Synthetic verified answer");return {ok:true,waMessageId:`synthetic-journey-out-${randomUUID()}`};});
  const input={jobId:job,claimToken:token,companyId:f.company};
  expect(await runInboundWorkerAnswer(input,createIntegrationPorts(input))).toMatchObject({ok:true,sendAccepted:true,delivered:false});
  expect((await rows(`SELECT status,usage_status,usage_subscription_id FROM whatsapp_inbound_jobs WHERE id=${lit(job)}::uuid`))[0]).toMatchObject({status:"completed",usage_status:"accepted",usage_subscription_id:f.subscription});
  expect((await rows(`SELECT company_id,conversation_id,link_id,link_generation,phone_number_id,outcome FROM whatsapp_send_intents WHERE original_job_id=${lit(job)}::uuid`))[0]).toMatchObject({company_id:f.company,conversation_id:conversationId,link_id:f.link,link_generation:Number(link.generation),phone_number_id:signup.phoneNumberId,outcome:"accepted"});
  const usage=(await rows(`SELECT status,company_id,total_tokens,actual_model_id,cost_baisa FROM ai_usage_ledger WHERE worker_job_id=${lit(job)}::uuid`))[0];
  expect(usage).toMatchObject({status:"success",company_id:f.company,total_tokens:30});expect(Number(usage.cost_baisa)).toBeGreaterThan(0);

  const inbox=await loadWhatsappInboxInitialPage();expect(inbox.ok).toBe(true);if(!inbox.ok)throw Error(inbox.code);
  expect(inbox.page.unreadTotal).toBe(1);expect(inbox.conversations.some(c=>c.id===conversationId)).toBe(true);expect(inbox.conversations.every(c=>c.id!==other.conversation)).toBe(true);
  const thread=await loadWhatsappThreadPage({companyId:f.company,conversationId,limit:40});expect(thread.ok).toBe(true);if(!thread.ok)throw Error(thread.code);
  expect(thread.data.messages).toHaveLength(2);expect(thread.data.messages.map(m=>m.direction)).toEqual(["inbound","outbound"]);
  const boundary=thread.data.displayedInboundMessageId;expect(boundary).toBe(incoming.message_id);
  expect(await markWhatsappThreadRead({companyId:f.company,conversationId,displayedInboundMessageId:boundary!})).toMatchObject({ok:true,data:{unreadCount:0}});
  expect((await client.rpc("whatsapp_thread_page",{p_company_id:other.company,p_conversation_id:conversationId,p_limit:40,p_before:null})).data).toMatchObject({ok:false});
  expect(await controlWhatsappConversation({conversationId,action:"take_over",expectedRevision:thread.data.conversation.revision!})).toMatchObject({ok:true});
  const controlled=(await rows(`SELECT automation_allowed,status FROM whatsapp_conversations WHERE id=${lit(conversationId)}::uuid`))[0];expect(controlled).toMatchObject({automation_allowed:false,status:"handed_over"});
  expect((await rows(`SELECT id,company_id,phone_number_id,customer_wa_id FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid`))[0]).toEqual(originalConversation);
  expect(state.model).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);expect(http).toHaveBeenCalledTimes(10);
 },150_000);
});
