import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminGetPlatformHealthOverview } from "./health-actions";

const state = vi.hoisted(() => ({
  roleGateResult: { ok: true, userId: "owner-123", email: "velorahelperai@gmail.com", role: "owner" } as {
    ok: boolean;
    code?: string;
    message?: string;
    userId?: string;
    email?: string;
    role?: string;
  },
  dbError: null as { message: string } | null,
  authError: null as { message: string } | null,
  budgetData: { total_budget_baisa: 100000, consumed_baisa: 14320 } as Record<string, unknown> | null,
}));

vi.mock("@/lib/tenancy/access-guards", () => ({
  requirePlatformRole: vi.fn(async (allowedRoles: string[]) => {
    if (!state.roleGateResult.ok) return state.roleGateResult;
    if (!allowedRoles.includes(state.roleGateResult.role!)) {
      return { ok: false, code: "FORBIDDEN", message: "Role not permitted" };
    }
    return state.roleGateResult;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "companies") {
        return {
          select: () => ({
            limit: async () => ({
              data: state.dbError ? null : [{ id: "comp-1" }],
              error: state.dbError,
            }),
          }),
        };
      }
      if (table === "ai_budget") {
        return {
          select: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: state.budgetData,
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          limit: () => ({ data: [], error: null }),
        }),
      };
    },
    auth: {
      getSession: async () => ({
        data: { session: null },
        error: state.authError,
      }),
    },
  })),
}));

describe("Module 14 Platform Health & Readiness Contracts", () => {
  beforeEach(() => {
    state.roleGateResult = { ok: true, userId: "owner-123", email: "velorahelperai@gmail.com", role: "owner" };
    state.dbError = null;
    state.authError = null;
    state.budgetData = { total_budget_baisa: 100000, consumed_baisa: 14320 };
  });

  it("denies access to platform health overview when unauthenticated", async () => {
    state.roleGateResult = { ok: false, code: "UNAUTHENTICATED" };

    const res = await adminGetPlatformHealthOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAUTHENTICATED");
    }
  });

  it("denies access to non-operations non-owner roles like finance or support", async () => {
    state.roleGateResult = { ok: true, role: "finance", email: "finance@velora.ai" };

    const res = await adminGetPlatformHealthOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("allows operations role to inspect platform health matrix", async () => {
    state.roleGateResult = { ok: true, role: "operations", email: "ops@velora.ai" };

    const res = await adminGetPlatformHealthOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kpis.overallStatus).toBe("DEGRADED");
      expect(res.data.kpis.paymentGatewayMode).toBe("TEST_MODE_GUARDED");
      expect(res.data.kpis.aiRouterStatus).toBe("UNKNOWN");
      expect(res.data.kpis.dbLatencyMs).toBeGreaterThanOrEqual(1);

      // Verify subsystem probes
      const probeIds = res.data.probes.map((p) => p.id);
      expect(probeIds).toContain("postgres_db");
      expect(probeIds).toContain("gotrue_auth");
      expect(probeIds).toContain("meta_wa_webhook");
      expect(probeIds).toContain("meta_ig_webhook");
      expect(probeIds).not.toContain("paymob_gateway");
      expect(res.data.probes.find(p => p.id === "payment_gateway")?.status).toBe("UNKNOWN");
      expect(probeIds).toContain("ai_router_fleet");
      expect(probeIds).toContain("storage_service");

      // Verify security invariants
      const invIds = res.data.invariants.map((i) => i.id);
      expect(invIds).toContain("inv_append_only_audit");
      expect(invIds).toContain("inv_tenant_isolation");
      expect(invIds).toContain("inv_payment_sandbox");
      expect(invIds).toContain("inv_secret_redaction");
      expect(invIds).toContain("inv_platform_owner_gate");
    }
  });

  it("marks overall status DOWN if database probe fails", async () => {
    state.dbError = { message: "connection to server at 'db.supabase.co' failed: Connection refused" };

    const res = await adminGetPlatformHealthOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kpis.overallStatus).toBe("DOWN");
      const dbProbe = res.data.probes.find((p) => p.id === "postgres_db");
      expect(dbProbe?.status).toBe("DOWN");
      expect(dbProbe?.detailsEn).toContain("Connection refused");
    }
  });
});
