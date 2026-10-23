import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminGetAuditLogsOverview } from "./audit-actions";

const state = vi.hoisted(() => ({
  authContext: null as { ok: boolean; code?: string; context?: { userId: string } } | null,
  auditLogsMock: [] as Record<string, unknown>[],
  companiesMock: [] as Record<string, unknown>[],
  dbError: null as string | null,
}));

vi.mock("@/lib/tenancy/access", () => ({
  requirePlatformOwner: vi.fn(async () => {
    return state.authContext ?? { ok: true, context: { userId: "owner-123" } };
  }),
}));

interface AuditQueryBuilder {
  ilike: (col: string, val: string) => AuditQueryBuilder;
  eq: (col: string, val: unknown) => AuditQueryBuilder;
  filter: (col: string, op: string, pattern: string) => AuditQueryBuilder;
  not: (col: string, op: string, pattern: string) => AuditQueryBuilder;
  or: (conditions: string) => AuditQueryBuilder;
  order: () => AuditQueryBuilder;
  gte: (col: string, val: string) => AuditQueryBuilder;
  range: (from: number, to: number) => { data: unknown[] | null; error: { message: string } | null; count: number | null };
  then: (resolve: (val: { data: unknown[] | null; error: { message: string } | null; count: number | null }) => void) => void;
}

interface CompanyQueryBuilder {
  in: (col: string, vals: string[]) => { data: Record<string, unknown>[]; error: null };
  ilike: (col: string, val: string) => { limit: () => Promise<{ data: Record<string, unknown>[]; error: null; count: number }> };
  then: (resolve: (val: { data: Record<string, unknown>[]; error: null }) => void) => void;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
            let filtered = [...state.auditLogsMock];
            const builder: AuditQueryBuilder = {
              ilike: (col: string, val: string) => {
                const term = val.replace(/%/g, "").replace(/\\/g, "").toLowerCase();
                filtered = filtered.filter((item) => String(item[col] ?? "").toLowerCase().includes(term));
                return builder;
              },
              eq: (col: string, val: unknown) => {
                filtered = filtered.filter((item) => item[col] === val);
                return builder;
              },
              filter: (col: string, _op: string, pattern: string) => {
                const reg = new RegExp(pattern, "i");
                filtered = filtered.filter((item) => reg.test(String(item[col] ?? "")));
                return builder;
              },
              not: (col: string, _op: string, pattern: string) => {
                const reg = new RegExp(pattern, "i");
                filtered = filtered.filter((item) => !reg.test(String(item[col] ?? "")));
                return builder;
              },
              or: (conditions: string) => {
                if (conditions.includes("company_id.in.")) {
                  const match = conditions.match(/company_id\.in\.\(([^)]+)\)/);
                  if (match) {
                    const allowedIds = match[1].split(",");
                    filtered = filtered.filter((item) => allowedIds.includes(String(item.company_id)));
                  }
                }
                return builder;
              },
              order: () => builder,
              gte: (col: string, val: string) => {
                filtered = filtered.filter((item) => String(item[col] ?? "") >= val);
                return builder;
              },
              range: (from: number, to: number) => {
                if (state.dbError) {
                  return { data: null, error: { message: state.dbError }, count: null };
                }
                const sliced = filtered.slice(from, to + 1);
                return { data: sliced, error: null, count: filtered.length };
              },
              then: (resolve) => {
                if (state.dbError) {
                  return resolve({ data: null, error: { message: state.dbError }, count: null });
                }
                return resolve({ data: opts?.head ? [] : filtered, error: null, count: filtered.length });
              },
            };
            return builder;
          },
        };
      }
      if (table === "companies") {
        return {
          select: () => {
            const builder: CompanyQueryBuilder = {
              in: (col: string, vals: string[]) => ({
                data: state.companiesMock.filter((c) => vals.includes(String(c[col]))),
                error: null,
              }),
              ilike: (col: string, val: string) => {
                const term = val.replace(/%/g, "").toLowerCase();
                const matched = state.companiesMock.filter((c) => String(c[col] ?? "").toLowerCase().includes(term));
                return {
                  limit: async () => ({ data: matched, error: null, count: matched.length }),
                };
              },
              then: (resolve) => resolve({ data: state.companiesMock, error: null }),
            };
            return builder;
          },
        };
      }
      return {
        select: () => ({ data: [], error: null }),
      };
    },
  })),
}));

