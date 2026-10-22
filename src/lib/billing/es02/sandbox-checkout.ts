/** Server orchestration only. No route, credentials, DB implementation or default HTTP transport.
 * The caller must authenticate the account and provide an atomic durable store before wiring.
 * This module does not provision companies or enable the deferred Production ES02 path.
 */
import "server-only";
import type { Es02AccountOrderView } from "./contracts";
import { es02Uuid } from "./contracts";
import { offerFingerprint, offersEqual, resolveEs02Offer } from "./commercial-offer";
import { commercialBaisaToVerifiedPaymobAmount } from "../money";
import { assertPaymobConfigForCalls, type PaymobAdapterConfig } from "../paymob/config";
import type { PaymobHttpClient } from "../paymob/http";
import { bindPaymobCorrelation, logPaymobSandboxEvent } from "../paymob/intention";
import { openTestCheckout } from "../wiring/test-checkout";
import { verifyAndMapProcessedCallback } from "../paymob/callback";
import { matchVerifiedObservationToOrder } from "../paymob/match";

type Binding={accountId:string;orderId:string;paymentAttemptId:string;specialReference:string;offerFingerprint:string;amountBaisa:number;providerAmount:number;currency:"OMR";environment:"test";providerAccountRef:string;merchantOwnerId:string};
type Saved={binding:Binding;url:string;providerOrderId:string;providerIntentionId:string;claimToken:string};
type Claim={kind:"claimed";token:string}|{kind:"ready";saved:unknown}|{kind:"pending"}|{kind:"rejected";code:string};
export type AccountSandboxStore={
 loadOwnedOrder:(accountId:string,orderId:string)=>Promise<Es02AccountOrderView|null>;
 /** Atomically reserve this exact immutable binding, or return its prior persisted result.
  * A sent/uncertain claim MUST remain pending until server reconciliation; never auto-release it.
  */
 claim:(binding:Binding)=>Promise<Claim>;
 /** Compare claim token + full binding atomically; save provider IDs and protected capability URL. */
 complete:(saved:Saved)=>Promise<boolean>;
};
type PaymentEvidence={accountId:string;orderId:string;paymentAttemptId:string;providerTransactionId:string;amountBaisa:number;currency:"OMR";environment:"test";providerOrderId:string};
export type AccountSandboxWebhookStore={
 /** Lookup by HMAC-signed provider order, pinned integration and test environment only. */
 loadByProviderOrderId:(providerOrderId:string,integrationId:number,environment:"test")=>Promise<unknown>;
 /** Atomic, idempotent by verified transaction + account/order; never grants company rights here. */
 recordVerifiedPayment:(evidence:PaymentEvidence)=>Promise<{ok:true;outcome:"settled"|"duplicate"}|{ok:false;code:string}>;
};
const denied=(code:string)=>({ok:false as const,code});
function assertTest(config:PaymobAdapterConfig){
 assertPaymobConfigForCalls(config);
 if(config.environment!=="test"||config.liveEnabled||!config.hmacSecret||!/^\d+$/.test(config.merchantOwnerId??"")||Number(config.merchantOwnerId)<=0)throw Error("test_not_configured");
 if(!Number.isSafeInteger(config.verifiedOmrUnitsPerOmr)||!config.verifiedOmrUnitsPerOmr||config.verifiedOmrUnitsPerOmr<1)throw Error("omr_conversion_not_configured");
}
function bindingFor(order:Es02AccountOrderView,config:PaymobAdapterConfig):Binding|null{
 if(!es02Uuid(order.accountId)||!es02Uuid(order.orderId)||!es02Uuid(order.paymentAttemptId)||!order.specialReference||order.environment!=="test")return null;
 const canonical=resolveEs02Offer({term:order.offer.term,slots:order.offer.slots.map(s=>({persona:s.persona,package:s.package}))});
 if(!canonical.ok||!offersEqual(order.offer,canonical.offer))return null;
 const converted=commercialBaisaToVerifiedPaymobAmount(order.offer.amountBaisa,config.verifiedOmrUnitsPerOmr??0);if(!converted.ok)return null;
 return {accountId:order.accountId,orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,specialReference:order.specialReference,offerFingerprint:offerFingerprint(order.offer),amountBaisa:order.offer.amountBaisa,providerAmount:converted.amount,currency:"OMR",environment:"test",providerAccountRef:String(config.integrationId),merchantOwnerId:config.merchantOwnerId!};
}
function sameBinding(value:unknown,expected:Binding):boolean{
 if(!value||typeof value!=="object")return false;
 return (Object.keys(expected) as (keyof Binding)[]).every(k=>(value as Binding)[k]===expected[k]);
}
function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}

