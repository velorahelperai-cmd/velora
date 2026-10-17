"use server";

import {createBrokerBoundClient,createClient} from "@/lib/supabase/server";
import {requirePlatformAdmin} from "@/lib/tenancy/access";
import {checkAppSession} from "@/lib/auth/session-guard";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
import {brokerLog} from "@/lib/auth/broker/log";
import {personalPhoneUuid} from "./personal-phone";
import {
 classifyIdentityRecoveryRpcFailure,
 identityRecoveryBoundaryOk,
 parseIdentityRecoveryCase,
 type IdentityRecoveryCase,
 type IdentityRecoveryResult,
 type IdentityRecoveryView,
} from "./identity-recovery";

/** Supabase/PostgREST rpc observation — status is top-level, often absent on error object (SDK 503 shape). */
type RpcObservation={data:unknown;error:unknown;status?:number;statusText?:string};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<RpcObservation>;
type BoundAuth={
 client:Awaited<ReturnType<typeof createClient>>;
 userId:string;
 boundaryFingerprint:string;
 nativeSessionId:string;
 registryId:string;
 browserLineageId:string;
};

function captureMismatch(expectedBoundaryFingerprint:string,userId:string){
 brokerLog("warn","identity.recovery.capture_not_tip",{
  module:"identity.recovery",
  operation:"authorize",
  error_code:"CAPTURE_NOT_AUTHORITATIVE",
  boundary_fp:expectedBoundaryFingerprint,
  user_id:userId,
 });
 return {ok:false as const,code:"UNAUTHENTICATED" as const};
}

function sessionIdFromClaims(claims:unknown):string|null{
 if(!claims||typeof claims!=="object")return null;
 const sid=(claims as {session_id?:unknown}).session_id;
 return personalPhoneUuid(sid)?sid:null;
}

/** Resolve current broker tip — registry/lineage/native from server resolve, not browser hints. */
async function resolveCapturedTip(
 expectedBoundaryFingerprint?:string,
 expectedUserId?:string,
):Promise<{ok:true;data:BoundAuth}|{ok:false;code:string;expired?:true}>{
 const bound=await createBrokerBoundClient();
 if(!bound.bound.ok)return {ok:false,code:bound.bound.code};
 const resolve=bound.bound.resolve;
 const tip=resolve.boundary;
 if(!personalPhoneUuid(tip.nativeSessionId))return {ok:false,code:"UNAUTHENTICATED"};
 if(!personalPhoneUuid(resolve.registryId))return {ok:false,code:"UNAUTHENTICATED"};
 if(!personalPhoneUuid(tip.browserLineageId))return {ok:false,code:"UNAUTHENTICATED"};
 if(expectedBoundaryFingerprint!==undefined){
  if(!identityRecoveryBoundaryOk(expectedBoundaryFingerprint))return {ok:false,code:"INVALID_INPUT"};
  if(tip.boundaryFingerprint!==expectedBoundaryFingerprint){
   return captureMismatch(expectedBoundaryFingerprint,tip.userId);
  }
 }
 if(expectedUserId!==undefined){
  if(!personalPhoneUuid(expectedUserId)||expectedUserId!==tip.userId)return {ok:false,code:"UNAUTHENTICATED"};
 }
 return {
  ok:true,
  data:{
   client:bound.bound.client,
   userId:tip.userId,
   boundaryFingerprint:tip.boundaryFingerprint,
   nativeSessionId:tip.nativeSessionId,
   registryId:resolve.registryId,
   browserLineageId:tip.browserLineageId!,
  },
 };
}

/**
 * WP01A capture authority: tip must match before and after awaited native checks;
 * JWT session_id equals tip.nativeSessionId; registry/lineage captured for SQL root fence.
 */
