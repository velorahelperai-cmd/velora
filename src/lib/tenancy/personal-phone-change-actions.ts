"use server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {checkAppSession} from "@/lib/auth/session-guard";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
import {personalPhoneSmsRuntimeConfigured} from "./personal-phone-hook-config";
import {personalPhoneReceipt,personalPhoneUuid,type PersonalPhoneResult} from "./personal-phone";
import {beginPersonalPhoneChange,resendCurrentPhone,sendReplacementPhone,verifyPhoneChangeStep,type PersonalPhoneChangePort,type PersonalPhoneChangeStatus} from "./personal-phone-change";
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
function responseSessionId(token:unknown):string|undefined{
 if(typeof token!=="string"||token.length>20000)return;try{const payload=JSON.parse(Buffer.from(token.split(".")[1]??"","base64url").toString("utf8"));return personalPhoneUuid(payload.session_id)?payload.session_id:undefined;}catch{return;}
}
async function port(expectedUserId:string):Promise<PersonalPhoneChangePort>{
 const client=await createClient();const rpc=client.rpc as unknown as Rpc;
 return {configured:personalPhoneSmsRuntimeConfigured(),currentUser:async()=>{
  const {data,error}=await client.auth.getUser();if(error||!data.user)return {ok:false,code:"UNAUTHENTICATED"};
  const valid=await checkAppSession(client);return valid.ok?{ok:true,data:{userId:data.user.id,emailVerified:Boolean(data.user.email_confirmed_at)}}:{ok:false,code:valid.code};
 },rpc:async(name,args)=>{const {data,error}=await rpc.call(client,name,args);return error?{ok:false,code:"UNAVAILABLE"}:personalPhoneReceipt(data);},
 serviceRpc:async(name,args)=>{const admin=createAdminClient();if(!admin)return {ok:false,code:"UNCONFIGURED"};const {data,error}=await(admin.rpc as unknown as Rpc).call(admin,name,args);return error?{ok:false,code:"UNAVAILABLE"}:personalPhoneReceipt(data);},
 sendOld:async phone=>({ok:!(await client.auth.signInWithOtp({phone,options:{shouldCreateUser:false,channel:"sms"}})).error}),
 updatePhone:async phone=>({ok:!(await client.auth.updateUser({phone})).error}),
 verify:async(phone,code,type)=>{
  const {data,error}=await client.auth.verifyOtp({phone,token:code,type});
  if(data.user&&data.user.id!==expectedUserId){await client.auth.signOut({scope:"local"});return {ok:true,userId:data.user.id};}
  // This session ID is parsed ONLY from the trusted native verifyOtp response,
  // never an action argument, browser token or generic OTP AMR assertion.
  return {ok:!error&&Boolean(data.user&&data.session),userId:data.user?.id,phone:data.user?.phone,sessionId:responseSessionId(data.session?.access_token)};
 },revokeOthers:async()=>({ok:!(await client.auth.signOut({scope:"others"})).error}),reconcileNativeNew:async()=>{
  const {data,error}=await client.auth.getClaims();if(error||data?.claims.sub!==expectedUserId||!personalPhoneUuid(data?.claims.session_id))return {ok:false,code:"UNAUTHENTICATED"};
  const admin=createAdminClient();if(!admin)return {ok:false,code:"UNCONFIGURED"};
  const result=await(admin.rpc as unknown as Rpc).call(admin,"master_reconcile_phone_change_native",{p_user_id:expectedUserId,p_verified_session_id:data.claims.session_id});
  return result.error?{ok:false,code:"UNAVAILABLE"}:personalPhoneReceipt(result.data);
 }};
}
export async function beginPersonalPhoneChangeAction(input:{expectedUserId:string;newPhone:string;requestKey:string}):Promise<PersonalPhoneResult>{
 if(!masterJourneyEnabled()||!personalPhoneSmsRuntimeConfigured())return {ok:false,code:"UNCONFIGURED"};try{return await beginPersonalPhoneChange(await port(input.expectedUserId),input);}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function sendReplacementPhoneAction(input:{expectedUserId:string;changeId:string;requestKey:string}):Promise<PersonalPhoneResult>{
 if(!masterJourneyEnabled()||!personalPhoneSmsRuntimeConfigured())return {ok:false,code:"UNCONFIGURED"};try{return await sendReplacementPhone(await port(input.expectedUserId),input);}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function resendCurrentPhoneAction(input:{expectedUserId:string;changeId:string;requestKey:string}):Promise<PersonalPhoneResult>{
 if(!masterJourneyEnabled()||!personalPhoneSmsRuntimeConfigured())return {ok:false,code:"UNCONFIGURED"};try{return await resendCurrentPhone(await port(input.expectedUserId),input);}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function verifyPhoneChangeStepAction(input:{expectedUserId:string;intentId:string;code:string}):Promise<PersonalPhoneResult>{
 if(!masterJourneyEnabled()||!personalPhoneSmsRuntimeConfigured())return {ok:false,code:"UNCONFIGURED"};try{return await verifyPhoneChangeStep(await port(input.expectedUserId),input);}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function readPersonalPhoneChangeStatus(expectedUserId:string):Promise<PersonalPhoneResult<PersonalPhoneChangeStatus>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};if(!personalPhoneUuid(expectedUserId))return {ok:false,code:"INVALID_INPUT"};
 try{const p=await port(expectedUserId),who=await p.currentUser();if(!who.ok)return who;if(who.data.userId!==expectedUserId)return {ok:false,code:"UNAUTHENTICATED"};
 if(p.configured&&p.reconcileNativeNew){const finished=await p.reconcileNativeNew();if(!finished.ok)return finished;if(finished.data.step==="complete")await p.revokeOthers();}
 const r=await p.rpc("master_phone_change_status",{});if(!r.ok)return r;const d=r.data as unknown as PersonalPhoneChangeStatus;
 if(d.userId!==expectedUserId||!["CONFIGURED","UNCONFIGURED"].includes(d.configuration))return {ok:false,code:"UNAVAILABLE"};
 if(d.change!==null){const c=d.change;if(!c||!personalPhoneUuid(c.id)||!["old_pending","old_verified","new_pending","complete","expired"].includes(c.step)||typeof c.oldPhoneMasked!=="string"||typeof c.newPhoneMasked!=="string"||!Number.isFinite(Date.parse(c.expiresAt))||c.intent!==null&&(!c.intent||!personalPhoneUuid(c.intent.id)||!["reserved","sent","verifying","verified","failed","expired"].includes(c.intent.state)||!Number.isFinite(Date.parse(c.intent.expiresAt))||!Number.isFinite(Date.parse(c.intent.resendAt))))return {ok:false,code:"UNAVAILABLE"};}
 return {ok:true,data:{...d,configuration:p.configured&&d.configuration==="CONFIGURED"?"CONFIGURED":"UNCONFIGURED"}};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
