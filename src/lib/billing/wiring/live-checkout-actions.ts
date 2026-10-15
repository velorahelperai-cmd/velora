"use server";

import {getCompanyAccess} from "@/lib/tenancy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {siteUrl} from "@/lib/auth/site-url";
import {readBillingActorSession} from "./public-purchase-persist";
import {readLiveCheckoutConfig,openLiveCheckout,readyLiveCheckoutUrl} from "./live-checkout";
import {fetchPaymobHttp,type CheckoutClaim,type CheckoutResult} from "./test-checkout";
import {billingUuid} from "./public-offer-policy";
import {commercialBaisaToVerifiedPaymobAmount} from "../money";
import type {SupabaseClient} from "@supabase/supabase-js";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";

type RpcClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>};
type StartInput={planVersionId:string;clientOpId:string;expectedCompanyId:string;expectedCatalogRevision:number;termsVersion?:string;consentAccepted?:boolean;purchasePurpose?:"initial"|"upgrade"};
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;

/** Resume only an already persisted Live checkout; never allocate another provider request. */
export async function resumeLiveCheckoutAction(input:{orderId:string}):Promise<CheckoutResult>{
 if(!input||Object.keys(input).some(k=>k!=="orderId")||!billingUuid(input.orderId))return {ok:false,code:"INVALID_INPUT"};
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner"||access.context.membership.status!=="active"
  ||!["setup","active"].includes(access.context.company.status))return {ok:false,code:"not_owner"};
 const settings=readLiveCheckoutConfig(process.env);if(!settings.ok)return settings;
 const session=await readBillingActorSession(access.context.userId);if(!session)return {ok:false,code:"not_owner"};
 const client=createAdminClient();if(!client)return {ok:false,code:"live_not_configured"};
 const admin=client as unknown as SupabaseClient;
 try{
  const companyId=access.context.company.id;
  const {data:order,error}=await admin.from("billing_orders").select("id,status,provider_account_ref")
   .eq("id",input.orderId).eq("company_id",companyId).eq("provider_environment","live").maybeSingle();
  if(error||!order||order.status!=="submitted"||order.provider_account_ref!==String(settings.config.integrationId))return {ok:false,code:"payment_pending"};
  const {data:attempt,error:attemptError}=await admin.from("billing_payment_attempts").select("id")
   .eq("order_id",input.orderId).eq("company_id",companyId).eq("provider_environment","live")
   .eq("provider_account_ref",String(settings.config.integrationId)).eq("status","provider_submitted")
   .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(attemptError||!attempt||!billingUuid(attempt.id))return {ok:false,code:"payment_pending"};
  const result=await (admin as unknown as RpcClient).rpc("billing_claim_live_checkout",{p_company_id:companyId,p_order_id:input.orderId,p_attempt_id:attempt.id,p_actor_id:access.context.userId,p_actor_session_id:session});
  const claim=record(result.data);
  if(!result.error&&claim?.kind==="ready"&&typeof claim.url==="string"&&readyLiveCheckoutUrl(claim.url,settings.config))return {ok:true,url:claim.url};
  return {ok:false,code:"payment_pending"};
 }catch{return {ok:false,code:"payment_pending"};}
}

