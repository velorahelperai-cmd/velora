import {personalPhoneUuid} from "./personal-phone";
export type IdentityRecoveryCase={id:string;userId:string;reason:"lost_phone"|"lost_email_and_phone";state:"review"|"needs_evidence"|"rejected"|"approved_for_manual_recovery";createdAt:string;verifiedEvidence:number};
export type IdentityRecoveryResult<T=Record<string,unknown>>={ok:true;data:T}|{ok:false;code:string};
export function parseIdentityRecoveryCase(value:unknown,expectedUserId?:string):IdentityRecoveryCase|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;const c=value as IdentityRecoveryCase;
 return personalPhoneUuid(c.id)&&personalPhoneUuid(c.userId)&&(expectedUserId===undefined||expectedUserId===c.userId)&&["lost_phone","lost_email_and_phone"].includes(c.reason)&&["review","needs_evidence","rejected","approved_for_manual_recovery"].includes(c.state)&&Number.isFinite(Date.parse(c.createdAt))&&Number.isSafeInteger(c.verifiedEvidence)&&c.verifiedEvidence>=0?c:null;
}
export type IdentityRecoveryEvidencePort={configured:boolean;verify:(input:{source:string;evidenceReference:string;expectedUserId:string})=>Promise<{verified:boolean;userId?:string}>;record:(input:{caseId:string;source:string;evidenceReference:string;userId:string})=>Promise<IdentityRecoveryResult>};
export async function attestIdentityRecoveryEvidence(port:IdentityRecoveryEvidencePort,input:{caseId:string;expectedUserId:string;source:string;evidenceReference:string}):Promise<IdentityRecoveryResult>{
 if(!port.configured)return {ok:false,code:"UNCONFIGURED"};
 if(!personalPhoneUuid(input?.caseId)||!personalPhoneUuid(input?.expectedUserId)||typeof input?.source!=="string"||input.source.length<1||input.source.length>100||typeof input?.evidenceReference!=="string"||input.evidenceReference.length<1||input.evidenceReference.length>200)return {ok:false,code:"INVALID_INPUT"};
 try{const proof=await port.verify({source:input.source,evidenceReference:input.evidenceReference,expectedUserId:input.expectedUserId});if(proof.verified!==true||proof.userId!==input.expectedUserId)return {ok:false,code:"REVIEW_REQUIRED"};return await port.record({caseId:input.caseId,source:input.source,evidenceReference:input.evidenceReference,userId:proof.userId});}catch{return {ok:false,code:"UNAVAILABLE"};}
}
