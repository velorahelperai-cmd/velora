import type {
  Conversation,
  FollowUpStatus,
  LeadStage,
  ConversationStatus,
} from "@/lib/demo-state";
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
  assignees: InboxAssigneeOption[];
  counts: Record<LeadWorklist, number>;
};

const LEAD_SELECT =
  "id, customer_name, customer_wa_id, last_message_at, status, automation_allowed, automation_generation, control_revision, assigned_to, lead_stage, lead_stage_reason, internal_note, follow_up_status, follow_up_at, last_touch_at, lead_revision";

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

function mapMessageFrom(sender: string | null | undefined): Conversation["messages"][number]["from"] {
  if (sender === "staff") return "staff";
  if (sender === "assistant") return "assistant";
  return "customer";
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

async function loadAssigneeNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  assignedIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(assignedIds.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from("company_members")
    .select("user_id, member_name")
    .eq("company_id", companyId)
    .in("user_id", unique);
  if (error || !data) return map;

  for (const row of data) {
    const name = (row.member_name ?? "").trim();
    if (name) map.set(row.user_id, name);
  }
  return map;
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

/**
 * Load live inbox for the active company membership only.
 * Platform admin without operational membership gets NO_COMPANY (not all tenants).
 * Empty list ≠ load failure.
 */
export async function loadWhatsappInbox(): Promise<WhatsappInboxLoad> {
  const access = await getCompanyAccess();
  if (!access.ok) {
    if (access.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "NO_COMPANY" };
  }
  if (!access.context.company || !access.context.membership) {
    return { ok: false, code: "NO_COMPANY" };
  }

  try {
    const supabase = await createClient();
    const companyId = access.context.company.id;
    const userId = access.context.userId;

    const canRead = await sessionHasCompanyCapability(companyId, "wa.conversations.read");
    if (canRead === false) return { ok: false, code: "UNAVAILABLE" };

    const scope = await sessionConversationScope(companyId);
    if (canRead === true && scope === null) {
      return { ok: false, code: "UNAVAILABLE" };
    }

    const canReply = (await sessionHasCompanyCapability(companyId, "wa.conversations.reply")) === true;
    const canAssign = (await sessionHasCompanyCapability(companyId, "wa.conversations.assign")) === true;

    let timezoneRaw: string | null = null;
    const { data: companyTz } = await supabase
      .from("companies")
      .select("timezone")
      .eq("id", companyId)
      .maybeSingle();
    if (companyTz && typeof (companyTz as { timezone?: string | null }).timezone === "string") {
      timezoneRaw = (companyTz as { timezone: string }).timezone;
    } else if (companyTz && (companyTz as { timezone?: string | null }).timezone === null) {
      timezoneRaw = null;
    }

    let query = supabase
      .from("whatsapp_conversations")
      .select(LEAD_SELECT)
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false });
    if (scope === "assigned_only") {
      query = query.eq("assigned_to", userId);
    }

    const { data: conversations, error } = await query;
    if (error) return { ok: false, code: "UNAVAILABLE" };

    const { zone, announcedUtc } = resolveCompanyTimezone(timezoneRaw);
    const timezone = announcedUtc ? null : zone;
    const conversationScope = scope === "assigned_only" ? "assigned_only" : "all_company";

    if (!conversations?.length) {
      const emptyCounts = {
        all: 0,
        awaiting_staff: 0,
        follow_up_today: 0,
        overdue: 0,
        trial_or_quote: 0,
      } satisfies Record<LeadWorklist, number>;
      return {
        ok: true,
        conversations: [],
        meta: {
          companyId,
          conversationScope,
          timezone,
          timezoneAnnouncedUtc: announcedUtc,
          canReply,
          canAssign,
          assignees: canAssign ? await loadAssigneeOptions(supabase, companyId) : [],
          counts: emptyCounts,
        },
      };
    }

    const { data: messages, error: messagesError } = await supabase
      .from("whatsapp_messages")
      .select("id, conversation_id, body, received_at, sender, direction, delivery_state")
      .eq("company_id", companyId)
      .in("conversation_id", conversations.map((row) => row.id))
      .order("received_at", { ascending: true });
    if (messagesError) return { ok: false, code: "UNAVAILABLE" };

    const byConversation = new Map<string, Conversation["messages"]>();
    for (const message of messages ?? []) {
      const list = byConversation.get(message.conversation_id) ?? [];
      list.push({
        id: message.id,
        from: mapMessageFrom(message.sender),
        text: message.body,
        at: Date.parse(message.received_at),
        deliveryState:
          message.direction === "outbound" && message.delivery_state
            ? (message.delivery_state as Conversation["messages"][number]["deliveryState"])
            : undefined,
      });
      byConversation.set(message.conversation_id, list);
    }

    const assigneeNames = await loadAssigneeNames(
      supabase,
      companyId,
      conversations.map((row) => row.assigned_to).filter((id): id is string => Boolean(id)),
    );

    const mapped = (conversations as ConversationRow[]).map((row) =>
      mapWhatsappConversation(row, byConversation.get(row.id) ?? [], assigneeNames),
    );

    const nowMs = Date.now();
    const lists: LeadWorklist[] = [
      "all",
      "awaiting_staff",
      "follow_up_today",
      "overdue",
      "trial_or_quote",
    ];
    const counts = {} as Record<LeadWorklist, number>;
    for (const list of lists) {
      counts[list] = countLeadWorklist(mapped, list, nowMs, timezone);
    }

    return {
      ok: true,
      conversations: mapped,
      meta: {
        companyId,
        conversationScope,
        timezone,
        timezoneAnnouncedUtc: announcedUtc,
        canReply,
        canAssign,
        assignees: canAssign ? await loadAssigneeOptions(supabase, companyId) : [],
        counts,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function loadWhatsappConversation(conversationId: string): Promise<Conversation | null> {
  const access = await getCompanyAccess();
  if (!access.ok || !access.context.company || !conversationId) return null;

  const supabase = await createClient();
  const companyId = access.context.company.id;

  const canRead = await sessionHasCompanyCapability(companyId, "wa.conversations.read");
  if (canRead === false) return null;
  const scope = await sessionConversationScope(companyId);
  if (canRead === true && scope === null) return null;

  let query = supabase
    .from("whatsapp_conversations")
    .select(LEAD_SELECT)
    .eq("company_id", companyId)
    .eq("id", conversationId);
  if (scope === "assigned_only") {
    query = query.eq("assigned_to", access.context.userId);
  }

  const { data: row, error } = await query.maybeSingle();
  if (error || !row) return null;

  const { data: messages } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, body, received_at, sender, direction, delivery_state")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .order("received_at", { ascending: true });

  const thread: Conversation["messages"] = (messages ?? []).map((message) => ({
    id: message.id,
    from: mapMessageFrom(message.sender),
    text: message.body,
    at: Date.parse(message.received_at),
    deliveryState:
      message.direction === "outbound" && message.delivery_state
        ? (message.delivery_state as Conversation["messages"][number]["deliveryState"])
        : undefined,
  }));

  const assigneeNames = await loadAssigneeNames(
    supabase,
    companyId,
    row.assigned_to ? [row.assigned_to] : [],
  );

  return mapWhatsappConversation(row as ConversationRow, thread, assigneeNames);
}

export type { LeadWorklist, ManualLeadStage };