/** Opens an already-created canonical account order; no business draft or company ID crosses this port. */
export async function openAccountSandboxCheckout(input:{accountId:string;orderId:string;config:PaymobAdapterConfig;billingPhone:string;callbackOrigin:string;correlationId?:string;deps:AccountSandboxStore&{http:PaymobHttpClient}}){
 const {config,deps}=input;
 const correlationId=bindPaymobCorrelation({correlationId:input.correlationId,orderId:input.orderId});
 try{
  assertTest(config);
  if(!es02Uuid(input.accountId)||!es02Uuid(input.orderId)||!/^\+[1-9]\d{6,14}$/.test(input.billingPhone)){
   logPaymobSandboxEvent({correlationId,stage:"order_create",code:"INVALID_INPUT",orderId:input.orderId});
   return denied("INVALID_INPUT");
  }
  // This is server configuration, never a browser-supplied redirect URL.
  const origin=new URL(input.callbackOrigin);
  if(origin.protocol!=="https:"||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=="/"||["localhost","127.0.0.1","[::1]"].includes(origin.hostname)){
   logPaymobSandboxEvent({correlationId,stage:"order_create",code:"callback_not_configured",orderId:input.orderId});
   return denied("callback_not_configured");
  }
  const order=await deps.loadOwnedOrder(input.accountId,input.orderId);
  if(!order||order.accountId!==input.accountId||order.orderId!==input.orderId){
   logPaymobSandboxEvent({correlationId,stage:"order_create",code:"FORBIDDEN",orderId:input.orderId});
   return denied("FORBIDDEN");
  }
  const binding=bindingFor(order,config);
  if(!binding||order.provisionedCompanyId||!["open","collection_pending"].includes(order.status)){
   logPaymobSandboxEvent({correlationId,stage:"order_create",code:"order_not_ready",orderId:input.orderId,paymentAttemptId:order.paymentAttemptId});
   return denied("order_not_ready");
  }
  bindPaymobCorrelation({correlationId,orderId:order.orderId,specialReference:order.specialReference});
  let claimToken:string|null=null;
  return await openTestCheckout({config,locked:{orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,specialReference:order.specialReference,correlationId,currency:"OMR",amountBaisa:binding.amountBaisa,providerAmount:binding.providerAmount,providerAmountUnit:"paymob_amount",providerAccountRef:binding.providerAccountRef,providerEnvironment:"test",integrationId:config.integrationId,billingPhone:input.billingPhone,itemName:"Velora subscription",notificationUrl:origin.origin+"/api/billing/es02/paymob/sandbox/webhook",redirectionUrl:origin.origin+"/account/orders/"+order.orderId},deps:{http:deps.http,
   claim:async()=>{
    const claim=await deps.claim(binding);
    if(claim.kind==="claimed"){
     if(!claim.token)return {kind:"rejected",code:"claim_invalid"};
     claimToken=claim.token;return {kind:"claimed"};
    }
    if(claim.kind!=="ready")return claim;
    const saved=record(claim.saved);
    if(!saved||!sameBinding(saved.binding,binding)||typeof saved.url!=="string"||typeof saved.providerOrderId!=="string"||!/^\d+$/.test(saved.providerOrderId)||typeof saved.providerIntentionId!=="string"||!saved.providerIntentionId.startsWith("pi_test_"))return {kind:"rejected",code:"checkout_binding_mismatch"};
    const url=new URL(saved.url);
    if(url.searchParams.get("publicKey")!==config.publicKey||url.hash)return {kind:"rejected",code:"checkout_binding_mismatch"};
    return {kind:"ready",url:saved.url};
   },
   persist:async saved=>!!claimToken&&!!saved.providerIntentionId&&deps.complete({...saved,providerIntentionId:saved.providerIntentionId,binding,claimToken}),
  }});
 }catch(error){
  const code=error instanceof Error&&["test_not_configured","omr_conversion_not_configured"].includes(error.message)?error.message:"payment_pending";
  logPaymobSandboxEvent({correlationId,stage:"order_create",code,orderId:input.orderId});
  // Never clear a claim here: transport/persistence exceptions may follow a provider side effect.
  return denied("payment_pending");
 }
}

