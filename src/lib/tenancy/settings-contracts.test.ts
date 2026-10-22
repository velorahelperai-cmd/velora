import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminGetPlatformSettingsOverview,
  adminUpdatePlatformPolicies,
} from "./settings-actions";

const state = vi.hoisted(() => ({
  roleGateResult: { ok: true, userId: "owner-123", email: "velorahelperai@gmail.com", role: "owner" } as {
    ok: boolean;
    code?: string;
    message?: string;
    userId?: string;
    email?: string;
    role?: string;
  },
  ownerGateResult: { ok: true, role: "owner", context: { userId: "owner-123", email: "velorahelperai@gmail.com" } } as {
    ok: boolean;
    code?: string;
    role?: string;
    context?: { userId: string; email: string };
  },
  insertedAuditLogs: [] as Record<string, unknown>[],
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

vi.mock("@/lib/tenancy/access", () => ({
  requirePlatformOwner: vi.fn(async () => state.ownerGateResult),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          insert: async (data: Record<string, unknown>) => {
            state.insertedAuditLogs.push(data);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ data: [], error: null }),
      };
    },
  })),
}));

describe("Module 13 Settings & Automations Contracts", () => {
  beforeEach(() => {
    state.roleGateResult = { ok: true, userId: "owner-123", email: "velorahelperai@gmail.com", role: "owner" };
    state.ownerGateResult = { ok: true, role: "owner", context: { userId: "owner-123", email: "velorahelperai@gmail.com" } };
    state.insertedAuditLogs = [];
  });

  it("denies access to settings overview when unauthenticated", async () => {
    state.roleGateResult = { ok: false, code: "UNAUTHENTICATED" };

    const res = await adminGetPlatformSettingsOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAUTHENTICATED");
    }
  });

  it("denies access to settings overview for unauthorized roles like support or finance", async () => {
    state.roleGateResult = { ok: true, role: "support", email: "support@velora.ai" };

    const res = await adminGetPlatformSettingsOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("allows operations role to view settings overview with authoritative policies", async () => {
    state.roleGateResult = { ok: true, role: "operations", email: "ops@velora.ai" };

    const res = await adminGetPlatformSettingsOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.policies.officialContactEmail).toBe("velorahelperai@gmail.com");
      expect(res.data.policies.renewalGraceDays).toBe(3);
      expect(res.data.policies.auditRetentionPolicy).toBe("UNCONFIGURED");
      expect(res.data.policies.livePaymentGuarded).toBe(true);
      expect(res.data.kpis.livePaymentsStatus).toBe("GUARDED_DISABLED");
      expect(res.data.automations.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("rejects non-owner attempts to update platform policies", async () => {
    state.ownerGateResult = { ok: false, code: "FORBIDDEN" };

    const res = await adminUpdatePlatformPolicies({ aiBudgetAlertThresholdPercent: 85 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("validates input thresholds when updating platform policies", async () => {
    const res = await adminUpdatePlatformPolicies({ aiBudgetAlertThresholdPercent: 20 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_INPUT");
    }
  });

  it("returns UNAVAILABLE when updating policies because persistent settings storage is unconfigured", async () => {
    const res = await adminUpdatePlatformPolicies({
      aiBudgetAlertThresholdPercent: 85,
      onboardingReviewReminderHours: 72,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAVAILABLE");
      expect(res.message).toBe("PLATFORM_POLICY_STORAGE_UNCONFIGURED");
    }
  });
});
