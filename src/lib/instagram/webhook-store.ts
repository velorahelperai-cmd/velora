import "server-only";
import type { InstagramRpcClient } from "./connection-store";
import type { InstagramWebhookEvent, RawProviderTimestamp } from "./webhook-contracts";
import type { InstagramWebhookPersistenceBatch, InstagramWebhookRoutePorts } from "./webhook-route";

const id = (v: unknown): v is string => typeof v === "string" && /^\d{1,64}$/.test(v);
const timestamp = (v: unknown): v is RawProviderTimestamp | undefined => v === undefined || v === null || typeof v === "string" || typeof v === "number" && Number.isFinite(v);
function capture(batch: InstagramWebhookPersistenceBatch): InstagramWebhookPersistenceBatch {
  const { rawBodySha256, localReceivedAt, events: supplied } = batch;
  if (!/^[0-9a-f]{64}$/.test(rawBodySha256) || typeof localReceivedAt !== "string" || !Number.isFinite(Date.parse(localReceivedAt)) || !Array.isArray(supplied)) throw Error("INVALID_BATCH");
  const events = supplied.map((event): InstagramWebhookEvent => {
    const { professionalAccountId, senderId, recipientId, messageId, rawTimestamp, rawEntryTimestamp, kind } = event;
    if (![professionalAccountId, senderId, recipientId].every(id) || typeof messageId !== "string" || !messageId || /[\s\x00-\x1f\x7f]/.test(messageId)
      || (senderId === professionalAccountId) === (recipientId === professionalAccountId) || !timestamp(rawTimestamp) || !timestamp(rawEntryTimestamp)) throw Error("INVALID_EVENT");
    const common = { professionalAccountId, senderId, recipientId, messageId, ...(rawTimestamp === undefined ? {} : { rawTimestamp }), ...(rawEntryTimestamp === undefined ? {} : { rawEntryTimestamp }) };
    if (kind === "read") return Object.freeze({ ...common, kind });
    if (kind !== "message" || ![true, false, null].includes(event.isEcho) || event.direction !== (recipientId === professionalAccountId ? "inbound" : "outbound") || event.isEcho === true && event.direction !== "outbound") throw Error("INVALID_EVENT");
    const content = event.content.kind === "non_text" ? { kind: "non_text" as const }
      : event.content.kind === "text" && typeof event.content.text === "string" && event.content.text.length ? { kind: "text" as const, text: event.content.text } : null;
    if (!content) throw Error("INVALID_CONTENT");
    return Object.freeze({ ...common, kind, direction: event.direction, isEcho: event.isEcho, content: Object.freeze(content) });
  });
  return Object.freeze({ rawBodySha256, localReceivedAt, events: Object.freeze(events) });
}
function committed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value), status = Object.getOwnPropertyDescriptor(value, "status");
  return (prototype === Object.prototype || prototype === null) && keys.length === 1 && keys[0] === "status" && !!status && "value" in status && status.value === "committed";
}
/** Trusted server-internal RPC only. The injected standard POST client must resolve
 * after transaction commit; SQL rows inside an open transaction are not durability.
 * No raw payload, company/generation input, logs, fallback queue or internal retry. */
export function createInstagramWebhookPersistence(server: InstagramRpcClient): NonNullable<InstagramWebhookRoutePorts["persist"]> {
  return async batch => {
    try {
      const captured = capture(batch);
      const result = await server.rpc("instagram_ingest_webhook", { p_batch: captured });
      return { status: !result.error && committed(result.data) ? "committed" : "retryable" };
    } catch { return { status: "retryable" }; }
  };
}
