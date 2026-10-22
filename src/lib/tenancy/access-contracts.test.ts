import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminGetPlatformAccessOverview,
  adminGrantPlatformAdminRole,
  adminRevokePlatformAdmin,
  adminToggleAdminStatus,
  adminUpdatePlatformAdminRole,
} from "./access-actions";
import { requirePlatformRole } from "./access-guards";
import type { PlatformRole } from "./access-types";

interface MockAuthUser {
  id: string;
  email: string;
  email_confirmed_at: string;
}

const state = vi.hoisted(() => ({
  authContext: null as { ok: boolean; code?: string; context?: { userId: string } } | null,
  appSessionOk: true,
  authUser: { id: "owner-123", email: "velorahelperai@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z" } as MockAuthUser,
  platformAdminsMock: [] as Record<string, unknown>[],
  profilesMock: [] as Record<string, unknown>[],
  scopesMock: [] as Record<string, unknown>[],
  auditLogsMock: [] as Record<string, unknown>[],
  dbError: null as string | null,
}));

vi.mock("@/lib/auth/session-guard", () => ({
  checkAppSession: vi.fn(async () => {
    return state.appSessionOk ? { ok: true, session: { id: "session-xyz" } } : { ok: false, code: "UNAUTHENTICATED" };
  }),
}));

vi.mock("@/lib/tenancy/access", () => ({
  requirePlatformOwner: vi.fn(async () => {
    return state.authContext ?? { ok: true, context: { userId: "owner-123" } };
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.authUser },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => {
              const row = state.platformAdminsMock.find((r) => r.user_id === val);
              return {
                maybeSingle: async () => ({ data: row ?? null, error: state.dbError ? { message: state.dbError } : null }),
              };
            },
            in: () => ({ data: state.platformAdminsMock, error: null }),
            data: state.platformAdminsMock,
            error: state.dbError ? { message: state.dbError } : null,
          }),
          upsert: async (payload: Record<string, unknown>) => {
            const idx = state.platformAdminsMock.findIndex((r) => r.user_id === payload.user_id);
            if (idx >= 0) {
              state.platformAdminsMock[idx] = { ...state.platformAdminsMock[idx], ...payload };
            } else {
              state.platformAdminsMock.push(payload);
            }
            return { error: null };
          },
          update: (payload: Record<string, unknown>) => ({
            eq: async (_col: string, val: unknown) => {
              const row = state.platformAdminsMock.find((r) => r.user_id === val);
              if (row) Object.assign(row, payload);
              return { error: null };
            },
          }),
          delete: () => ({
            eq: async (_col: string, val: unknown) => {
              state.platformAdminsMock = state.platformAdminsMock.filter((r) => r.user_id !== val);
              return { error: null };
            },
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => {
              const row = state.profilesMock.find((r) => r.user_id === val);
              return { maybeSingle: async () => ({ data: row ?? null, error: null }) };
            },
            in: () => ({ data: state.profilesMock, error: null }),
          }),
        };
      }
      if (table === "platform_admin_scopes") {
        return {
          select: () => ({
            in: () => ({ data: state.scopesMock, error: null }),
          }),
          upsert: async (payload: Record<string, unknown>) => {
            state.scopesMock.push(payload);
            return { error: null };
          },
          delete: () => ({
            eq: async (_col: string, val: unknown) => {
              state.scopesMock = state.scopesMock.filter((s) => s.admin_user_id !== val);
              return { error: null };
            },
          }),
        };
      }
      if (table === "admin_audit_logs") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            state.auditLogsMock.push(payload);
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

