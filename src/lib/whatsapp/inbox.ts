import type {
  Conversation,
  FollowUpStatus,
  LeadStage,
  ConversationStatus,
} from "@/lib/demo-state";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import {
  sessionConversationScope,
  sessionHasCompanyCapability,
} from "@/lib/access/actions";
import {
  countLeadWorklist,
  isManualLeadStage,
  resolveCompanyTimezone,
  type LeadWorklist,
  type ManualLeadStage,
} from "@/lib/whatsapp/leads";

type ConversationRow = {
  id: string;
  customer_name: string;
  customer_wa_id: string;
  last_message_at: string;
  status: string;
  automation_allowed: boolean;
  automation_generation: number;
  control_revision: number;
  assigned_to: string | null;
  lead_stage?: string | null;
  lead_stage_reason?: string | null;
  internal_note?: string | null;
  follow_up_status?: string | null;
  follow_up_at?: string | null;
  last_touch_at?: string | null;
  lead_revision?: number | null;
};

export type InboxAssigneeOption = {
  userId: string;
  name: string;
};

export type WhatsappInboxMeta = {
  /** Active company for this load — used to detect workspace switches on refresh. */
  companyId: string;
  /** all_company | assigned_only — paired with companyId for snapshot scope. */
  conversationScope: "all_company" | "assigned_only";
  timezone: string | null;
  timezoneAnnouncedUtc: boolean;
  canReply: boolean;
  canAssign: boolean;
  canTakeOver?: boolean;
  canResume?: boolean;
  canClose?: boolean;
  assignees: InboxAssigneeOption[];
  counts: Record<LeadWorklist, number>;
};

function mapStatus(status: string): ConversationStatus {
  if (status === "resolved") return "resolved";
  if (status === "handed_over") return "handed_over";
  return "open";
}

function mapLeadStage(value: string | null | undefined): LeadStage {
  if (value && isManualLeadStage(value)) return value;
  return "new";
}

function mapFollowUpStatus(value: string | null | undefined): FollowUpStatus {
  if (value === "scheduled" || value === "completed" || value === "cancelled" || value === "none") {
    return value;
  }
  return "none";
}

/** Honest owner label: assistant, real assignee name when readable, else generic staff. */
function ownerLabelFor(
  automationAllowed: boolean,
  assignedTo: string | null,
  assigneeNames: Map<string, string>,
): string {
  if (automationAllowed) return "assistant";
  if (assignedTo) {
    const name = assigneeNames.get(assignedTo)?.trim();
    if (name) return name;
  }
  return "staff";
}

export function mapWhatsappConversation(
  row: ConversationRow,
  messages: Conversation["messages"],
  assigneeNames: Map<string, string>,
): Conversation {
  const automationAllowed = Boolean(row.automation_allowed);
  const status = mapStatus(row.status);
  const latest = messages[messages.length - 1]?.text ?? "";
  return {
    id: row.id,
    customer: row.customer_name || row.customer_wa_id,
    phone: row.customer_wa_id,
    topic: "واتساب",
    summary: latest,
    status,
    owner: ownerLabelFor(automationAllowed, row.assigned_to, assigneeNames),
    assistantPaused: !automationAllowed,
    automationAllowed,
    automationGeneration: row.automation_generation ?? 0,
    revision: row.control_revision ?? 1,
    messages,
    leadStage: mapLeadStage(row.lead_stage),
    leadStageReason: row.lead_stage_reason ?? "",
    internalNote: row.internal_note ?? "",
    followUpStatus: mapFollowUpStatus(row.follow_up_status),
    followUpAt: row.follow_up_at ?? null,
    lastTouchAt: row.last_touch_at ?? null,
    leadRevision: row.lead_revision ?? 1,
    assignedTo: row.assigned_to,
  };
}

async function loadAssigneeOptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
): Promise<InboxAssigneeOption[]> {
  const { data, error } = await supabase
    .from("company_members")
    .select("user_id, member_name")
    .eq("company_id", companyId)
    .eq("status", "active")
    .in("role", ["owner", "staff"])
    .order("member_name", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    userId: row.user_id,
    name: (row.member_name ?? "").trim() || row.user_id.slice(0, 8),
  }));
}

export type WhatsappInboxLoad =
  | { ok: true; conversations: Conversation[]; meta: WhatsappInboxMeta }
  | { ok: false; code: "NO_COMPANY" | "UNAVAILABLE" };

