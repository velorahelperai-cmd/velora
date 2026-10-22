import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminGetFinancialAnalytics } from "./analytics-actions";

const state = vi.hoisted(() => ({
  gateResult: { ok: true, actor: { userId: "owner-123", email: "velorahelperai@gmail.com" } } as {
    ok: boolean;
    code?: string;
    actor?: { userId: string; email: string };
  },
  ordersMock: [] as Record<string, unknown>[],
  subscriptionsMock: [] as Record<string, unknown>[],
  plansMock: [] as Record<string, unknown>[],
  versionsMock: [] as Record<string, unknown>[],
  evidenceMock: [] as Record<string, unknown>[],
  dbError: null as string | null,
  clientAvailable: true,
}));

vi.mock("@/lib/billing/admin/owner-gate", () => ({
  billingOwnerGate: vi.fn(async () => state.gateResult),
  recheckBillingOwner: vi.fn(async () => state.gateResult),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    if (!state.clientAvailable) return null;
    return {
      from: (table: string) => ({
        select: () => ({
          order: () => ({
            range: async (_from: number, _to: number) => {
              if (state.dbError) return { data: null, error: { message: state.dbError } };
              if (table === "billing_orders") return { data: state.ordersMock, error: null };
              if (table === "billing_subscriptions") return { data: state.subscriptionsMock, error: null };
              if (table === "billing_plans") return { data: state.plansMock, error: null };
              if (table === "billing_plan_versions") return { data: state.versionsMock, error: null };
              return { data: [], error: null };
            },
          }),
        }),
      }),
    };
  }),
}));

vi.mock("@/lib/billing/financial-read", () => ({
  financialDb: vi.fn((client: unknown) => client),
  readFinancialEvidence: vi.fn(async () => {
    if (state.dbError) throw Error(state.dbError);
    return state.evidenceMock;
  }),
}));

const futurePaidThrough = new Date(Date.now() + 30 * 86400000).toISOString();

vi.mock("@/lib/billing/financial-truth", () => ({
  qualifyFinancialOrder: vi.fn((_companyId: string, order: Record<string, unknown>) => {
    const isLive = order.environment === "live";
    const isCollected = order.status === "paid";
    return {
      collectionProven: isCollected,
      state: isCollected ? "proven" : "unpaid",
      environment: isLive ? "live" : "test",
      collectedAt: isCollected ? (order.collected_at as string ?? "2026-10-01T10:00:00Z") : null,
      paidThrough: isCollected ? futurePaidThrough : null,
    };
  }),
}));

describe("Stage F — Module 12: Financial Analytics Contracts & Actions", () => {
  beforeEach(() => {
    state.gateResult = { ok: true, actor: { userId: "owner-123", email: "velorahelperai@gmail.com" } };
    state.clientAvailable = true;
    state.dbError = null;
    state.ordersMock = [
      { id: "ord-1", company_id: "comp-1", plan_version_id: "pv-1", amount_baisa: 45000, environment: "live", status: "paid", collected_at: "2026-10-01T10:00:00Z" },
      { id: "ord-2", company_id: "comp-2", plan_version_id: "pv-2", amount_baisa: 90000, environment: "live", status: "paid", collected_at: "2026-10-05T12:00:00Z" },
      { id: "ord-3", company_id: "comp-3", plan_version_id: "pv-1", amount_baisa: 15000, environment: "test", status: "paid", collected_at: "2026-10-10T14:00:00Z" },
    ];
    state.subscriptionsMock = [
      { id: "sub-1", company_id: "comp-1", status: "active", plan_version_id: "pv-1", paid_through: futurePaidThrough },
      { id: "sub-2", company_id: "comp-2", status: "active", plan_version_id: "pv-2", paid_through: futurePaidThrough },
    ];
    state.plansMock = [
      { id: "plan-1", name: "نورا - الدعم الأساسي", code: "level_1_basic" },
      { id: "plan-2", name: "نورا - الدعم المتقدم", code: "level_1_premium" },
    ];
    state.versionsMock = [
      { id: "pv-1", plan_id: "plan-1", currency: "OMR", amount_baisa: 45000, period_unit: "month", period_count: 1 },
      { id: "pv-2", plan_id: "plan-2", currency: "OMR", amount_baisa: 90000, period_unit: "month", period_count: 1 },
    ];
    state.evidenceMock = [];
  });

  it("permits authoritative platform owner and denies non-owner or unauthenticated requests", async () => {
    const resOwner = await adminGetFinancialAnalytics();
    expect(resOwner.ok).toBe(true);

    state.gateResult = { ok: false, code: "forbidden" };
    const resForbidden = await adminGetFinancialAnalytics();
    expect(resForbidden.ok).toBe(false);
    if (!resForbidden.ok) {
      expect(resForbidden.code).toBe("FORBIDDEN");
    }
  });

  it("calculates gross realized revenue and active tenant counts correctly", async () => {
    const res = await adminGetFinancialAnalytics();
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 45,000 + 90,000 = 135,000 Baisa = 135.000 OMR
      expect(res.data.kpis.grossRealizedBaisa).toBe(135000);
      expect(res.data.kpis.grossRealizedOmr).toBe("135.000 OMR");
      expect(res.data.kpis.activeSubscribedTenants).toBe(2);
      expect(res.data.kpis.gatewayMode).toBe("TEST_MODE_GUARDED");
    }
  });

  it("handles database / client unavailability gracefully", async () => {
    state.clientAvailable = false;
    const res = await adminGetFinancialAnalytics();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAVAILABLE");
    }
  });
});
