"use server";

import { randomUUID } from "node:crypto";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import { adminListPendingReviewsPage, adminSearchAccounts } from "@/lib/tenancy/actions";
import type {
  AdminSupportOverviewData,
  SupportTicketItem,
  TicketCategory,
  TicketNote,
  TicketPriority,
  TicketStatus,
} from "./support-types";
import type { AdminAccountSearchItem } from "./types";

export type AdminSupportResult =
  | {
      ok: true;
      data: AdminSupportOverviewData;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE";
      message?: string;
    };

export interface AdminSupportOverviewFilter {
  status?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface RawTicketRecord {
  id: string;
  revision: number;
  ticket_number?: string | null;
  company_id: string;
  branch_id?: string | null;
  creator_user_id?: string | null;
  assigned_to_user_id?: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  resolution_summary?: string | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  resolved_at?: string | null;
}

type DbReply = { data: unknown; error: { code?: string } | null; count: number | null };
type DynamicQuery = PromiseLike<DbReply> & {
  select(cols: string, options?: { count?: "exact"; head?: boolean }): DynamicQuery;
  eq(col: string, val: unknown): DynamicQuery;
  in(col: string, values: string[]): DynamicQuery;
  ilike(col: string, value: string): DynamicQuery;
  or(filters: string): DynamicQuery;
  order(col: string, opts?: { ascending?: boolean }): DynamicQuery;
  limit(count: number): DynamicQuery;
  range(from: number, to: number): DynamicQuery;
};
type DynamicClient = { from(table: string): DynamicQuery; rpc(name: string, input: Record<string, unknown>): PromiseLike<DbReply> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: TicketStatus[] = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
const CATEGORIES: TicketCategory[] = ["onboarding", "billing", "technical", "channel", "ai", "other"];
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => "\\" + match);
const optionalText = (value: unknown) => value === undefined || typeof value === "string" && value.length <= 10000;
function ticketItem(value: unknown): SupportTicketItem {
  const row = record(value);
  if (!row || !UUID.test(String(row.id)) || !UUID.test(String(row.company_id)) || typeof row.ticket_number !== "string"
    || typeof row.title !== "string" || typeof row.description !== "string" || !STATUSES.includes(row.status as TicketStatus)
    || !PRIORITIES.includes(row.priority as TicketPriority) || !CATEGORIES.includes(row.category as TicketCategory)
    || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1
    || !Number.isFinite(Date.parse(String(row.created_at))) || !Number.isFinite(Date.parse(String(row.updated_at)))) throw Error("SUPPORT_RESULT_INVALID");
  return { id: String(row.id), revision: Number(row.revision), ticketNumber: row.ticket_number,
    companyId: String(row.company_id), branchId: typeof row.branch_id === "string" ? row.branch_id : null,
    creatorUserId: typeof row.creator_user_id === "string" ? row.creator_user_id : null,
    assignedToUserId: typeof row.assigned_to_user_id === "string" ? row.assigned_to_user_id : null,
    title: row.title, description: row.description, status: row.status as TicketStatus, priority: row.priority as TicketPriority,
    category: row.category as TicketCategory, resolutionSummary: typeof row.resolution_summary === "string" ? row.resolution_summary : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    closedAt: typeof row.closed_at === "string" ? row.closed_at : null, resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null };
}
function supportFailure(code: string, stage: string) {
  const reference = randomUUID();
  withLogContext({ request_id: reference, trace_id: reference }, () => logEvent("error", "admin.support.failed", { stage, error_code: code }));
  return { ok: false as const, code, message: code + " [" + reference + "]" };
}

export async function adminGetSupportOverview(
  filter?: AdminSupportOverviewFilter
): Promise<AdminSupportResult> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED" || admin.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (admin.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }

  let availableReviews: AdminSupportOverviewData["pendingReviews"] | null = null;
  let availableReviewCount = 0;
  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicClient;

