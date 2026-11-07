import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionView } from "@/components/app/subscription-model";

const state = vi.hoisted(() => ({
  access: vi.fn(),
  rpc: vi.fn(),
  filters: [] as Array<{ table: string; key: string; value: unknown }>,
  subscription: { status: "active", paid_through: "2099-01-01T00:00:00.000Z", plan_version_id: null },
  order: null as null | { id: string; provider_environment: string },
  display: null as null | { data: unknown; error: unknown },
  es02: { data: null as unknown, error: null as unknown },
  es02Purchase: { data: null as unknown, error: null as unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: state.access }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      state.rpc(name, args);
      if (name === "es02_read_activation_foundation") return state.es02;
      if (name === "es02_read_owned_purchase") return state.es02Purchase;
      return state.display ?? { data: null, error: { code: "08006" } };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
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
  const v = { environment: "live", active: true, status: "active", paid_through: "2099-01-01T00:00:00.000Z", plan_version_id: null as string | null, ...extra };
  return {
    ok: true,
    data: {
      company_id: "fixture-company",
      environment: v.environment,
      billing_paid: true,
      operational_eligible: v.active,
      qualified_paid_through: v.paid_through,
      journey: {
        subscription: v.status === "none"
          ? null
          : { company_id: "fixture-company", status: v.status, paid_through: v.paid_through, plan_version_id: v.plan_version_id },
      },
      usage: null,
    },
  };
}
function es02Active(extra: Record<string, unknown> = {}) {
  return {
    data: {
      ok: true,
      data: {
        companyId: "fixture-company",
        orderGroupId: "fixture-group",
        paymentConfirmedAt: "2026-10-01T00:00:00.000Z",
        entitlementCreatedAt: "2026-10-01T00:00:01.000Z",
        activationDeadlineAt: "2026-10-08T00:00:00.000Z",
        bonusDays: 7,
        renewalGraceDays: 3,
        termUnit: "month",
        termCount: 1,
        clockState: "active",
        firstChannelReady: true,
        actualAiReady: true,
        operationalReady: true,
        subscriptionStartedAt: "2026-10-01T00:00:02.000Z",
        paidThroughAt: "2099-01-01T00:00:00.000Z",
        ...extra,
      },
    },
    error: null,
  };
}
beforeEach(() => {
  state.access.mockReset().mockResolvedValue({
    ok: true,
    context: {
      company: { id: "fixture-company", status: "active" },
      membership: { role: "owner" },
      userId: "fixture-user",
    },
  });
  state.rpc.mockClear();
  state.filters = [];
  state.order = null;
  state.subscription = { status: "active", paid_through: "2099-01-01T00:00:00.000Z", plan_version_id: null };
  state.display = { data: entitlement(), error: null };
  state.es02 = { data: { ok: false, code: "UNAVAILABLE" }, error: null };
  state.es02Purchase = { data: { ok: true, data: null }, error: null };
});
describe("owner subscription uses authoritative Live entitlement", () => {
  it("does not show Test or unknown future paid-through as active when operational RPC denies entitlement", async () => {
    state.display = { data: entitlement({ active: false, status: "none", paid_through: null }), error: null };
    expect(await loadOwnerBillingSubscription(fallback)).toEqual(fallback);
    expect(state.rpc).toHaveBeenCalledWith("billing_read_company_display_evidence", { p_company_id: "fixture-company" });
    expect(state.filters.some((row) => row.table === "billing_subscriptions")).toBe(false);
  });
  it("shows a verified active Live entitlement", async () => {
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("active");
  });
  it("enriches an active ES02 entitlement (plan_version_id null) with tier, package, and cycle from ES02 RPCs", async () => {
    state.display = { data: entitlement({ plan_version_id: null }), error: null };
    state.es02 = es02Active({ termUnit: "month" });
    state.es02Purchase = {
      data: {
        ok: true,
        data: {
          accountId: "fixture-user",
          orderId: "fixture-order",
          status: "provisioned",
          companyId: "fixture-company",
          offer: {
            persona: "level_2",
            package: "premium",
            term: "monthly",
          },
        },
      },
      error: null,
    };
    expect(await loadOwnerBillingSubscription(fallback)).toEqual({
      state: "active",
      currentTier: "level_2",
      currentPackage: "premium",
      cycle: "monthly",
      paidThrough: "2099-01-01T00:00:00.000Z",
    });
  });
  it("shows proven paid waiting service without claiming operational readiness when master is enabled", async () => {
    vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED", "true");
    try {
      state.display = { data: entitlement({ active: false }), error: null };
      expect(await loadOwnerBillingSubscription(fallback)).toMatchObject({ state: "active", operationalReady: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("keeps service active when only renewal was cancelled", async () => {
    state.display = { data: entitlement({ status: "cancel_at_period_end" }), error: null };
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("active");
  });
  it("requires Live environment even if an inconsistent RPC result claims active", async () => {
    state.display = { data: entitlement({ environment: "test" }), error: null };
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("error");
  });
  it("does not reuse a possibly active fallback after RPC failure", async () => {
    state.display = { data: null, error: { code: "08006" } };
    expect((await loadOwnerBillingSubscription({ ...fallback, state: "active" })).state).toBe("error");
  });
  it("does not activate a past paid period even if the response claims active", async () => {
    state.display = { data: entitlement({ paid_through: "2000-01-01T00:00:00.000Z" }), error: null };
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("expired");
  });
  it("respects explicit subscription suspension", async () => {
    state.display = { data: entitlement({ active: false, status: "suspended" }), error: null };
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("suspended");
  });
  it("does not expose a Test pending order in the Live projection", async () => {
    state.display = { data: entitlement({ active: false, status: "none", paid_through: null }), error: null };
    state.order = { id: "fixture-test-order", provider_environment: "test" };
    expect((await loadOwnerBillingSubscription(fallback)).state).toBe("empty");
    expect(state.filters).toContainEqual({ table: "billing_orders", key: "provider_environment", value: "live" });
  });
  it("shows a pending Live order without granting an active period", async () => {
    state.display = { data: entitlement({ active: false, status: "none", paid_through: null }), error: null };
    state.order = { id: "fixture-live-order", provider_environment: "live" };
    expect(await loadOwnerBillingSubscription(fallback)).toEqual({ ...fallback, state: "pending", pendingOrderId: "fixture-live-order" });
  });
  it("preserves the existing access-denied fallback without reading any Billing rows", async () => {
    state.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await loadOwnerBillingSubscription(fallback)).toEqual(fallback);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.filters).toEqual([]);
  });
  it("surfaces a real ES02 paid foundation when commercial display still reports empty", async () => {
    state.display = {
      data: {
        ok: true,
        data: {
          company_id: "fixture-company",
          environment: "live",
          billing_paid: false,
          operational_eligible: false,
          qualified_paid_through: null,
          journey: { subscription: null },
          usage: null,
        },
      },
      error: null,
    };
    state.es02 = es02Active();
    expect(await loadOwnerBillingSubscription(fallback)).toEqual({
      state: "active",
      currentTier: null,
      cycle: "monthly",
      paidThrough: "2099-01-01T00:00:00.000Z",
    });
    expect(state.rpc).toHaveBeenCalledWith("es02_read_activation_foundation", {
      p_expected_account_id: "fixture-user",
      p_company_id: "fixture-company",
    });
  });
  it("does not invent an ES02 paid plan without paymentConfirmedAt", async () => {
    state.display = {
      data: {
        ok: true,
        data: {
          company_id: "fixture-company",
          environment: "live",
          billing_paid: false,
          operational_eligible: false,
          qualified_paid_through: null,
          journey: { subscription: null },
          usage: null,
        },
      },
      error: null,
    };
    state.es02 = es02Active({ paymentConfirmedAt: null, paidThroughAt: null });
    expect(await loadOwnerBillingSubscription(fallback)).toEqual(fallback);
  });
  it.each([
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ])("ES02 empty-commercial fallback is scoped to the selected company %s", async (companyId) => {
    state.access.mockResolvedValue({
      ok: true,
      context: {
        company: { id: companyId, status: "active" },
        membership: { role: "owner" },
        userId: "fixture-user",
      },
    });
    state.display = {
      data: {
        ok: true,
        data: {
          company_id: companyId,
          environment: "live",
          billing_paid: false,
          operational_eligible: false,
          qualified_paid_through: null,
          journey: { subscription: null },
          usage: null,
        },
      },
      error: null,
    };
    state.es02 = es02Active({ companyId });
    expect(await loadOwnerBillingSubscription(fallback)).toMatchObject({
      state: "active",
      paidThrough: "2099-01-01T00:00:00.000Z",
    });
    expect(state.rpc).toHaveBeenCalledWith("billing_read_company_display_evidence", { p_company_id: companyId });
    expect(state.rpc).toHaveBeenCalledWith("es02_read_activation_foundation", {
      p_expected_account_id: "fixture-user",
      p_company_id: companyId,
    });
  });
});
