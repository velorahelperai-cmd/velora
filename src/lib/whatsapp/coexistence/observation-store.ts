import "server-only";

export type CoexistenceObservation = {
  companyId: string; linkId: string; linkGeneration: number;
  wabaId: string; phoneNumberId: string;
  kind: "history" | "mobile_echo";
  customerWaId: string; waMessageId: string;
  direction: "inbound" | "outbound";
  messageType: string; body: string; providerOccurredAt: string;
};
export type CoexistenceObservationClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type CoexistenceObservationFailureCode = "INVALID_INPUT" | "CONNECTION_UNAVAILABLE" | "IDENTITY_CONFLICT" | "UNAVAILABLE";
export type CoexistenceObservationResult =
  | { ok: true; durable: true; receiptId: string; inserted: boolean; duplicate: boolean; projectionStatus: "pending" }
  | { ok: false; durable: false; code: CoexistenceObservationFailureCode };

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const assetId = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,64}$/.test(value);
const identifier = (value: unknown, max: number): value is string => typeof value === "string"
  && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f]/.test(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object"
  && !Array.isArray(value) ? value as Record<string, unknown> : null;
function failure(code: CoexistenceObservationFailureCode): CoexistenceObservationResult {
  return { ok: false, durable: false, code };
}
function valid(input: CoexistenceObservation): boolean {
  if (!input || !uuid(input.companyId) || !uuid(input.linkId) || !Number.isSafeInteger(input.linkGeneration)
    || input.linkGeneration < 1 || !assetId(input.wabaId) || !assetId(input.phoneNumberId)
    || !["history", "mobile_echo"].includes(input.kind)
    || !identifier(input.customerWaId, 128) || !identifier(input.waMessageId, 512)
    || !["inbound", "outbound"].includes(input.direction)
    || (input.kind === "mobile_echo" && input.direction !== "outbound")
    || typeof input.messageType !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(input.messageType)
    || typeof input.body !== "string" || input.body.length > 8192 || Array.from(input.body).length > 4096
    || /\u0000/.test(input.body) || Array.from(input.body).some(char => /^[\ud800-\udfff]$/.test(char))
    || typeof input.providerOccurredAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.providerOccurredAt)) return false;
  const time = Date.parse(input.providerOccurredAt);
  return Number.isFinite(time) && time > 0 && new Date(time).toISOString() === input.providerOccurredAt;
}

/**
 * Receipts only. Caller must supply normalized evidence from authenticated server ingress.
 * The database independently revalidates exact tenant/link/generation/Meta authorization.
 * An unknown transport outcome is never retried here or acknowledged as durable.
 */
export async function recordCoexistenceObservation(
  client: CoexistenceObservationClient, input: CoexistenceObservation,
): Promise<CoexistenceObservationResult> {
  if (!valid(input)) return failure("INVALID_INPUT");
  // PostgreSQL serializes UUIDs in lowercase. Freeze the normalized scalar
  // snapshot before awaiting persistence so caller mutation cannot change binding.
  const normalized: CoexistenceObservation = {
    companyId: input.companyId.toLowerCase(), linkId: input.linkId.toLowerCase(), linkGeneration: input.linkGeneration,
    wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, kind: input.kind,
    customerWaId: input.customerWaId, waMessageId: input.waMessageId, direction: input.direction,
    messageType: input.messageType, body: input.body, providerOccurredAt: input.providerOccurredAt,
  };
  try {
    const { data, error } = await client.rpc("whatsapp_record_coexistence_observation", {
      p_company_id: normalized.companyId, p_link_id: normalized.linkId, p_link_generation: normalized.linkGeneration,
      p_waba_id: normalized.wabaId, p_phone_number_id: normalized.phoneNumberId, p_kind: normalized.kind,
      p_customer_wa_id: normalized.customerWaId, p_wa_message_id: normalized.waMessageId,
      p_direction: normalized.direction, p_message_type: normalized.messageType, p_body: normalized.body,
      p_provider_occurred_at: normalized.providerOccurredAt,
    });
    const row = record(data);
    if (error || !row) return failure("UNAVAILABLE");
    if (row.ok === false) {
      const code = row.code;
      return failure(code === "INVALID_INPUT" || code === "CONNECTION_UNAVAILABLE" || code === "IDENTITY_CONFLICT"
        ? code : "UNAVAILABLE");
    }
    if (row.ok !== true || !uuid(row.receipt_id) || typeof row.inserted !== "boolean"
      || row.duplicate !== !row.inserted || row.projection_status !== "pending"
      || row.company_id !== normalized.companyId || row.link_id !== normalized.linkId
      || row.link_generation !== normalized.linkGeneration || row.waba_id !== normalized.wabaId
      || row.phone_number_id !== normalized.phoneNumberId || row.kind !== normalized.kind
      || row.wa_message_id !== normalized.waMessageId) return failure("UNAVAILABLE");
    return { ok: true, durable: true, receiptId: row.receipt_id,
      inserted: row.inserted, duplicate: !row.inserted, projectionStatus: "pending" };
  } catch {
    return failure("UNAVAILABLE");
  }
}
