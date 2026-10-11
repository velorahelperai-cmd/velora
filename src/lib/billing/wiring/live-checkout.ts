import "server-only";
import {assertAllowedPaymobBaseUrl,assertPaymobConfigForCalls,type PaymobAdapterConfig} from "../paymob/config";
import {readPaymobServerConfig} from "../paymob/server-config";
import {createPaymobIntention,type LockedIntentionOrder} from "../paymob/intention";
import {buildOmanHostedCheckoutUrl} from "../paymob/checkout";
import type {PaymobHttpClient} from "../paymob/http";
import {commercialBaisaToVerifiedPaymobAmount} from "../money";
import {billingUuid} from "./public-offer-policy";
import type {CheckoutClaim,CheckoutResult} from "./test-checkout";

export function readLiveCheckoutConfig(settings:Record<string,string|undefined>):
 {ok:true;config:PaymobAdapterConfig;unitsPerOmr:number}|{ok:false;code:string}{
 const enabled=(name:string)=>["true","1","yes","on"].includes(settings[name]?.trim().toLowerCase()??"");
 for(const name of ["CREATE","WEBHOOK","SETTLE","LIVE"])if(!enabled("BILLING_PAYMOB_"+name+"_ENABLED"))return {ok:false,code:"live_disabled"};
 const read=readPaymobServerConfig("live",settings);
 if(!read.ok)return {ok:false,code:"live_not_configured"};
 const test=settings.PAYMOB_INTEGRATION_ID_TEST?.trim()??"";
 if(!/^[1-9][0-9]*$/.test(test)||!Number.isSafeInteger(Number(test))||Number(test)===read.config.integrationId)return {ok:false,code:"integration_mode_isolation_required"};
 return {ok:true,config:read.config,unitsPerOmr:read.config.verifiedOmrUnitsPerOmr!};
}

function readyLiveCheckoutUrl(url:string,config:PaymobAdapterConfig):boolean{
 try{
  const parsed=new URL(url),keys=[...parsed.searchParams.keys()];
  return !parsed.username&&!parsed.password&&!parsed.hash&&parsed.pathname==="/"
   &&assertAllowedPaymobBaseUrl(parsed.origin,"checkout").ok
   &&parsed.searchParams.get("publicKey")===config.publicKey
   &&Boolean(parsed.searchParams.get("clientSecret")?.trim())
   &&!parsed.searchParams.get("clientSecret")?.includes("_test_")
   &&keys.length===2&&new Set(keys).size===2&&keys.includes("publicKey")&&keys.includes("clientSecret");
 }catch{return false;}
}

/** Receives only a server-created SQL snapshot. Durable claim wins before HTTP; no grant/activation port. */
export async function openLiveCheckout(input:{
 config:PaymobAdapterConfig;locked:LockedIntentionOrder;actorCompanyId:string;
 deps:{http:PaymobHttpClient;claim:()=>Promise<CheckoutClaim>;persist:(saved:{url:string;providerOrderId:string;providerIntentionId:string|null})=>Promise<boolean>};
}):Promise<CheckoutResult>{
 try{assertPaymobConfigForCalls(input.config);}catch{return {ok:false,code:"live_not_configured"};}
 const {locked,config}=input;
 const amount=typeof locked.amountBaisa==="number"?commercialBaisaToVerifiedPaymobAmount(locked.amountBaisa,config.verifiedOmrUnitsPerOmr??NaN):null;
 if(config.environment!=="live"||locked.providerEnvironment!=="live"||locked.companyId!==input.actorCompanyId
  ||![locked.companyId,locked.orderId,locked.paymentAttemptId,locked.planVersionId].every(billingUuid)
  ||locked.currency!=="OMR"||locked.providerAccountRef!==String(config.integrationId)||locked.integrationId!==config.integrationId
  ||locked.providerAmountUnit!=="paymob_amount"||!amount?.ok||amount.amount!==locked.providerAmount
  ||!Number.isSafeInteger(locked.amountBaisa)||locked.amountBaisa!<=0||!locked.specialReference.trim())return {ok:false,code:"live_order_not_ready"};
 try{
  const claim=await input.deps.claim();
  if(claim.kind==="rejected")return {ok:false,code:claim.code};
  if(claim.kind==="pending")return {ok:false,code:"payment_pending"};
  if(claim.kind==="ready")return readyLiveCheckoutUrl(claim.url,config)?{ok:true,url:claim.url}:{ok:false,code:"checkout_invalid"};
  const intention=await createPaymobIntention({config,locked,http:input.deps.http});
  if(!intention.ok)return {ok:false,code:"payment_pending"};
  if(intention.clientSecret.includes("_test_")||intention.intentionId?.includes("_test_"))return {ok:false,code:"payment_pending"};
  const checkout=buildOmanHostedCheckoutUrl({config,clientSecret:intention.clientSecret});
  if(!checkout.ok||!readyLiveCheckoutUrl(checkout.url,config))return {ok:false,code:"payment_pending"};
  if(!await input.deps.persist({url:checkout.url,providerOrderId:String(intention.intentionOrderId),providerIntentionId:intention.intentionId}))return {ok:false,code:"payment_pending"};
  return {ok:true,url:checkout.url};
 }catch{return {ok:false,code:"payment_pending"};}
}