    const reviewsRes = await adminListPendingReviewsPage({ limit: 50, offset: 0 });
    if (!reviewsRes.ok) return { ...supportFailure("SUPPORT_REVIEWS_UNAVAILABLE", "support_read"), code: "UNAVAILABLE" };
    const pendingReviews = reviewsRes.data.rows;
    const pendingCount = reviewsRes.data.totalCount;
    availableReviews = pendingReviews;
    availableReviewCount = pendingCount;
    const limit = Number.isSafeInteger(filter?.limit) ? Math.min(Math.max(filter!.limit!, 1), 100) : 50;
    const offset = Number.isSafeInteger(filter?.offset) ? Math.max(filter!.offset!, 0) : 0;
    let query = dynamicClient.from("support_tickets").select("*", { count: "exact" });
    if (filter?.status && filter.status !== "all") {
      if (!STATUSES.includes(filter.status as TicketStatus)) throw Error("SUPPORT_INVALID_FILTER");
      query = query.eq("status", filter.status);
    }
    if (filter?.priority && filter.priority !== "all") {
      if (!PRIORITIES.includes(filter.priority as TicketPriority)) throw Error("SUPPORT_INVALID_FILTER");
      query = query.eq("priority", filter.priority);
    }
    const search = filter?.search?.trim();
    if (search) {
      if (search.length > 120) throw Error("SUPPORT_INVALID_FILTER");
      const { data: companies, count: companyCount, error: companyErr } = await dynamicClient.from("companies")
        .select("id", { count: "exact" }).ilike("display_name", "%" + escapeLike(search) + "%").limit(1000);
      if (companyErr || companyCount === null || companyCount > 1000 || !Array.isArray(companies)) throw Error("SUPPORT_COMPANY_SEARCH_UNAVAILABLE");
      const term = JSON.stringify("%" + escapeLike(search) + "%");
      const clauses = ["ticket_number.ilike." + term, "title.ilike." + term, "description.ilike." + term];
      const ids = companies.map(company => record(company)?.id).filter((id): id is string => typeof id === "string" && UUID.test(id));
      if (ids.length !== companies.length) throw Error("SUPPORT_COMPANY_SEARCH_INVALID");
      if (ids.length) clauses.push("company_id.in.(" + ids.join(",") + ")");
      query = query.or(clauses.join(","));
    }
    const { data: ticketsData, error: ticketsErr, count: totalCount } = await query
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (ticketsErr || !Array.isArray(ticketsData) || totalCount === null) throw Error("SUPPORT_TICKETS_UNAVAILABLE");
    const rawTickets = ticketsData as RawTicketRecord[];
    const countStatuses = (statuses: string[]) => dynamicClient.from("support_tickets").select("id", { count: "exact", head: true }).in("status", statuses);
    const counts = await Promise.all([countStatuses(["open"]), countStatuses(["in_progress", "waiting_customer"]), countStatuses(["resolved", "closed"])]);
    if (counts.some(result => result.error || result.count === null)) throw Error("SUPPORT_COUNTS_UNAVAILABLE");

    // 3. Map company display names if available
    const companyIds = [...new Set(rawTickets.map((t) => t.company_id).filter(Boolean))];
    const companyNameMap = new Map<string, string>();
    if (companyIds.length > 0) {
      try {
        const { data: compData } = await supabase
          .from("companies")
          .select("id, display_name").in("id", companyIds);
        if (Array.isArray(compData)) {
          for (const c of compData) {
            companyNameMap.set(c.id, c.display_name);
          }
        }
      } catch {
        // Ignored, company names will fall back to ID
      }
    }

    const tickets = rawTickets.map(row => ({ ...ticketItem(row), companyName: companyNameMap.get(row.company_id) ?? row.company_id }));
    const openCount = counts[0].count!;
    const inProgressCount = counts[1].count!;
    const resolvedCount = counts[2].count!;

    const data: AdminSupportOverviewData = {
      ticketsAvailability: "ready",
      kpis: {
        pendingReviewsCount: pendingCount,
        openTicketsCount: openCount,
        inProgressTicketsCount: inProgressCount,
        resolvedTicketsCount: resolvedCount,
        supportSlaHours: "UNCONFIGURED",
        reviewGateStatus: "ACTIVE",
        officialSupportChannel: "WhatsApp & Email",
        officialSupportEmail: "velorahelperai@gmail.com",
      },
      pendingReviews,
      tickets,
      supportChannels: [
        {
          id: "wa-support",
          channel: "WhatsApp Official Support",
          target: "UNCONFIGURED",
          status: "UNCONFIGURED",
          description: "Direct customer escalations & support code lookups",
        },
        {
          id: "platform-owner",
          channel: "Platform Escalation Email",
          target: "velorahelperai@gmail.com",
          status: "OPERATIONAL",
          description: "Platform owner verified escalation and dispute resolution",
        },
        {
          id: "email-desk",
          channel: "Dedicated Support Desk",
          target: "UNCONFIGURED",
          status: "UNCONFIGURED",
          description: "Custom external ticketing desk unconfigured in platform settings",
        },
      ],
      pagination: {
        totalCount,
        limit,
        offset,
        hasMore: offset + tickets.length < totalCount,
      },
    };

