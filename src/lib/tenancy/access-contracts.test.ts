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
            eq: (_col: string, val: unknown) => {
              const rows = state.scopesMock.filter((s) => s.admin_user_id === val);
              const builder = {
                data: rows,
                error: null,
                eq: (_col2: string, val2: unknown) => {
                  const filtered = rows.filter((s) => s.company_id === val2);
                  return Promise.resolve({ data: filtered, error: null });
                },
                then: (resolve: (val: unknown) => void) => resolve({ data: rows, error: null }),
              };
              return builder;
            },
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

  // --- Dedicated Security Verification: Negative Tests & Isolation ---
  it("negative test 1: writing the word operations inside note does not grant authorization", async () => {
    // Admin has note containing 'operations', but NO operations capability in scopes
    state.platformAdminsMock.push({
      user_id: "fake-ops-note-user",
      role: "delegated",
      status: "active",
      note: "Senior operations lead / operations manager",
    });
    state.scopesMock.push({
      admin_user_id: "fake-ops-note-user",
      company_id: "company-111",
      usable_capabilities: ["support.tickets.manage"],
    });

    state.authUser = { id: "fake-ops-note-user", email: "fake@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const res = await requirePlatformRole(["operations"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("negative test 2: delegation for Company A does not expose Company B data (cross-tenant isolation)", async () => {
    state.platformAdminsMock.push({
      user_id: "scoped-admin-1",
      role: "delegated",
      status: "active",
      note: "Branch manager for Company A",
    });
    state.scopesMock.push({
      admin_user_id: "scoped-admin-1",
      company_id: "company-A",
      usable_capabilities: ["support.tickets.manage"],
    });

    state.authUser = { id: "scoped-admin-1", email: "scoped@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    // Accessing Company A -> PASS
    const scopeARes = await requirePlatformRole(["support"], "company-A");
    expect(scopeARes.ok).toBe(true);

    // Accessing Company B -> DENIED (Cross-tenant leak strictly blocked)
    const scopeBRes = await requirePlatformRole(["support"], "company-B");
    expect(scopeBRes.ok).toBe(false);
    if (!scopeBRes.ok) {
      expect(scopeBRes.code).toBe("FORBIDDEN");
    }
  });

  it("negative test 3: revoking or suspending delegation blocks access immediately", async () => {
    state.platformAdminsMock.push({
      user_id: "revocable-admin",
      role: "delegated",
      status: "active",
      note: "Active staff",
    });
    state.scopesMock.push({
      admin_user_id: "revocable-admin",
      company_id: "company-A",
      usable_capabilities: ["support.tickets.manage"],
    });

    state.authUser = { id: "revocable-admin", email: "rev@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    expect((await requirePlatformRole(["support"], "company-A")).ok).toBe(true);

    // Suspend admin
    const admin = state.platformAdminsMock.find((r) => r.user_id === "revocable-admin");
    if (admin) admin.status = "disabled";

    const suspendedRes = await requirePlatformRole(["support"], "company-A");
    expect(suspendedRes.ok).toBe(false);
    if (!suspendedRes.ok) {
      expect(suspendedRes.code).toBe("FORBIDDEN");
      expect(suspendedRes.message).toContain("revoked or suspended");
    }
  });

  it("negative test 4: support or finance role does not gain unauthorized operations or data", async () => {
    // Support admin attempting operations
    state.authUser = { id: "staff-support", email: "support@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const opsRes = await requirePlatformRole(["operations"]);
    expect(opsRes.ok).toBe(false);
    if (!opsRes.ok) expect(opsRes.code).toBe("FORBIDDEN");

    // Finance admin attempting operations
    state.authUser = { id: "staff-finance", email: "finance@velora.internal", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const opsRes2 = await requirePlatformRole(["operations"]);
    expect(opsRes2.ok).toBe(false);
    if (!opsRes2.ok) expect(opsRes2.code).toBe("FORBIDDEN");
  });

  it("negative test 5: platform owner retains approved sovereign authority", async () => {
    state.authUser = { id: "owner-123", email: "velorahelperai@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
    const ownerRes = await requirePlatformRole(["owner"]);
    expect(ownerRes.ok).toBe(true);
    if (ownerRes.ok) {
      expect(ownerRes.role).toBe("owner");
      expect(ownerRes.email).toBe("velorahelperai@gmail.com");
    }
  });
});
