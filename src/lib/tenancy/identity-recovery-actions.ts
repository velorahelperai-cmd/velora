"use server";
import {createClient} from "@/lib/supabase/server";
import {requirePlatformAdmin} from "@/lib/tenancy/access";
import {checkAppSession} from "@/lib/auth/session-guard";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
import {personalPhoneUuid} from "./personal-phone";
import {parseIdentityRecoveryCase,type IdentityRecoveryCase,type IdentityRecoveryResult} from "./identity-recovery";
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
async function call(name:string,args:Record<string,unknown>,expectedUserId?:string,admin=false):Promise<IdentityRecoveryResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 try{
  if(admin&&!(await requirePlatformAdmin()).ok)return {ok:false,code:"FORBIDDEN"};
  const client=await createClient(),who=await client.auth.getUser();if(who.error||!who.data.user||expectedUserId!==undefined&&who.data.user.id!==expectedUserId)return {ok:false,code:"UNAUTHENTICATED"};
  if(!(await checkAppSession(client)).ok)return {ok:false,code:"UNAUTHENTICATED"};
  const {data,error}=await(client.rpc as unknown as Rpc).call(client,name,args);
  if(error)return {ok:false,code:typeof error==="object"&&"code" in error&&error.code==="42501"?"FORBIDDEN":"UNAVAILABLE"};
  if(!data||typeof data!=="object"||Array.isArray(data))return {ok:false,code:"UNAVAILABLE"};const r=data as {ok?:unknown;data?:unknown;code?:unknown};
  return r.ok===true&&r.data&&typeof r.data==="object"&&!Array.isArray(r.data)?{ok:true,data:r.data as Record<string,unknown>}:{ok:false,code:typeof r.code==="string"&&["UNCONFIGURED","REVIEW_REQUIRED","INDEPENDENT_EVIDENCE_REQUIRED","INVALID_INPUT"].includes(r.code)?r.code:"UNAVAILABLE"};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function openIdentityRecoveryReviewAction(input:{expectedUserId:string;reason:"lost_phone"|"lost_email_and_phone";requestKey:string}):Promise<IdentityRecoveryResult<IdentityRecoveryCase>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};if(!personalPhoneUuid(input?.expectedUserId)||!personalPhoneUuid(input?.requestKey)||!["lost_phone","lost_email_and_phone"].includes(input?.reason))return {ok:false,code:"INVALID_INPUT"};
 const r=await call("master_open_identity_recovery_review",{p_expected_user_id:input.expectedUserId,p_reason:input.reason,p_request_key:input.requestKey},input.expectedUserId);if(!r.ok)return r;const data=parseIdentityRecoveryCase(r.data,input.expectedUserId);return data?{ok:true,data}:{ok:false,code:"UNAVAILABLE"};
}
export async function adminOpenIdentityRecoveryReviewAction(input:{userId:string;reason:"lost_phone"|"lost_email_and_phone";requestKey:string}):Promise<IdentityRecoveryResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};if(!personalPhoneUuid(input?.userId)||!personalPhoneUuid(input?.requestKey)||!["lost_phone","lost_email_and_phone"].includes(input?.reason))return {ok:false,code:"INVALID_INPUT"};
 return call("admin_open_identity_recovery_review",{p_user_id:input.userId,p_reason:input.reason,p_request_key:input.requestKey},undefined,true);
}
export async function readIdentityRecoveryReviewsAction(expectedUserId?:string,admin=false):Promise<IdentityRecoveryResult<{actorUserId:string;configuration:"CONFIGURED"|"UNCONFIGURED";cases:IdentityRecoveryCase[]}>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};if(expectedUserId!==undefined&&!personalPhoneUuid(expectedUserId))return {ok:false,code:"INVALID_INPUT"};
 const r=await call(admin?"admin_read_identity_recovery_reviews":"master_read_identity_recovery_reviews",{},expectedUserId,admin);if(!r.ok)return r;
 const actor=admin?r.data.actorUserId:r.data.userId;if(!personalPhoneUuid(actor)||expectedUserId!==undefined&&actor!==expectedUserId||!["CONFIGURED","UNCONFIGURED"].includes(String(r.data.configuration))||!Array.isArray(r.data.cases))return {ok:false,code:"UNAVAILABLE"};
 const cases=r.data.cases.map(c=>parseIdentityRecoveryCase(c,admin?undefined:actor));if(cases.some(c=>c===null))return {ok:false,code:"UNAVAILABLE"};return {ok:true,data:{actorUserId:actor,configuration:r.data.configuration as "CONFIGURED"|"UNCONFIGURED",cases:cases as IdentityRecoveryCase[]}};
}
export async function adminDecideIdentityRecoveryAction(input:{caseId:string;decision:"request_evidence"|"reject"|"approve_review";requestKey:string}):Promise<IdentityRecoveryResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};if(!personalPhoneUuid(input?.caseId)||!personalPhoneUuid(input?.requestKey)||!["request_evidence","reject","approve_review"].includes(input?.decision))return {ok:false,code:"INVALID_INPUT"};
 return call("admin_decide_identity_recovery",{p_case_id:input.caseId,p_decision:input.decision,p_request_key:input.requestKey},undefined,true);
}
