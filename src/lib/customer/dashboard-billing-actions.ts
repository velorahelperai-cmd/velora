"use server";
import {createClient} from "@/lib/supabase/server";
import {nativeReplyBalance} from "./dashboard-es02-credit-model";
import {getCompanyAccess} from "@/lib/tenancy/access";
import {readCompanyBillingDisplay} from "@/lib/billing/wiring/display-read";
import {getWhatsappCompanyLink} from "@/lib/whatsapp/connection-actions";
import {whatsappLiveOpsReady} from "@/lib/whatsapp/config";
import {billingChannelReadiness} from "./billing-channel-readiness";
import {dashboardBillingSnapshot,type DashboardBillingLoad} from "./dashboard-billing-model";
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Session-bound read-only snapshot; no checkout, provider or activation. */
export async function readDashboardBilling(input?:{expectedCompanyId?:string}):Promise<DashboardBillingLoad> {
 try{
  const access=await getCompanyAccess("owner");
  if(!access.ok)return {status:access.code==="UNAVAILABLE"?"unavailable":"forbidden"};
  if(!access.context.company||access.context.membership?.role!=="owner"||access.context.membership.status!=="active")return {status:"forbidden"};
  const companyId=access.context.company.id;
  if(input?.expectedCompanyId!==undefined&&input.expectedCompanyId!==companyId)return {status:"forbidden"};
  const [billing,channel]=await Promise.allSettled([readCompanyBillingDisplay(companyId),getWhatsappCompanyLink()]);
  if(billing.status!=="fulfilled")return {status:"unavailable"};
  if(!billing.value.ok)return {status:billing.value.code};
  const data=billing.value.data;
  const usage=record(data.usage);
  const snapshot=dashboardBillingSnapshot(companyId,data.journey,data.usage,{companyId:data.company_id,
   billingPaid:data.billing_paid,operationalEligible:data.operational_eligible,qualifiedPaidThrough:data.qualified_paid_through,
   usageCompanyId:usage?.company_id??null,
   channelReady:billingChannelReadiness(channel.status==="fulfilled"?channel.value:null,companyId,whatsappLiveOpsReady()),
  });
  // Native balances are an independent capacity projection; they never certify
  // payment, delivery, channel readiness, or subscription eligibility.
  const subscription=record(record(data.journey)?.subscription);
  if(snapshot.status==='ready'&&subscription?.plan_version_id===null){
   try{
    const client=await createClient();
    const rpc=client as unknown as {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
    const result=await rpc.rpc('es02_read_owner_reply_balance',{p_company_id:companyId});
    const envelope=record(result.data);
    const balance=!result.error&&envelope?.ok===true?nativeReplyBalance(companyId,envelope.data):null;
    if(balance)return {...snapshot,sent:null,held:balance.held,cap:balance.granted,remaining:balance.remaining,usedPercent:null};
   }catch{/* Keep the original evidence when native projection is unavailable. */}
  }
  return snapshot;
 }catch{return {status:"unavailable"};}
}
