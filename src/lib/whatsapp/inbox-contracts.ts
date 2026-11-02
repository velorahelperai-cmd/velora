import { readSessionConversationScope } from "@/lib/access/conversation-scope";
import { reportInboxReadFailure, type InboxReadStage } from "./inbox-diagnostics";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { sessionHasCompanyCapability } from "@/lib/access/actions";
import { mapWhatsappConversation } from "./inbox";
import type { Conversation } from "@/lib/demo-state";

export type InboxFailure = { ok: false; code: "NO_COMPANY" | "SCOPE_CHANGED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE" };
export type InboxResult<T> = { ok: true; data: T } | InboxFailure;
type Scope = "all_company" | "assigned_only";
type PageInput = { companyId: string; limit?: number; before?: string | null };
type ThreadInput = PageInput & { conversationId: string };
export type InboxInterventionReason = "human_control" | "worker_review" | "worker_failed" | "send_unknown" | "send_rejected" | "delivery_failed";
const REASONS: InboxInterventionReason[] = ["human_control", "worker_review", "worker_failed", "send_unknown", "send_rejected", "delivery_failed"];
export type WhatsappInboxItem = Conversation & {
  inboxSequence: string; unreadCount: number; intervention: { reasons: InboxInterventionReason[] };
};
export type WhatsappThreadMessage = Conversation["messages"][number] & { arrivalSequence: string; direction: "inbound" | "outbound" };
type PageMeta = { kind: "partial"; nextCursor: string | null; hasMore: boolean };
export type WhatsappInboxPage = PageMeta & {
  companyId: string; conversationScope: Scope; ordering: "newest_created";
  conversations: WhatsappInboxItem[]; total: number; unreadTotal: number; interventionTotal: number;
  membershipFingerprint: string;
};
export type WhatsappThreadPage = PageMeta & {
  companyId: string; conversationId: string; messages: WhatsappThreadMessage[];
  conversation: WhatsappInboxItem;
  displayedInboundMessageId: string | null; unreadCount: number;
};
export type WhatsappControlAuditPage = PageMeta & {
  companyId: string; conversationId: string;
  events: Array<{ id: string; eventSequence: string; action: string; actorUserId: string | null; revision: number; automationGeneration: number; at: string }>;
};
export type WhatsappConnectionStatus = {
  companyId: string; status: string; displayNumber: string | null; authorizationStatus: string;
  receiveReady: boolean; sendReady: boolean; inboundTestedAt: string | null; outboundTestedAt: string | null;
};
type RecordValue = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sequence = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= BigInt("9223372036854775807");
const record = (v: unknown): RecordValue | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : null;
const stringOrNull = (v: unknown) => typeof v === "string" ? v : null;
function count(v: unknown): number { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw Error("invalid_count"); return v; }
function pageMeta(row: RecordValue): PageMeta {
  if (typeof row.has_more !== "boolean" || (row.next_cursor !== null && !sequence(row.next_cursor)) || (row.has_more && row.next_cursor === null)) throw Error("invalid_page");
  return { kind: "partial", nextCursor: row.next_cursor as string | null, hasMore: row.has_more };
}
function pageValid(input: PageInput): boolean {
  return record(input) !== null && typeof input.companyId === "string" && UUID.test(input.companyId) && (input.limit === undefined || (Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100))
    && (input.before === undefined || input.before === null || sequence(input.before));
}
async function scopedRpc(expectedCompanyId: string|null, name: string, args: RecordValue): Promise<InboxResult<{ row: RecordValue; scope: Scope; companyId:string }>> {
  let stage: InboxReadStage = "page_access";
  const fail = (code: InboxFailure["code"], reason: Parameters<typeof reportInboxReadFailure>[1] = code, error?: unknown): InboxFailure => {
    if (name === "whatsapp_inbox_page") reportInboxReadFailure(stage, reason, error);
    return { ok: false, code };
  };
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return fail(access.code === "UNAVAILABLE" ? "UNAVAILABLE" : "NO_COMPANY");
    if (!access.context.company || !access.context.membership) return fail("NO_COMPANY");
    const companyId=access.context.company.id;
    if (expectedCompanyId!==null && companyId !== expectedCompanyId) return fail("SCOPE_CHANGED");
    stage = "page_scope";
    const scoped = await readSessionConversationScope(companyId);
    if (!scoped.ok) return fail(scoped.code, scoped.code === "FORBIDDEN" ? "FORBIDDEN" : "UNKNOWN_SCOPE");
    const scope = scoped.scope;
    stage = "page_capability";
    const read = await sessionHasCompanyCapability(companyId, "wa.conversations.read");
    // The capability helper also returns false for RPC errors, so this is not an explicit denial.
    if (read !== true) return fail("UNAVAILABLE", "READ_NOT_CONFIRMED");
    // Local RPC shape until the coordinated generated database types are refreshed.
    stage = "page_rpc";
    const client = await createClient() as unknown as { rpc(name: string, args: RecordValue): Promise<{ data: unknown; error: unknown }> };
    const { data, error } = await client.rpc(name, { p_company_id: companyId, ...args });
    if (error) return fail("UNAVAILABLE", "RPC_ERROR", error);
    stage = "page_shape";
    const row = record(data);
    if (!row) return fail("UNAVAILABLE", "INVALID_RESPONSE");
    if (row.ok !== true) {
      const code = row.code === "forbidden" ? "FORBIDDEN" : row.code === "not_found" ? "NOT_FOUND"
        : row.code === "invalid_input" ? "INVALID_INPUT" : row.code === "display_changed" ? "CONFLICT" : "UNAVAILABLE";
      return fail(code);
    }
    stage = "page_binding";
    if (row.company_id !== companyId || (row.conversation_scope !== undefined && row.conversation_scope !== scope)) return fail("UNAVAILABLE", "INVALID_RESPONSE");
    if (args.p_conversation_id !== undefined && row.conversation_id !== args.p_conversation_id) return fail("UNAVAILABLE", "INVALID_RESPONSE");
    return { ok: true, data: { row, scope, companyId } };
  } catch (error) { return fail("UNAVAILABLE", "EXCEPTION", error); }
}
function message(raw: unknown): WhatsappThreadMessage {
  const m = record(raw);
  if (!m || typeof m.id !== "string" || !UUID.test(m.id) || !sequence(m.arrival_sequence) || typeof m.body !== "string"
    || typeof m.received_at !== "string" || !Number.isFinite(Date.parse(m.received_at)) || (m.direction !== "inbound" && m.direction !== "outbound")) throw Error("invalid_message");
  const delivery = ["accepted", "sent", "delivered", "read", "failed"].includes(String(m.delivery_state)) ? m.delivery_state as Conversation["messages"][number]["deliveryState"] : undefined;
  return { id: m.id, text: m.body, from: m.sender === "staff" ? "staff" : m.sender === "assistant" ? "assistant" : "customer",
    at: Date.parse(m.received_at), direction: m.direction, arrivalSequence: m.arrival_sequence,
    ...(m.direction === "outbound" && delivery ? { deliveryState: delivery } : {}) };
}
function item(raw: unknown): WhatsappInboxItem {
  const r = record(raw);
  if (!r || typeof r.id !== "string" || !UUID.test(r.id) || !sequence(r.inbox_sequence)) throw Error("invalid_conversation");
  const messages = r.latest_message === null || r.latest_message === undefined ? [] : [message(r.latest_message)];
  const mapped = mapWhatsappConversation({
    id: r.id, customer_name: String(r.customer_name ?? ""), customer_wa_id: String(r.customer_wa_id ?? ""),
    last_message_at: String(r.last_message_at ?? ""), status: String(r.status ?? ""), automation_allowed: r.automation_allowed === true,
    automation_generation: count(r.automation_generation), control_revision: count(r.control_revision), assigned_to: stringOrNull(r.assigned_to),
    lead_stage: stringOrNull(r.lead_stage), lead_stage_reason: stringOrNull(r.lead_stage_reason), internal_note: stringOrNull(r.internal_note),
    follow_up_status: stringOrNull(r.follow_up_status), follow_up_at: stringOrNull(r.follow_up_at), last_touch_at: stringOrNull(r.last_touch_at),
    lead_revision: typeof r.lead_revision === "number" ? count(r.lead_revision) : 1,
  }, messages, new Map(typeof r.assigned_name === "string" && typeof r.assigned_to === "string" ? [[r.assigned_to, r.assigned_name]] : []));
  const intervention = record(r.intervention);
  return { ...mapped, inboxSequence: r.inbox_sequence, unreadCount: count(r.unread_count),
    intervention: { reasons: Array.isArray(intervention?.reasons) ? intervention.reasons.filter((x): x is InboxInterventionReason => REASONS.includes(x as InboxInterventionReason)) : [] } };
}

