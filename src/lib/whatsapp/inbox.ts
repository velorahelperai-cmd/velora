import type { Conversation, ConversationStatus } from "@/lib/demo-state";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";

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
};

function mapStatus(status: string): ConversationStatus {
  if (status === "resolved") return "resolved";
  if (status === "handed_over") return "handed_over";
  return "open";
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

  // Members can read teammate names via existing company_members select policies.
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

export type WhatsappInboxLoad =
  | { ok: true; conversations: Conversation[] }
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
  // Admin-only sessions without company membership must not browse every tenant inbox here.
  if (!access.context.company || !access.context.membership) {
    return { ok: false, code: "NO_COMPANY" };
  }

  try {
    const supabase = await createClient();
    const companyId = access.context.company.id;

    const { data: conversations, error } = await supabase
      .from("whatsapp_conversations")
      .select(
        "id, customer_name, customer_wa_id, last_message_at, status, automation_allowed, automation_generation, control_revision, assigned_to",
      )
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false });
    if (error) return { ok: false, code: "UNAVAILABLE" };
    if (!conversations?.length) return { ok: true, conversations: [] };

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
      const from =
        message.sender === "staff" || message.direction === "outbound"
          ? "staff"
          : message.sender === "assistant"
            ? "assistant"
            : "customer";
      list.push({
        id: message.id,
        from,
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

    return {
      ok: true,
      conversations: (conversations as ConversationRow[]).map((row) =>
        mapWhatsappConversation(row, byConversation.get(row.id) ?? [], assigneeNames),
      ),
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

  const { data: row, error } = await supabase
    .from("whatsapp_conversations")
    .select(
      "id, customer_name, customer_wa_id, last_message_at, status, automation_allowed, automation_generation, control_revision, assigned_to",
    )
    .eq("company_id", companyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !row) return null;

  const { data: messages } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, body, received_at, sender, direction, delivery_state")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .order("received_at", { ascending: true });

  const thread: Conversation["messages"] = (messages ?? []).map((message) => ({
    id: message.id,
    from:
      message.sender === "staff" || message.direction === "outbound"
        ? "staff"
        : message.sender === "assistant"
          ? "assistant"
          : "customer",
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
