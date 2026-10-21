import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readTestCheckoutConfig, openTestCheckout } from "./test-checkout";
import { receivePaymobWebhook } from "./webhook-receive";
import { processStoredPaymobEvent } from "./event-process";
import { mapBillingReturnDbParts, loadBillingReturnRow } from "./return-load";
import { setPaymobSandboxLogSink, logPaymobSandboxEvent, redactPaymobLogText, bindPaymobCorrelation, type PaymobSandboxLogEntry } from "../paymob/intention";
const env = { BILLING_PAYMOB_CREATE_ENABLED:"true", BILLING_PAYMOB_WEBHOOK_ENABLED:"true", BILLING_PAYMOB_SETTLE_ENABLED:"true", PAYMOB_SECRET_KEY_TEST:"om_sk_test_example", PAYMOB_PUBLIC_KEY_TEST:"om_pk_test_example", PAYMOB_HMAC_SECRET:"synthetic", PAYMOB_INTEGRATION_ID_TEST:"123", PAYMOB_MERCHANT_OWNER_ID:"456", PAYMOB_OMR_CONVERSION_VERIFIED:"true", PAYMOB_OMR_UNITS_PER_OMR:"1000" };
const locked = { companyId:"company",orderId:"order",paymentAttemptId:"attempt",specialReference:"ref",currency:"OMR" as const,amountBaisa:5000,providerAmount:5000,providerAmountUnit:"paymob_amount" as const,providerAccountRef:"123",providerEnvironment:"test" as const,integrationId:123,billingPhone:"+96890000000",itemName:"Noor",notificationUrl:"https://example.com/webhook",redirectionUrl:"https://example.com/return" };
function deps() { return { claim:vi.fn(async()=>({kind:"claimed" as const})), persist:vi.fn(async()=>true), http:{request:vi.fn(async()=>({kind:"response" as const,response:{status:201,headers:{},bodyText:JSON.stringify({client_secret:"om_csk_test_example",intention_order_id:987,id:"pi_test_example"})}}))} }; }
describe("test checkout configuration",()=>{
 it("requires explicit amount verification",()=>{expect(readTestCheckoutConfig({...env,PAYMOB_OMR_CONVERSION_VERIFIED:""})).toMatchObject({ok:false,code:"omr_conversion_not_configured"});});
 it("rejects live flags and live keys",()=>{expect(readTestCheckoutConfig({...env,BILLING_PAYMOB_LIVE_ENABLED:"true"}).ok).toBe(false); expect(readTestCheckoutConfig({...env,PAYMOB_SECRET_KEY_TEST:"om_sk_live_example"}).ok).toBe(false);});
 it("requires webhook and settlement before opening checkout",()=>{expect(readTestCheckoutConfig({...env,BILLING_PAYMOB_SETTLE_ENABLED:"false"}).ok).toBe(false);});
 it("accepts complete test settings only",()=>{expect(readTestCheckoutConfig(env)).toMatchObject({ok:true,unitsPerOmr:1000});});
});
describe("durable hosted test checkout",()=>{
 it("persists provider identity before returning a checkout URL",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const d=deps();const result=await openTestCheckout({config:cfg.config,locked,deps:d});expect(result).toMatchObject({ok:true});expect(d.persist).toHaveBeenCalledWith(expect.objectContaining({providerOrderId:"987"}));expect(d.persist.mock.invocationCallOrder[0]).toBeGreaterThan(d.http.request.mock.invocationCallOrder[0]);});
 it("never sends another intention for an unresolved claim",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const d=deps();const result=await openTestCheckout({config:cfg.config,locked,deps:{...d,claim:async()=>({kind:"pending"})}});expect(result).toMatchObject({ok:false,code:"payment_pending"});expect(d.http.request).not.toHaveBeenCalled();});
 it("reuses a stored checkout without a provider call",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const d=deps();const url="https://om.checkout.paymob.com/?publicKey=om_pk_test_example&clientSecret=om_csk_test_old";expect(await openTestCheckout({config:cfg.config,locked,deps:{...d,claim:async()=>({kind:"ready",url})}})).toEqual({ok:true,url});expect(d.http.request).not.toHaveBeenCalled();});
 it("does not redirect when durable persistence fails",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const result=await openTestCheckout({config:cfg.config,locked,deps:{...deps(),persist:async()=>false}});expect(result).toMatchObject({ok:false,code:"checkout_persist_failed"});});
 it("rejects a live intention returned for test settings",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const d=deps();d.http.request.mockResolvedValue({kind:"response",response:{status:201,headers:{},bodyText:JSON.stringify({client_secret:"om_csk_live_example",intention_order_id:987,id:"pi_live_example"})}});expect(await openTestCheckout({config:cfg.config,locked,deps:d})).toMatchObject({ok:false,code:"provider_mode_mismatch"});expect(d.persist).not.toHaveBeenCalled();});
 it("rejects credential-bearing stored URLs",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const d=deps();expect(await openTestCheckout({config:cfg.config,locked,deps:{...d,claim:async()=>({kind:"ready",url:"https://user:password@om.checkout.paymob.com/"})}})).toMatchObject({ok:false,code:"checkout_invalid"});});
 it("rejects invalid provider origins before HTTP",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error('config');const d=deps();expect((await openTestCheckout({config:{...cfg.config,apiBaseUrl:"https://evil.example"},locked,deps:d})).ok).toBe(false);expect(d.http.request).not.toHaveBeenCalled();});
 it("links order creation, intention response, webhook HMAC, settlement, and return with one correlationId and zero leaked secrets",async()=>{
  const entries:PaymobSandboxLogEntry[]=[];
  setPaymobSandboxLogSink(entry=>entries.push(entry));
  try{
   const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error("config");
   const d=deps();
   const corr="corr-velora-sandbox-journey-01";
   const openRes=await openTestCheckout({config:cfg.config,locked:{...locked,correlationId:corr},deps:d});
   expect(openRes.ok).toBe(true);
   const obj={amount_cents:5000,created_at:"2026-10-20T00:00:00Z",currency:"OMR",error_occured:false,has_parent_transaction:false,id:4321,integration_id:123,is_3d_secure:true,is_auth:false,is_capture:false,is_refunded:false,is_standalone_payment:true,is_voided:false,order:{id:987,merchant_order_id:"ref"},owner:456,pending:false,source_data:{pan:"2346",sub_type:"MasterCard",type:"card"},success:true};
   const fields=[obj.amount_cents,obj.created_at,obj.currency,obj.error_occured,obj.has_parent_transaction,obj.id,obj.integration_id,obj.is_3d_secure,obj.is_auth,obj.is_capture,obj.is_refunded,obj.is_standalone_payment,obj.is_voided,obj.order.id,obj.owner,obj.pending,obj.source_data.pan,obj.source_data.sub_type,obj.source_data.type,obj.success];
   const hmac=createHmac("sha512",cfg.config.hmacSecret).update(fields.map(String).join("")).digest("hex");
   const webhookRes=await receivePaymobWebhook({
    rawBody:JSON.stringify({type:"TRANSACTION",obj}),
    hmacQueryParam:hmac,
    deps:{
     webhookEnabled:true,
     hmacSecret:cfg.config.hmacSecret,
     providerEnvironment:"test",
     findOrderByProviderOrderId:async()=>({companyId:"company",orderId:"order",paymentAttemptId:"attempt",providerOrderId:"987",specialReference:"ref",amountBaisa:5000,currency:"OMR",providerAmount:5000,providerAccountRef:"123",providerEnvironment:"test",integrationId:123,merchantOwnerId:"456",status:"submitted"}),
     insertProviderEvent:async()=>({ok:true,inserted:true,eventId:"evt-1"}),
    },
   });
   expect(webhookRes.status).toBe(200);
   const settleRes=await processStoredPaymobEvent({
    event:{id:"evt-1",companyId:"company",orderId:"order",paymentAttemptId:"attempt",providerTransactionId:"4321",eventStatus:"success",providerEnvironment:"test",providerAccountRef:"123",specialReference:"ref",amountBaisa:5000,observationKey:"obs-1"},
    deps:{settleEnabled:true,settleHmacVerified:async()=>({ok:true,outcome:"granted"})},
   });
   expect(settleRes).toEqual({ok:true,outcome:"granted"});
   const returnRow=mapBillingReturnDbParts("company",{order:{id:"order",company_id:"company",status:"settled",provider_environment:"test"},attempt:{id:"attempt",status:"settled"},latestEvent:{event_status:"success",observation_key:"obs-1"},grant:{id:"grant-1",applied_paid_through:"2026-11-20T00:00:00Z"}});
   logPaymobSandboxEvent({stage:"return",code:returnRow?.orderStatus??"unknown",orderId:"order",detail:`Authorization: Token ${cfg.config.secretKey} hmac=${hmac} clientSecret=om_csk_test_example phone=+96890000000`});
   const stages=entries.map(e=>e.stage);
   expect(stages).toEqual(expect.arrayContaining(["order_create","checkout_claim","intention_request","intention_response","checkout_ready","hmac_verify","order_match","webhook_receive","settlement","return"]));
   expect(entries.every(e=>e.correlationId===corr&&Boolean(Date.parse(e.timestamp)))).toBe(true);
   const serialized=JSON.stringify(entries);
   expect(serialized).not.toContain("om_sk_test_example");
   expect(serialized).not.toContain("om_csk_test_example");
   expect(serialized).not.toContain("synthetic");
   expect(serialized).not.toContain(hmac);
   expect(serialized).not.toContain("+96890000000");
   expect(serialized).not.toContain("2346");
  }finally{
   setPaymobSandboxLogSink(null);
  }
 });
 it("completely removes captured Token and Bearer values during redaction and sanitizes unsafe correlation IDs",()=>{
  const raw="Authorization: Token syn_tok_value_998877, Bearer syn_bearer_value_112233";
  const redacted=redactPaymobLogText(raw);
  expect(redacted).not.toContain("syn_tok_value_998877");
  expect(redacted).not.toContain("syn_bearer_value_112233");
  expect(redacted).toBe("Authorization: Token [REDACTED], Bearer [REDACTED]");
  const corrWithSecret=bindPaymobCorrelation({correlationId:"corr-Token syn_tok_value_998877"});
  expect(corrWithSecret).not.toContain("syn_tok_value_998877");
  expect(corrWithSecret).toBe("paymob-corr-unlinked");
  const corrWithKey=bindPaymobCorrelation({correlationId:"corr_om_sk_test_secret999"});
  expect(corrWithKey).not.toContain("om_sk_test_secret999");
  expect(corrWithKey).toBe("paymob-corr-unlinked");
 });
 it("breaks ties by descending id when return-load attempts or events share identical timestamps",async()=>{
  vi.doMock("server-only",()=>({}));
  const tables:Record<string,unknown[]>={
   billing_orders:[{id:"order-tie",company_id:"company-tie",status:"settled",provider_environment:"test",amount_baisa:45000,currency:"OMR"}],
   billing_payment_attempts:[
    {id:"attempt-a",order_id:"order-tie",company_id:"company-tie",status:"failed",created_at:"2026-10-20T12:00:00Z"},
    {id:"attempt-z",order_id:"order-tie",company_id:"company-tie",status:"settled",created_at:"2026-10-20T12:00:00Z"},
   ],
   billing_provider_events:[
    {id:"event-a",payment_attempt_id:"attempt-z",company_id:"company-tie",event_status:"pending",observation_key:"obs-a",received_at:"2026-10-20T12:01:00Z"},
    {id:"event-z",payment_attempt_id:"attempt-z",company_id:"company-tie",event_status:"success",observation_key:"obs-z",received_at:"2026-10-20T12:01:00Z"},
   ],
   billing_entitlement_applications:[],
   billing_settlement_outcomes:[],
   billing_plan_versions:[],
  };
  vi.doMock("@/lib/supabase/admin",()=>({
   createAdminClient:()=>({
    from:(table:string)=>({
     select:()=>{
      const rows=[...(tables[table]??[])];
      const chain={
       eq:()=>chain,
       in:()=>chain,
       order:()=>chain,
       range:async()=>({data:rows,error:null}),
       returns:()=>({maybeSingle:async()=>({data:rows[0]??null,error:null})}),
      };
      return chain;
     },
    }),
   }),
  }));
  const row=await loadBillingReturnRow({requestCompanyId:"company-tie",orderId:"order-tie"});
  expect(row?.attemptStatus).toBe("settled");
  expect(row?.latestEventStatus).toBe("success");
 });
});

it("Test intention supplies synthetic required billing names without business data",async()=>{const cfg=readTestCheckoutConfig(env);if(!cfg.ok)throw Error("config");const d=deps();await openTestCheckout({config:cfg.config,locked,deps:d});expect(d.http.request).toHaveBeenCalledOnce();const [request]=d.http.request.mock.calls[0] as unknown as [{body:string}];const body=JSON.parse(request.body);expect(body.billing_data).toEqual({phone_number:locked.billingPhone,first_name:"Velora",last_name:"Sandbox"});expect(body).not.toHaveProperty("extras");expect(body).not.toHaveProperty("companyId");expect(body).not.toHaveProperty("preparation");});
