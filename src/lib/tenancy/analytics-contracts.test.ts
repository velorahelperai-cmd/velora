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
  onQueryPage: null as ((tableCallCount: number, table: string) => void) | null,
}));

vi.mock("@/lib/billing/admin/owner-gate", () => ({
  billingOwnerGate: vi.fn(async () => state.gateResult),
  recheckBillingOwner: vi.fn(async () => state.gateResult),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    if (!state.clientAvailable) return null;
    const tableCallCounts: Record<string, number> = {};
    return {
      from: (table: string) => {
        let gtVal: string | null = null;
        let lteVal: string | null = null;
        let orderCol: string | null = null;
        let isAscending = true;
        let rangeFrom = 0;
        let rangeTo = 99999;

        const getSourceData = () => {
          if (table === "billing_orders") return state.ordersMock;
          if (table === "billing_subscriptions") return state.subscriptionsMock;
          if (table === "billing_plans") return state.plansMock;
          if (table === "billing_plan_versions") return state.versionsMock;
          return [];
        };

        const execute = () => {
          if (state.dbError) return { data: null, error: { message: state.dbError } };
          tableCallCounts[table] = (tableCallCounts[table] ?? 0) + 1;
          if (state.onQueryPage) {
            state.onQueryPage(tableCallCounts[table], table);
          }
          let rows = [...getSourceData()];
          if (gtVal !== null) {
            rows = rows.filter((r) => String(r.id) > (gtVal as string));
          }
          if (lteVal !== null) {
            rows = rows.filter((r) => String(r.id) <= (lteVal as string));
          }
          if (orderCol) {
            rows.sort((a, b) => {
              const aVal = String(a[orderCol as string] ?? "");
              const bVal = String(b[orderCol as string] ?? "");
              return isAscending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            });
          }
          const sliced = rows.slice(rangeFrom, rangeTo + 1);
          return { data: sliced, error: null };
        };

        const builder: Record<string, unknown> = {
          select: () => builder,
          order: (col: string, options?: { ascending: boolean }) => {
            orderCol = col;
            isAscending = options?.ascending !== false;
            return builder;
          },
          gt: (_col: string, val: string) => {
            gtVal = String(val);
            return builder;
          },
          lte: (_col: string, val: string) => {
            lteVal = String(val);
            return builder;
          },
          range: (from: number, to: number) => {
            rangeFrom = from;
            rangeTo = to;
            return builder;
          },
          then: (resolve: (val: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            try {
              return Promise.resolve(resolve(execute()));
            } catch (err) {
              if (reject) return Promise.resolve(reject(err));
              throw err;
            }
          },
        };

        return builder;
      },
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
      collectedAt: isCollected ? ((order.collected_at as string) ?? "2026-10-01T10:00:00Z") : null,
      paidThrough: isCollected ? futurePaidThrough : null,
    };
  }),
}));