async function authorizeCustomer(
 expectedBoundaryFingerprint?:string,
 expectedUserId?:string,
):Promise<{ok:true;data:BoundAuth}|{ok:false;code:string;expired?:true}>{
 const first=await resolveCapturedTip(expectedBoundaryFingerprint,expectedUserId);
 if(!first.ok)return first;
 const who=await first.data.client.auth.getUser();
 if(who.error||!who.data.user||who.data.user.id!==first.data.userId){
  return {ok:false,code:"UNAUTHENTICATED"};
 }
 const guard=await checkAppSession(first.data.client);
 if(!guard.ok){
  if(guard.expired===true)return {ok:false,code:"UNAUTHENTICATED",expired:true};
  return {ok:false,code:"UNAUTHENTICATED"};
 }
 const again=await resolveCapturedTip(expectedBoundaryFingerprint,expectedUserId);
 if(!again.ok)return again;
 if(
  again.data.userId!==first.data.userId
  ||again.data.boundaryFingerprint!==first.data.boundaryFingerprint
  ||again.data.nativeSessionId!==first.data.nativeSessionId
  ||again.data.registryId!==first.data.registryId
  ||again.data.browserLineageId!==first.data.browserLineageId
 )return {ok:false,code:"UNAUTHENTICATED"};
 if(
  expectedBoundaryFingerprint!==undefined
  &&again.data.boundaryFingerprint!==expectedBoundaryFingerprint
 )return {ok:false,code:"UNAUTHENTICATED"};
 const claims=await again.data.client.auth.getClaims();
 const jwtSid=sessionIdFromClaims(claims.data?.claims);
 if(!jwtSid||jwtSid!==again.data.nativeSessionId)return {ok:false,code:"UNAUTHENTICATED"};
 return again;
}

async function invoke(
 client:BoundAuth["client"],
 name:string,
 args:Record<string,unknown>,
 options?:{uncertainAfterAttempt?:boolean},
):Promise<IdentityRecoveryResult>{
 const uncertain=options?.uncertainAfterAttempt===true;
 try{
  const observation=await(client.rpc as unknown as Rpc).call(client,name,args);
  if(observation.error){
   return {ok:false,code:classifyIdentityRecoveryRpcFailure(observation,uncertain)};
  }
  const data=observation.data;
  if(!data||typeof data!=="object"||Array.isArray(data))return {ok:false,code:"UNAVAILABLE"};
  const r=data as {ok?:unknown;data?:unknown;code?:unknown};
  if(r.ok===true&&r.data&&typeof r.data==="object"&&!Array.isArray(r.data)){
   return {ok:true,data:r.data as Record<string,unknown>};
  }
  const allowed=["UNCONFIGURED","REVIEW_REQUIRED","INDEPENDENT_EVIDENCE_REQUIRED","INVALID_INPUT"];
  return {
   ok:false,
   code:typeof r.code==="string"&&allowed.includes(r.code)?r.code:"UNAVAILABLE",
  };
 }catch{
  return {ok:false,code:uncertain?"UNCONFIRMED":"UNAVAILABLE"};
 }
}

async function callAdmin(
 name:string,
 args:Record<string,unknown>,
):Promise<IdentityRecoveryResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 try{
  if(!(await requirePlatformAdmin()).ok)return {ok:false,code:"FORBIDDEN"};
  const client=await createClient();
  const who=await client.auth.getUser();
  if(who.error||!who.data.user)return {ok:false,code:"UNAUTHENTICATED"};
  if(!(await checkAppSession(client)).ok)return {ok:false,code:"UNAUTHENTICATED"};
  return await invoke(client,name,args,{uncertainAfterAttempt:false});
 }catch{
  return {ok:false,code:"UNAVAILABLE"};
 }
}

/**
 * Open a recovery review for the bound tip actor.
 * Passes tip registry/lineage/native into RPC for root-linearized tip fence (C01).
 * Transport uncertainty after the attempt → UNCONFIRMED; keep requestKey for reconcile.
 */
