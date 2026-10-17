import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {authCallbackUrl} from "@/lib/auth/site-url";
import {commitIntentCookie,type CookieReader,type CookieWriter} from "./cookies";
import {encryptSecret} from "./crypto";
import {prepareBrokerAdmissionLineage} from "./lineage-auth";
import {brokerLog} from "./log";
import {createProviderAuthClient} from "./provider";
import {loadAuthIntentByNonce,probeBrokerCapability,reserveBoundAuthIntent} from "./registry";

/** The email request is neutral; only a bound native PKCE exchange grants authority. */
export async function brokerRequestPasswordReset(input:{email:string;requestNonce?:string|null;reader:CookieReader;writer:CookieWriter}):Promise<{ok:true}|{ok:false;code:"UNAVAILABLE"}>{
 if(!input.email.trim()||!input.requestNonce||input.requestNonce.length<16)return {ok:false,code:"UNAVAILABLE"};
 const capability=await probeBrokerCapability();if(!capability.ok||!capability.boundAdmit)return {ok:false,code:"UNAVAILABLE"};
 const lineage=await prepareBrokerAdmissionLineage(input.reader,input.writer);if(!lineage.ok)return {ok:false,code:"UNAVAILABLE"};
 const reserved=await reserveBoundAuthIntent({bootstrapHash:lineage.bootstrapHash,requestNonce:input.requestNonce,purpose:"password_recovery",ttlSeconds:600});if(!reserved)return {ok:false,code:"UNAVAILABLE"};
 const intent=await loadAuthIntentByNonce(reserved.stateNonce);
 if(!intent||intent.purpose!=="password_recovery"||intent.status!=="reserved"||intent.browserLineageId!==lineage.browserLineageId||!Number.isFinite(Date.parse(intent.expiresAt))||Date.parse(intent.expiresAt)<=Date.now())return {ok:false,code:"UNAVAILABLE"};
 // An uncertain request retry must not replace the verifier for a possibly delivered link.
 if(intent.pkceVerifier){commitIntentCookie(input.writer,reserved.stateNonce,600);return {ok:true};}
 const admin=createAdminClient();if(!admin)return {ok:false,code:"UNAVAILABLE"};
 let persisted=false;
 const bundle=createProviderAuthClient({persistPkceVerifier:async verifier=>{
  const encrypted=encryptSecret(verifier)?.toString("base64");if(!encrypted)throw Error("RECOVERY_VERIFIER_ENCRYPTION_UNAVAILABLE");
  const {data,error}=await admin.from("vel_broker_auth_intents" as never).update({pkce_verifier_enc:encrypted,updated_at:new Date().toISOString()} as never).eq("id",intent.id as never).eq("status","reserved" as never).is("pkce_verifier_enc",null).select("id");
  if(error||!Array.isArray(data)||data.length!==1)throw Error("RECOVERY_VERIFIER_PERSIST_UNAVAILABLE");
  commitIntentCookie(input.writer,reserved.stateNonce,600);persisted=true;
 }});if(!bundle)return {ok:false,code:"UNAVAILABLE"};
 const base=authCallbackUrl("/reset-password");const redirectTo=base+(base.includes("?")?"&":"?")+"vel_intent="+encodeURIComponent(reserved.stateNonce);
 try{
  const {error}=await bundle.client.auth.resetPasswordForEmail(input.email.trim().toLowerCase(),{redirectTo});
  if(error)brokerLog("warn","auth.broker.password_reset.request_unconfirmed",{error_code:"RECOVERY_REQUEST_UNCONFIRMED",stage:"provider"});
 }catch{
  brokerLog("warn","auth.broker.password_reset.request_unconfirmed",{error_code:persisted?"RECOVERY_REQUEST_UNKNOWN":"RECOVERY_VERIFIER_UNAVAILABLE",stage:persisted?"provider":"persist"});
 }
 return persisted?{ok:true}:{ok:false,code:"UNAVAILABLE"};
}
