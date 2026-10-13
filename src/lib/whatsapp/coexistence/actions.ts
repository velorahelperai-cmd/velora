"use server";
import {diagnoseWhatsAppConnection,diagnosedWhatsAppPorts} from "../connection-diagnostics";
import {revalidatePath} from "next/cache";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {checkAppSession} from "@/lib/auth/session-guard";
import {authorizeCoexistenceOwner,type OwnerRpcClient} from "./owner-auth";
import {normalizeConfirmedCompanyPhone,type CoexistenceCompletionInput,type PublicCoexistenceClientConfig} from "./client-config";
import {readCoexistenceSignupReadiness,readCoexistenceSignupStatus,startCoexistenceSignupStore,createCoexistenceSignupPorts,cancelCoexistenceSignupStore,disconnectCoexistenceSignupStore} from "./signup-store";
import {finishCoexistenceSignup} from "./flow";
import {reconcileCoexistenceEvents} from "./projection-store";
import {readCoexistenceSyncReadiness,readCoexistenceSyncStatus,requestCoexistenceSync,createCoexistenceSyncPorts,type CoexistenceSyncType} from "./sync";

const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const assetId=(value:unknown):value is string=>typeof value==="string"&&/^[1-9]\d{0,31}$/.test(value);
const env=(name:string)=>process.env[name]?.trim()??"";
async function owner(companyId?:string){
 return authorizeCoexistenceOwner(companyId,{
  access:()=>getCompanyAccess("owner"),
  session:async()=>{const client=await createClient(),claims=await client.auth.getClaims();return {client:client as unknown as OwnerRpcClient,subject:claims.data?.claims?.sub,sessionId:claims.data?.claims?.session_id,claimsError:Boolean(claims.error)};},
  checkSession:client=>checkAppSession(client),
 });
}
/** A dedicated configuration and tenant routing are required; default remains disabled. */
function serverConfig(){
 const appId=env("WHATSAPP_EMBEDDED_SIGNUP_APP_ID"),configId=env("WHATSAPP_COEXISTENCE_CONFIG_ID"),graphVersion=env("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION"),appSecret=env("WHATSAPP_APP_SECRET"),systemUserToken=env("WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN");
 if(env("WHATSAPP_COEXISTENCE")!=="true"||env("WHATSAPP_ROUTING_MODE")!=="tenant_registry"||!assetId(appId)||!assetId(configId)||configId===env("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID")||!/^v\d+\.0$/.test(graphVersion)||!appSecret||!systemUserToken)return null;
 return {enabled:true,appId,configId,graphVersion,appSecret,systemUserToken};
}
function publicConfig(config:NonNullable<ReturnType<typeof serverConfig>>):PublicCoexistenceClientConfig{return {appId:config.appId,configId:config.configId,graphVersion:config.graphVersion};}
export async function getCoexistenceSetup(companyId:string){
 return diagnoseWhatsAppConnection(async trace=>{
 if(!uuid(companyId))return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("session");const auth=await owner(companyId);if(!auth.ok)return auth;
 trace.stage("channel");let persisted=await readCoexistenceSignupStatus(auth.client,auth.identity.companyId);if(!persisted.ok)return persisted;
 const admin=createAdminClient();
 const recovery=persisted.connectionStatus==="active"&&admin?await reconcileCoexistenceEvents(admin as unknown as OwnerRpcClient,auth.identity.companyId):null;
 if(recovery?.ok){persisted=await readCoexistenceSignupStatus(auth.client,auth.identity.companyId);if(!persisted.ok)return persisted;}
 trace.stage("preflight");const config=serverConfig();let ready=false;
 if(config&&createAdminClient())ready=(await readCoexistenceSignupReadiness(auth.client,auth.identity.companyId)).ok;
 return {ok:true as const,config:config&&ready?publicConfig(config):null,status:{companyId:persisted.companyId,connectionStatus:["claimed","token_checkpointed","reconcile_required"].includes(persisted.status)?"needs_review" as const:persisted.connectionStatus==="active"?"connected" as const:persisted.connectionStatus==="not_connected"?"not_connected" as const:"disconnected" as const,displayPhoneNumber:persisted.displayPhoneNumber,liveVerified:persisted.connectionStatus==="active"&&persisted.liveVerified,historySyncStatus:persisted.historySyncStatus,lastErrorCode:persisted.lastErrorCode,projectionRecovery:recovery?.ok?{pending:recovery.remaining,conflicts:recovery.conflicts}:null}};
 });
}
export async function startCoexistenceSignup(input:{companyId:string;internationalPhoneNumber:string;confirmed:true}){
 return diagnoseWhatsAppConnection(async trace=>{
 if(!uuid(input?.companyId))return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("session");const auth=await owner(input?.companyId);if(!auth.ok)return auth;
 trace.stage("input");const phone=normalizeConfirmedCompanyPhone(input?.internationalPhoneNumber,input?.confirmed);if(!phone)return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("preflight");const config=serverConfig();if(!config||!createAdminClient())return {ok:false as const,code:"NEEDS_SETUP"};
 trace.stage("readiness");const ready=await readCoexistenceSignupReadiness(auth.client,auth.identity.companyId);if(!ready.ok)return ready;
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
 const attemptId=crypto.randomUUID();
 trace.stage("persistence");const started=await startCoexistenceSignupStore(auth.client,{companyId:auth.identity.companyId,attemptId,nonce,expectedPhoneNumber:phone,appId:config.appId,configId:config.configId,graphVersion:config.graphVersion,keepOnPhone:true});
 return started.ok?{...started,config:publicConfig(config)}:started;
 });
}
export async function completeCoexistenceSignup(input:CoexistenceCompletionInput){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await owner();if(!auth.ok)return auth;
 trace.stage("input");if(!input||!uuid(input.attemptId)||typeof input.nonce!=="string"||!/^[0-9a-f]{64}$/.test(input.nonce)||typeof input.code!=="string"||!input.code.trim()||input.code.length>8192||!assetId(input.wabaId)||(input.phoneNumberId!==undefined&&!assetId(input.phoneNumberId))||normalizeConfirmedCompanyPhone(input.confirmedPhoneNumber,true)!==input.confirmedPhoneNumber)return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("preflight");const config=serverConfig(),admin=createAdminClient();if(!config||!admin)return {ok:false as const,code:"NEEDS_SETUP"};
 trace.stage("readiness");const ready=await readCoexistenceSignupReadiness(auth.client,auth.identity.companyId);if(!ready.ok)return ready;
 const normalized={...input,attemptId:input.attemptId.toLowerCase()};
 const result=await finishCoexistenceSignup(auth.identity,normalized,config,diagnosedWhatsAppPorts(createCoexistenceSignupPorts(auth.identity,normalized,config,auth.client,admin as unknown as OwnerRpcClient),trace));
 if(result.ok)await reconcileCoexistenceEvents(admin as unknown as OwnerRpcClient,auth.identity.companyId);
 revalidatePath("/app/settings");revalidatePath("/setup");return result;
 });
}
export async function cancelCoexistenceSignup(input:{attemptId:string;nonce:string}){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("session");const auth=await owner();if(!auth.ok)return auth;
 trace.stage("input");if(!input||!uuid(input.attemptId)||typeof input.nonce!=="string"||!/^[0-9a-f]{64}$/.test(input.nonce))return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("persistence");return cancelCoexistenceSignupStore(auth.client,auth.identity.companyId,input.attemptId.toLowerCase(),input.nonce);
 });
}
export async function disconnectCoexistenceSignup(companyId:string){
 return diagnoseWhatsAppConnection(async trace=>{
 if(!uuid(companyId))return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("session");const auth=await owner(companyId);if(!auth.ok)return auth;
 trace.stage("persistence");const result=await disconnectCoexistenceSignupStore(auth.client,auth.identity.companyId);
 if(result.ok){revalidatePath("/app/settings");revalidatePath("/setup");}return result;
 });
}

