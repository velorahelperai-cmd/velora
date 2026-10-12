import "server-only";
import { isCoexistenceWebhookEvent, type CoexistenceWebhookEvent } from "./webhook-events";

export type CoexistenceIngressClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
export type CoexistenceIngressFailure = "INVALID_INPUT" | "CONNECTION_UNAVAILABLE" | "IDENTITY_CONFLICT" | "NOT_COEXISTENCE" | "UNAVAILABLE";
export type CoexistenceIngressResult =
  | { ok: true; durable: true; receiptId: string; inserted: boolean; duplicate: boolean; bindingState: "active_link" | "signup_checkpoint"; projectionStatus: "projected" | "pending" | "conflict_review" }
  | { ok: false; durable: false; code: CoexistenceIngressFailure; retry: boolean };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const denied = (code: CoexistenceIngressFailure): CoexistenceIngressResult => ({ ok: false, durable: false, code, retry: code === "UNAVAILABLE" });

/** One bounded receipt transaction. No send, AI, job creation, or automatic transport retry here. */
export async function ingestCoexistenceWebhookEvent(client: CoexistenceIngressClient, input: unknown): Promise<CoexistenceIngressResult> {
  if (!isCoexistenceWebhookEvent(input)) return denied("INVALID_INPUT");
  // Scalars are copied before await; caller mutation cannot change receipt verification.
  const event: CoexistenceWebhookEvent = { ...input };
  try {
    const { data, error } = await client.rpc("whatsapp_ingest_coexistence_event", {
      p_waba_id: event.wabaId, p_phone_number_id: event.phoneNumberId, p_display_phone_number: event.displayPhoneNumber,
      p_kind: event.kind, p_event_key: event.eventKey, p_customer_wa_id: event.customerWaId,
      p_wa_message_id: event.waMessageId, p_direction: event.direction, p_message_type: event.messageType,
      p_body: event.body, p_provider_occurred_at: event.providerOccurredAt, p_contact_action: event.contactAction,
      p_contact_name: event.contactName, p_history_phase: event.historyPhase, p_history_chunk_order: event.historyChunkOrder,
      p_history_progress: event.historyProgress, p_history_error_code: event.historyErrorCode,
      p_disconnection_reason: event.disconnectionReason, p_initiated_by: event.initiatedBy, p_media_id: event.mediaId,
    });
    const row = record(data);
    if (error || !row) return denied("UNAVAILABLE");
    if (row.ok === false) {
      // These exact SQL denials mean no receipt was authorized. Other codes and
      // transport failures remain uncertain and require provider redelivery.
      if (row.code === "invalid_input") return denied("INVALID_INPUT");
      if (["unknown_or_ambiguous_asset", "binding_changed", "unknown_or_inactive", "stale_or_inactive_lifecycle"].includes(String(row.code))) return denied("CONNECTION_UNAVAILABLE");
      return denied(["INVALID_INPUT", "CONNECTION_UNAVAILABLE", "IDENTITY_CONFLICT", "NOT_COEXISTENCE"].includes(String(row.code)) ? row.code as CoexistenceIngressFailure : "UNAVAILABLE");
    }
    // A pre-finalization receipt belongs to a proven signup checkpoint, never a
    // fabricated verified link. It may be durable while projection remains pending.
    const activeBinding = row.binding_state === "active_link" && uuid(row.link_id)
      && Number.isSafeInteger(row.link_generation) && Number(row.link_generation) >= 1;
    const checkpointBinding = row.binding_state === "signup_checkpoint" && uuid(row.signup_attempt_id)
      && row.link_id === null && row.link_generation === null && ["pending", "conflict_review"].includes(String(row.projection_status));
    if (row.ok !== true || row.durable !== true || !uuid(row.receipt_id) || typeof row.inserted !== "boolean"
      || row.duplicate !== !row.inserted || !["projected", "pending", "conflict_review"].includes(String(row.projection_status))
      || row.event_key !== event.eventKey || row.kind !== event.kind || row.waba_id !== event.wabaId
      || row.display_phone_number !== (event.displayPhoneNumber?.slice(1) ?? null)
      || !uuid(row.company_id) || (!activeBinding && !checkpointBinding)
      || (event.phoneNumberId !== null && row.phone_number_id !== event.phoneNumberId)
      || (event.phoneNumberId === null && (typeof row.phone_number_id !== "string" || !/^[0-9]{1,64}$/.test(row.phone_number_id)))) return denied("UNAVAILABLE");
    return { ok: true, durable: true, receiptId: row.receipt_id, inserted: row.inserted, duplicate: !row.inserted,
      bindingState: row.binding_state as "active_link" | "signup_checkpoint",
      projectionStatus: row.projection_status as "projected" | "pending" | "conflict_review" };
  } catch {
    return denied("UNAVAILABLE");
  }
}
