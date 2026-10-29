import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { DeliveryStatus, InboundMessage } from "@/lib/whatsapp/webhook";
import { whatsappConfig, whatsappConfigurationMode, whatsappRoutingMode } from "@/lib/whatsapp/config";
import {
  SETUP_META_TEST_INBOUND_SCOPE,
  saveSetupMetaTestInboundReceiveOnly,
  SetupMetaTestInboundRejectError,
} from "@/lib/tenancy/setup-meta-test-inbound";
import { INBOUND_CLAIM_LEASE_SECONDS, type SaveInboundResult } from "@/lib/whatsapp/store-types";
import {createHash} from 'node:crypto';

type Admin = SupabaseClient<Database>;

export { INBOUND_CLAIM_LEASE_SECONDS, type SaveInboundResult, SetupMetaTestInboundRejectError };

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`save_inbound_${label}`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`whatsapp_rpc_${label}`);
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

  const tenantRegistry = whatsappRoutingMode() === "tenant_registry";
  if (tenantRegistry && !message.wabaId) throw new Error("meta_waba_required");
  const args = {
    p_company_id: companyId,
    p_phone_number_id: message.phoneNumberId,
    p_customer_wa_id: message.customerWaId,
    p_customer_name: message.customerName,
    p_wa_message_id: message.waMessageId,
    p_body: message.body,
    p_message_type: message.messageType,
    p_received_at: message.receivedAt,
  };
  const test = whatsappConfigurationMode()==='meta_test';
  if (test && companyId === SETUP_META_TEST_INBOUND_SCOPE.companyId) {
    // TAG CITY Setup Meta-test: receive/save-only fence. Never mint a review grant.
    return saveSetupMetaTestInboundReceiveOnly(admin, companyId, message);
  }
  const { data, error } = test
    ? await (admin as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:Json;error:unknown}>}).rpc('review_store_whatsapp_inbound',{...args,p_waba_id:message.wabaId,p_secret_sha256:createHash('sha256').update(whatsappConfig().appSecret).digest('hex')})
    : tenantRegistry
    ? await admin.rpc("whatsapp_store_meta_inbound", { ...args, p_waba_id: message.wabaId! })
    : await admin.rpc("save_whatsapp_inbound", args);

  if (error) throw error;

  const row = asRecord(data);
  if (!row || row.ok !== true) throw new Error("save_inbound_failed");
  if (typeof row.job_status !== "string" || !["pending", "claimed", "completed", "failed", "retry_wait", "dead_letter", "review_required"].includes(row.job_status)) {
    throw new Error("save_inbound_job_status");
  }

  return {
    inserted: requireBoolean(row.inserted, "inserted"),
    messageId: requireString(row.message_id, "message_id"),
    conversationId: requireString(row.conversation_id, "conversation_id"),
    jobId: requireString(row.job_id, "job_id"),
    jobStatus: row.job_status,
  };
}

/**
 * Persist a delivery/read status event with dedupe.
 * Links to a message only when company + phone + wa_message_id match — no guessing.
 * Unmatched events are kept for later safe rebind. Stale ranks do not overwrite newer state.
 * accepted is never stored as delivered.
 */
export async function saveStatus(admin: Admin, companyId: string, status: DeliveryStatus) {
  const tenantRegistry = whatsappRoutingMode() === "tenant_registry";
  if (tenantRegistry && !status.wabaId) throw new Error("meta_waba_required");
  const args = {
    p_company_id: companyId,
    p_phone_number_id: status.phoneNumberId,
    p_wa_message_id: status.waMessageId,
    p_status: status.status,
    p_recipient_wa_id: status.recipientWaId,
    p_occurred_at: status.occurredAt,
  };
  const { data, error } = tenantRegistry
    ? await admin.rpc("whatsapp_apply_meta_delivery_status", { ...args, p_waba_id: status.wabaId! })
    : await admin.rpc("apply_whatsapp_delivery_status", args);
  if (error) throw error;
  const row = asRecord(data);
  if (!row || row.ok !== true) throw new Error("save_status_failed");
  const inserted = requireBoolean(row.inserted, "inserted");
  // New-event SQL omits duplicate; replay SQL explicitly reports duplicate=true.
  if (inserted ? row.duplicate !== undefined && row.duplicate !== false : row.duplicate !== true) {
    throw new Error("save_status_result_invalid");
  }
  return { inserted, duplicate: !inserted };
}

/** Re-apply unmatched delivery events after an outbound message row exists. */
export async function rebindDeliveryStatuses(
  admin: Admin,
  input: { companyId: string; phoneNumberId: string; waMessageId: string },
) {
  const { data, error } = await admin.rpc("rebind_whatsapp_delivery_statuses", {
    p_company_id: input.companyId,
    p_phone_number_id: input.phoneNumberId,
    p_wa_message_id: input.waMessageId,
  });
  if (error) throw error;
  const row = asRecord(data);
  if (!row || row.ok !== true) throw new Error("rebind_status_failed");
  return {
    applied: Number(row.applied ?? 0),
    kept: Number(row.kept ?? 0),
  };
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
      delivery_state: "accepted",
      delivery_rank: 1,
      delivery_updated_at: sentAt,
    })
    .select("id, body, received_at, sender, delivery_state")
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
  if (row.job_id !== jobId || typeof row.claim_expires_at !== "string" || !Number.isFinite(Date.parse(row.claim_expires_at)) ||
      typeof row.attempt_count !== "number" || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 1) {
    throw new Error("claim_inbound_result_invalid");
  }
  return {
    ok: true as const,
    jobId: requireString(row.job_id, "job_id"),
    messageId: requireString(row.message_id, "message_id"),
    companyId: requireString(row.company_id, "company_id"),
    waMessageId: requireString(row.wa_message_id, "wa_message_id"),
    claimToken: requireString(row.claim_token, "claim_token"),
    claimExpiresAt: requireString(row.claim_expires_at, "claim_expires_at"),
    attemptCount: row.attempt_count,
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
  if (row.job_id !== input.jobId || row.status !== (input.ok ? "completed" : "failed")) {
    throw new Error("complete_inbound_result_invalid");
  }
  return {
    ok: true as const,
    jobId: requireString(row.job_id, "job_id"),
    status: String(row.status ?? ""),
    resultCode: typeof row.result_code === "string" ? row.result_code : null,
  };
}
