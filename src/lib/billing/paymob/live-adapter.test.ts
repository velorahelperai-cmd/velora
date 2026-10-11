import {describe,expect,it} from "vitest";
import {assertPaymobConfigForCalls,defaultPaymobTestConfigSkeleton,type PaymobAdapterConfig} from "./config";
import {createPaymobIntention,type LockedIntentionOrder} from "./intention";
import {buildOmanHostedCheckoutUrl} from "./checkout";
import {reconcilePaymobTransaction} from "./reconcile";
import {createMockPaymobHttpClient} from "./http";

const liveConfig= (changes:Partial<PaymobAdapterConfig>={}):PaymobAdapterConfig => ({
 ...defaultPaymobTestConfigSkeleton(),environment:"live",liveEnabled:true,
 secretKey:"om_sk_live_SYNTHETIC_ONLY",publicKey:"om_pk_live_SYNTHETIC_ONLY",
 hmacSecret:"synthetic-hmac",apiKeyShared:"synthetic-shared",merchantOwnerId:"1001",
 integrationId:98765,verifiedOmrUnitsPerOmr:1000,
 ...{liveConfigurationVerified:true},...changes,
});
const order=(changes:Partial<LockedIntentionOrder>={}):LockedIntentionOrder=>({
 companyId:"11111111-1111-4111-8111-111111111111",orderId:"22222222-2222-4222-8222-222222222222",
 paymentAttemptId:"33333333-3333-4333-8333-333333333333",specialReference:"SYNTHETIC-LIVE-ORDER",
 currency:"OMR",providerAmount:45000,providerAmountUnit:"paymob_amount",
 providerAccountRef:"98765",providerEnvironment:"live",integrationId:98765,
 billingPhone:"+96890000000",itemName:"Synthetic locked subscription",
 notificationUrl:"https://example.test/webhook",redirectionUrl:"https://example.test/return",
 ...{amountBaisa:45000,planVersionId:"44444444-4444-4444-8444-444444444444"},...changes,
});
const success={kind:"response" as const,response:{status:201,headers:{},bodyText:JSON.stringify({
 client_secret:"synthetic-client",intention_order_id:900001, payment_methods:[{integration_id:98765,currency:"OMR",live:true}],
 intention_detail:{amount:45000,currency:"OMR"},special_reference:"SYNTHETIC-LIVE-ORDER",
})}};
const http=()=>createMockPaymobHttpClient([{match:()=>true,result:success}]);
describe("Live adapter is opt-in and bound to locked server evidence",()=>{
 it("accepts complete explicitly verified Live configuration",()=>expect(()=>assertPaymobConfigForCalls(liveConfig())).not.toThrow());
 it("keeps Live disabled by default",()=>expect(()=>assertPaymobConfigForCalls(liveConfig({liveEnabled:false}))).toThrow(/live_locked/));
 it("rejects a Test config carrying the Live enable switch",()=>expect(()=>assertPaymobConfigForCalls({...defaultPaymobTestConfigSkeleton(),...liveConfig(),environment:"test"})).toThrow());
 it.each(["secretKey","publicKey"] as const)("rejects Test %s for Live",key=>expect(()=>assertPaymobConfigForCalls(liveConfig({[key]:key==="secretKey"?"sk_test_SYNTHETIC":"pk_test_SYNTHETIC"}))).toThrow());
 it("requires an explicit Live configuration verification",()=>expect(()=>assertPaymobConfigForCalls(liveConfig({...{liveConfigurationVerified:false}}))).toThrow());
 it.each([{merchantOwnerId:""},{hmacSecret:""},{verifiedOmrUnitsPerOmr:undefined},{integrationId:0}])("rejects missing required Live configuration %j",v=>expect(()=>assertPaymobConfigForCalls(liveConfig(v))).toThrow());
 it("uses only the locked amount and integration in the Live intention",async()=>{
  const client=http(),result=await createPaymobIntention({config:liveConfig(),locked:order(),http:client});
  expect(result).toMatchObject({ok:true,intentionOrderId:900001});
  expect(client.calls).toHaveLength(1);expect(JSON.parse(client.calls[0].body!)).toMatchObject({amount:45000,currency:"OMR",payment_methods:[98765]});
  expect(client.calls[0].headers?.Authorization).toBe("Token om_sk_live_SYNTHETIC_ONLY");
 });
 it("builds the allowlisted Live checkout with the Live public key",()=>expect(buildOmanHostedCheckoutUrl({config:liveConfig(),clientSecret:"synthetic-client"})).toMatchObject({ok:true,url:expect.stringContaining("publicKey=om_pk_live_SYNTHETIC_ONLY")}));
 it.each([{providerEnvironment:"test" as const},{integrationId:71610},{providerAccountRef:"71610"},{providerAmount:44999},{...{amountBaisa:undefined}},{...{planVersionId:undefined}}])("refuses inconsistent or incomplete locked Live order before HTTP %j",async changes=>{
  const client=http();expect((await createPaymobIntention({config:liveConfig(),locked:order(changes),http:client})).ok).toBe(false);expect(client.calls).toHaveLength(0);
 });
 it("rejects fractional provider units instead of rounding", async () => {
  const client=http(); expect(await createPaymobIntention({config:liveConfig({verifiedOmrUnitsPerOmr:100}),locked:order({amountBaisa:1,providerAmount:1}),http:client})).toMatchObject({ok:false,code:"provider_amount_mismatch"});expect(client.calls).toHaveLength(0);
 });
 it("rejects invalid persisted plan version identity", async () => {
  const client=http();expect(await createPaymobIntention({config:liveConfig(),locked:order({planVersionId:"browser-plan"}),http:client})).toMatchObject({ok:false,code:"locked_order_invalid"});expect(client.calls).toHaveLength(0);
 });
 it("does not retry an unknown Live intention",async()=>{const client=createMockPaymobHttpClient([{match:()=>true,result:{kind:"timeout"}}]);expect(await createPaymobIntention({config:liveConfig(),locked:order(),http:client})).toMatchObject({ok:false,code:"timeout_unknown",needsReconciliation:true});expect(client.calls).toHaveLength(1);});
 it("refuses an inconsistent provider Live echo without authorizing payment",async()=>{const client=createMockPaymobHttpClient([{match:()=>true,result:{...success,response:{...success.response,bodyText:JSON.stringify({client_secret:"synthetic",intention_order_id:900001,payment_methods:[{integration_id:98765,live:false}]})}}}]);expect(await createPaymobIntention({config:liveConfig(),locked:order(),http:client})).toMatchObject({ok:false,code:"invalid_response",needsReconciliation:true});});
});
const transaction=(changes:Record<string,unknown>={})=>({
 id:9,order:{id:900001,merchant_order_id:"SYNTHETIC-LIVE-ORDER"},amount_cents:45000,currency:"OMR",
 integration_id:98765,owner:1001,is_live:true,success:true,pending:false,error_occured:false,is_auth:false,is_capture:false,
 is_voided:false,is_refunded:false,has_parent_transaction:false,is_standalone_payment:true,...changes,
});
function inquiry(row:Record<string,unknown>){return createMockPaymobHttpClient([
 {match:r=>r.url.endsWith("/api/auth/tokens"),result:{kind:"response",response:{status:201,headers:{},bodyText:'{"token":"synthetic-token"}'}}},
 {match:r=>r.url.endsWith("/api/acceptance/transactions/9"),result:{kind:"response",response:{status:200,headers:{},bodyText:JSON.stringify(row)}}},
]);}
describe("Live inquiry proves environment independently of the shared API key",()=>{
 it("accepts authenticated matching Live transaction without granting or collecting",async()=>expect(await reconcilePaymobTransaction({config:liveConfig(),lookup:{by:"transaction_id",transactionId:"9"},http:inquiry(transaction())})).toMatchObject({ok:true,transaction:{isLive:true,integrationId:98765,ownerId:"1001"}}));
 it.each([{is_live:false},{is_live:null},{integration_id:71610},{owner:9999},{currency:"USD"}])("refuses mismatched authenticated evidence %j",async changes=>expect(await reconcilePaymobTransaction({config:liveConfig(),lookup:{by:"transaction_id",transactionId:"9"},http:inquiry(transaction(changes))})).toMatchObject({ok:false,allowsNewCollection:false}));
});
