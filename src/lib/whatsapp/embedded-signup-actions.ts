"use server";
import {diagnoseWhatsAppConnection,diagnosedWhatsAppPorts} from "./connection-diagnostics";
import {fixedAckConfig} from "./fixed-ack";
import {revalidatePath} from "next/cache";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {checkAppSession} from "@/lib/auth/session-guard";
import {createEmbeddedSignupAttempt,embeddedSignupClientConfig} from "./embedded-signup";
import {createSignupPorts,signupRpc,type SignupRpcClient} from "./embedded-signup-store";
import {finishEmbeddedSignup,type SignupCompletionInput} from "./embedded-signup-flow";

const uuid=(s:unknown)=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
async function owner(expectedCompanyId?:string){
 const access=await getCompanyAccess("owner");
 if(!access.ok)return {ok:false as const,code:access.code==="UNAVAILABLE"?"UNAVAILABLE":"FORBIDDEN"};
 if(!access.context.identityVerified||!access.context.company||access.context.membership?.role!=="owner")return {ok:false as const,code:"FORBIDDEN"};
 if(expectedCompanyId!==undefined&&access.context.company.id!==expectedCompanyId)return {ok:false as const,code:"FORBIDDEN"};
 if(access.context.company.status==="suspended")return {ok:false as const,code:"COMPANY_SUSPENDED"};
 try{
  const client=await createClient();const claims=await client.auth.getClaims();const sessionId=claims.data?.claims?.session_id;
  if(claims.error||claims.data?.claims?.sub!==access.context.userId||!uuid(sessionId)||!(await checkAppSession(client)).ok)return {ok:false as const,code:"FORBIDDEN"};
  return {ok:true as const,identity:{companyId:access.context.company.id,userId:access.context.userId,sessionId:String(sessionId)},client:client as unknown as SignupRpcClient};
 }catch{return {ok:false as const,code:"UNAVAILABLE"};}
}
async function scopedOwner(companyId:unknown){
 if(typeof companyId!=="string"||!companyId.trim())return {ok:false as const,code:"INVALID_INPUT"};
 return owner(companyId.trim());
}
function serverConfig(){
 const publicConfig=embeddedSignupClientConfig();if(!publicConfig.ok)return null;
 return {...publicConfig,enabled:true,appSecret:process.env.WHATSAPP_APP_SECRET?.trim()??"",systemUserToken:process.env.WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN?.trim()??""};
}
export async function getEmbeddedSignupSetup(companyId:string){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await scopedOwner(companyId);if(!auth.ok)return auth;
 trace.stage("preflight");const config=embeddedSignupClientConfig();if(!config.ok||!createAdminClient())return {ok:false as const,code:"NEEDS_SETUP"};
 trace.stage("readiness");const ready=await signupRpc(auth.client,"whatsapp_embedded_signup_readiness",{p_company_id:auth.identity.companyId});
 if(ready.ok!==true)return {ok:false as const,code:String(ready.code)};return config;
 });
}
export async function startEmbeddedSignup(input:{companyId:string;keepOnPhone:boolean}){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await scopedOwner(input?.companyId);if(!auth.ok)return auth;
 trace.stage("preflight");const config=embeddedSignupClientConfig();if(!config.ok||!createAdminClient()||input?.keepOnPhone!==false)return {ok:false as const,code:"NEEDS_SETUP"};
 trace.stage("input");const fresh=createEmbeddedSignupAttempt({...auth.identity,keepOnPhone:false});if(!fresh.ok)return fresh;
 trace.stage("persistence");const r=await signupRpc(auth.client,"whatsapp_start_embedded_signup",{p_company_id:auth.identity.companyId,p_attempt_id:fresh.attempt.id,p_nonce:fresh.attempt.nonce,p_keep_on_phone:false,p_app_id:config.appId,p_config_id:config.configId,p_graph_version:config.graphVersion});
 if(r.ok!==true)return {ok:false as const,code:String(r.code)};
 if(r.attempt_id!==fresh.attempt.id||r.nonce!==fresh.attempt.nonce||typeof r.expires_at!=="string")return {ok:false as const,code:"UNAVAILABLE"};
 return {ok:true as const,attemptId:fresh.attempt.id,nonce:fresh.attempt.nonce,expiresAt:r.expires_at,config:{appId:config.appId,configId:config.configId,graphVersion:config.graphVersion}};
 });
}
export async function completeEmbeddedSignup(input:SignupCompletionInput){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await owner();if(!auth.ok)return auth;
 trace.stage("preflight");const config=serverConfig(),admin=createAdminClient();if(!config||!admin)return {ok:false as const,code:"NEEDS_SETUP"};
 trace.stage("input");if(!input||!uuid(input.attemptId)||typeof input.nonce!=="string"||!/^[0-9a-f]{64}$/.test(input.nonce)||typeof input.code!=="string"||!input.code||input.code.length>4096||!/^\d{1,64}$/.test(input.wabaId)||!/^\d{1,64}$/.test(input.phoneNumberId)||!/^\d{6}$/.test(input.pin))return {ok:false as const,code:"INVALID_INPUT"};
 const r=await finishEmbeddedSignup(auth.identity,input,config,diagnosedWhatsAppPorts(createSignupPorts(auth.identity,input,config,auth.client,admin as unknown as SignupRpcClient),trace));
 if(r.ok){try{revalidatePath("/app/settings");}catch{/* Authorization is already durably finalized. */}}return r;
 });
}
export async function cancelEmbeddedSignup(input:{attemptId:string;nonce:string}){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await owner();if(!auth.ok)return auth;
 trace.stage("input");if(!input||!uuid(input.attemptId)||typeof input.nonce!=="string"||!/^[0-9a-f]{64}$/.test(input.nonce))return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("persistence");const r=await signupRpc(auth.client,"whatsapp_cancel_embedded_signup",{p_company_id:auth.identity.companyId,p_attempt_id:input.attemptId,p_nonce:input.nonce});return r.ok===true?{ok:true as const}:{ok:false as const,code:String(r.code)};
 });
}
export async function disconnectEmbeddedSignup(companyId:string){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await scopedOwner(companyId);if(!auth.ok)return auth;
 trace.stage("persistence");const r=await signupRpc(auth.client,"whatsapp_disconnect_embedded_signup",{p_company_id:auth.identity.companyId});if(r.ok===true){try{revalidatePath("/app/settings");}catch{/* Authorization is already durably revoked. */}}return r.ok===true?{ok:true as const}:{ok:false as const,code:String(r.code)};
 });
}

