import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionView } from "@/components/app/subscription-model";

const state = vi.hoisted(() => ({
  access: vi.fn(), rpc: vi.fn(), filters: [] as Array<{ table: string; key: string; value: unknown }>,
  subscription: { status: "active", paid_through: "2099-01-01T00:00:00.000Z", plan_version_id: null },
  order: null as null | { id: string; provider_environment: string },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: state.access }));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:state.rpc})}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: state.rpc,
  from(table: string) {
    const filters = new Map<string, unknown>();
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.set(key, value); state.filters.push({ table, key, value }); return query; },
      in() { return query; }, order() { return query; }, limit() { return query; },
      async maybeSingle() {
        const data = table === "billing_subscriptions" ? state.subscription
          : table === "billing_orders" ? state.order && (!filters.has("provider_environment") || filters.get("provider_environment") === state.order.provider_environment) ? state.order : null
          : null;
        return { data, error: null };
      },
    };
    return query;
  },
}) }));
import { loadOwnerBillingSubscription } from "./subscription-read";

const fallback: SubscriptionView = { state: "empty", currentTier: null, cycle: null, paidThrough: null };
function entitlement(extra: Record<string, unknown> = {}) {
 const v={environment:"live",active:true,status:"active",paid_through:"2099-01-01T00:00:00.000Z",plan_version_id:null,...extra};
 return {ok:true,data:{company_id:"fixture-company",environment:v.environment,billing_paid:true,operational_eligible:v.active,qualified_paid_through:v.paid_through,
  journey:{subscription:v.status==="none"?null:{company_id:"fixture-company",status:v.status,paid_through:v.paid_through,plan_version_id:v.plan_version_id}},usage:null}};
}
beforeEach(() => {
  state.access.mockReset().mockResolvedValue({ ok: true, context: { company: { id: "fixture-company", status: "active" }, membership: { role: "owner" } } });
  state.rpc.mockReset().mockResolvedValue({ data: entitlement(), error: null });
  state.filters = []; state.order = null;
  state.subscription = { status: "active", paid_through: "2099-01-01T00:00:00.000Z", plan_version_id: null };
});
describe("owner subscription uses authoritative Live entitlement", () => {
  it("does not show Test or unknown future paid-through as active when operational RPC denies entitlement", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ active: false, status: "none", paid_through: null }), error: null });
    expect(await loadOwnerBillingSubscription(fallback)).toEqual(fallback);
    expect(state.rpc).toHaveBeenCalledWith("billing_read_company_display_evidence", { p_company_id: "fixture-company" });
    expect(state.filters.some(row => row.table === "billing_subscriptions")).toBe(false);
  });
  it("shows a verified active Live entitlement", async () => {
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("active");
  });
  it('shows proven paid waiting service without claiming operational readiness when master is enabled',async()=>{
    vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');
    try{
      state.rpc.mockResolvedValue({data:entitlement({active:false}),error:null});
      expect(await loadOwnerBillingSubscription(fallback)).toMatchObject({state:'active',operationalReady:false});
    }finally{vi.unstubAllEnvs();}
  });
  it("keeps service active when only renewal was cancelled", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ status: "cancel_at_period_end" }), error: null });
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("active");
  });
  it("requires Live environment even if an inconsistent RPC result claims active", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ environment: "test" }), error: null });
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("error");
  });
  it("does not reuse a possibly active fallback after RPC failure", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    expect((await loadOwnerBillingSubscription({ ...fallback, state: "active" })).state).toBe("error");
  });
  it("does not activate a past paid period even if the response claims active", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ paid_through: "2000-01-01T00:00:00.000Z" }), error: null });
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("expired");
  });
  it("respects explicit subscription suspension", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ active: false, status: "suspended" }), error: null });
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("suspended");
  });
  it("does not expose a Test pending order in the Live projection", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ active: false, status: "none", paid_through: null }), error: null });
    state.order = { id: "fixture-test-order", provider_environment: "test" };
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("empty");
    expect(state.filters).toContainEqual({ table: "billing_orders", key: "provider_environment", value: "live" });
  });
  it("shows a pending Live order without granting an active period", async () => {
    state.rpc.mockResolvedValue({ data: entitlement({ active: false, status: "none", paid_through: null }), error: null });
    state.order = { id: "fixture-live-order", provider_environment: "live" };
    expect(await loadOwnerBillingSubscription(fallback)).toEqual({ ...fallback, state: "pending", pendingOrderId: "fixture-live-order" });
  });
  it("preserves the existing access-denied fallback without reading any Billing rows", async () => {
    state.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await loadOwnerBillingSubscription(fallback)).toEqual(fallback);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.filters).toEqual([]);
  });
});