export async function openIdentityRecoveryReviewAction(input:{
 reason:"lost_phone"|"lost_email_and_phone";
 requestKey:string;
 expectedBoundaryFingerprint:string;
 expectedUserId?:string;
}):Promise<IdentityRecoveryResult<IdentityRecoveryCase&{boundaryFingerprint:string}>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 if(
  !identityRecoveryBoundaryOk(input?.expectedBoundaryFingerprint)
  ||!personalPhoneUuid(input?.requestKey)
  ||!["lost_phone","lost_email_and_phone"].includes(input?.reason)
 )return {ok:false,code:"INVALID_INPUT"};
 if(input.expectedUserId!==undefined&&!personalPhoneUuid(input.expectedUserId)){
  return {ok:false,code:"INVALID_INPUT"};
 }
 try{
  const auth=await authorizeCustomer(input.expectedBoundaryFingerprint,input.expectedUserId);
  if(!auth.ok)return auth;
  const tip=await resolveCapturedTip(input.expectedBoundaryFingerprint,input.expectedUserId);
  if(!tip.ok)return tip;
  if(
   tip.data.userId!==auth.data.userId
   ||tip.data.nativeSessionId!==auth.data.nativeSessionId
   ||tip.data.boundaryFingerprint!==auth.data.boundaryFingerprint
   ||tip.data.registryId!==auth.data.registryId
   ||tip.data.browserLineageId!==auth.data.browserLineageId
  )return {ok:false,code:"UNAUTHENTICATED"};
  const claims=await tip.data.client.auth.getClaims();
  const jwtSid=sessionIdFromClaims(claims.data?.claims);
  if(!jwtSid||jwtSid!==tip.data.nativeSessionId)return {ok:false,code:"UNAUTHENTICATED"};

  const r=await invoke(tip.data.client,"master_open_identity_recovery_review",{
   p_expected_user_id:tip.data.userId,
   p_reason:input.reason,
   p_request_key:input.requestKey,
   p_expected_native_session_id:tip.data.nativeSessionId,
   p_expected_registry_id:tip.data.registryId,
   p_expected_browser_lineage_id:tip.data.browserLineageId,
  },{uncertainAfterAttempt:true});
  if(!r.ok){
   brokerLog("warn","identity.recovery.open",{
    module:"identity.recovery",
    operation:"open_review",
    error_code:r.code,
    boundary_fp:tip.data.boundaryFingerprint,
    user_id:tip.data.userId,
    stage:r.code==="UNCONFIRMED"?"unconfirmed":"rejected",
   });
   return r;
  }
  const data=parseIdentityRecoveryCase(r.data,tip.data.userId);
  if(!data)return {ok:false,code:"UNAVAILABLE"};
  brokerLog("info","identity.recovery.open",{
   module:"identity.recovery",
   operation:"open_review",
   boundary_fp:tip.data.boundaryFingerprint,
   user_id:tip.data.userId,
   support_ref:data.id,
   stage:data.state,
  });
  return {ok:true,data:{...data,boundaryFingerprint:tip.data.boundaryFingerprint}};
 }catch{
  brokerLog("warn","identity.recovery.open",{
   module:"identity.recovery",
   operation:"open_review",
   error_code:"UNCONFIRMED",
   stage:"unconfirmed",
  });
  return {ok:false,code:"UNCONFIRMED"};
 }
}

export async function adminOpenIdentityRecoveryReviewAction(input:{
 userId:string;
 reason:"lost_phone"|"lost_email_and_phone";
 requestKey:string;
}):Promise<IdentityRecoveryResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 if(
  !personalPhoneUuid(input?.userId)
  ||!personalPhoneUuid(input?.requestKey)
  ||!["lost_phone","lost_email_and_phone"].includes(input?.reason)
 )return {ok:false,code:"INVALID_INPUT"};
 return callAdmin("admin_open_identity_recovery_review",{
  p_user_id:input.userId,
  p_reason:input.reason,
  p_request_key:input.requestKey,
 });
}

type ReadInput={
 expectedUserId?:string;
 expectedBoundaryFingerprint?:string;
 admin?:boolean;
};

function normalizeReadArgs(
 expectedUserIdOrInput?:string|ReadInput,
 adminFlag?:boolean,
):ReadInput{
 if(expectedUserIdOrInput&&typeof expectedUserIdOrInput==="object")return expectedUserIdOrInput;
 return {expectedUserId:expectedUserIdOrInput,admin:adminFlag===true};
}

