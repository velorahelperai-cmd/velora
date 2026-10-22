import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminCreateSupportTicket, adminAddTicketNote, adminUpdateTicketStatus, adminAssignTicket, adminGetSupportOverview, adminLookupCustomerByCodeOrEmail } from "./support-actions";

// Synthetic unit-contract fixtures only; these are not database acceptance evidence.
const ids = { actor: "00000000-0000-4000-8000-000000000001", company: "00000000-0000-4000-8000-000000000002", ticket: "00000000-0000-4000-8000-000000000003", operation: "00000000-0000-4000-8000-000000000004", note: "00000000-0000-4000-8000-000000000005" };
const state = vi.hoisted(() => ({
  allowed: true, rpcError: null as { code: string } | null, rpcData: null as unknown, transportFailure: false,
  calls: [] as { name: string; args: Record<string, unknown> }[], queryCalls: [] as string[],
  rows: [] as Record<string, unknown>[], count: 101, readError: false,
}));
vi.mock("@/lib/logging/logger.mjs", () => ({ logEvent: vi.fn(), withLogContext: (_fields: unknown, run: () => unknown) => run() }));
vi.mock("@/lib/tenancy/access", () => ({ requirePlatformOwner: async () => state.allowed ? { ok: true, context: { userId: "00000000-0000-4000-8000-000000000001" } } : { ok: false, code: "FORBIDDEN" } }));
vi.mock("@/lib/tenancy/actions", () => ({
  adminListPendingReviewsPage: async () => ({ ok: true, data: { rows: [], totalCount: 0 } }),
  adminSearchAccounts: async () => ({ ok: true, data: { rows: [] } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (state.transportFailure) throw Error("Synthetic transport loss");
    return { data: state.rpcData, error: state.rpcError };
  },
  from: (table: string) => {
    let head = false;
    const query = {
      select: (_fields: string, options?: { head?: boolean }) => { head = !!options?.head; return query; },
      eq: (field: string) => { state.queryCalls.push("eq:" + field); return query; },
      in: (field: string) => { state.queryCalls.push("in:" + field); return query; },
      ilike: (field: string) => { state.queryCalls.push("ilike:" + field); return query; },
      or: () => { state.queryCalls.push("or"); return query; },
      order: (field: string) => { state.queryCalls.push("order:" + field); return query; },
      range: (start: number, end: number) => { state.queryCalls.push("range:" + start + ":" + end); return query; },
      limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: head || table === "companies" ? [] : state.rows, count: head ? 7 : table === "companies" ? 0 : state.count, error: state.readError ? { code: "42501" } : null })),
    };
    return query;
  },
}) }));
function ticket() { return { id: ids.ticket, ticket_number: "SYNTHETIC-UNIT-TICKET", company_id: ids.company, branch_id: null, creator_user_id: ids.actor, assigned_to_user_id: null, title: "Synthetic unit ticket", description: "Synthetic contract data", status: "open", priority: "medium", category: "technical", revision: 1, created_at: "2026-10-22T01:00:00Z", updated_at: "2026-10-22T01:00:00Z" }; }
const createInput = () => ({ companyId: ids.company, title: "Synthetic unit ticket", description: "Synthetic contract data", operationId: ids.operation });
beforeEach(() => { state.allowed = true; state.rpcError = null; state.rpcData = { ok: true, ticket: ticket() }; state.transportFailure = false; state.calls = []; state.queryCalls = []; state.rows = []; state.count = 101; state.readError = false; });
describe("Support repair unit contracts (no live DB)", () => {
  it("denies writes before calling the RPC for non-owners", async () => { state.allowed = false; expect((await adminCreateSupportTicket(createInput())).ok).toBe(false); expect(state.calls).toHaveLength(0); });
  it("reports a missing contract without a temporary successful ticket", async () => { state.rpcError = { code: "PGRST202" }; const result = await adminCreateSupportTicket(createInput()); expect(result.ok).toBe(false); expect(result.code).toBe("SUPPORT_CONTRACT_NOT_INSTALLED"); expect(result.ticket).toBeUndefined(); });
  it("rejects a success envelope without a persisted ticket", async () => { state.rpcData = { ok: true, ticket: null }; expect((await adminCreateSupportTicket(createInput())).ok).toBe(false); });
  it("accepts only a real returned identifier and binds creation to its company", async () => { const result = await adminCreateSupportTicket(createInput()); expect(result.ok).toBe(true); expect(result.ticket?.id).toBe(ids.ticket); state.rpcData = { ok: true, ticket: { ...ticket(), company_id: ids.actor } }; expect((await adminCreateSupportTicket(createInput())).ok).toBe(false); });
  it("preserves a lost-transport outcome as UNKNOWN without an automatic retry", async () => { state.transportFailure = true; const result = await adminCreateSupportTicket(createInput()); expect(result.code).toBe("UNKNOWN"); expect(state.calls).toHaveLength(1); expect(state.calls[0].args.p_operation_id).toBe(ids.operation); });
  it("passes initial note inside the same atomic creation call", async () => { const result = await adminCreateSupportTicket({ ...createInput(), initialNote: "Synthetic unit note" }); expect(result.ok).toBe(true); expect(state.calls).toHaveLength(1); expect((state.calls[0].args.p_input as Record<string, unknown>).initialNote).toBe("Synthetic unit note"); });
  it("rejects updates without the displayed revision", async () => { const result = await adminUpdateTicketStatus({ ticketId: ids.ticket, status: "closed" }); expect(result.ok).toBe(false); expect(state.calls).toHaveLength(0); });
  it("surfaces revision conflicts rather than reporting status saved", async () => { state.rpcData = { ok: false, code: "CONFLICT" }; const result = await adminUpdateTicketStatus({ ticketId: ids.ticket, status: "closed", expectedRevision: 1, operationId: ids.operation }); expect(result.code).toBe("CONFLICT"); expect(result.ok).toBe(false); });
  it("does not invent note IDs when a note was not returned", async () => { const result = await adminAddTicketNote({ ticketId: ids.ticket, content: "Synthetic unit note", expectedRevision: 1, operationId: ids.operation }); expect(result.ok).toBe(false); expect(result.note).toBeUndefined(); });
  it("returns a note only when its persisted ticket and author match", async () => { state.rpcData = { ok: true, ticket: { ...ticket(), revision: 2 }, note: { id: ids.note, ticket_id: ids.ticket, author_user_id: ids.actor, note_type: "internal_note", content: "Synthetic unit note", created_at: "2026-10-22T01:00:00Z" } }; const result = await adminAddTicketNote({ ticketId: ids.ticket, content: "Synthetic unit note", expectedRevision: 1, operationId: ids.operation }); expect(result.ok).toBe(true); expect(result.note?.id).toBe(ids.note); });
  it("reports an assignment denial", async () => { state.rpcError = { code: "42501" }; expect((await adminAssignTicket({ ticketId: ids.ticket, assignedToUserId: null, expectedRevision: 1 })).ok).toBe(false); });
  it("uses count and offset with SQL filters before pagination", async () => { state.rows = [ticket()]; const result = await adminGetSupportOverview({ status: "open", priority: "medium", offset: 50, limit: 50 }); expect(result.ok).toBe(true); if (result.ok) { expect(result.data.pagination).toEqual({ totalCount: 101, offset: 50, limit: 50, hasMore: true }); expect(result.data.kpis.openTicketsCount).toBe(7); } expect(state.queryCalls.indexOf("eq:status")).toBeLessThan(state.queryCalls.indexOf("range:50:99")); expect(state.queryCalls).toContain("eq:priority"); });
  it("keeps reviews available while explicitly reporting ticket read failure", async () => { state.readError = true; const result = await adminGetSupportOverview(); expect(result.ok).toBe(true); if (result.ok) { expect(result.data.ticketsAvailability).toBe("unavailable"); expect(result.data.kpis.openTicketsCount).toBe("UNKNOWN"); expect(result.data.ticketsError).toContain("SUPPORT_READ_UNAVAILABLE"); expect(result.data.pagination).toBeUndefined(); } });
  it("keeps customer lookup on its existing search contract", async () => { expect((await adminLookupCustomerByCodeOrEmail("SYNTHETIC-UNIT")).ok).toBe(true); });
});
