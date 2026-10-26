import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{throw Error("retired path accessed database");}}));
import {createBillingOrderAction} from "./order-actions";
import {startTestCheckoutAction,resumeTestCheckoutAction} from "./test-checkout-actions";
import {startLiveCheckoutAction,resumeLiveCheckoutAction} from "./live-checkout-actions";
describe("retired provider entry points",()=>{
 it("refuses legacy collection without creating an order or redirect",async()=>{
  expect(await createBillingOrderAction({planVersionId:"plan",clientOpId:"op"})).toEqual({ok:false,code:"provider_retired"});
  expect(await startTestCheckoutAction({planVersionId:"plan",clientOpId:"op"})).toEqual({ok:false,code:"test_not_configured"});
  expect(await resumeTestCheckoutAction({orderId:"old"})).toEqual({ok:false,code:"test_not_configured"});
  expect(await startLiveCheckoutAction({planVersionId:"plan",clientOpId:"op",expectedCompanyId:"company",expectedCatalogRevision:1})).toEqual({ok:false,code:"live_not_configured"});
  expect(await resumeLiveCheckoutAction({orderId:"old"})).toEqual({ok:false,code:"live_not_configured"});
 });
});
