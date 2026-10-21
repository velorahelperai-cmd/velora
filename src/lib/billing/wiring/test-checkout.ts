import { assertPaymobConfigForCalls, assertAllowedPaymobBaseUrl, PAYMOB_OMAN_API_BASE_URL, PAYMOB_OMAN_CHECKOUT_BASE_URL, type PaymobAdapterConfig } from "../paymob/config";
import { createPaymobIntention, bindPaymobCorrelation, logPaymobSandboxEvent, type PaymobIntentionInput } from "../paymob/intention";
import { buildOmanHostedCheckoutUrl } from "../paymob/checkout";
import type { PaymobHttpClient } from "../paymob/http";
export type CheckoutResult = {ok:true;url:string}|{ok:false;code:string};
export function readTestCheckoutConfig(env:Record<string,string|undefined>):{ok:true;config:PaymobAdapterConfig;unitsPerOmr:number}|{ok:false;code:string}{
 const value=(name:string)=>env[name]?.trim()??"", enabled=(name:string)=>["true","1","yes","on"].includes(value(name).toLowerCase());
 if(enabled("BILLING_PAYMOB_LIVE_ENABLED")||enabled("PAYMOB_LIVE_ENABLED"))return {ok:false,code:"live_rejected"};
 for(const flag of ["CREATE","WEBHOOK","SETTLE"])if(!enabled(`BILLING_PAYMOB_${flag}_ENABLED`))return {ok:false,code:"test_not_configured"};
 const unitsPerOmr=Number(value("PAYMOB_OMR_UNITS_PER_OMR"));
 if(!enabled("PAYMOB_OMR_CONVERSION_VERIFIED")||!Number.isSafeInteger(unitsPerOmr)||unitsPerOmr<=0||unitsPerOmr>1000000)return {ok:false,code:"omr_conversion_not_configured"};
 const secret=value("PAYMOB_SECRET_KEY_TEST"),publicKey=value("PAYMOB_PUBLIC_KEY_TEST");
 if(!/(^|_)sk_test_/.test(secret)||!/(^|_)pk_test_/.test(publicKey))return {ok:false,code:"test_keys_missing"};
 const integrationId=Number(value("PAYMOB_INTEGRATION_ID_TEST"));
 if(!Number.isSafeInteger(integrationId)||integrationId<=0||!value("PAYMOB_HMAC_SECRET")||!value("PAYMOB_MERCHANT_OWNER_ID"))return {ok:false,code:"test_not_configured"};
 const config:PaymobAdapterConfig={environment:"test",liveEnabled:false,apiBaseUrl:value("PAYMOB_API_BASE_URL")||PAYMOB_OMAN_API_BASE_URL,checkoutBaseUrl:value("PAYMOB_CHECKOUT_BASE_URL")||PAYMOB_OMAN_CHECKOUT_BASE_URL,secretKey:secret,publicKey,hmacSecret:value("PAYMOB_HMAC_SECRET"),integrationId,merchantOwnerId:value("PAYMOB_MERCHANT_OWNER_ID"),currency:"OMR",verifiedOmrUnitsPerOmr:unitsPerOmr};
 try{assertPaymobConfigForCalls(config);}catch{return {ok:false,code:"test_config_invalid"};}
 return {ok:true,config,unitsPerOmr};
}
export type CheckoutClaim={kind:"claimed"}|{kind:"ready";url:string}|{kind:"pending"}|{kind:"rejected";code:string};
export async function openTestCheckout({config,locked,deps}:{config:PaymobAdapterConfig;locked:PaymobIntentionInput;deps:{claim:()=>Promise<CheckoutClaim>;persist:(input:{url:string;providerOrderId:string;providerIntentionId:string|null})=>Promise<boolean>;http:PaymobHttpClient}}):Promise<CheckoutResult>{
 const correlationId=bindPaymobCorrelation({correlationId:locked.correlationId,orderId:locked.orderId,specialReference:locked.specialReference});
 try{assertPaymobConfigForCalls(config);}catch{
  logPaymobSandboxEvent({correlationId,stage:"order_create",code:"test_config_invalid",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,specialReference:locked.specialReference});
  return {ok:false,code:"test_config_invalid"};
 }
 logPaymobSandboxEvent({correlationId,stage:"order_create",code:"locked_order_ready",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,specialReference:locked.specialReference});
 const claim=await deps.claim();
 if(claim.kind==="rejected"){
  logPaymobSandboxEvent({correlationId,stage:"checkout_claim",code:claim.code,orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,specialReference:locked.specialReference});
  return {ok:false,code:claim.code};
 }
 if(claim.kind==="pending"){
  logPaymobSandboxEvent({correlationId,stage:"checkout_claim",code:"payment_pending",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,specialReference:locked.specialReference});
  return {ok:false,code:"payment_pending"};
 }
 if(claim.kind==="ready"){
  try{const url=new URL(claim.url);if(url.username||url.password||url.pathname!=="/"||!url.searchParams.get("clientSecret")?.includes("_test_")||!url.searchParams.get("publicKey")?.includes("pk_test_")||!assertAllowedPaymobBaseUrl(url.origin,"checkout").ok){logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:"checkout_invalid",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId});return {ok:false,code:"checkout_invalid"};}}catch{logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:"checkout_invalid",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId});return {ok:false,code:"checkout_invalid"};}
  logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:"reused",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,specialReference:locked.specialReference});
  return {ok:true,url:claim.url};
 }
 logPaymobSandboxEvent({correlationId,stage:"checkout_claim",code:"claimed",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,specialReference:locked.specialReference});
 const intention=await createPaymobIntention({config,locked:{...locked,correlationId},http:deps.http});
 if(!intention.ok)return {ok:false,code:intention.needsReconciliation?"payment_pending":intention.code};
 if(!intention.intentionId?.startsWith("pi_test_")||!intention.clientSecret.includes("_test_")){
  logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:"provider_mode_mismatch",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,providerOrderId:intention.intentionOrderId});
  return {ok:false,code:"provider_mode_mismatch"};
 }
 const checkout=buildOmanHostedCheckoutUrl({config,clientSecret:intention.clientSecret});
 if(!checkout.ok){
  logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:checkout.code,orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,providerOrderId:intention.intentionOrderId});
  return {ok:false,code:checkout.code};
 }
 if(!await deps.persist({url:checkout.url,providerOrderId:String(intention.intentionOrderId),providerIntentionId:intention.intentionId})){
  logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:"checkout_persist_failed",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,providerOrderId:intention.intentionOrderId});
  return {ok:false,code:"checkout_persist_failed"};
 }
 logPaymobSandboxEvent({correlationId,stage:"checkout_ready",code:"persisted",orderId:locked.orderId,paymentAttemptId:locked.paymentAttemptId,providerOrderId:intention.intentionOrderId,specialReference:locked.specialReference});
 return {ok:true,url:checkout.url};
}
export const fetchPaymobHttp:PaymobHttpClient={async request(input){try{const response=await fetch(input.url,{method:input.method,headers:input.headers,body:input.body,signal:AbortSignal.timeout(input.timeoutMs),redirect:"error",cache:"no-store"});return {kind:"response",response:{status:response.status,headers:{},bodyText:await response.text()}};}catch(error){return error instanceof Error&&(error.name==="TimeoutError"||error.name==="AbortError")?{kind:"timeout"}:{kind:"network_error",message:"provider_request_failed"};}}};
