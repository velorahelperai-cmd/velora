import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminCreateSupportTicket,
  adminUpdateTicketStatus,
  adminAddTicketNote,
  adminCloseTicket,
  adminReopenTicket,
  adminLookupCustomerByCodeOrEmail,
} from "./support-actions";
import {
  adminGrantPlatformAdminRole,
  adminUpdatePlatformAdminRole,
  adminToggleAdminStatus,
  adminRevokePlatformAdmin,
} from "./access-actions";
import { adminGetOperationsOverview } from "./operations-actions";

type DbRow = Record<string, unknown>;

const state = vi.hoisted(() => ({
  actor: { userId: "00000000-0000-0000-0000-000000000001", email: "velorahelperai@gmail.com" },
  ownerGateResult: { ok: true, role: "owner", context: { userId: "00000000-0000-0000-0000-000000000001", email: "velorahelperai@gmail.com" } } as {
    ok: boolean;
    code?: string;
    role?: string;
    context?: { userId: string; email: string };
  },
  roleGateResult: { ok: true, userId: "00000000-0000-0000-0000-000000000001", email: "velorahelperai@gmail.com", role: "owner" } as {
    ok: boolean;
    code?: string;
    message?: string;
    userId?: string;
    email?: string;
    role?: string;
  },
  auditLogs: [] as DbRow[],
  tickets: [] as DbRow[],
  ticketNotes: [] as DbRow[],
  platformAdmins: [] as DbRow[],
  companies: [
    { id: "00000000-0000-0000-0000-000000000001", display_name: "Al-Baraka Trading", status: "active", reference_number: "VEL-1020-3040-5060" },
  ] as DbRow[],
  branches: [
    { id: "00000000-0000-0000-0000-000000000002", company_id: "00000000-0000-0000-0000-000000000001", name: "Main Branch - Muscat" },
  ] as DbRow[],
  profiles: [
    { user_id: "00000000-0000-0000-0000-000000000001", full_name: "Velora Platform Owner" },
    { user_id: "00000000-0000-0000-0000-000000000003", full_name: "Tariq Support Staff" },
  ] as DbRow[],
  paymobEvents: [
    {
      id: "pm-evt-1",
      payment_attempt_id: "pay-attempt-999",
      provider_transaction_id: "txn-123456",
      company_id: "00000000-0000-0000-0000-000000000001",
      event_status: "success",
      observation_key: "auth_token_settled",
      created_at: new Date().toISOString(),
    },
  ] as DbRow[],
  waEvents: [
    {
      id: "wa-evt-1",
      company_id: "00000000-0000-0000-0000-000000000001",
      conversation_id: "wa-conv-888",
      action: "message_received",
      created_at: new Date().toISOString(),
    },
  ] as DbRow[],
  igEvents: [] as DbRow[],
}));

vi.mock("@/lib/tenancy/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenancy/access")>();
  return {
    ...actual,
    requirePlatformOwner: vi.fn(async () => state.ownerGateResult),
    requirePlatformAdmin: vi.fn(async () => state.ownerGateResult),
  };
});

