export type BillingFact = boolean | "unavailable";
export type DashboardBillingEvidence = {
 companyId: string; billingPaid: BillingFact; operationalEligible: BillingFact;
 channelReady: BillingFact; usageCompanyId: string|null; qualifiedPaidThrough: string|null;
};
export type DashboardBillingLoad =
 | {status:"unavailable"|"forbidden"}
 | {status:"empty";companyId:string}
 | {status:"ready";companyId:string;subscriptionStatus:string;paidThrough:string|null;monthStart:string|null;
    billingPaid:BillingFact;operationalEligible:BillingFact;channelReady:BillingFact;
    sent:number|null;held:number|null;cap:number|null;remaining:number|null;usedPercent:number|null};
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const count=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const timestamp=(v:unknown):v is string=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const fact=(v:unknown):BillingFact=>typeof v==="boolean"?v:"unavailable";
/** Financial history, current entitlement and channel readiness are independent.
 * Only the server envelope binds usage and proof; raw Active never authorizes capacity.
 */
export function dashboardBillingSnapshot(companyId:string,journey:unknown,usage:unknown,evidence?:unknown):DashboardBillingLoad {
 const j=record(journey);
 if(!j||!("subscription" in j))return {status:"unavailable"};
 if(j.subscription===null)return {status:"empty",companyId};
 const s=record(j.subscription);
 if(!s||s.company_id!==companyId||typeof s.status!=="string"||!s.status.trim()
  ||!(s.paid_through===null||timestamp(s.paid_through)))return {status:"unavailable"};
 const raw=record(evidence),e=raw?.companyId===companyId?raw:null;
 const billingPaid=fact(e?.billingPaid),channelReady=fact(e?.channelReady);
 const paidThrough=timestamp(e?.qualifiedPaidThrough)?e.qualifiedPaidThrough:null;
 const reported=fact(e?.operationalEligible);
 const operationalEligible=reported==="unavailable"?"unavailable":reported===true&&billingPaid===true
  &&["active","cancel_at_period_end"].includes(s.status)&&paidThrough!==null&&Date.parse(paidThrough)>Date.now();
 const u=record(usage);
 const usageScoped=!!u&&u.company_id===companyId&&(!raw||raw.usageCompanyId===companyId);
 const validUsage=usageScoped&&timestamp(u?.month_start)&&count(u?.successful_automated_outbound)&&count(u?.held_outbound_capacity)
  &&Number.isSafeInteger(u.successful_automated_outbound+u.held_outbound_capacity);
 const sent=validUsage?u.successful_automated_outbound as number:null,held=validUsage?u.held_outbound_capacity as number:null;
 const cap=validUsage&&count(u.cap)?u.cap:null;
 const allocated=sent===null||held===null?null:sent+held;
 const usable=operationalEligible===true&&allocated!==null&&cap!==null;
 return {status:"ready",companyId,subscriptionStatus:s.status,paidThrough,monthStart:validUsage?u.month_start as string:null,
  billingPaid,operationalEligible,channelReady,sent,held,cap,
  remaining:usable?Math.max(0,cap-allocated):null,usedPercent:usable&&cap>0?Math.min(100,allocated/cap*100):null};
}