    return { ok: true, data };
  } catch {
    const failure = supportFailure("SUPPORT_READ_UNAVAILABLE", "support_read");
    if (availableReviews !== null) return { ok: true, data: {
      ticketsAvailability: "unavailable", ticketsError: failure.message,
      kpis: { pendingReviewsCount: availableReviewCount, openTicketsCount: "UNKNOWN", inProgressTicketsCount: "UNKNOWN", resolvedTicketsCount: "UNKNOWN",
        supportSlaHours: "UNCONFIGURED", reviewGateStatus: "ACTIVE", officialSupportChannel: "Email", officialSupportEmail: "velorahelperai@gmail.com" },
      pendingReviews: availableReviews, tickets: [], supportChannels: [
        { id: "platform-owner", channel: "Platform Escalation Email", target: "velorahelperai@gmail.com", status: "STANDBY", description: "Configured contact address; delivery not probed" },
        { id: "email-desk", channel: "Dedicated Support Desk", target: "UNCONFIGURED", status: "UNCONFIGURED", description: "External support desk is unconfigured" },
      ],
    } };
    return { ...failure, code: "UNAVAILABLE" };
  }
}

type MutationMeta = { operationId?: string; expectedRevision?: number };
type MutationResult = { ok: boolean; code?: string; ticket?: SupportTicketItem; note?: TicketNote; message?: string };
async function mutateSupport(kind: "create" | "status" | "assign" | "note", input: Record<string, unknown>, meta: MutationMeta): Promise<MutationResult> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) return { ok: false, code: admin.code, message: admin.code };
  const operationId = meta.operationId ?? randomUUID();
  if (!UUID.test(operationId) || (kind !== "create" && (!Number.isSafeInteger(meta.expectedRevision) || Number(meta.expectedRevision) < 1))) return supportFailure("INVALID_INPUT", "support_validation");
  try {
    const db = await createClient() as unknown as DynamicClient;
    // Implemented by the review-only SQL package. Missing RPC is a blocker, never a success fallback.
    const { data, error } = await db.rpc("admin_support_mutate", { p_operation_id: operationId, p_kind: kind, p_input: input, p_expected_revision: kind === "create" ? null : meta.expectedRevision });
    if (error) {
      const code = error.code === "PGRST202" || error.code === "42883" ? "SUPPORT_CONTRACT_NOT_INSTALLED"
        : error.code === "42501" ? "FORBIDDEN" : ["22023", "22P02", "23502", "23503", "23514"].includes(error.code ?? "") ? "INVALID_INPUT" : "UNKNOWN";
      return supportFailure(code, "support_" + kind);
    }
    const result = record(data);
    if (result?.ok !== true) return supportFailure(["CONFLICT", "NOT_FOUND", "FORBIDDEN"].includes(String(result?.code)) ? String(result!.code) : "UNKNOWN", "support_" + kind);
    const ticket = ticketItem(result.ticket);
    if (kind !== "create" && ticket.id !== input.ticketId) return supportFailure("UNKNOWN", "support_result_binding");
    if (kind === "create" && (ticket.companyId !== input.companyId || ticket.creatorUserId !== admin.context.userId || ticket.branchId !== input.branchId || ticket.title !== input.title || ticket.description !== input.description)) return supportFailure("UNKNOWN", "support_result_binding");
    if (kind !== "create" && ticket.revision !== Number(meta.expectedRevision) + 1
      || kind === "status" && ticket.status !== input.status
      || kind === "assign" && ticket.assignedToUserId !== input.assignedToUserId) return supportFailure("UNKNOWN", "support_result_binding");
    if (kind !== "note") return { ok: true, ticket };
    const note = record(result.note);
    if (!note || !UUID.test(String(note.id)) || note.ticket_id !== ticket.id || note.author_user_id !== admin.context.userId
      || !["internal_note", "customer_response"].includes(String(note.note_type)) || typeof note.content !== "string"
      || note.content !== input.content || note.note_type !== input.noteType
      || !Number.isFinite(Date.parse(String(note.created_at)))) return supportFailure("UNKNOWN", "support_note_result");
    return { ok: true, ticket, note: { id: String(note.id), ticketId: ticket.id, authorUserId: String(note.author_user_id), authorEmail: null,
      noteType: note.note_type as TicketNote["noteType"], content: note.content, createdAt: String(note.created_at) } };
  } catch {
    // A transport failure may occur after COMMIT. Preserve UNKNOWN and the caller's operation ID.
    return supportFailure("UNKNOWN", "support_" + kind);
  }
}