/** A verified webhook is the only payment-evidence input. Browser return fields are never accepted. */
export async function receiveAccountSandboxPayment(input:{body:unknown;hmacQueryParam:string|null;config:PaymobAdapterConfig;correlationId?:string;deps:AccountSandboxWebhookStore}){
 try{
  const {config,deps}=input;assertTest(config);
  const verified=verifyAndMapProcessedCallback({body:input.body,hmacQueryParam:input.hmacQueryParam,hmacSecret:config.hmacSecret});
  if(!verified.ok){
   logPaymobSandboxEvent({correlationId:input.correlationId,stage:"hmac_verify",code:verified.reason});
   return denied(verified.reason);
  }
  const observation=verified.observation;
  const correlationId=bindPaymobCorrelation({correlationId:input.correlationId,providerOrderId:observation.signedOrderId,specialReference:observation.merchantOrderId});
  logPaymobSandboxEvent({correlationId,stage:"hmac_verify",code:"verified",providerOrderId:observation.signedOrderId,providerTransactionId:observation.providerTransactionId,specialReference:observation.merchantOrderId});
  const stored=record(await deps.loadByProviderOrderId(observation.signedOrderId,config.integrationId,"test"));
  if(!stored){
   logPaymobSandboxEvent({correlationId,stage:"order_match",code:"order_not_found",providerOrderId:observation.signedOrderId,providerTransactionId:observation.providerTransactionId});
   return denied("order_not_found");
  }
  const order=stored.order as Es02AccountOrderView;
  const binding=bindingFor(order,config);
  if(!binding||!sameBinding(stored.binding,binding)||typeof stored.providerOrderId!=="string"){
   logPaymobSandboxEvent({correlationId,stage:"order_match",code:"checkout_binding_mismatch",orderId:order?.orderId,providerOrderId:observation.signedOrderId,providerTransactionId:observation.providerTransactionId});
   return denied("checkout_binding_mismatch");
  }
  bindPaymobCorrelation({correlationId,orderId:order.orderId,providerOrderId:stored.providerOrderId,specialReference:order.specialReference});
  const matched=matchVerifiedObservationToOrder({observation,order:{orderId:order.orderId,providerOrderId:stored.providerOrderId,specialReference:order.specialReference,amountBaisa:binding.amountBaisa,currency:"OMR",providerAmount:binding.providerAmount,providerAccountRef:binding.providerAccountRef,providerEnvironment:"test",integrationId:config.integrationId,merchantOwnerId:config.merchantOwnerId??null}});
  if(!matched.ok){
   logPaymobSandboxEvent({correlationId,stage:"order_match",code:matched.reason,orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,providerOrderId:stored.providerOrderId,providerTransactionId:observation.providerTransactionId});
   return denied(matched.reason);
  }
  logPaymobSandboxEvent({correlationId,stage:"order_match",code:"matched",orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,providerOrderId:stored.providerOrderId,providerTransactionId:observation.providerTransactionId});
  if(observation.eventStatus!=="success"){
   const outcome=observation.eventStatus==="other"?"review" as const:observation.eventStatus;
   logPaymobSandboxEvent({correlationId,stage:"settlement",code:outcome,orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,providerOrderId:stored.providerOrderId,providerTransactionId:observation.providerTransactionId});
   return {ok:true as const,outcome};
  }
  const recorded=await deps.recordVerifiedPayment({accountId:order.accountId,orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,providerTransactionId:observation.providerTransactionId,amountBaisa:binding.amountBaisa,currency:"OMR",environment:"test",providerOrderId:stored.providerOrderId});
  logPaymobSandboxEvent({correlationId,stage:"settlement",code:recorded.ok?recorded.outcome:recorded.code,orderId:order.orderId,paymentAttemptId:order.paymentAttemptId,providerOrderId:stored.providerOrderId,providerTransactionId:observation.providerTransactionId});
  return recorded;
 }catch{return denied("payment_pending");}
}