export async function readIdentityRecoveryReviewsAction(
 expectedUserIdOrInput?:string|ReadInput,
 adminFlag?:boolean,
):Promise<IdentityRecoveryResult<IdentityRecoveryView>>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 const input=normalizeReadArgs(expectedUserIdOrInput,adminFlag);
 if(input.admin){
  try{
   const r=await callAdmin("admin_read_identity_recovery_reviews",{});
   if(!r.ok)return r;
   const actor=r.data.actorUserId;
   if(
    !personalPhoneUuid(actor)
    ||!["CONFIGURED","UNCONFIGURED"].includes(String(r.data.configuration))
    ||!Array.isArray(r.data.cases)
   )return {ok:false,code:"UNAVAILABLE"};
   const cases=r.data.cases.map((c)=>parseIdentityRecoveryCase(c));
   if(cases.some((c)=>c===null))return {ok:false,code:"UNAVAILABLE"};
   return {
    ok:true,
    data:{
     actorUserId:actor,
     configuration:r.data.configuration as "CONFIGURED"|"UNCONFIGURED",
     cases:cases as IdentityRecoveryCase[],
     boundaryFingerprint:"",
    },
   };
  }catch{
   return {ok:false,code:"UNAVAILABLE"};
  }
 }
 if(input.expectedUserId!==undefined&&!personalPhoneUuid(input.expectedUserId)){
  return {ok:false,code:"INVALID_INPUT"};
 }
 if(
  input.expectedBoundaryFingerprint!==undefined
  &&!identityRecoveryBoundaryOk(input.expectedBoundaryFingerprint)
 )return {ok:false,code:"INVALID_INPUT"};
 try{
  const auth=await authorizeCustomer(input.expectedBoundaryFingerprint,input.expectedUserId);
  if(!auth.ok)return auth;
  const tip=await resolveCapturedTip(input.expectedBoundaryFingerprint,input.expectedUserId);
  if(!tip.ok)return tip;
  if(
   tip.data.userId!==auth.data.userId
   ||tip.data.nativeSessionId!==auth.data.nativeSessionId
   ||tip.data.registryId!==auth.data.registryId
   ||tip.data.browserLineageId!==auth.data.browserLineageId
  )return {ok:false,code:"UNAUTHENTICATED"};
  const r=await invoke(tip.data.client,"master_read_identity_recovery_reviews",{
   p_expected_native_session_id:tip.data.nativeSessionId,
   p_expected_registry_id:tip.data.registryId,
   p_expected_browser_lineage_id:tip.data.browserLineageId,
  },{uncertainAfterAttempt:false});
  if(!r.ok){
   brokerLog("warn","identity.recovery.read",{
    module:"identity.recovery",
    operation:"read_reviews",
    error_code:r.code,
    boundary_fp:tip.data.boundaryFingerprint,
    user_id:tip.data.userId,
    stage:"rejected",
   });
   return r;
  }
  const actor=r.data.userId;
  if(
   !personalPhoneUuid(actor)
   ||actor!==tip.data.userId
   ||!["CONFIGURED","UNCONFIGURED"].includes(String(r.data.configuration))
   ||!Array.isArray(r.data.cases)
  )return {ok:false,code:"UNAVAILABLE"};
  const cases=r.data.cases.map((c)=>parseIdentityRecoveryCase(c,actor));
  if(cases.some((c)=>c===null))return {ok:false,code:"UNAVAILABLE"};
  brokerLog("info","identity.recovery.read",{
   module:"identity.recovery",
   operation:"read_reviews",
   boundary_fp:tip.data.boundaryFingerprint,
   user_id:tip.data.userId,
   stage:String(r.data.configuration),
  });
  return {
   ok:true,
   data:{
    actorUserId:actor,
    configuration:r.data.configuration as "CONFIGURED"|"UNCONFIGURED",
    cases:cases as IdentityRecoveryCase[],
    boundaryFingerprint:tip.data.boundaryFingerprint,
   },
  };
 }catch{
  return {ok:false,code:"UNAVAILABLE"};
 }
}

export async function adminDecideIdentityRecoveryAction(input:{
 caseId:string;
 decision:"request_evidence"|"reject"|"approve_review";
 requestKey:string;
}):Promise<IdentityRecoveryResult>{
 if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
 if(
  !personalPhoneUuid(input?.caseId)
  ||!personalPhoneUuid(input?.requestKey)
  ||!["request_evidence","reject","approve_review"].includes(input?.decision)
 )return {ok:false,code:"INVALID_INPUT"};
 return callAdmin("admin_decide_identity_recovery",{
  p_case_id:input.caseId,
  p_decision:input.decision,
  p_request_key:input.requestKey,
 });
}
