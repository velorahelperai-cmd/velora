import type { Conversation } from "@/lib/demo-state";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";

export async function loadWhatsappInbox(): Promise<Conversation[]> {
  const access = await getCompanyAccess();
  if (!access.ok || !access.context.company) return [];

  const supabase = await createClient();
  const companyId = access.context.company.id;
  const { data: conversations, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, customer_name, customer_wa_id, last_message_at")
    .eq("company_id", companyId)
    .order("last_message_at", { ascending: false });
  if (error || !conversations?.length) return [];

  const { data: messages } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, body, received_at")
    .eq("company_id", companyId)
    .in("conversation_id", conversations.map((row) => row.id))
    .order("received_at", { ascending: true });

  const byConversation = new Map<string, Conversation["messages"]>();
  for (const message of messages ?? []) {
    const list = byConversation.get(message.conversation_id) ?? [];
    list.push({
      id: message.id,
      from: "customer",
      text: message.body,
      at: Date.parse(message.received_at),
    });
    byConversation.set(message.conversation_id, list);
  }

  return conversations.map((row) => {
    const thread = byConversation.get(row.id) ?? [];
    const latest = thread[thread.length - 1]?.text ?? "";
    return {
      id: row.id,
      customer: row.customer_name || row.customer_wa_id,
      phone: row.customer_wa_id,
      topic: "واتساب",
      summary: latest,
      status: "open",
      owner: "staff",
      assistantPaused: true,
      messages: thread,
    };
  });
}
