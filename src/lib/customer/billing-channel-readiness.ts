import type {BillingFact} from "./dashboard-billing-model";
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Existing verified channel evidence, independent of subscription payment. */
export function billingChannelReadiness(result:unknown,companyId:string,liveOpsReady:boolean,now=Date.now()):BillingFact {
 const r=record(result),d=record(r?.data);
 if(r?.ok!==true||!d||d.companyId!==companyId)return "unavailable";
 if(["not_connected","request_saved","needs_external_action","error","disconnected"].includes(String(d.status)))return false;
 if(d.status!=="verified"||typeof d.authorizationReady!=="boolean")return "unavailable";
 if(d.authorizationReady!==true||d.receptionSendTested!==true||!liveOpsReady)return false;
 if(typeof d.authorizationExpiresAt!=="string"||!Number.isFinite(Date.parse(d.authorizationExpiresAt)))return "unavailable";
 for(const field of ["inboundTestedAt","outboundTestedAt"]){
  const value=d[field];if(typeof value!=="string"||!Number.isFinite(Date.parse(value)))return "unavailable";
  if(Date.parse(value)>now)return false;
 }
 return Date.parse(d.authorizationExpiresAt)>now;
}