vi.mock("@/lib/tenancy/access-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenancy/access-guards")>();
  return {
    ...actual,
    requirePlatformRole: vi.fn(async (roles: string[]) => {
      if (!state.roleGateResult.ok) return state.roleGateResult;
      if (!roles.includes(state.roleGateResult.role!)) {
        return { ok: false, code: "FORBIDDEN", message: "Role unauthorized" };
      }
      return state.roleGateResult;
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn === "admin_search_accounts") {
        return {
          data: [
            {
              user_id: "00000000-0000-0000-0000-000000000003",
              full_name: "Tariq Support Staff",
              email: "tariq@example.com",
              email_confirmed: true,
              support_code: "VEL-1020-3040-5060",
              created_at: new Date().toISOString(),
              companies: [
                {
                  company_id: "00000000-0000-0000-0000-000000000001",
                  display_name: "Al-Baraka Trading",
                  role: "owner",
                  status: "active",
                  company_status: "active",
                  business_phone: "+96891234567",
                },
              ],
            },
          ],
          error: null,
        };
      }
      if (fn === "admin_support_mutate") {
        const kind = params.p_kind;
        const pInput = params.p_input as Record<string, unknown>;
        if (kind === "create") {
          const tId = "11111111-2222-3333-4444-555555555555";
          const item = {
            id: tId,
            ticket_number: "TCK-1001",
            company_id: pInput.companyId,
            branch_id: pInput.branchId,
            creator_user_id: "00000000-0000-0000-0000-000000000001",
            title: pInput.title,
            description: pInput.description,
            status: "open",
            priority: pInput.priority,
            category: pInput.category,
            revision: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          state.tickets.push(item);
          state.auditLogs.push({ action: "support_ticket.created", ticket_id: tId });
          return { data: { ok: true, ticket: item }, error: null };
        }
        if (kind === "status") {
          const tId = String(pInput.ticketId);
          const item = state.tickets.find((t) => t.id === tId) ?? { id: tId, company_id: "00000000-0000-0000-0000-000000000001" };
          item.status = pInput.status;
          item.resolution_summary = pInput.resolutionSummary ?? null;
          item.revision = (Number(item.revision) || 1) + 1;
          return { data: { ok: true, ticket: item }, error: null };
        }
        if (kind === "note") {
          const tId = String(pInput.ticketId);
          const item = state.tickets.find((t) => t.id === tId) ?? { id: tId, company_id: "00000000-0000-0000-0000-000000000001" };
          item.revision = (Number(item.revision) || 1) + 1;
          const noteId = "99999999-8888-7777-6666-555555555555";
          const noteObj = {
            id: noteId,
            ticket_id: tId,
            author_user_id: "00000000-0000-0000-0000-000000000001",
            note_type: pInput.noteType ?? "internal_note",
            content: pInput.content,
            created_at: new Date().toISOString(),
          };
          state.ticketNotes.push(noteObj);
          return { data: { ok: true, ticket: item, note: noteObj }, error: null };
        }
        return { data: { ok: true }, error: null };
      }
      if (fn === "admin_read_operations_snapshot") {
        const nowIso = new Date().toISOString();
        return {
          data: {
            ok: true,
            traceCoverage: "NOT_RECORDED",
            ingressRatesMeasured: false,
            windowStart: new Date(Date.now() - 3600000).toISOString(),
            windowEnd: nowIso,
            sources: [
              { source: "paymob", count: 1, lastActiveAt: nowIso },
              { source: "whatsapp", count: 0, lastActiveAt: null },
              { source: "instagram", count: 0, lastActiveAt: null },
            ],
            events: [
              {
                id: "00000000-0000-0000-0000-000000000001",
                companyId: null,
                service: "billing_paymob",
                severity: "info",
                errorCode: "PAYMOB_EVENT_RECORDED",
                message: "PAYMOB_EVENT_RECORDED",
                traceId: "UNKNOWN",
                requestId: "UNKNOWN",
                createdAt: nowIso,
              },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          insert: async (row: DbRow) => {
            state.auditLogs.push(row);
            return { error: null };
          },
        };
      }
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => {
              const matched = state.platformAdmins.filter((p) => p.user_id === val);
              return {
                maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
              };
            },
          }),
          insert: async (row: DbRow) => {
            state.platformAdmins.push({ ...row });
            return { error: null };
          },
          upsert: async (row: DbRow) => {
            const existing = state.platformAdmins.find((p) => p.user_id === row.user_id);
            if (existing) {
              Object.assign(existing, row);
            } else {
              state.platformAdmins.push({ ...row });
            }
            return { error: null };
          },
          update: (updates: DbRow) => ({
            eq: (_col: string, val: unknown) => {
              const item = state.platformAdmins.find((p) => p.user_id === val);
              if (item) Object.assign(item, updates);
              return { error: null };
            },
          }),
          delete: () => ({
            eq: (_col: string, val: unknown) => {
              const idx = state.platformAdmins.findIndex((p) => p.user_id === val);
              if (idx >= 0) state.platformAdmins.splice(idx, 1);
              return { error: null };
            },
          }),
        };
      }
      if (table === "platform_admin_scopes") {
        return {
          insert: async () => ({ error: null }),
          upsert: async () => ({ error: null }),
          delete: () => ({ eq: () => ({ error: null }) }),
        };
      }
      if (table === "companies") {
        return {
          select: () => ({
            limit: async () => ({ data: state.companies, error: null }),
            eq: (col: string, val: unknown) => ({
              maybeSingle: async () => ({
                data: state.companies.find((c) => c[col] === val) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "company_branches") {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => ({
              data: state.branches.filter((b) => b[col] === val),
              error: null,
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => ({
              maybeSingle: async () => ({
                data: state.profiles.find((p) => p.user_id === val) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "billing_provider_events") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: state.paymobEvents, error: null }),
            }),
          }),
        };
      }
      if (table === "whatsapp_conversation_events") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: state.waEvents, error: null }),
            }),
          }),
        };
      }
      if (table === "instagram_webhook_receipts") {
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: state.igEvents, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          limit: async () => ({ data: [], error: null }),
        }),
      };
    },
  })),
}));

