import {personalPhoneUuid} from "./personal-phone";

export type IdentityRecoveryCase={
 id:string;
 userId:string;
 reason:"lost_phone"|"lost_email_and_phone";
 state:"review"|"needs_evidence"|"rejected"|"approved_for_manual_recovery";
 createdAt:string;
 verifiedEvidence:number;
};

export type IdentityRecoveryView={
 actorUserId:string;
 configuration:"CONFIGURED"|"UNCONFIGURED";
 cases:IdentityRecoveryCase[];
 /** Opaque tip that authorized this read — UI capture fence, not a privilege grant. */
 boundaryFingerprint:string;
};

export type IdentityRecoveryResult<T=Record<string,unknown>>={ok:true;data:T}|{ok:false;code:string;expired?:true};

export function identityRecoveryBoundaryOk(value:unknown):value is string{
 return typeof value==="string"&&/^[a-f0-9]{16}$/i.test(value);
}

/** Classify PostgREST/SDK rpc failures. Top-level status is authoritative; error.status is often absent on 503. */
export function classifyIdentityRecoveryRpcFailure(
 observation:{error:unknown;status?:number;statusText?:string},
 uncertainAfterAttempt:boolean,
):string{
 const error=observation.error;
 if(typeof error==="object"&&error&&"code" in error&&(error as {code?:unknown}).code==="42501"){
  return "FORBIDDEN";
 }
 const status=
  typeof observation.status==="number"
   ?observation.status
   :typeof error==="object"&&error&&"status" in error
    ?Number((error as {status?:unknown}).status)
    :NaN;
 const statusText=
  typeof observation.statusText==="string"
   ?observation.statusText
   :typeof error==="object"&&error&&"statusText" in error
    ?String((error as {statusText?:unknown}).statusText??"")
    :"";
 const message=
  typeof error==="object"&&error&&"message" in error
   ?String((error as {message?:unknown}).message??"")
   :typeof error==="string"?error:"";
 const code=typeof error==="object"&&error&&"code" in error?String((error as {code?:unknown}).code??""):"";
 if(uncertainAfterAttempt){
  if(status===502||status===503||status===504||status===0)return "UNCONFIRMED";
  if(/service unavailable|bad gateway|gateway timeout/i.test(`${statusText} ${message}`))return "UNCONFIRMED";
  if(code==="PGRST301"||code==="57014"||code==="08006"||code==="08001"||code==="57P01")return "UNCONFIRMED";
  if(/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(message))return "UNCONFIRMED";
 }
 return "UNAVAILABLE";
}

export function parseIdentityRecoveryCase(value:unknown,expectedUserId?:string):IdentityRecoveryCase|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;const c=value as IdentityRecoveryCase;
 return personalPhoneUuid(c.id)&&personalPhoneUuid(c.userId)&&(expectedUserId===undefined||expectedUserId===c.userId)&&["lost_phone","lost_email_and_phone"].includes(c.reason)&&["review","needs_evidence","rejected","approved_for_manual_recovery"].includes(c.state)&&Number.isFinite(Date.parse(c.createdAt))&&Number.isSafeInteger(c.verifiedEvidence)&&c.verifiedEvidence>=0?c:null;
}

export type IdentityRecoveryEvidencePort={
 configured:boolean;
 verify:(input:{source:string;evidenceReference:string;expectedUserId:string})=>Promise<{verified:boolean;userId?:string}>;
 record:(input:{caseId:string;source:string;evidenceReference:string;userId:string})=>Promise<IdentityRecoveryResult>;
};

/** Evidence attestation only — never grants providers, identity mutation, or session authority. */
export async function attestIdentityRecoveryEvidence(
 port:IdentityRecoveryEvidencePort,
 input:{caseId:string;expectedUserId:string;source:string;evidenceReference:string},
):Promise<IdentityRecoveryResult>{
 if(!port.configured)return {ok:false,code:"UNCONFIGURED"};
 if(
  !personalPhoneUuid(input?.caseId)
  ||!personalPhoneUuid(input?.expectedUserId)
  ||typeof input?.source!=="string"
  ||input.source.length<1
  ||input.source.length>100
  ||typeof input?.evidenceReference!=="string"
  ||input.evidenceReference.length<1
  ||input.evidenceReference.length>200
 )return {ok:false,code:"INVALID_INPUT"};
 try{
  const proof=await port.verify({
   source:input.source,
   evidenceReference:input.evidenceReference,
   expectedUserId:input.expectedUserId,
  });
  if(proof.verified!==true||proof.userId!==input.expectedUserId)return {ok:false,code:"REVIEW_REQUIRED"};
  return await port.record({
   caseId:input.caseId,
   source:input.source,
   evidenceReference:input.evidenceReference,
   userId:proof.userId,
  });
 }catch{
  return {ok:false,code:"UNAVAILABLE"};
 }
}