describe("Stage E — Module 10: Access Control & Platform Teams Contracts", () => {
  beforeEach(() => {
    state.authContext = null;
    state.appSessionOk = true;
    state.dbError = null;
    state.authUser = { id: "owner-123", email: "velorahelperai@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
    state.platformAdminsMock = [
      { user_id: "owner-123", role: "owner", status: "active", granted_at: "2026-10-01T00:00:00Z", note: "Authoritative owner" },
      { user_id: "staff-support", role: "support", status: "active", granted_at: "2026-10-15T00:00:00Z", note: "Support team lead" },
      { user_id: "staff-finance", role: "finance", status: "active", granted_at: "2026-10-16T00:00:00Z", note: "Finance auditor" },
    ];
    state.profilesMock = [
      { user_id: "owner-123", full_name: "Platform Owner", support_code: "VEL-OWNER-001" },
      { user_id: "staff-support", full_name: "Salim Support", support_code: "VEL-SUPP-002" },
      { user_id: "staff-finance", full_name: "Fatima Finance", support_code: "VEL-FIN-003" },
      { user_id: "candidate-ops", full_name: "Nasser Ops", support_code: "VEL-OPS-004" },
    ];
    state.scopesMock = [
      { admin_user_id: "staff-support", usable_capabilities: ["platform.search_accounts", "support.tickets.manage"] },
      { admin_user_id: "staff-finance", usable_capabilities: ["billing.ledger.read", "financial.reconcile"] },
    ];
    state.auditLogsMock = [];
  });

  it("denies access to overview if caller is not the platform owner", async () => {
    state.authContext = { ok: false, code: "FORBIDDEN" };
    const res = await adminGetPlatformAccessOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("returns overview with owner, delegated staff, and isolation KPIs", async () => {
    const res = await adminGetPlatformAccessOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.owner.email).toBe("velorahelperai@gmail.com");
      expect(res.data.kpis.totalAdminsCount).toBe(3);
      expect(res.data.kpis.activeAdminsCount).toBe(3);
      expect(res.data.kpis.escalationProtection).toBe("LOCKED");
      expect(res.data.kpis.sessionRevocationPolicy).toBe("IMMEDIATE");
      expect(res.data.delegatedAdmins).toHaveLength(2);

      const supportAdmin = res.data.delegatedAdmins.find((a) => a.userId === "staff-support");
      expect(supportAdmin).toBeDefined();
      expect(supportAdmin?.role).toBe("support");
      expect(supportAdmin?.fullName).toBe("Salim Support");
      expect(supportAdmin?.allowedCapabilities).toContain("support.tickets.manage");
    }
  });

  it("prevents privilege escalation: cannot grant or escalate to owner role", async () => {
    const res = await adminGrantPlatformAdminRole({
      userId: "candidate-ops",
      role: "owner" as unknown as Exclude<PlatformRole, "owner">,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
      expect(res.message).toContain("strictly forbidden");
    }
  });

  it("grants a delegated role and logs to admin_audit_logs", async () => {
    const res = await adminGrantPlatformAdminRole({
      userId: "candidate-ops",
      role: "operations",
      note: "Operations monitoring lead",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.userId).toBe("candidate-ops");
      expect(res.data.role).toBe("operations");
      expect(state.auditLogsMock).toHaveLength(1);
      expect(state.auditLogsMock[0].action).toBe("access.platform_role_granted");
    }
  });

  it("updates an existing delegated admin role and note", async () => {
    const res = await adminUpdatePlatformAdminRole({
      userId: "staff-support",
      role: "operations",
      status: "active",
      note: "Promoted to Operations Supervisor",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.role).toBe("operations");
      const updated = state.platformAdminsMock.find((r) => r.user_id === "staff-support");
      expect(updated?.role).toBe("operations");
      expect(updated?.note).toBe("Promoted to Operations Supervisor");
      expect(state.auditLogsMock[0].action).toBe("access.platform_role_updated");
    }
  });

  it("suspends admin and enforces immediate session revocation via status check", async () => {
    // 1. Suspend support admin
    const suspendRes = await adminToggleAdminStatus("staff-support", "disabled");
    expect(suspendRes.ok).toBe(true);

    const suspended = state.platformAdminsMock.find((r) => r.user_id === "staff-support");
    expect(suspended?.status).toBe("disabled");
    expect(state.auditLogsMock[0].action).toBe("access.platform_role_suspended");

    // 2. Test requirePlatformRole for this user
    state.authUser = { id: "staff-support", email: "support@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const guardRes = await requirePlatformRole(["support"]);
    expect(guardRes.ok).toBe(false);
    if (!guardRes.ok) {
      expect(guardRes.code).toBe("FORBIDDEN");
      expect(guardRes.message).toContain("revoked or suspended");
    }
  });

  it("prevents unauthorized financial access for support and operations roles", async () => {
    // Test support admin attempting financial action
    state.authUser = { id: "staff-support", email: "support@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const guardRes = await requirePlatformRole(["owner", "finance"]);
    expect(guardRes.ok).toBe(false);
    if (!guardRes.ok) {
      expect(guardRes.code).toBe("FORBIDDEN");
      expect(guardRes.message).toContain("not permitted");
    }

    // Test finance admin attempting financial action -> PASS
    state.authUser = { id: "staff-finance", email: "finance@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const financeRes = await requirePlatformRole(["owner", "finance"]);
    expect(financeRes.ok).toBe(true);
  });

  it("revokes delegated admin and deletes scopes", async () => {
    const res = await adminRevokePlatformAdmin("staff-support");
    expect(res.ok).toBe(true);

    const exists = state.platformAdminsMock.some((r) => r.user_id === "staff-support");
    expect(exists).toBe(false);
    expect(state.scopesMock.some((s) => s.admin_user_id === "staff-support")).toBe(false);
    expect(state.auditLogsMock[0].action).toBe("access.platform_role_revoked");
  });

  it("strictly prevents modifying or revoking the platform owner", async () => {
    const revokeOwnerRes = await adminRevokePlatformAdmin("owner-123");
    expect(revokeOwnerRes.ok).toBe(false);
    if (!revokeOwnerRes.ok) {
      expect(revokeOwnerRes.code).toBe("FORBIDDEN");
      expect(revokeOwnerRes.message).toContain("Cannot revoke platform owner");
    }

    const suspendOwnerRes = await adminToggleAdminStatus("owner-123", "disabled");
    expect(suspendOwnerRes.ok).toBe(false);
    if (!suspendOwnerRes.ok) {
      expect(suspendOwnerRes.code).toBe("FORBIDDEN");
      expect(suspendOwnerRes.message).toContain("Cannot suspend platform owner");
    }
  });
});