/** Creation-order keyset page. Never use this as a full membership refresh. */
export async function loadWhatsappInboxPage(input: PageInput): Promise<InboxResult<WhatsappInboxPage>> {
  if (!pageValid(input)) return { ok: false, code: "INVALID_INPUT" };
  const result = await scopedRpc(input.companyId, "whatsapp_inbox_page", { p_limit: input.limit ?? 50, p_before: input.before ?? null });
  return decodeInboxPage(result);
}
/** Initial composition derives its company from native authority once. No caller
 * can supply a trusted access object or skip the scope/capability checks. */
export async function loadCurrentWhatsappInboxPage():Promise<InboxResult<WhatsappInboxPage>>{
  return decodeInboxPage(await scopedRpc(null,'whatsapp_inbox_page',{p_limit:40,p_before:null}));
}
function decodeInboxPage(result:Awaited<ReturnType<typeof scopedRpc>>):InboxResult<WhatsappInboxPage>{
  if (!result.ok) return result;
  try {
    const { row, scope, companyId } = result.data;
    if (!Array.isArray(row.conversations) || typeof row.membership_fingerprint !== "string" || !/^[a-f0-9]{32}$/.test(row.membership_fingerprint)) throw Error("invalid_rows");
    return { ok: true, data: { ...pageMeta(row), companyId, conversationScope: scope, ordering: "newest_created",
      conversations: row.conversations.map(item), total: count(row.total), unreadTotal: count(row.unread_total), interventionTotal: count(row.intervention_total), membershipFingerprint: row.membership_fingerprint } };
  } catch {
    reportInboxReadFailure("page_decode", "INVALID_RESPONSE");
    return { ok: false, code: "UNAVAILABLE" };
  }
}
/** Only the latest page issues a read boundary; loading historical pages never advances it. */
export async function loadWhatsappThreadPage(input: ThreadInput): Promise<InboxResult<WhatsappThreadPage>> {
  if (!pageValid(input) || !UUID.test(input.conversationId)) return { ok: false, code: "INVALID_INPUT" };
  const result = await scopedRpc(input.companyId, "whatsapp_thread_page", { p_conversation_id: input.conversationId, p_limit: input.limit ?? 50, p_before: input.before ?? null });
  if (!result.ok) return result;
  try {
    const row = result.data.row;
    if (!Array.isArray(row.messages)) throw Error("invalid_rows");
    const messages = row.messages.map(message);
    const boundary = stringOrNull(row.displayed_inbound_message_id);
    if (boundary && !messages.some(m => m.id === boundary && m.direction === "inbound")) throw Error("invalid_boundary");
    return { ok: true, data: { ...pageMeta(row), companyId: input.companyId, conversationId: input.conversationId,
      conversation: item(row.conversation), messages, displayedInboundMessageId: boundary, unreadCount: count(row.unread_count) } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
export async function markWhatsappThreadRead(input: { companyId: string; conversationId: string; displayedInboundMessageId: string }): Promise<InboxResult<{ companyId: string; conversationId: string; lastReadSequence: string; unreadCount: number }>> {
  if (!record(input) || ![input.companyId, input.conversationId, input.displayedInboundMessageId].every(x => typeof x === "string" && UUID.test(x))) return { ok: false, code: "INVALID_INPUT" };
  const result = await scopedRpc(input.companyId, "whatsapp_mark_thread_read", { p_conversation_id: input.conversationId, p_displayed_inbound_message_id: input.displayedInboundMessageId });
  if (!result.ok) return result;
  try {
    const row = result.data.row;
    if (!sequence(row.last_read_sequence)) throw Error("invalid_sequence");
    return { ok: true, data: { companyId: input.companyId, conversationId: input.conversationId, lastReadSequence: row.last_read_sequence, unreadCount: count(row.unread_count) } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
export async function loadWhatsappControlAuditPage(input: ThreadInput): Promise<InboxResult<WhatsappControlAuditPage>> {
  if (!pageValid(input) || !UUID.test(input.conversationId)) return { ok: false, code: "INVALID_INPUT" };
  const result = await scopedRpc(input.companyId, "whatsapp_control_audit_page", { p_conversation_id: input.conversationId, p_limit: input.limit ?? 50, p_before: input.before ?? null });
  if (!result.ok) return result;
  try {
    const row = result.data.row;
    if (!Array.isArray(row.events)) throw Error("invalid_rows");
    const events = row.events.map(raw => {
      const e = record(raw);
      if (!e || typeof e.id !== "string" || !sequence(e.event_sequence) || typeof e.action !== "string" || typeof e.created_at !== "string") throw Error("invalid_event");
      return { id: e.id, eventSequence: e.event_sequence, action: e.action, actorUserId: stringOrNull(e.actor_user_id), revision: count(e.revision), automationGeneration: count(e.automation_generation), at: e.created_at };
    });
    return { ok: true, data: { ...pageMeta(row), companyId: input.companyId, conversationId: input.conversationId, events } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
/** Readiness is connection authorization only; each send still requires runtime window/quota fences. */
export async function loadWhatsappConnectionStatus(input: { companyId: string }): Promise<InboxResult<WhatsappConnectionStatus>> {
  if (!record(input) || typeof input.companyId !== "string" || !UUID.test(input.companyId)) return { ok: false, code: "INVALID_INPUT" };
  const result = await scopedRpc(input.companyId, "whatsapp_inbox_connection_status", {});
  if (!result.ok) return result;
  const c = record(result.data.row.connection);
  if (!c || typeof c.status !== "string" || typeof c.authorization_status !== "string" || typeof c.receive_ready !== "boolean" || typeof c.send_ready !== "boolean") return { ok: false, code: "UNAVAILABLE" };
  return { ok: true, data: { companyId: input.companyId, status: c.status, authorizationStatus: c.authorization_status,
    displayNumber: stringOrNull(c.display_number), receiveReady: c.receive_ready, sendReady: c.send_ready,
    inboundTestedAt: stringOrNull(c.inbound_tested_at), outboundTestedAt: stringOrNull(c.outbound_tested_at) } };
}
