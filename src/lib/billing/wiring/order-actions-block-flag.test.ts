import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseGateDecision } from "./purchase-gate";

const state = vi.hoisted(() => ({
  rpcPayload: {} as Record<string, unknown>,
  gateRejection: null as Extract<PurchaseGateDecision, { ok: false }> | null,
}));

vi.mock("@/lib/tenancy/access", () => ({
  getCompanyAccess: async () => ({
    ok: true,
    context: {
      company: { id: "11111111-1111-4111-8111-111111111111", status: "active" },
      membership: { role: "owner", status: "active" },
      userId: "22222222-2222-4222-8222-222222222222",
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const data = table === "billing_plan_versions"
        ? {
            id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444", status: "published",
            amount_baisa: 45000, currency: "OMR", period_days: 30,
            period_unit: "month", period_count: 1,
          }
        : {
            company_id: "11111111-1111-4111-8111-111111111111", status: "active",
            paid_through: "2099-01-31T00:00:00.000Z",
            cancel_at_period_end: false, plan_version_id: "33333333-3333-4333-8333-333333333333",
          };
      const query = {
        select: () => query,
        eq: () => query,
        in: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data, error: null }),
      };
      return query;
    },
    rpc: async (name:string) => ({ data: name==="billing_read_public_test_offer"?{ok:true,data:{
      id:"33333333-3333-4333-8333-333333333333",plan_id:"44444444-4444-4444-8444-444444444444",status:"published",plan_status:"active",plan_code:"noor_basic",amount_baisa:45000,currency:"OMR",period_days:30,period_unit:"month",period_count:1,service_code:"noura",tier:"basic",capabilities:["noura.knowledge.read"],bound:true,
    }}:state.rpcPayload, error: null }),
  }),
}));

vi.mock("@/lib/billing/wiring/flags", () => ({
  readBillingPaymobWiringFlags: () => ({ createEnabled: true, liveEnabled: false }),
  readWiringSecretsPresence: () => ({}),
  blocksPaymobConnection: () => "test_provider_blocked",
}));
vi.mock("@/lib/billing/paymob/config", () => ({
  getPaymobOmrConversionState: () => ({ status: "CONFIGURED", unitsPerOmr: 1000 }),
}));
vi.mock("@/lib/billing/wiring/purchase-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./purchase-gate")>();
  return {
    ...actual,
    decidePurchaseGate: (input: Parameters<typeof actual.decidePurchaseGate>[0]) =>
      state.gateRejection ?? actual.decidePurchaseGate(input),
  };
});

vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"22222222-2222-4222-8222-222222222222",session_id:"55555555-5555-4555-8555-555555555555"}},error:null})},rpc:async()=>({data:{ok:true,expires_at:"2099-11-01T00:00:00Z"},error:null})})}));
import { createBillingOrderAction } from "./order-actions";
import { buildEarlyRenewQuote, confirmationFromQuote } from "./renew-gate";

function renew() {
  return createBillingOrderAction({
    planVersionId: "33333333-3333-4333-8333-333333333333",
    clientOpId: "flag-renew",
    purchasePurpose: "renew",
    earlyRenewConfirmation: confirmationFromQuote(buildEarlyRenewQuote({
      amountBaisa: 45000,
      period: { unit: "month", count: 1 },
      currentPaidThrough: new Date("2099-01-31T00:00:00.000Z"),
    })),
  });
}

describe("billing action collection-block response", () => {
  beforeEach(() => {
    state.gateRejection = null;
    state.rpcPayload = {
      ok: false,
      code: "OPEN_COLLECTION_UNRESOLVED",
      block_new_collection: true,
      manage_subscription_hint: true,
    };
  });

  it("preserves the unresolved-collection flag through the public action response", async () => {
    expect(await renew()).toEqual({
      ok: false, code: "OPEN_COLLECTION_UNRESOLVED", purchasePurpose: "renew",
      manageSubscriptionHint: true, blockNewCollection: true,
    });
  });

  it("preserves a collection-block flag from a gate rejection", async () => {
    state.gateRejection = {
      ok: false, code: "PENDING_COLLECTION_RECONCILE",
      purchasePurpose: "renew", blockNewCollection: true,
    };
    expect(await renew()).toEqual({
      ok: false, code: "PENDING_COLLECTION_RECONCILE",
      purchasePurpose: "renew", blockNewCollection: true,
    });
  });

  it("keeps ordinary failure responses free of an absent block flag", async () => {
    state.rpcPayload = { ok: false, code: "purchase_persist_rejected" };
    expect(await renew()).toEqual({
      ok: false, code: "purchase_persist_rejected", purchasePurpose: "renew",
    });
  });

  it("retains the existing blocked-reuse success response", async () => {
    state.rpcPayload = {
      ok: true, action: "reuse", order_id: "flag-order",
      special_reference: "FLAG_SYNTHETIC", payment_attempt_id: "flag-attempt",
      block_new_collection: true,
    };
    expect(await renew()).toMatchObject({
      ok: true, action: "reuse", orderId: "flag-order",
      blockNewCollection: true, providerConnection: "blocked",
    });
  });
});