/** A bounded initial UI page. Worklist counts describe only the loaded page. */
export async function loadWhatsappInboxInitialPage(): Promise<
  | { ok: true; conversations: import("./inbox-contracts").WhatsappInboxItem[]; meta: WhatsappInboxMeta; page: import("./inbox-contracts").WhatsappInboxPage }
  | { ok: false; code: "NO_COMPANY" | "FORBIDDEN" | "UNAVAILABLE" }
> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok || !access.context.company || !access.context.membership) return { ok: false, code: access.ok || access.code !== "UNAVAILABLE" ? "NO_COMPANY" : "UNAVAILABLE" };
    const companyId = access.context.company.id;
    const scope = await sessionConversationScope(companyId);
    if ((scope !== "all_company" && scope !== "assigned_only") || await sessionHasCompanyCapability(companyId, "wa.conversations.read") !== true) return { ok: false, code: "UNAVAILABLE" };
    const { loadWhatsappInboxPage } = await import("./inbox-contracts");
    const page = await loadWhatsappInboxPage({ companyId, limit: 40 });
    if (!page.ok) return { ok: false, code: page.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE" };
    if (page.data.companyId !== companyId || page.data.conversationScope !== scope) return { ok: false, code: "UNAVAILABLE" };
    const client = await createClient();
    const [timezoneRow, permissions] = await Promise.all([
      client.from("companies").select("timezone").eq("id", companyId).maybeSingle(),
      Promise.all((["wa.conversations.reply", "wa.conversations.assign", "wa.conversations.take_over", "wa.conversations.resume", "wa.conversations.close"] as const).map(capability => sessionHasCompanyCapability(companyId, capability))),
    ]);
    if (timezoneRow.error) return { ok: false, code: "UNAVAILABLE" };
    const { zone, announcedUtc } = resolveCompanyTimezone((timezoneRow.data as { timezone?: string | null } | null)?.timezone ?? null);
    const timezone = announcedUtc ? null : zone;
    const [canReply, canAssign, canTakeOver, canResume, canClose] = permissions.map(value => value === true);
    const assignees = canAssign ? await loadAssigneeOptions(client, companyId) : [];
    const current = await getCompanyAccess();
    if (!current.ok || current.context.company?.id !== companyId || await sessionConversationScope(companyId) !== scope || await sessionHasCompanyCapability(companyId, "wa.conversations.read") !== true) return { ok: false, code: "UNAVAILABLE" };
    const lists: LeadWorklist[] = ["all", "awaiting_staff", "follow_up_today", "overdue", "trial_or_quote"];
    const counts = Object.fromEntries(lists.map(list => [list, countLeadWorklist(page.data.conversations, list, Date.now(), timezone)])) as Record<LeadWorklist, number>;
    return { ok: true, conversations: page.data.conversations, page: page.data, meta: {
      companyId, conversationScope: scope, timezone, timezoneAnnouncedUtc: announcedUtc, canReply, canAssign,
      canTakeOver, canResume, canClose, assignees, counts,
    } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

/**
 * Load live inbox for the active company membership only.
 * Platform admin without operational membership gets NO_COMPANY (not all tenants).
 * Empty list ≠ load failure.
 */
export async function loadWhatsappInbox(): Promise<WhatsappInboxLoad> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return { ok: false, code: access.code === "UNAVAILABLE" ? "UNAVAILABLE" : "NO_COMPANY" };
    if (!access.context.company || !access.context.membership) return { ok: false, code: "NO_COMPANY" };
    const companyId = access.context.company.id;
    if (await sessionHasCompanyCapability(companyId, "wa.conversations.read") !== true) return { ok: false, code: "UNAVAILABLE" };
    const scope = await sessionConversationScope(companyId);
    if (scope !== "all_company" && scope !== "assigned_only") return { ok: false, code: "UNAVAILABLE" };
    const { loadWhatsappInboxPage } = await import("./inbox-contracts");
    const conversations: Conversation[] = [];
    let membershipFingerprint: string | null = null;
    let before: string | null = null;
    // Compatibility ceiling is explicit: failure is never returned as a truncated full snapshot.
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page = await loadWhatsappInboxPage({ companyId, limit: 100, before });
      if (!page.ok || page.data.conversationScope !== scope) return { ok: false, code: "UNAVAILABLE" };
      membershipFingerprint ??= page.data.membershipFingerprint;
      if (page.data.membershipFingerprint !== membershipFingerprint) return { ok: false, code: "UNAVAILABLE" };
      for (const row of page.data.conversations) {
        const complete = await loadCompleteThread(companyId, row.id);
        if (!complete) return { ok: false, code: "UNAVAILABLE" };
        conversations.push(complete);
      }
      if (!page.data.hasMore) break;
      if (pageNumber === 19 || page.data.nextCursor === before) return { ok: false, code: "UNAVAILABLE" };
      before = page.data.nextCursor;
    }
    const supabase = await createClient();
    const { data: companyTz, error: timezoneError } = await supabase.from("companies").select("timezone").eq("id", companyId).maybeSingle();
    if (timezoneError) return { ok: false, code: "UNAVAILABLE" };
    const { zone, announcedUtc } = resolveCompanyTimezone((companyTz as { timezone?: string | null } | null)?.timezone ?? null);
    const timezone = announcedUtc ? null : zone;
    const canReply = await sessionHasCompanyCapability(companyId, "wa.conversations.reply") === true;
    const canAssign = await sessionHasCompanyCapability(companyId, "wa.conversations.assign") === true;
    const lists: LeadWorklist[] = ["all", "awaiting_staff", "follow_up_today", "overdue", "trial_or_quote"];
    const now = Date.now();
    const counts = Object.fromEntries(lists.map(list => [list, countLeadWorklist(conversations, list, now, timezone)])) as Record<LeadWorklist, number>;
    // Recheck selection after the complete traversal; a workspace switch cannot publish a stale full snapshot.
    const current = await getCompanyAccess();
    if (!current.ok || current.context.company?.id !== companyId || await sessionConversationScope(companyId) !== scope
      || await sessionHasCompanyCapability(companyId, "wa.conversations.read") !== true) return { ok: false, code: "UNAVAILABLE" };
    const finalMembership = await loadWhatsappInboxPage({ companyId, limit: 1 });
    const collectedIds = conversations.map(row => row.id.toLowerCase());
    const collectedFingerprint = createHash("md5").update(collectedIds.sort().join(",")).digest("hex");
    if (!finalMembership.ok || finalMembership.data.membershipFingerprint !== membershipFingerprint
      || finalMembership.data.conversationScope !== scope || new Set(collectedIds).size !== collectedIds.length
      || collectedIds.length !== finalMembership.data.total || collectedFingerprint !== finalMembership.data.membershipFingerprint) return { ok: false, code: "UNAVAILABLE" };
    return { ok: true, conversations, meta: { companyId, conversationScope: scope, timezone,
      timezoneAnnouncedUtc: announcedUtc, canReply, canAssign,
      assignees: canAssign ? await loadAssigneeOptions(supabase, companyId) : [], counts } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

async function loadCompleteThread(companyId: string, conversationId: string): Promise<Conversation | null> {
  const { loadWhatsappThreadPage } = await import("./inbox-contracts");
  let before: string | null = null;
  let conversation: Conversation | null = null;
  const byId = new Map<string, Conversation["messages"][number] & { arrivalSequence: string }>();
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await loadWhatsappThreadPage({ companyId, conversationId, limit: 100, before });
    if (!page.ok) return null;
    if (!conversation) conversation = page.data.conversation;
    for (const message of page.data.messages) byId.set(message.id, message);
    if (!page.data.hasMore) {
      const messages = [...byId.values()].sort((a, b) => BigInt(a.arrivalSequence) < BigInt(b.arrivalSequence) ? -1 : 1);
      return { ...conversation, messages, summary: messages[messages.length - 1]?.text ?? "" };
    }
    if (pageNumber === 99 || page.data.nextCursor === before) return null;
    before = page.data.nextCursor;
  }
  return null;
}

export async function loadWhatsappConversation(conversationId: string): Promise<Conversation | null> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok || !access.context.company || !access.context.membership || !conversationId) return null;
    const companyId = access.context.company.id;
    if (await sessionHasCompanyCapability(companyId, "wa.conversations.read") !== true || await sessionConversationScope(companyId) === null) return null;
    return await loadCompleteThread(companyId, conversationId);
  } catch { return null; }
}

export type { LeadWorklist, ManualLeadStage };