/** Browser supplies identifiers/revision only. SQL owns price, service, quota, budget and immutable provider binding. */
export async function startLiveCheckoutAction(input:StartInput):Promise<CheckoutResult&{orderId?:string}>{
 if(!input||typeof input!=="object"||Object.keys(input).some(k=>!["planVersionId","clientOpId","expectedCompanyId","expectedCatalogRevision","termsVersion","consentAccepted","purchasePurpose"].includes(k))
  ||!billingUuid(input.planVersionId)||!billingUuid(input.expectedCompanyId)||typeof input.clientOpId!=="string"
  ||input.clientOpId.trim().length<1||input.clientOpId.trim().length>128
  ||!Number.isSafeInteger(input.expectedCatalogRevision)||input.expectedCatalogRevision<1
  ||input.purchasePurpose!==undefined&&!["initial","upgrade"].includes(input.purchasePurpose))return {ok:false,code:"INVALID_INPUT"};
 const master=masterJourneyEnabled();
 if(!master&&input.purchasePurpose==="upgrade")return {ok:false,code:"CHECKOUT_UPGRADE_UNCONFIGURED"};
 if(master&&(input.consentAccepted!==true||typeof input.termsVersion!=="string"||input.termsVersion.trim().length<1||input.termsVersion.length>128))return {ok:false,code:"CHECKOUT_CONSENT_REQUIRED"};
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner"||access.context.membership.status!=="active"
  ||!["setup","active"].includes(access.context.company.status))return {ok:false,code:"not_owner"};
 const company=access.context.company;
 if(company.id!==input.expectedCompanyId)return {ok:false,code:"FORBIDDEN"};
 const settings=readLiveCheckoutConfig(process.env);if(!settings.ok)return settings;
 const session=await readBillingActorSession(access.context.userId);if(!session)return {ok:false,code:"not_owner"};
 let origin:URL;try{origin=new URL(siteUrl());}catch{return {ok:false,code:"callback_not_configured"};}
 if(origin.protocol!=="https:"||origin.username||origin.password||["localhost","127.0.0.1","[::1]"].includes(origin.hostname))return {ok:false,code:"callback_not_configured"};
 if(!company.contact_phone)return {ok:false,code:"billing_phone_missing"};
 const client=createAdminClient();if(!client)return {ok:false,code:"live_not_configured"};
 const admin=client as unknown as RpcClient;
 try{
  const {data,error}=await admin.rpc(input.purchasePurpose==="upgrade"?"billing_create_live_upgrade_order":"billing_create_live_checkout_order",{
   p_company_id:company.id,p_actor_id:access.context.userId,p_actor_session_id:session,
   p_plan_version_id:input.planVersionId,p_client_op_id:input.clientOpId.trim(),p_expected_revision:input.expectedCatalogRevision,
   p_integration_id:settings.config.integrationId,p_merchant_owner_id:settings.config.merchantOwnerId,p_units_per_omr:settings.unitsPerOmr,
  });
  if(error)return {ok:false,code:["PGRST202","42883","42P01"].includes(error.code??"")?"live_checkout_schema_unavailable":"live_order_rejected"};
  const row=record(data);
  if(row?.ok!==true)return {ok:false,code:typeof row?.code==="string"?row.code:"live_order_rejected"};
  const locked=record(row.locked),service=record(row.service);
  const amount=typeof locked?.amount_baisa==="number"?commercialBaisaToVerifiedPaymobAmount(locked.amount_baisa,settings.unitsPerOmr):null;
  if(!billingUuid(row.order_id)||!billingUuid(row.payment_attempt_id)||typeof row.special_reference!=="string"||!row.special_reference.trim()
   ||locked?.plan_version_id!==input.planVersionId||locked.provider_environment!=="live"||locked.currency!=="OMR"
   ||locked.provider_amount_unit!=="paymob_amount"||locked.provider_account_ref!==String(settings.config.integrationId)
   ||!amount?.ok||amount.amount!==locked.provider_amount
   ||service?.service_code!=="noura"||!["basic","premium"].includes(String(service.tier))
   ||!Number.isSafeInteger(service.allowance_cap)||Number(service.allowance_cap)<1||Number(service.allowance_cap)>999999999
   ||!Number.isSafeInteger(service.monthly_limit_baisa)||Number(service.monthly_limit_baisa)<1)return {ok:false,code:"live_order_not_ready"};
  const orderId=row.order_id,attemptId=row.payment_attempt_id;
  if(master){const agreement=await admin.rpc("master_accept_checkout_consent",{p_company_id:company.id,p_order_id:orderId,
   p_actor_id:access.context.userId,p_actor_session_id:session,p_terms_version:input.termsVersion,p_accepted:true});
  const accepted=record(agreement.data);
  if(agreement.error||accepted?.ok!==true)return {ok:false,code:typeof accepted?.code==="string"?accepted.code:"CHECKOUT_CONSENT_UNAVAILABLE",orderId};}
  const args={p_company_id:company.id,p_order_id:orderId,p_attempt_id:attemptId,p_actor_id:access.context.userId,p_actor_session_id:session};
  const checkout=await openLiveCheckout({config:settings.config,actorCompanyId:company.id,
   locked:{companyId:company.id,orderId,paymentAttemptId:attemptId,planVersionId:input.planVersionId,
    amountBaisa:Number(locked.amount_baisa),providerAmount:Number(locked.provider_amount),providerAmountUnit:"paymob_amount",
    providerEnvironment:"live",providerAccountRef:String(locked.provider_account_ref),integrationId:settings.config.integrationId,
    currency:"OMR",specialReference:row.special_reference,billingPhone:company.contact_phone,itemName:"Noura subscription",
    notificationUrl:origin.origin+"/api/billing/paymob/webhook",redirectionUrl:origin.origin+"/app/subscription/orders/"+orderId},
   deps:{http:fetchPaymobHttp,claim:async()=>{const result=await admin.rpc("billing_claim_live_checkout",args);
    const claim=record(result.data);
    if(result.error||!claim||!["claimed","ready","pending","rejected"].includes(String(claim.kind))
     ||(claim.kind==="ready"&&typeof claim.url!=="string")||(claim.kind==="rejected"&&typeof claim.code!=="string"))return {kind:"rejected",code:"live_checkout_schema_unavailable"};
    return claim as CheckoutClaim;
   },persist:async saved=>{const result=await admin.rpc("billing_complete_live_checkout",{...args,p_provider_order_id:saved.providerOrderId,p_checkout_url:saved.url,p_intention_id:saved.providerIntentionId});return !result.error&&result.data===true;}},
  });
  return {...checkout,orderId};
 }catch{return {ok:false,code:"payment_pending"};}
}