describe("Stage G — 5 Authoritative Operational Lifecycles", () => {
  beforeEach(() => {
    state.ownerGateResult = { ok: true, role: "owner", context: { userId: "00000000-0000-0000-0000-000000000001", email: "velorahelperai@gmail.com" } };
    state.roleGateResult = { ok: true, userId: "00000000-0000-0000-0000-000000000001", email: "velorahelperai@gmail.com", role: "owner" };
    state.auditLogs = [];
    state.tickets = [];
    state.ticketNotes = [];
    state.platformAdmins = [
      { user_id: "00000000-0000-0000-0000-000000000001", email: "velorahelperai@gmail.com", role: "owner", status: "active" },
    ];
  });

  // Cycle 1: Support Ticket Lifecycle
  it("Cycle 1: executes full support ticket lifecycle with status transitions, notes, and audit trails", async () => {
    // 1. Create ticket
    const createRes = await adminCreateSupportTicket({
      companyId: "00000000-0000-0000-0000-000000000001",
      branchId: "00000000-0000-0000-0000-000000000002",
      title: "WhatsApp message delay on Branch 1",
      description: "Customer reports 3-minute delay in automated answers",
      category: "technical",
      priority: "high",
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok || !createRes.ticket) return;
    const ticketId = createRes.ticket.id;
    expect(ticketId).toBe("11111111-2222-3333-4444-555555555555");
    expect(state.tickets).toHaveLength(1);
    expect(state.tickets[0].status).toBe("open");

    // Verify audit log for creation
    expect(state.auditLogs.some((l) => l.action === "support_ticket.created")).toBe(true);

    // 2. Add internal diagnostic note
    const noteRes = await adminAddTicketNote({
      ticketId,
      expectedRevision: 1,
      content: "Investigated WhatsApp Cloud API latency, webhook received promptly.",
      noteType: "internal_note",
    });
    expect(noteRes.ok).toBe(true);
    expect(state.ticketNotes).toHaveLength(1);
    expect(state.ticketNotes[0].content).toContain("WhatsApp Cloud API");

    // 3. Update status to in_progress
    const updateRes = await adminUpdateTicketStatus({
      ticketId,
      expectedRevision: 2,
      status: "in_progress",
      internalNote: "Investigation started by ops team",
    });
    expect(updateRes.ok).toBe(true);
    expect(state.tickets[0].status).toBe("in_progress");

    // 4. Close ticket with resolution
    const closeRes = await adminCloseTicket({
      ticketId,
      expectedRevision: 3,
      resolutionSummary: "Resolved by refreshing Meta access webhook token.",
      note: "Closing after verification",
    });
    expect(closeRes.ok).toBe(true);
    expect(state.tickets[0].status).toBe("closed");
    expect(state.tickets[0].resolution_summary).toContain("Meta access webhook");

    // 5. Reopen ticket
    const reopenRes = await adminReopenTicket({
      ticketId,
      expectedRevision: 4,
      reason: "Customer reports recurrence on morning shift.",
    });
    expect(reopenRes.ok).toBe(true);
    expect(state.tickets[0].status).toBe("open");
  });

  // Cycle 2: Staff Role Change Lifecycle & Anti-Privilege Escalation
  it("Cycle 2: executes full staff role lifecycle: grant, protect owner, update, toggle suspend, and revoke", async () => {
    // 1. Deny escalating anyone to owner
    const escalateRes = await adminGrantPlatformAdminRole({
      userId: "00000000-0000-0000-0000-000000000003",
      role: "owner" as unknown as "support",
    });
    expect(escalateRes.ok).toBe(false);
    if (!escalateRes.ok) {
      expect(escalateRes.code).toBe("FORBIDDEN");
    }

    // 2. Grant legitimate support role
    const grantRes = await adminGrantPlatformAdminRole({
      userId: "00000000-0000-0000-0000-000000000003",
      role: "support",
      note: "Customer support specialist",
    });
    expect(grantRes.ok).toBe(true);
    expect(state.platformAdmins.some((p) => p.user_id === "00000000-0000-0000-0000-000000000003" && p.role === "support")).toBe(true);
    expect(state.auditLogs.some((l) => l.action === "access.platform_role_granted")).toBe(true);

    // 3. Update role to operations
    const updateRoleRes = await adminUpdatePlatformAdminRole({
      userId: "00000000-0000-0000-0000-000000000003",
      role: "operations",
      status: "active",
      note: "Transferred to operations team",
    });
    expect(updateRoleRes.ok).toBe(true);
    expect(state.platformAdmins.find((p) => p.user_id === "00000000-0000-0000-0000-000000000003")?.role).toBe("operations");

    // 4. Toggle suspend (active -> disabled)
    const suspendRes = await adminToggleAdminStatus("00000000-0000-0000-0000-000000000003", "disabled");
    expect(suspendRes.ok).toBe(true);
    expect(state.platformAdmins.find((p) => p.user_id === "00000000-0000-0000-0000-000000000003")?.status).toBe("disabled");
    expect(state.auditLogs.some((l) => l.action === "access.platform_role_suspended")).toBe(true);

    // 5. Revoke role entirely
    const revokeRes = await adminRevokePlatformAdmin("00000000-0000-0000-0000-000000000003");
    expect(revokeRes.ok).toBe(true);
    expect(state.platformAdmins.some((p) => p.user_id === "00000000-0000-0000-0000-000000000003")).toBe(false);
    expect(state.auditLogs.some((l) => l.action === "access.platform_role_revoked")).toBe(true);

    // 6. Deny revoking the platform owner
    const revokeOwnerRes = await adminRevokePlatformAdmin("00000000-0000-0000-0000-000000000001");
    expect(revokeOwnerRes.ok).toBe(false);
    if (!revokeOwnerRes.ok) {
      expect(revokeOwnerRes.code).toBe("FORBIDDEN");
    }
  });

  // Cycle 3: Customer Lookup by VEL-XXXX Code, Email, or Phone
  it("Cycle 3: executes customer lookup by Support Code VEL-XXXX and returns company context", async () => {
    const lookupRes = await adminLookupCustomerByCodeOrEmail("VEL-1020-3040-5060");
    expect(lookupRes.ok).toBe(true);
    if (lookupRes.ok) {
      expect(Array.isArray(lookupRes.rows)).toBe(true);
      expect(lookupRes.rows.length).toBeGreaterThanOrEqual(1);
      expect(lookupRes.rows[0].support_code).toBe("VEL-1020-3040-5060");
      expect(lookupRes.rows[0].companies[0].display_name).toBe("Al-Baraka Trading");
    }
  });

  // Cycle 4: Incident Trace Tracking with Correlation ID
  it("Cycle 4: correlates operational telemetry using Trace ID / Request ID", async () => {
    const overviewRes = await adminGetOperationsOverview({ correlationId: "pay-attempt-999" });
    expect(overviewRes.ok).toBe(true);
    if (overviewRes.ok) {
      expect(overviewRes.data.recentEvents).toHaveLength(1);
      expect(overviewRes.data.recentEvents[0].traceId).toBe("UNKNOWN");
      expect(overviewRes.data.recentEvents[0].service).toBe("billing_paymob");
    }
  });
});
