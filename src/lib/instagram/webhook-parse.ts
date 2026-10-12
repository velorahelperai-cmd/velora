import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ParentWebhookSecret, RawProviderTimestamp, InstagramWebhookEvent,
  IgnoredWebhookReason, InstagramWebhookParseResult,
} from "./webhook-contracts";

/** Pure server verifier. A synthetic match does not prove deployed secret mapping. */
export function verifyInstagramWebhookSignature(
  rawBody: Uint8Array, signatureHeaders: readonly string[], secret: ParentWebhookSecret,
): boolean {
  try {
    if (!(rawBody instanceof Uint8Array) || !Array.isArray(signatureHeaders) || signatureHeaders.length !== 1
      || typeof signatureHeaders[0] !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signatureHeaders[0])
      || secret?.source !== "parent_webhook_app" || typeof secret.value !== "string"
      || !secret.value || secret.value !== secret.value.trim()) return false;
    const expected = createHmac("sha256", secret.value).update(rawBody).digest();
    const supplied = Buffer.from(signatureHeaders[0].slice(7), "hex");
    return timingSafeEqual(expected, supplied);
  } catch { return false; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function accountId(value: unknown): value is string { return typeof value === "string" && /^\d{1,64}$/.test(value); }
function messageId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !/[\s\x00-\x1f\x7f]/.test(value); }
function timestamp(value: unknown): value is RawProviderTimestamp | undefined {
  return value === undefined || value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function validAttachment(value: unknown): boolean {
  const item = record(value);
  return item !== null && typeof item.type === "string" && item.type.length > 0 && item.type === item.type.trim()
    && (item.payload === undefined || record(item.payload) !== null);
}

/**
 * Pure parsing of already authenticated Instagram messaging evidence.
 * No tenant lookup/authority, durable deduplication, HTML rendering, attachment
 * fetching, delivery claims or time-unit/window inference. Missing echo stays null.
 * The route/store must verify raw bytes first and resolve historical bindings.
 */
export function parseInstagramWebhookPayload(payload: unknown): InstagramWebhookParseResult {
  try {
    const root = record(payload);
    if (!root || typeof root.object !== "string") return { ok: false, code: "INVALID_PAYLOAD" };
    if (root.object !== "instagram") return { ok: true, events: [], ignored: [{ reason: "UNSUPPORTED_OBJECT" }] };
    if (!Array.isArray(root.entry)) return { ok: false, code: "INVALID_PAYLOAD" };
    const events: InstagramWebhookEvent[] = [];
    const ignored: { reason: IgnoredWebhookReason }[] = [];
    const ignore = (reason: IgnoredWebhookReason) => { ignored.push({ reason }); };
    for (const rawEntry of root.entry) {
      const entry = record(rawEntry);
      if (!entry || !accountId(entry.id) || !Array.isArray(entry.messaging) || !timestamp(entry.time)) {
        ignore("MALFORMED_ENTRY"); continue;
      }
      const professionalAccountId = entry.id;
      for (const rawEvent of entry.messaging) {
        const event = record(rawEvent);
        if (!event) { ignore("MALFORMED_EVENT"); continue; }
        const hasMessage = event.message !== undefined, hasRead = event.read !== undefined;
        if (!hasMessage && !hasRead) { ignore("UNSUPPORTED_EVENT"); continue; }
        const senderId = record(event.sender)?.id, recipientId = record(event.recipient)?.id;
        if (hasMessage && hasRead || !accountId(senderId) || !accountId(recipientId) || !timestamp(event.timestamp)) {
          ignore("MALFORMED_EVENT"); continue;
        }
        // Exactly one participant must be the entry's professional account.
        const incoming = recipientId === professionalAccountId, outgoing = senderId === professionalAccountId;
        if (incoming === outgoing) { ignore("ACCOUNT_MISMATCH"); continue; }
        const common = {
          professionalAccountId, senderId, recipientId,
          rawTimestamp: event.timestamp, rawEntryTimestamp: entry.time,
        };
        if (hasRead) {
          const read = record(event.read);
          if (!read || !messageId(read.mid)) { ignore("MALFORMED_EVENT"); continue; }
          events.push({ ...common, kind: "read", messageId: read.mid }); continue;
        }
        const message = record(event.message);
        if (!message || !messageId(message.mid) || (message.is_echo !== undefined && typeof message.is_echo !== "boolean")) {
          ignore("MALFORMED_EVENT"); continue;
        }
        if (message.is_echo === true && !outgoing) { ignore("ACCOUNT_MISMATCH"); continue; }
        // Recognized attachment fields must be valid even alongside a text body.
        if (message.attachments !== undefined && (!Array.isArray(message.attachments)
          || message.attachments.length === 0 || !message.attachments.every(validAttachment))) {
          ignore("MALFORMED_EVENT"); continue;
        }
        let content: Extract<InstagramWebhookEvent, { kind: "message" }>["content"];
        if (message.text !== undefined) {
          if (typeof message.text !== "string" || !message.text.length) { ignore("MALFORMED_EVENT"); continue; }
          content = { kind: "text", text: message.text };
        } else if (Array.isArray(message.attachments) && message.attachments.length > 0) {
          content = { kind: "non_text" };
        } else { ignore("MALFORMED_EVENT"); continue; }
        events.push({ ...common, kind: "message", messageId: message.mid, direction: incoming ? "inbound" : "outbound", isEcho: message.is_echo === undefined ? null : message.is_echo, content });
      }
    }
    return { ok: true, events, ignored };
  } catch { return { ok: false, code: "INVALID_PAYLOAD" }; }
}

/** Verified raw-body entry point; no route registration or receive activation. */
export function verifyAndParseInstagramWebhook(
  rawBody: Uint8Array, signatureHeaders: readonly string[], secret: ParentWebhookSecret,
): InstagramWebhookParseResult {
  try {
    if (!(rawBody instanceof Uint8Array)) return { ok: false, code: "INVALID_SIGNATURE" };
    // Freeze the byte evidence used for BOTH authentication and decoding.
    const body = new Uint8Array(rawBody);
    if (!verifyInstagramWebhookSignature(body, signatureHeaders, secret)) return { ok: false, code: "INVALID_SIGNATURE" };
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { return { ok: false, code: "INVALID_JSON" }; }
    return parseInstagramWebhookPayload(payload);
  } catch { return { ok: false, code: "INVALID_SIGNATURE" }; }
}