export async function getFixedAckSetup(companyId:string){
 const auth=await scopedOwner(companyId);if(!auth.ok)return auth;
 const config=fixedAckConfig();if(!config||config.companyId!==auth.identity.companyId)return {ok:true as const,available:false as const};
 const r=await signupRpc(auth.client,"whatsapp_read_fixed_ack",{p_company_id:config.companyId});
 if(r.ok!==true||typeof r.enabled!=="boolean"||r.response_kind!=="fixed_ack_v1")return {ok:false as const,code:"UNAVAILABLE"};
 return {ok:true as const,available:true as const,enabled:r.enabled};
}
export async function configureFixedAck(companyId:string,enabled:boolean){
 const auth=await scopedOwner(companyId);if(!auth.ok)return auth;
 const config=fixedAckConfig();if(!config||config.companyId!==auth.identity.companyId)return {ok:false as const,code:"NEEDS_SETUP"};
 if(typeof enabled!=="boolean")return {ok:false as const,code:"INVALID_INPUT"};
 const r=await signupRpc(auth.client,"whatsapp_configure_fixed_ack",{p_company_id:config.companyId,p_phone_number_id:config.phoneNumberId,p_recipient_wa_id:config.recipientWaId,p_enabled:enabled});
 if(r.ok!==true||r.enabled!==enabled)return {ok:false as const,code:"UNAVAILABLE"};revalidatePath("/app/settings");return {ok:true as const,enabled};
}
