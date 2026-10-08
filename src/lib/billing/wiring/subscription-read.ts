import "server-only";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionView } from "@/components/app/subscription-model";
export async function loadOwnerBillingSubscription(fallback:SubscriptionView):Promise<SubscriptionView>{
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner")return fallback;
 const company=access.context.company;
 if(company.status==="suspended")return {...fallback,state:"suspended"};
 const client=createAdminClient();if(!client)return fallback;
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const admin=client as any;
 try{
 const {data:sub,error}=await admin.from("billing_subscriptions").select("status,paid_through,plan_version_id").eq("company_id",company.id).maybeSingle();
 if(error)return fallback;
 if(!sub)return {...fallback,state:"empty"};
 const paidThrough=sub.paid_through?String(sub.paid_through):null;
 const future=paidThrough!==null&&new Date(paidThrough).getTime()>Date.now();
 let tier:SubscriptionView["currentTier"]=null;
 let cycle:SubscriptionView["cycle"]=null;
 if(sub.plan_version_id){const {data:version}=await admin.from("billing_plan_versions").select("plan_id,period_unit,period_count").eq("id",sub.plan_version_id).maybeSingle();if(version){cycle=version.period_unit==="year"&&version.period_count===1?"yearly":version.period_unit==="month"&&version.period_count===1?"monthly":null;const {data:plan}=await admin.from("billing_plans").select("code").eq("id",version.plan_id).maybeSingle();const code=String(plan?.code??"");tier=code.startsWith("noor_")?"level_1":code.startsWith("lina_")?"level_2":code.startsWith("dana_")?"level_3":null;}}
 const {data:openOrder}=await admin.from("billing_orders").select("id").eq("company_id",company.id).in("status",["locked","submitted"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
 // A pending order does not mean its paid period is active.
 return {state:future?"active":paidThrough?"expired":openOrder?"pending":"empty",currentTier:tier,cycle,paidThrough,...(openOrder?{pendingOrderId:String(openOrder.id)}:{})};
 }catch{return fallback;}
}


