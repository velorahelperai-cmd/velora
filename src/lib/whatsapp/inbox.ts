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

export function mapWhatsappConversation(
  row: ConversationRow,
  messages: Conversation["messages"],
  ownerLabel: string,
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
    owner: automationAllowed ? "assistant" : (row.assigned_to ? ownerLabel : "staff"),
    assistantPaused: !automationAllowed,
    automationAllowed,
    automationGeneration: row.automation_generation ?? 0,
    revision: row.control_revision ?? 1,
    messages,
  };
}

export async function loadWhatsappInbox(): Promise<Conversation[]> {
  const access = await getCompanyAccess();
  if (!access.ok || !access.context.company) return [];

  const supabase = await createClient();
  const companyId = access.context.company.id;
  const ownerLabel = access.context.fullName || access.context.membership?.member_name || "staff";

  const { data: conversations, error } = await supabase
    .from("whatsapp_conversations")
    .select(
      "id, customer_name, customer_wa_id, last_message_at, status, automation_allowed, automation_generation, control_revision, assigned_to",
    )
    .eq("company_id", companyId)
    .order("last_message_at", { ascending: false });
  if (error || !conversations?.length) return [];

  const { data: messages } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, body, received_at, sender, direction")
    .eq("company_id", companyId)
    .in("conversation_id", conversations.map((row) => row.id))
    .order("received_at", { ascending: true });

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
    });
    byConversation.set(message.conversation_id, list);
  }

  return (conversations as ConversationRow[]).map((row) =>
    mapWhatsappConversation(row, byConversation.get(row.id) ?? [], ownerLabel),
  );
}

export async function loadWhatsappConversation(conversationId: string): Promise<Conversation | null> {
  const access = await getCompanyAccess();
  if (!access.ok || !access.context.company || !conversationId) return null;

  const supabase = await createClient();
  const companyId = access.context.company.id;
  const ownerLabel = access.context.fullName || access.context.membership?.member_name || "staff";

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
    .select("id, conversation_id, body, received_at, sender, direction")
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
  }));

  return mapWhatsappConversation(row as ConversationRow, thread, ownerLabel);
}
