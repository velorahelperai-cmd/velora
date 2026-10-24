import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { openAccountSandboxCheckout, receiveAccountSandboxPayment } from "./sandbox-checkout";
import { resolveEs02Offer } from "./commercial-offer";
import { readTestCheckoutConfig } from "../wiring/test-checkout";
import { setPaymobSandboxLogSink, type PaymobSandboxLogEntry } from "../paymob/intention";
import type { Es02AccountOrderView } from "./contracts";

const accountId="11111111-2222-4333-8444-555555555555",orderId="22222222-2222-4333-8444-555555555555";
const configured=readTestCheckoutConfig({BILLING_PAYMOB_CREATE_ENABLED:"true",BILLING_PAYMOB_WEBHOOK_ENABLED:"true",BILLING_PAYMOB_SETTLE_ENABLED:"true",PAYMOB_SECRET_KEY_TEST:"om_sk_test_fixture",PAYMOB_PUBLIC_KEY_TEST:"om_pk_test_fixture",PAYMOB_HMAC_SECRET:"synthetic-only",PAYMOB_INTEGRATION_ID_TEST:"123",PAYMOB_MERCHANT_OWNER_ID:"456",PAYMOB_OMR_CONVERSION_VERIFIED:"true",PAYMOB_OMR_UNITS_PER_OMR:"1000"});
if(!configured.ok)throw Error("fixture config");
const config=configured.config;
function fixture(){
 const resolved=resolveEs02Offer({term:"monthly",slots:[{persona:"level_1",package:"basic"}]});if(!resolved.ok)throw Error("fixture offer");
 const order:Es02AccountOrderView={accountId,orderId,status:"open",offer:resolved.offer,specialReference:"es02-fixture-order",paymentAttemptId:"33333333-2222-4333-8444-555555555555",environment:"test",settledAt:null,provisionedCompanyId:null,originalOrderGroupId:orderId};
 let saved:unknown=null,pending=false,settled=false;let providerCalls=0;const applied:unknown[]=[];
 const deps={
  loadOwnedOrder:async()=>order,
  claim:async(binding:unknown)=>{if(saved)return {kind:"ready" as const,saved};if(pending)return {kind:"pending" as const};pending=true;return {kind:"claimed" as const,token:"fixture-claim",binding};},
  complete:async(input:Record<string,unknown>)=>{if(!pending||input.claimToken!=="fixture-claim")return false;saved=input;return true;},
  http:{request:async()=>{providerCalls++;return {kind:"response" as const,response:{status:201,headers:{},bodyText:JSON.stringify({client_secret:"om_csk_test_fixture",intention_order_id:987,id:"pi_test_fixture"})}};}},
  loadByProviderOrderId:async()=>saved?{...(saved as object),order}:null,
  recordVerifiedPayment:async(input:unknown)=>{applied.push(input);const outcome=settled?"duplicate" as const:"settled" as const;settled=true;order.status="settled";return {ok:true as const,outcome};},
 };
 return {order,deps,applied,providerCalls:()=>providerCalls,saved:()=>saved,replaceSaved:(v:unknown)=>{saved=v;}};
}
const input={accountId,orderId,config,billingPhone:"+96890000000",callbackOrigin:"https://fixture.invalid"};
function callback(overrides:Record<string,unknown>={}){
 const obj={amount_cents:45000,created_at:"2026-10-20T00:00:00Z",currency:"OMR",error_occured:false,has_parent_transaction:false,id:4321,integration_id:123,is_3d_secure:true,is_auth:false,is_capture:false,is_refunded:false,is_standalone_payment:true,is_voided:false,order:{id:987},owner:456,pending:false,source_data:{pan:"2346",sub_type:"MasterCard",type:"card"},success:true,...overrides};
 // Independent literal official signed-field order, not the production signing helper.
 const fields=[obj.amount_cents,obj.created_at,obj.currency,obj.error_occured,obj.has_parent_transaction,obj.id,obj.integration_id,obj.is_3d_secure,obj.is_auth,obj.is_capture,obj.is_refunded,obj.is_standalone_payment,obj.is_voided,obj.order.id,obj.owner,obj.pending,obj.source_data.pan,obj.source_data.sub_type,obj.source_data.type,obj.success];
 return {body:{type:"TRANSACTION",obj},hmacQueryParam:createHmac("sha512",config.hmacSecret).update(fields.map(String).join("")).digest("hex")};
}
describe("account-bound sandbox adapter (offline transport and fixture store only)",()=>{
 it.each([["monthly",75000],["yearly",720000]] as const)("reopens and settles a frozen legacy Dana %s order at its original amount",async(term,amount)=>{
  const f=fixture();f.order.offer={...f.order.offer,catalogRevision:"2026-10-14",term,persona:"level_3",package:"basic",amountBaisa:amount,repliesPerMonth:3000,slots:[{slotIndex:0,persona:"level_3",package:"basic",amountBaisa:amount,repliesPerMonth:3000,employees:2,channels:1}]};
  expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:true});
  expect(f.saved()).toMatchObject({binding:{amountBaisa:amount,providerAmount:amount}});
  expect(await receiveAccountSandboxPayment({...callback({amount_cents:amount}),config,deps:f.deps})).toMatchObject({ok:true,outcome:"settled"});
  expect(f.order.offer.amountBaisa).toBe(amount);
 });

 it("persists a test checkout for an account without creating or requiring a company",async()=>{
  const f=fixture();expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:true,url:expect.stringContaining("https://om.checkout.paymob.com/")});
  expect(f.saved()).toMatchObject({binding:{accountId,orderId,amountBaisa:45000,providerAmount:45000,environment:"test"},providerOrderId:"987",providerIntentionId:"pi_test_fixture"});
  expect(f.order.provisionedCompanyId).toBeNull();expect(f.order.status).toBe("open");expect(f.applied).toHaveLength(0);
 });
 it("same-order concurrent calls and retry open only one provider intention",async()=>{
  const f=fixture();await Promise.all([openAccountSandboxCheckout({...input,deps:f.deps}),openAccountSandboxCheckout({...input,deps:f.deps})]);
  expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:true});expect(f.providerCalls()).toBe(1);
 });
 it("keeps an uncertain provider outcome pending and never recollects",async()=>{
  const f=fixture();let sends=0;f.deps.http.request=async()=>{sends++;throw Error("uncertain transport");};
  expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:false,code:"payment_pending"});
  expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:false,code:"payment_pending"});expect(f.saved()).toBeNull();expect(sends).toBe(1);
 });
 it("does not return an unpersisted checkout capability",async()=>{
  const f=fixture();f.deps.complete=async()=>false;
  expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:false,code:"checkout_persist_failed"});
  expect(await openAccountSandboxCheckout({...input,deps:f.deps})).toMatchObject({ok:false,code:"payment_pending"});expect(f.providerCalls()).toBe(1);
 });
 it.each(["foreign","live","tampered","company","settled"])("refuses %s orders before claiming or contacting provider",async(kind)=>{
  const f=fixture();if(kind==="foreign")f.order.accountId="99999999-2222-4333-8444-555555555555";if(kind==="live")f.order.environment="live";if(kind==="tampered")f.order.offer={...f.order.offer,amountBaisa:1};if(kind==="company")f.order.provisionedCompanyId=orderId;if(kind==="settled")f.order.status="settled";
  expect((await openAccountSandboxCheckout({...input,deps:f.deps})).ok).toBe(false);expect(f.providerCalls()).toBe(0);expect(f.saved()).toBeNull();
 });
 it("refuses live flags, wrong-mode keys, unverified conversion and insecure callbacks",async()=>{
  for(const change of [{config:{...config,liveEnabled:true}},{config:{...config,secretKey:"om_sk_live_fixture"}},{config:{...config,verifiedOmrUnitsPerOmr:undefined}},{callbackOrigin:"http://localhost:3720"}]){const f=fixture();expect((await openAccountSandboxCheckout({...input,...change,deps:f.deps})).ok).toBe(false);expect(f.providerCalls()).toBe(0);}
 });
 it("rejects a stored capability belonging to another account",async()=>{
  const f=fixture();await openAccountSandboxCheckout({...input,deps:f.deps});const saved=f.saved() as {binding:object};f.replaceSaved({...saved,binding:{...saved.binding,accountId:"other"}});
  expect((await openAccountSandboxCheckout({...input,deps:f.deps})).ok).toBe(false);expect(f.providerCalls()).toBe(1);
 });
 it("settles only a valid signed test observation against the saved provider order and replays idempotently",async()=>{
  const entries:PaymobSandboxLogEntry[]=[];
  setPaymobSandboxLogSink(entry=>entries.push(entry));
  try{
   const f=fixture();await openAccountSandboxCheckout({...input,correlationId:"corr-es02-sandbox-01",deps:f.deps});const message=callback();
   expect(await receiveAccountSandboxPayment({...message,config,deps:f.deps})).toMatchObject({ok:true,outcome:"settled"});
   expect(await receiveAccountSandboxPayment({...message,config,deps:f.deps})).toMatchObject({ok:true,outcome:"duplicate"});
   expect(f.applied[0]).toMatchObject({accountId,orderId,paymentAttemptId:f.order.paymentAttemptId,providerTransactionId:"4321",amountBaisa:45000,environment:"test"});expect(f.order.provisionedCompanyId).toBeNull();
   expect(entries.every(e=>e.correlationId==="corr-es02-sandbox-01")).toBe(true);
   const raw=JSON.stringify(entries);
   expect(raw).not.toContain("om_sk_test_fixture");
   expect(raw).not.toContain("om_csk_test_fixture");
   expect(raw).not.toContain("synthetic-only");
   expect(raw).not.toContain(message.hmacQueryParam);
  }finally{
   setPaymobSandboxLogSink(null);
  }
 });
 it("rejects an invalid signature and browser return fields before settlement",async()=>{
  const f=fixture();await openAccountSandboxCheckout({...input,deps:f.deps});
  expect((await receiveAccountSandboxPayment({...callback(),hmacQueryParam:"invalid",config,deps:f.deps})).ok).toBe(false);
  expect((await receiveAccountSandboxPayment({body:{success:true,order_id:987},hmacQueryParam:null,config,deps:f.deps})).ok).toBe(false);expect(f.applied).toHaveLength(0);
 });
 it.each([{amount_cents:1},{owner:999},{integration_id:999},{order:{id:999}}])("rejects correctly signed mismatched payment evidence %j",async(change)=>{
  const f=fixture();await openAccountSandboxCheckout({...input,deps:f.deps});expect((await receiveAccountSandboxPayment({...callback(change),config,deps:f.deps})).ok).toBe(false);expect(f.applied).toHaveLength(0);
 });
 it.each([{pending:true},{success:false},{is_refunded:true},{is_auth:true}])("does not settle non-collection lifecycle %j",async(change)=>{
  const f=fixture();await openAccountSandboxCheckout({...input,deps:f.deps});expect(await receiveAccountSandboxPayment({...callback(change),config,deps:f.deps})).toMatchObject({ok:true,outcome:expect.stringMatching(/pending|failed|review/)});expect(f.applied).toHaveLength(0);
 });
});