describe("Stage F — Module 12: Financial Analytics Contracts & Actions", () => {
  beforeEach(() => {
    state.gateResult = { ok: true, actor: { userId: "owner-123", email: "velorahelperai@gmail.com" } };
    state.clientAvailable = true;
    state.dbError = null;
    state.onQueryPage = null;
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

  describe("CLN-03 — Keyset pagination stability, uniqueness, and completeness", () => {
    it("aggregates exact total for 250 synthetic paid orders without pagination overflow", async () => {
      // 250 orders, each 9,000 baisa -> 2,250,000 baisa (2,250.000 OMR)
      state.ordersMock = Array.from({ length: 250 }, (_, i) => ({
        id: `ord-${String(i + 1).padStart(4, "0")}`,
        company_id: `comp-${i + 1}`,
        plan_version_id: "pv-1",
        amount_baisa: 9000,
        environment: "live",
        status: "paid",
        collected_at: "2026-10-01T10:00:00Z",
      }));

      const res = await adminGetFinancialAnalytics();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.kpis.grossRealizedBaisa).toBe(2250000);
        expect(res.data.kpis.grossRealizedOmr).toBe("2250.000 OMR");
      }
    });

    it("prevents duplication when a row is inserted before cursor between pages (reproduction fix)", async () => {
      // 251 orders: ord-0001 to ord-0251
      state.ordersMock = Array.from({ length: 251 }, (_, i) => ({
        id: `ord-${String(i + 1).padStart(4, "0")}`,
        company_id: `comp-${i + 1}`,
        plan_version_id: "pv-1",
        amount_baisa: 9000,
        environment: "live",
        status: "paid",
        collected_at: "2026-10-01T10:00:00Z",
      }));

      // In billing_orders:
      // Call 1 = boundary query (returns ord-0251 as capturedMaxId)
      // Call 2 = page 1 data query (fetching first 250 rows: ord-0001 to ord-0250)
      // Call 3 = page 2 data query (fetching remaining rows: ord-0251)
      // On call 2 (while reading page 1), simulate concurrent insertion of an earlier unpaid row:
      let inserted = false;
      state.onQueryPage = (tableCallCount, table) => {
        if (table === "billing_orders" && tableCallCount === 2 && !inserted) {
          inserted = true;
          state.ordersMock.unshift({
            id: "ord-0000-earlier-unpaid",
            company_id: "comp-new",
            plan_version_id: "pv-1",
            amount_baisa: 9000,
            environment: "live",
            status: "unpaid",
            collected_at: null,
          });
        }
      };

      const res = await adminGetFinancialAnalytics();
      expect(res.ok).toBe(true);
      if (res.ok) {
        // 251 orders * 9,000 = 2,259,000 baisa.
        // It must NOT duplicate ord-0250 (which produced 2,268,000 baisa in buggy offset pagination).
        expect(res.data.kpis.grossRealizedBaisa).toBe(2259000);
        expect(res.data.kpis.grossRealizedOmr).toBe("2259.000 OMR");
      }
    });

    it("ignores newly inserted rows beyond capturedMaxId boundary to maintain snapshot integrity", async () => {
      // 250 orders: ord-0001 to ord-0250
      state.ordersMock = Array.from({ length: 250 }, (_, i) => ({
        id: `ord-${String(i + 1).padStart(4, "0")}`,
        company_id: `comp-${i + 1}`,
        plan_version_id: "pv-1",
        amount_baisa: 9000,
        environment: "live",
        status: "paid",
        collected_at: "2026-10-01T10:00:00Z",
      }));

      // Call 1 = boundary query (captures capturedMaxId = ord-0250)
      // On call 2 (data page query), simulate concurrent insertion of a new order ord-9999
      let injected = false;
      state.onQueryPage = (tableCallCount, table) => {
        if (table === "billing_orders" && tableCallCount === 2 && !injected) {
          injected = true;
          state.ordersMock.push({
            id: "ord-9999-newly-appended",
            company_id: "comp-later",
            plan_version_id: "pv-1",
            amount_baisa: 9000,
            environment: "live",
            status: "paid",
            collected_at: "2026-10-01T10:00:00Z",
          });
        }
      };

      const res = await adminGetFinancialAnalytics();
      expect(res.ok).toBe(true);
      if (res.ok) {
        // Total remains strictly 2,250,000 (captured snapshot), ord-9999 is bounded out by lte(capturedMaxId)
        expect(res.data.kpis.grossRealizedBaisa).toBe(2250000);
      }
    });

    it("fails closed with UNAVAILABLE if snapshot becomes incomplete due to concurrent row deletion", async () => {
      // 251 orders
      state.ordersMock = Array.from({ length: 251 }, (_, i) => ({
        id: `ord-${String(i + 1).padStart(4, "0")}`,
        company_id: `comp-${i + 1}`,
        plan_version_id: "pv-1",
        amount_baisa: 9000,
        environment: "live",
        status: "paid",
        collected_at: "2026-10-01T10:00:00Z",
      }));

      // Call 1 = boundary query (captures capturedMaxId = "ord-0251")
      // Call 2 = page 1 data query (fetches ord-0001 to ord-0250)
      // Right before Call 3 (page 2), ord-0251 is deleted from the table!
      state.onQueryPage = (tableCallCount, table) => {
        if (table === "billing_orders" && tableCallCount === 2) {
          // Delete ord-0251 from the table
          state.ordersMock = state.ordersMock.filter((r) => r.id !== "ord-0251");
        }
      };

      const res = await adminGetFinancialAnalytics();
      // Must fail closed with UNAVAILABLE rather than returning an undercounted / corrupted total
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("UNAVAILABLE");
      }
    });

    it("fails closed with UNAVAILABLE if duplicate row IDs appear", async () => {
      state.ordersMock = [
        { id: "ord-1", company_id: "comp-1", plan_version_id: "pv-1", amount_baisa: 45000, environment: "live", status: "paid", collected_at: "2026-10-01T10:00:00Z" },
        { id: "ord-1", company_id: "comp-1", plan_version_id: "pv-1", amount_baisa: 45000, environment: "live", status: "paid", collected_at: "2026-10-01T10:00:00Z" },
      ];

      const res = await adminGetFinancialAnalytics();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("UNAVAILABLE");
      }
    });

    it("returns consistent exact total for stable 252 orders across multiple pages", async () => {
      // 252 orders: ord-0001 to ord-0252 (252 * 9000 = 2,268,000 baisa)
      state.ordersMock = Array.from({ length: 252 }, (_, i) => ({
        id: `ord-${String(i + 1).padStart(4, "0")}`,
        company_id: `comp-${i + 1}`,
        plan_version_id: "pv-1",
        amount_baisa: 9000,
        environment: "live",
        status: "paid",
        collected_at: "2026-10-01T10:00:00Z",
      }));

      const res = await adminGetFinancialAnalytics();
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.kpis.grossRealizedBaisa).toBe(2268000);
        expect(res.data.kpis.grossRealizedOmr).toBe("2268.000 OMR");
      }
    });

    it("R4 acceptance: fails closed with UNAVAILABLE when two orders are inserted concurrently across cursor boundary (252 -> 254 orders)", async () => {
      // 252 initial orders: ord-0001 to ord-0252
      state.ordersMock = Array.from({ length: 252 }, (_, i) => ({
        id: `ord-${String(i + 1).padStart(4, "0")}`,
        company_id: `comp-${i + 1}`,
        plan_version_id: "pv-1",
        amount_baisa: 9000,
        environment: "live",
        status: "paid",
        collected_at: "2026-10-01T10:00:00Z",
      }));

      // Call 1 = boundary query (captures capturedMaxId = "ord-0252")
      // Call 2 = page 1 data query (reads ord-0001 to ord-0250)
      // Call 3 = page 1 consistency check
      // Between call 2 and call 4 (between the two data pages), insert 2 new orders:
      // - One before cursor: id = "ord-0100-concurrent" (< ord-0250)
      // - One after cursor and under capturedMaxId: id = "ord-0251-concurrent" (> ord-0250 && <= ord-0252)
      let injected = false;
      state.onQueryPage = (tableCallCount, table) => {
        if (table === "billing_orders" && tableCallCount === 3 && !injected) {
          injected = true;
          state.ordersMock.push(
            {
              id: "ord-0100-concurrent",
              company_id: "comp-conc-1",
              plan_version_id: "pv-1",
              amount_baisa: 9000,
              environment: "live",
              status: "paid",
              collected_at: "2026-10-01T10:00:00Z",
            },
            {
              id: "ord-0251-concurrent",
              company_id: "comp-conc-2",
              plan_version_id: "pv-1",
              amount_baisa: 9000,
              environment: "live",
              status: "paid",
              collected_at: "2026-10-01T10:00:00Z",
            }
          );
        }
      };

      const res = await adminGetFinancialAnalytics();
      // Must NOT return { ok: true } with partial/mixed 253 orders (2,277,000 baisa).
      // It MUST fail closed with UNAVAILABLE because consistency cannot be proven across pages.
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("UNAVAILABLE");
      }
    });
  });
});
