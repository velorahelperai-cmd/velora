import type {MetaSignupConfig,MetaSignupInput,MetaSignupProof,MetaSignupResult} from "./embedded-signup-meta";
export type SignupIdentity={companyId:string;userId:string;sessionId:string};
export type SignupCompletionInput={attemptId:string;nonce:string;code:string;wabaId:string;phoneNumberId:string;pin:string};
export type SignupClaim={ok:true;attempt_id:string;company_id:string;user_id:string;session_id:string;app_id:string;config_id:string;graph_version:string;keep_on_phone:boolean};
export type SignupFailure={ok:false;code:string};
export type SignupPorts={claim:()=>Promise<SignupClaim|SignupFailure>;provider:(input:MetaSignupInput)=>Promise<MetaSignupResult>;finalize:(claim:SignupClaim,token:string,proof:MetaSignupProof)=>Promise<{ok:true}|SignupFailure>;fail:(code:string)=>Promise<void>};
/** The caller supplies identity from verified Auth, never from completion input. */
export async function finishEmbeddedSignup(identity:SignupIdentity,input:SignupCompletionInput,config:MetaSignupConfig&{configId:string},ports:SignupPorts):Promise<{ok:true}|SignupFailure>{
 if(!config.enabled)return {ok:false,code:"NEEDS_SETUP"};
 try{
  const claim=await ports.claim();if(!claim.ok)return claim;
  if(claim.attempt_id!==input.attemptId||claim.company_id!==identity.companyId||claim.user_id!==identity.userId||claim.session_id!==identity.sessionId||claim.app_id!==config.appId||claim.config_id!==config.configId||claim.graph_version!==config.graphVersion)return {ok:false,code:"FORBIDDEN"};
  const verified=await ports.provider({code:input.code,wabaId:input.wabaId,phoneNumberId:input.phoneNumberId,pin:input.pin,keepOnPhone:claim.keep_on_phone});
  if(!verified.ok){await ports.fail(verified.code);return verified;}
  const final=await ports.finalize(claim,verified.accessToken,verified.proof);
  if(!final.ok){await ports.fail("RECONCILIATION_REQUIRED");return {ok:false,code:"RECONCILIATION_REQUIRED"};}
  return {ok:true};
 }catch{
  // A provider mutation or database commit may have succeeded. No implicit replay.
  try{await ports.fail("RECONCILIATION_REQUIRED");}catch{}
  return {ok:false,code:"RECONCILIATION_REQUIRED"};
 }
}