export async function adminCreateSupportTicket(input: {
  companyId: string; branchId?: string | null; title: string; description: string; priority?: TicketPriority;
  category?: TicketCategory; assignedToUserId?: string | null; initialNote?: string; operationId?: string;
}): Promise<MutationResult> {
  if (!record(input)) return supportFailure("INVALID_INPUT", "support_create_validation");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!UUID.test(input.companyId) || input.branchId && !UUID.test(input.branchId) || input.assignedToUserId && !UUID.test(input.assignedToUserId)
    || !title || title.length < 3 || title.length > 200 || !description || description.length < 5 || description.length > 10000
    || input.priority && !PRIORITIES.includes(input.priority) || input.category && !CATEGORIES.includes(input.category)
    || !optionalText(input.initialNote)) return supportFailure("INVALID_INPUT", "support_create_validation");
  return mutateSupport("create", { companyId: input.companyId, branchId: input.branchId || null, title, description,
    priority: input.priority ?? "medium", category: input.category ?? "technical", assignedToUserId: input.assignedToUserId || null, initialNote: input.initialNote?.trim() || null }, input);
}
export async function adminUpdateTicketStatus(input: MutationMeta & { ticketId: string; status: TicketStatus; internalNote?: string; resolutionSummary?: string }): Promise<MutationResult> {
  if (!record(input) || !UUID.test(input.ticketId) || !STATUSES.includes(input.status) || !optionalText(input.internalNote) || !optionalText(input.resolutionSummary)) return supportFailure("INVALID_INPUT", "support_status_validation");
  return mutateSupport("status", { ticketId: input.ticketId, status: input.status, internalNote: input.internalNote?.trim() || null,
    ...(input.resolutionSummary !== undefined ? { resolutionSummary: input.resolutionSummary } : {}) }, input);
}
export async function adminAssignTicket(input: MutationMeta & { ticketId: string; assignedToUserId: string | null; internalNote?: string }): Promise<MutationResult> {
  if (!record(input) || !UUID.test(input.ticketId) || input.assignedToUserId && !UUID.test(input.assignedToUserId) || !optionalText(input.internalNote)) return supportFailure("INVALID_INPUT", "support_assign_validation");
  return mutateSupport("assign", { ticketId: input.ticketId, assignedToUserId: input.assignedToUserId, internalNote: input.internalNote?.trim() || null }, input);
}
export async function adminAddTicketNote(input: MutationMeta & { ticketId: string; content: string; noteType?: "internal_note" | "customer_response" }): Promise<MutationResult> {
  if (!record(input)) return supportFailure("INVALID_INPUT", "support_note_validation");
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!UUID.test(input.ticketId) || !content || content.length > 10000 || input.noteType && !["internal_note", "customer_response"].includes(input.noteType)) return supportFailure("INVALID_INPUT", "support_note_validation");
  return mutateSupport("note", { ticketId: input.ticketId, content, noteType: input.noteType ?? "internal_note" }, input);
}
export async function adminCloseTicket(input: MutationMeta & { ticketId: string; resolutionSummary?: string; note?: string }): Promise<MutationResult> {
  return adminUpdateTicketStatus({ ...input, status: "closed", internalNote: input.note });
}
export async function adminReopenTicket(input: MutationMeta & { ticketId: string; reason?: string }): Promise<MutationResult> {
  return adminUpdateTicketStatus({ ...input, status: "open", internalNote: input.reason });
}

export async function adminLookupCustomerByCodeOrEmail(
  query: string
): Promise<{ ok: boolean; rows: AdminAccountSearchItem[]; message?: string }> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, rows: [], message: admin.code };
  }
  const clean = query.trim();
  if (!clean) return { ok: true, rows: [] };
  const res = await adminSearchAccounts({ query: clean, limit: 20 });
  if (!res.ok) {
    return { ok: false, rows: [], message: res.message ?? res.code };
  }
  return { ok: true, rows: res.data.rows };
}
