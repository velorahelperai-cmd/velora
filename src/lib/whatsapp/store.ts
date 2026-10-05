import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { DeliveryStatus, InboundMessage } from "@/lib/whatsapp/webhook";

type Admin = SupabaseClient<Database>;

/** Default processing lease (seconds). Contract only — no worker runs here. */
export const INBOUND_CLAIM_LEASE_SECONDS = 120;

export type SaveInboundResult = {
  inserted: boolean;
  messageId: string;
  conversationId: string;
  jobId: string;
  jobStatus: string;
};

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`save_inbound_${label}`);
  return value;
}

/**
 * Persist inbound message + conversation + processing job atomically via RPC.
 * Duplicate wa_message_id does not rewrite the original message; may repair job/conversation.
 */
export async function saveInbound(
  admin: Admin,
  companyId: string,
  message: InboundMessage,
): Promise<SaveInboundResult> {
  if (!companyId) throw new Error("company_required");

  const { data, error } = await admin.rpc("save_whatsapp_inbound", {
    p_company_id: companyId,
    p_phone_number_id: message.phoneNumberId,
    p_customer_wa_id: message.customerWaId,
    p_customer_name: message.customerName,
    p_wa_message_id: message.waMessageId,
    p_body: message.body,
    p_message_type: message.messageType,
    p_received_at: message.receivedAt,
  });

  if (error) throw error;

  const row = asRecord(data);
  if (!row || row.ok !== true) throw new Error("save_inbound_failed");

  return {
    inserted: Boolean(row.inserted),
    messageId: requireString(row.message_id, "message_id"),
    conversationId: requireString(row.conversation_id, "conversation_id"),
    jobId: requireString(row.job_id, "job_id"),
    jobStatus: typeof row.job_status === "string" ? row.job_status : "pending",
  };
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

/** Claim a processing job. Reclaim only when lease expired; does not insert a second job. */
export async function claimInboundJob(
  admin: Admin,
  jobId: string,
  leaseSeconds: number = INBOUND_CLAIM_LEASE_SECONDS,
) {
  const { data, error } = await admin.rpc("claim_whatsapp_inbound_job", {
    p_job_id: jobId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  const row = asRecord(data);
  if (!row) throw new Error("claim_inbound_failed");
  if (row.ok !== true) {
    return { ok: false as const, code: String(row.code ?? "not_claimable") };
  }
  return {
    ok: true as const,
    jobId: requireString(row.job_id, "job_id"),
    messageId: requireString(row.message_id, "message_id"),
    companyId: requireString(row.company_id, "company_id"),
    waMessageId: requireString(row.wa_message_id, "wa_message_id"),
    claimToken: requireString(row.claim_token, "claim_token"),
    claimExpiresAt: requireString(row.claim_expires_at, "claim_expires_at"),
    attemptCount: Number(row.attempt_count ?? 0),
  };
}

/** Complete only while the caller still holds a valid (unexpired) claim token. */
export async function completeInboundJob(
  admin: Admin,
  input: {
    jobId: string;
    claimToken: string;
    ok: boolean;
    resultCode?: string;
  },
) {
  const { data, error } = await admin.rpc("complete_whatsapp_inbound_job", {
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
    p_ok: input.ok,
    p_result_code: input.resultCode ?? null,
  });
  if (error) throw error;
  const row = asRecord(data);
  if (!row) throw new Error("complete_inbound_failed");
  if (row.ok !== true) {
    return { ok: false as const, code: String(row.code ?? "claim_rejected") };
  }
  return {
    ok: true as const,
    jobId: requireString(row.job_id, "job_id"),
    status: String(row.status ?? ""),
    resultCode: typeof row.result_code === "string" ? row.result_code : null,
  };
}
