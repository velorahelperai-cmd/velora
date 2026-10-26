import { describe, expect, it, vi } from "vitest";
const catalog=vi.hoisted(()=>vi.fn());
vi.mock("server-only",()=>({}));
vi.mock("./rpc",()=>({readPublicCatalogBackend:catalog}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{throw new Error("Catalog display must not access payment configuration");}}));
import { readSubscriptionOffersView } from "./offer-readiness";
const id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",plan="22222222-2222-4222-8222-222222222222";
const row={code:"noor_basic",currency:"OMR",amount_baisa:45000,period_unit:"month",period_count:1,automated_outbound_per_month:500,feature_availability:{knowledge:"not_verified"},product_code:"velora_ai_staff",plan_id:plan,version_id:id,version:1,persona:"noor",variant:"basic",checkout_enabled:false};

describe("catalog after legacy checkout retirement",()=>{
 it.each(["basic","premium"])("retains %s prices without advertising retired payment readiness",async variant=>{
  catalog.mockResolvedValue({ok:true,data:[{...row,variant,code:`noor_${variant}`} ]});
  const view=await readSubscriptionOffersView();
  expect(view.status).toBe("ready");
  expect(view.offers[0].amountBaisa).toBe(45000);
  expect(view.offers[0].testCheckoutReady).toBe(false);
  expect(view.offers[0].liveCheckoutReady).not.toBe(true);
 });
 it("preserves unavailable catalog state",async()=>{
  catalog.mockResolvedValue({ok:false,code:"UNAVAILABLE"});
  expect((await readSubscriptionOffersView()).status).not.toBe("ready");
 });
});