export async function getCoexistenceSyncSetup(companyId:string){
 return diagnoseWhatsAppConnection(async trace=>{
 if(!uuid(companyId))return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("session");const auth=await owner(companyId);if(!auth.ok)return auth;
 trace.stage("channel");let status:Awaited<ReturnType<typeof readCoexistenceSyncStatus>>;try{status=await readCoexistenceSyncStatus(auth.client,auth.identity.companyId);}catch{return {ok:false as const,code:"UNAVAILABLE" as const};}if(!status.ok)return status;
 trace.stage("preflight");const config=serverConfig();
 const ready=Boolean(config&&createAdminClient()&&(await readCoexistenceSyncReadiness(auth.client,auth.identity.companyId)).ok);
 return {...status,ready};
 });
}
export async function requestCoexistenceHistorySync(input:{companyId:string;linkId:string;linkGeneration:number;syncType:CoexistenceSyncType;consent:true}){
 return diagnoseWhatsAppConnection(async trace=>{
 trace.stage("input");if(!input||!uuid(input.companyId)||!uuid(input.linkId)||!Number.isSafeInteger(input.linkGeneration)||input.linkGeneration<1||!["history","smb_app_state_sync"].includes(input.syncType)||input.consent!==true)return {ok:false as const,code:"INVALID_INPUT"};
 trace.stage("session");const auth=await owner(input.companyId);if(!auth.ok)return auth;
 trace.stage("preflight");const config=serverConfig(),admin=createAdminClient();if(!config||!admin)return {ok:false as const,code:"NEEDS_SETUP"};
 trace.stage("readiness");const ready=await readCoexistenceSyncReadiness(auth.client,auth.identity.companyId);if(!ready.ok)return ready;
 const request={requestId:crypto.randomUUID(),linkId:input.linkId.toLowerCase(),linkGeneration:input.linkGeneration,syncType:input.syncType,consent:true as const};
 const result=await requestCoexistenceSync(auth.identity,request,config,diagnosedWhatsAppPorts(createCoexistenceSyncPorts(auth.identity,request,config,auth.client,admin as unknown as OwnerRpcClient),trace));
 revalidatePath("/app/settings");return result;
 });
}