describe("Stage E — Module 11: Audit Contracts & Actions", () => {
  beforeEach(() => {
    state.authContext = null;
    state.dbError = null;
    state.companiesMock = [
      { id: "comp-1", display_name: "Oman Roastery" },
      { id: "comp-2", display_name: "Muscat Perfumes" },
    ];
    state.auditLogsMock = [
      {
        id: "log-1",
        actor_user_id: "owner-123",
        company_id: "comp-1",
        action: "security.role_grant",
        before_data: { role: "member" },
        after_data: { role: "admin" },
        created_at: new Date().toISOString(),
      },
      {
        id: "log-2",
        actor_user_id: "owner-123",
        company_id: "comp-1",
        action: "support_ticket.created",
        before_data: null,
        after_data: { ticket_id: "tck-101" },
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "log-3",
        actor_user_id: "owner-123",
        company_id: "comp-2",
        action: "billing.settlement_confirmed",
        before_data: { status: "pending" },
        after_data: { status: "settled" },
        created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
      },
    ];
  });

  it("denies access if platform owner validation fails", async () => {
    state.authContext = { ok: false, code: "UNAUTHENTICATED" };
    const res = await adminGetAuditLogsOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAUTHENTICATED");
    }

    state.authContext = { ok: false, code: "FORBIDDEN" };
    const res2 = await adminGetAuditLogsOverview();
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.code).toBe("FORBIDDEN");
    }
  });

  it("returns overview with parsed categories, joined company names, and KPIs", async () => {
    const res = await adminGetAuditLogsOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.kpis.totalLogsCount).toBe(3);
      expect(res.data.kpis.recent24hCount).toBe(2); // log-1 and log-2 are within 24h
      expect(res.data.kpis.immutabilityGate).toBe("UNKNOWN");
      expect(res.data.kpis.retentionPolicy).toBe("UNCONFIGURED");
      expect(res.data.logs).toHaveLength(3);

      const log1 = res.data.logs.find((l) => l.id === "log-1");
      expect(log1).toBeDefined();
      expect(log1?.category).toBe("security");
      expect(log1?.companyName).toBe("Oman Roastery");
      expect(log1?.actorEmail).toBe("velorahelperai@gmail.com");

      const log2 = res.data.logs.find((l) => l.id === "log-2");
      expect(log2?.category).toBe("support");

      const log3 = res.data.logs.find((l) => l.id === "log-3");
      expect(log3?.category).toBe("billing");
      expect(log3?.companyName).toBe("Muscat Perfumes");
    }
  });

  it("filters audit records by category", async () => {
    const res = await adminGetAuditLogsOverview({ category: "support" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.logs).toHaveLength(1);
      expect(res.data.logs[0].action).toBe("support_ticket.created");
    }
  });

  it("filters audit records by action and search text", async () => {
    const res = await adminGetAuditLogsOverview({ action: "security.role_grant" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.logs).toHaveLength(1);
      expect(res.data.logs[0].id).toBe("log-1");
    }

    const searchRes = await adminGetAuditLogsOverview({ search: "Muscat" });
    expect(searchRes.ok).toBe(true);
    if (searchRes.ok) {
      expect(searchRes.data.logs).toHaveLength(1);
      expect(searchRes.data.logs[0].id).toBe("log-3");
    }
  });

  it("redacts sensitive data like passwords, tokens, and secret keys in audit payloads", async () => {
    state.auditLogsMock = [
      {
        id: "log-sec-sensitive",
        actor_user_id: "owner-123",
        company_id: "comp-1",
        action: "security.user_password_reset",
        before_data: { password: randomUUID(), token: randomUUID(), nested: { api_key: randomUUID() } },
        after_data: { status: "reset_done" },
        created_at: new Date().toISOString(),
      },
    ];

    const res = await adminGetAuditLogsOverview();
    expect(res.ok).toBe(true);
    if (res.ok) {
      const entry = res.data.logs[0];
      expect(entry.beforeData?.password).toBe("[REDACTED]");
      expect(entry.beforeData?.token).toBe("[REDACTED]");
      const nested = entry.beforeData?.nested as Record<string, unknown>;
      expect(nested?.api_key).toBe("[REDACTED]");
    }
  });

  it("handles database query failure gracefully", async () => {
    state.dbError = "connection timeout to replica";
    const res = await adminGetAuditLogsOverview();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAVAILABLE");
      expect(res.message).toBeDefined();
    }
  });
});
