import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { DeliveryStatus, InboundMessage } from "@/lib/whatsapp/webhook";

type Admin = SupabaseClient<Database>;

async function conversationId(admin: Admin, companyId: string, message: InboundMessage) {
  const match = {
    company_id: companyId,
    phone_number_id: message.phoneNumberId,
    customer_wa_id: message.customerWaId,
  };
  const existing = await admin
    .from("whatsapp_conversations")
    .select("id")
    .match(match)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;

  const created = await admin
    .from("whatsapp_conversations")
    .insert({
      ...match,
      customer_name: message.customerName,
      last_message_at: message.receivedAt,
    })
    .select("id")
    .single();
  if (created.data?.id) return created.data.id;
  if (created.error?.code !== "23505") throw created.error ?? new Error("conversation insert failed");

  const raced = await admin.from("whatsapp_conversations").select("id").match(match).maybeSingle();
  if (!raced.data?.id) throw raced.error ?? new Error("conversation missing");
  return raced.data.id;
}

export async function saveInbound(admin: Admin, companyId: string, message: InboundMessage) {
  const conversation = await conversationId(admin, companyId, message);
  const inserted = await admin
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      conversation_id: conversation,
      wa_message_id: message.waMessageId,
      body: message.body,
      message_type: message.messageType,
      direction: "inbound",
      sender: "customer",
      received_at: message.receivedAt,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error?.code === "23505") return { inserted: false as const };
  if (inserted.error) throw inserted.error;

  const updated = await admin
    .from("whatsapp_conversations")
    .update({
      last_message_at: message.receivedAt,
      ...(message.customerName ? { customer_name: message.customerName } : {}),
    })
    .eq("id", conversation)
    .eq("company_id", companyId);
  if (updated.error) throw updated.error;

  return { inserted: true as const };
}

export async function saveStatus(admin: Admin, companyId: string, status: DeliveryStatus) {
  const inserted = await admin.from("whatsapp_delivery_statuses").insert({
    company_id: companyId,
    phone_number_id: status.phoneNumberId,
    wa_message_id: status.waMessageId,
    status: status.status,
    recipient_wa_id: status.recipientWaId,
    occurred_at: status.occurredAt,
  });
  if (inserted.error?.code === "23505") return { inserted: false as const };
  if (inserted.error) throw inserted.error;
  return { inserted: true as const };
}

export async function saveOutbound(
  admin: Admin,
  input: {
    companyId: string;
    conversationId: string;
    waMessageId: string;
    body: string;
    sentAt?: string;
  },
) {
  const sentAt = input.sentAt ?? new Date().toISOString();
  const inserted = await admin
    .from("whatsapp_messages")
    .insert({
      company_id: input.companyId,
      conversation_id: input.conversationId,
      wa_message_id: input.waMessageId,
      body: input.body,
      message_type: "text",
      direction: "outbound",
      sender: "staff",
      received_at: sentAt,
    })
    .select("id, body, received_at, sender")
    .maybeSingle();
  if (inserted.error?.code === "23505") return { inserted: false as const, row: null };
  if (inserted.error) throw inserted.error;

  const updated = await admin
    .from("whatsapp_conversations")
    .update({ last_message_at: sentAt })
    .eq("id", input.conversationId)
    .eq("company_id", input.companyId);
  if (updated.error) throw updated.error;

  return { inserted: true as const, row: inserted.data };
}
