"use server";
import { createBillingOrderAction } from "./order-actions";
import { readTestCheckoutConfig, openTestCheckout, fetchPaymobHttp, type CheckoutClaim, type CheckoutResult } from "./test-checkout";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/auth/site-url";
import { commercialBaisaToVerifiedPaymobAmount } from "../money";
export type StartTestCheckoutResult = CheckoutResult & { orderId?:string;message?:string };
export async function startTestCheckoutAction(input:{planVersionId:string;clientOpId:string;expectedCompanyId?:string}):Promise<StartTestCheckoutResult>{
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner"||access.context.company.status==="suspended")return {ok:false,code:"not_owner"};
 if(!input||typeof input!=="object"||Array.isArray(input)||typeof input.planVersionId!=="string"||typeof input.clientOpId!=="string")return {ok:false,code:"INVALID_INPUT"};
 if("expectedCompanyId" in input){
  if(typeof input.expectedCompanyId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedCompanyId))return {ok:false,code:"INVALID_INPUT",message:"invalid_company"};
  if(input.expectedCompanyId!==access.context.company.id)return {ok:false,code:"FORBIDDEN",message:"workspace_changed"};
 }
 const settings=readTestCheckoutConfig(process.env);
 if(!settings.ok)return settings;
 let origin:URL;try{origin=new URL(siteUrl());}catch{return {ok:false,code:"callback_not_configured"};}
 if(origin.protocol!=="https:"||["localhost","127.0.0.1"].includes(origin.hostname))return {ok:false,code:"callback_not_configured"};
 const phone=access.context.company.contact_phone;
 if(!phone)return {ok:false,code:"billing_phone_missing"};
 const result=await createBillingOrderAction({planVersionId:input.planVersionId,clientOpId:input.clientOpId,purchasePurpose:"initial",expectedCompanyId:access.context.company.id});
 if(!result.ok)return result;
 try{
 const companyId=access.context.company.id,client=createAdminClient();
 if(!client)return {ok:false,code:"test_not_configured",orderId:result.orderId};
 // Billing schema is not part of the generated database types yet.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const admin=client as any;
 const {data:order,error}=await admin.from("billing_orders").select("id,amount_baisa,currency,provider_amount,provider_amount_unit,provider_account_ref,provider_environment,plan_version_id").eq("id",result.orderId).eq("company_id",companyId).maybeSingle();
 if(error||!order||order.provider_environment!=="test"||order.currency!=="OMR"||order.provider_amount_unit!=="paymob_amount"||String(order.provider_account_ref)!==String(settings.config.integrationId))return {ok:false,code:"order_not_ready",orderId:result.orderId};
 const amount=Number(order.provider_amount),expected=commercialBaisaToVerifiedPaymobAmount(order.amount_baisa,settings.unitsPerOmr);
 if(!expected.ok||!Number.isSafeInteger(amount)||amount<=0||amount!==expected.amount)return {ok:false,code:"order_amount_invalid",orderId:result.orderId};
 const checkout=await openTestCheckout({config:settings.config,locked:{companyId,orderId:result.orderId,paymentAttemptId:result.paymentAttemptId,specialReference:result.specialReference,currency:"OMR",providerAmount:amount,providerAmountUnit:"paymob_amount",providerAccountRef:String(order.provider_account_ref),providerEnvironment:"test",integrationId:settings.config.integrationId,billingPhone:phone,itemName:"Velora subscription",notificationUrl:`${origin.origin}/api/billing/paymob/webhook`,redirectionUrl:`${origin.origin}/app/subscription/orders/${result.orderId}`},deps:{http:fetchPaymobHttp,claim:async()=>{const {data,error}=await admin.rpc("billing_claim_test_checkout",{p_company_id:companyId,p_order_id:result.orderId,p_attempt_id:result.paymentAttemptId});if(error||!data)return {kind:"rejected",code:"checkout_schema_unavailable"};return data as CheckoutClaim;},persist:async saved=>{const {data,error}=await admin.rpc("billing_complete_test_checkout",{p_company_id:companyId,p_order_id:result.orderId,p_attempt_id:result.paymentAttemptId,p_provider_order_id:saved.providerOrderId,p_checkout_url:saved.url,p_intention_id:saved.providerIntentionId});return !error&&data===true;}}});
 return {...checkout,orderId:result.orderId};
 }catch{return {ok:false,code:"payment_pending",orderId:result.orderId};}
}

/** Resume a persisted Test checkout only; never creates an order or an Intention. */
export async function resumeTestCheckoutAction(input:{orderId:string}):Promise<StartTestCheckoutResult>{
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner"||access.context.company.status==="suspended")return {ok:false,code:"not_owner"};
 const settings=readTestCheckoutConfig(process.env);if(!settings.ok)return settings;
 const client=createAdminClient();if(!client)return {ok:false,code:"test_not_configured"};
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const admin=client as any,companyId=access.context.company.id;
 try{
 const {data:order,error:orderError}=await admin.from("billing_orders").select("id,provider_account_ref").eq("id",input.orderId).eq("company_id",companyId).eq("provider_environment","test").in("status",["locked","submitted"]).maybeSingle();
 if(orderError||!order||String(order.provider_account_ref)!==String(settings.config.integrationId))return {ok:false,code:"order_not_ready"};
 const {data:saved,error:savedError}=await admin.from("billing_test_checkouts").select("checkout_url,payment_attempt_id").eq("order_id",order.id).eq("company_id",companyId).eq("status","ready").order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(savedError||!saved)return {ok:false,code:"payment_pending"};
 const {data:attempt,error:attemptError}=await admin.from("billing_payment_attempts").select("status").eq("id",saved.payment_attempt_id).eq("company_id",companyId).eq("order_id",order.id).maybeSingle();
 if(attemptError||attempt?.status!=="provider_submitted")return {ok:false,code:"payment_pending"};
 const url=new URL(String(saved.checkout_url));
 if(url.origin!=="https://om.checkout.paymob.com"||url.username||url.password||url.pathname!=="/"||!url.searchParams.get("clientSecret")?.includes("_test_")||!url.searchParams.get("publicKey")?.includes("pk_test_"))return {ok:false,code:"checkout_invalid"};
 return {ok:true,url:url.href,orderId:order.id};
 }catch{return {ok:false,code:"payment_pending"};}
}
