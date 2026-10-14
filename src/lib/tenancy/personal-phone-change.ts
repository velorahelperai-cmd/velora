import {normalizePersonalPhone,personalPhoneUuid,type PersonalPhoneResult} from "./personal-phone";
export type PersonalPhoneChangePort={configured:boolean;currentUser:()=>Promise<PersonalPhoneResult<{userId:string;emailVerified:boolean}>>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<PersonalPhoneResult>;serviceRpc:(name:string,args:Record<string,unknown>)=>Promise<PersonalPhoneResult>;
 sendOld:(phone:string)=>Promise<{ok:boolean}>;updatePhone:(phone:string)=>Promise<{ok:boolean}>;
 verify:(phone:string,code:string,type:"sms"|"phone_change")=>Promise<{ok:boolean;userId?:string;phone?:string;sessionId?:string}>;revokeOthers:()=>Promise<{ok:boolean}>;reconcileNativeNew?:()=>Promise<PersonalPhoneResult>};
export type PersonalPhoneChangeStatus={userId:string;configuration:"CONFIGURED"|"UNCONFIGURED";change:null|{id:string;step:string;oldPhoneMasked:string;newPhoneMasked:string;expiresAt:string;intent:null|{id:string;state:string;expiresAt:string;resendAt:string}}};
async function actor(port:PersonalPhoneChangePort,uid:string){const r=await port.currentUser();return !r.ok?r:r.data.userId!==uid?{ok:false as const,code:"UNAUTHENTICATED" as const}:!r.data.emailVerified?{ok:false as const,code:"EMAIL_REQUIRED" as const}:r;}
async function send(port:PersonalPhoneChangePort,uid:string,reserved:PersonalPhoneResult,step:"old"|"new"){
 if(!reserved.ok||reserved.data.executeProvider===false)return reserved;
 const phone=normalizePersonalPhone(reserved.data.phone);if(!phone||!personalPhoneUuid(reserved.data.intentId)||!personalPhoneUuid(reserved.data.changeId)||reserved.data.executeProvider!==true)return {ok:false as const,code:"UNAVAILABLE" as const};
 const current=await actor(port,uid);if(!current.ok)return current;
 let sent=false;try{sent=(await(step==="old"?port.sendOld(phone):port.updatePhone(phone))).ok;}catch{/* Unknown sends never retry automatically. */}
 const settled=await port.rpc("master_personal_phone_send_result",{p_expected_user_id:uid,p_intent_id:reserved.data.intentId,p_sent:sent});
 return sent?settled:{ok:false as const,code:"UNAVAILABLE" as const};
}
export async function beginPersonalPhoneChange(port:PersonalPhoneChangePort,input:{expectedUserId:string;newPhone:string;requestKey:string}):Promise<PersonalPhoneResult>{
 if(!port.configured)return {ok:false,code:"UNCONFIGURED"};
 const target=normalizePersonalPhone(input?.newPhone);if(!target||!personalPhoneUuid(input?.expectedUserId)||!personalPhoneUuid(input?.requestKey))return {ok:false,code:"INVALID_INPUT"};
 try{const r=await actor(port,input.expectedUserId);if(!r.ok)return r;return await send(port,input.expectedUserId,await port.rpc("master_begin_phone_change",{p_expected_user_id:input.expectedUserId,p_new_phone:target,p_request_key:input.requestKey}),"old");}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function sendReplacementPhone(port:PersonalPhoneChangePort,input:{expectedUserId:string;changeId:string;requestKey:string}):Promise<PersonalPhoneResult>{
 if(!port.configured)return {ok:false,code:"UNCONFIGURED"};
 if(![input?.expectedUserId,input?.changeId,input?.requestKey].every(personalPhoneUuid))return {ok:false,code:"INVALID_INPUT"};
 try{const r=await actor(port,input.expectedUserId);if(!r.ok)return r;return await send(port,input.expectedUserId,await port.rpc("master_send_replacement_phone",{p_expected_user_id:input.expectedUserId,p_change_id:input.changeId,p_request_key:input.requestKey}),"new");}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function resendCurrentPhone(port:PersonalPhoneChangePort,input:{expectedUserId:string;changeId:string;requestKey:string}):Promise<PersonalPhoneResult>{
 if(!port.configured)return {ok:false,code:"UNCONFIGURED"};
 if(![input?.expectedUserId,input?.changeId,input?.requestKey].every(personalPhoneUuid))return {ok:false,code:"INVALID_INPUT"};
 try{const r=await actor(port,input.expectedUserId);if(!r.ok)return r;return await send(port,input.expectedUserId,await port.rpc("master_resend_current_phone",{p_expected_user_id:input.expectedUserId,p_change_id:input.changeId,p_request_key:input.requestKey}),"old");}catch{return {ok:false,code:"UNAVAILABLE"};}
}
export async function verifyPhoneChangeStep(port:PersonalPhoneChangePort,input:{expectedUserId:string;intentId:string;code:string}):Promise<PersonalPhoneResult>{
 if(!port.configured)return {ok:false,code:"UNCONFIGURED"};
 if(!personalPhoneUuid(input?.expectedUserId)||!personalPhoneUuid(input?.intentId)||typeof input?.code!=="string"||!/^\d{6}$/.test(input.code))return {ok:false,code:"INVALID_INPUT"};
 try{
 const who=await actor(port,input.expectedUserId);if(!who.ok)return who;
 const r=await port.rpc("master_claim_phone_change_verify",{p_expected_user_id:input.expectedUserId,p_intent_id:input.intentId});if(!r.ok||r.data.complete===true)return r;
 const phone=normalizePersonalPhone(r.data.phone);if(!phone||!personalPhoneUuid(r.data.leaseId)||r.data.intentId!==input.intentId||!["old","new"].includes(String(r.data.step)))return {ok:false,code:"UNAVAILABLE"};
 const current=await actor(port,input.expectedUserId);if(!current.ok)return current;
 const proof=await port.verify(phone,input.code,r.data.step==="old"?"sms":"phone_change");
 if(!proof.ok)return {ok:false,code:"CODE_INVALID"};if(proof.userId!==input.expectedUserId)return {ok:false,code:"UNAUTHENTICATED"};
 const confirmed=typeof proof.phone==="string"?normalizePersonalPhone(proof.phone.startsWith("+")?proof.phone:`+${proof.phone}`):null;
 if(confirmed!==phone||!personalPhoneUuid(proof.sessionId))return {ok:false,code:"VERIFICATION_INCOMPLETE"};
 const fresh=await actor(port,input.expectedUserId);if(!fresh.ok)return fresh;
 const finished=await port.serviceRpc("master_finish_phone_change_verify",{p_user_id:input.expectedUserId,p_intent_id:input.intentId,p_lease_id:r.data.leaseId,p_verified_session_id:proof.sessionId});
 if(finished.ok&&finished.data.step==="complete")await port.revokeOthers();return finished;
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
