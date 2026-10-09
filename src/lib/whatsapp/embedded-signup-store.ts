import "server-only";
import type {SignupClaim,SignupCompletionInput,SignupIdentity,SignupPorts} from "./embedded-signup-flow";
import type {MetaSignupConfig} from "./embedded-signup-meta";
import {onboardMetaSignup} from "./embedded-signup-meta";
export type SignupRpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
const object=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:null;
const codes=new Set(["FORBIDDEN","EXPIRED","CONSUMED","NEEDS_SETUP","INVALID_INPUT","UNAVAILABLE","RECONCILIATION_REQUIRED"]);
export async function signupRpc(client:SignupRpcClient,name:string,args:Record<string,unknown>){
 try{const {data,error}=await client.rpc(name,args);const r=object(data);if(error||!r)return {ok:false as const,code:"UNAVAILABLE"};
 if(r.ok!==true)return {ok:false as const,code:codes.has(String(r.code))?String(r.code):"UNAVAILABLE"};return r;
 }catch{return {ok:false as const,code:"UNAVAILABLE"};}
}
export function createSignupPorts(identity:SignupIdentity,input:SignupCompletionInput,config:MetaSignupConfig,session:SignupRpcClient,admin:SignupRpcClient):SignupPorts{
 const binding={p_attempt_id:input.attemptId,p_user_id:identity.userId,p_session_id:identity.sessionId};
 return {
  claim:async()=>{const r=await signupRpc(session,"whatsapp_claim_embedded_signup",{p_company_id:identity.companyId,p_attempt_id:input.attemptId,p_nonce:input.nonce});
   if(r.ok!==true)return {ok:false,code:String(r.code)};
   if(["attempt_id","company_id","user_id","session_id","app_id","config_id","graph_version"].some(k=>typeof r[k]!=="string")||typeof r.keep_on_phone!=="boolean")return {ok:false,code:"UNAVAILABLE"};return r as SignupClaim;
  },
  provider:i=>onboardMetaSignup(config,i),
  finalize:async(_claim,token,proof)=>{const r=await signupRpc(admin,"whatsapp_finalize_embedded_signup",{...binding,p_access_token:token,p_proof:proof});return r.ok===true?{ok:true}:{ok:false,code:String(r.code)};},
  fail:async code=>{await signupRpc(admin,"whatsapp_fail_embedded_signup",{...binding,p_code:code});},
 };
}
