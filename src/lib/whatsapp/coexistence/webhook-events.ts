import { createHash } from "node:crypto";

/** Normalize only after the route verifies the signature over the original bytes. */
export type CoexistenceEventKind = "live_inbound" | "history" | "mobile_echo" | "history_chunk" | "contact" | "history_media" | "partner_removed";
export type CoexistenceWebhookEvent = Readonly<{
  kind: CoexistenceEventKind; eventKey: string; wabaId: string;
  phoneNumberId: string | null; displayPhoneNumber: string | null;
  customerWaId: string | null; waMessageId: string | null; direction: "inbound" | "outbound" | null;
  messageType: string | null; body: string | null; providerOccurredAt: string | null;
  contactAction: "add" | "remove" | null; contactName: string | null;
  historyPhase: number | null; historyChunkOrder: number | null; historyProgress: number | null; historyErrorCode: number | null;
  disconnectionReason: string | null; initiatedBy: string | null; mediaId: string | null;
}>;
export type CoexistenceWebhookParseResult = {
  events: CoexistenceWebhookEvent[];
  /** Recognized change families, including malformed ones; never a completeness claim. */
  supportedCount: number;
  errors: Array<"INVALID_ENVELOPE" | "INVALID_ASSET" | "INVALID_EVENT" | "EVENT_LIMIT">;
};
const KINDS: readonly string[] = ["live_inbound", "history", "mobile_echo", "history_chunk", "contact", "history_media", "partner_removed"];
const MAX_EVENTS = 2_000;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const asset = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,64}$/.test(value);
const id = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f]/.test(value) && !Array.from(value).some(char => /^[\ud800-\udfff]$/.test(char));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max * 2 && Array.from(value).length <= max && !value.includes("\u0000") && !Array.from(value).some(char => /^[\ud800-\udfff]$/.test(char));
const integer = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
function numeric(value: unknown, max: number): number | null {
  const parsed = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return integer(parsed, max) ? parsed : null;
}
/** Provider numbers are already international; formatting is removed, no country is inferred. */
function number(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !/^[+\d() -]+$/.test(value)) return null;
  const compact = value.replace(/[() -]/g, "").replace(/^\+/, "");
  return /^[1-9]\d{6,14}$/.test(compact) ? compact : null;
}
function time(value: unknown): string | null {
  const seconds = numeric(value, 253_402_300_799);
  return seconds !== null && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}
function iso(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && new Date(parsed).toISOString() === value;
}
type Draft = Omit<CoexistenceWebhookEvent, "eventKey">;
function base(kind: CoexistenceEventKind, wabaId: string, phoneNumberId: string | null, displayPhoneNumber: string | null): Draft {
  return { kind, wabaId, phoneNumberId, displayPhoneNumber, customerWaId: null, waMessageId: null, direction: null,
    messageType: null, body: null, providerOccurredAt: null, contactAction: null, contactName: null,
    historyPhase: null, historyChunkOrder: null, historyProgress: null, historyErrorCode: null,
    disconnectionReason: null, initiatedBy: null, mediaId: null };
}
function eventKey(event: Draft): string {
  const scope = [event.kind, event.wabaId, event.phoneNumberId];
  const identity = event.kind === "contact" ? [event.customerWaId, event.providerOccurredAt]
    : event.kind === "history_chunk" ? [event.historyPhase, event.historyChunkOrder, event.historyErrorCode]
    : event.kind === "partner_removed" ? [event.displayPhoneNumber, event.providerOccurredAt]
    : [event.waMessageId];
  return createHash("sha256").update(JSON.stringify([...scope, ...identity])).digest("hex");
}
/** Runtime check used by the server adapter as well as the provider-JSON parser. */
export function isCoexistenceWebhookEvent(value: unknown): value is CoexistenceWebhookEvent {
  const event = record(value);
  if (!event || !KINDS.includes(String(event.kind)) || !asset(event.wabaId)
    || !id(event.eventKey, 64) || !/^[0-9a-f]{64}$/.test(event.eventKey)
    || (event.phoneNumberId !== null && !asset(event.phoneNumberId))
    || (event.displayPhoneNumber !== null && (typeof event.displayPhoneNumber !== "string" || `+${number(event.displayPhoneNumber)}` !== event.displayPhoneNumber))
    || (event.customerWaId !== null && (typeof event.customerWaId !== "string" || number(event.customerWaId) !== event.customerWaId))
    || (event.waMessageId !== null && !id(event.waMessageId))
    || (event.direction !== null && !["inbound", "outbound"].includes(String(event.direction)))
    || (event.messageType !== null && (typeof event.messageType !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(event.messageType)))
    || (event.body !== null && !text(event.body, 4096))
    || (event.providerOccurredAt !== null && !iso(event.providerOccurredAt))
    || (event.contactAction !== null && !["add", "remove"].includes(String(event.contactAction)))
    || (event.contactName !== null && !text(event.contactName, 128))
    || (event.historyPhase !== null && !integer(event.historyPhase, 2))
    || (event.historyChunkOrder !== null && !integer(event.historyChunkOrder, 2_147_483_647))
    || (event.historyProgress !== null && !integer(event.historyProgress, 100))
    || (event.historyErrorCode !== null && !integer(event.historyErrorCode, 2_147_483_647))
    || (event.disconnectionReason !== null && (typeof event.disconnectionReason !== "string" || !/^[A-Z_]{1,64}$/.test(event.disconnectionReason)))
    || (event.initiatedBy !== null && !["USER", "SYSTEM"].includes(String(event.initiatedBy)))
    || (event.mediaId !== null && !asset(event.mediaId))) return false;
  if (event.kind !== "partner_removed" && event.phoneNumberId === null) return false;
  if (["live_inbound", "history", "mobile_echo"].includes(String(event.kind))) {
    if (event.customerWaId === null || event.waMessageId === null || event.direction === null || event.messageType === null || event.body === null || event.providerOccurredAt === null) return false;
    if (event.kind === "mobile_echo" && event.direction !== "outbound") return false;
    if (event.kind === "live_inbound" && event.direction !== "inbound") return false;
  } else if (event.kind === "contact") {
    if (event.customerWaId === null || event.providerOccurredAt === null || event.contactAction === null
      || (event.contactAction === "remove" && event.contactName !== null)) return false;
  } else if (event.kind === "history_chunk") {
    if (event.historyErrorCode === null && (event.historyPhase === null || event.historyChunkOrder === null || event.historyProgress === null)) return false;
  } else if (event.kind === "history_media") {
    if (event.waMessageId === null || event.mediaId === null || event.messageType === null || event.body === null) return false;
  } else if (event.kind === "partner_removed") {
    if (event.displayPhoneNumber === null || event.providerOccurredAt === null || event.phoneNumberId !== null) return false;
  }
  return event.eventKey === eventKey(event as unknown as Draft);
}
function messageContent(message: Record<string, unknown>): { messageType: string; body: string } | null {
  const type = message.type;
  if (typeof type !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(type)) return null;
  const typed = record(message[type]);
  const body = type === "text" ? typed?.body : typeof typed?.caption === "string" ? typed.caption : `[${type}]`;
  return text(body, 4096) ? { messageType: type, body } : null;
}

/**
 * No in-memory dedup: contradictory same-ID evidence reaches durable collision checks.
 * Dispatch extras with includeLiveInbound=false. For live messages, first resolve
 * the exact signed WABA/phone and run this parser only on that coexistence change;
 * standalone Cloud API changes retain the existing parser and persistence path.
 */
export function splitCoexistenceWebhook(payload: unknown, options: { includeLiveInbound?: boolean } = {}): CoexistenceWebhookParseResult {
  const result: CoexistenceWebhookParseResult = { events: [], supportedCount: 0, errors: [] };
  const error = (code: CoexistenceWebhookParseResult["errors"][number]) => { if (result.errors.length < 64) result.errors.push(code); };
  function emit(draft: Draft) {
    if (result.events.length >= MAX_EVENTS) { error("EVENT_LIMIT"); return; }
    const event = { ...draft, eventKey: eventKey(draft) };
    if (!isCoexistenceWebhookEvent(event)) { error("INVALID_EVENT"); return; }
    result.events.push(Object.freeze(event));
  }
  const root = record(payload);
  if (root?.object !== "whatsapp_business_account") return result;
  if (!Array.isArray(root.entry) || root.entry.length > 100) { error("INVALID_ENVELOPE"); return result; }
  for (const rawEntry of root.entry) {
    const entry = record(rawEntry);
    if (!entry || !Array.isArray(entry.changes) || entry.changes.length > 100) { error("INVALID_ENVELOPE"); continue; }
    for (const rawChange of entry.changes) {
      const change = record(rawChange);
      const field = change?.field;
      if (!["history", "smb_message_echoes", "smb_app_state_sync", "account_update", ...(options.includeLiveInbound ? ["messages"] : [])].includes(String(field))) continue;
      const value = record(change?.value);
      if (field === "account_update" && value?.event !== "PARTNER_REMOVED") continue;
      // Keep the earlier, WABA-wide standalone Cloud API removal contract in its existing parser.
      if (field === "account_update" && value && !("phone_number" in value) && record(value.waba_info)) continue;
      result.supportedCount++;
      if (!asset(entry.id)) { error("INVALID_ASSET"); continue; }
      const wabaId = entry.id;
      if (!value || (value.messaging_product !== undefined && value.messaging_product !== "whatsapp")) { error("INVALID_EVENT"); continue; }
      if (field === "account_update") {
        const display = number(value.phone_number);
        const occurredAt = time(entry.time);
        if (!display || !occurredAt) { error("INVALID_EVENT"); continue; }
        const info = record(value.disconnection_info);
        emit({ ...base("partner_removed", wabaId, null, `+${display}`), providerOccurredAt: occurredAt,
          disconnectionReason: info?.reason === undefined ? null : info.reason as string,
          initiatedBy: info?.initiated_by === undefined ? null : info.initiated_by as string });
        continue;
      }
      const metadata = record(value.metadata);
      const phoneNumberId = metadata?.phone_number_id;
      const businessNumber = number(metadata?.display_phone_number);
      if (!asset(phoneNumberId) || (metadata?.display_phone_number !== undefined && !businessNumber)) { error("INVALID_ASSET"); continue; }
      const display = businessNumber ? `+${businessNumber}` : null;
      function parseMessage(raw: unknown, kind: "live_inbound" | "history" | "mobile_echo", threadId?: string) {
        const message = record(raw);
        const from = number(message?.from);
        const to = number(message?.to);
        const content = message && messageContent(message);
        const occurredAt = time(message?.timestamp);
        if (!message || !from || !content || !id(message.id) || !occurredAt) { error("INVALID_EVENT"); return; }
        let customerWaId: string | null;
        let direction: "inbound" | "outbound";
        if (kind === "mobile_echo") {
          if (!businessNumber || from !== businessNumber || !to || to === businessNumber) { error("INVALID_EVENT"); return; }
          customerWaId = to; direction = "outbound";
        } else if (kind === "history") {
          if (!businessNumber || !threadId || threadId === businessNumber || (from !== threadId && from !== businessNumber)) { error("INVALID_EVENT"); return; }
          customerWaId = threadId; direction = from === businessNumber ? "outbound" : "inbound";
        } else {
          if (from === businessNumber) { error("INVALID_EVENT"); return; }
          customerWaId = from; direction = "inbound";
        }
        emit({ ...base(kind, wabaId, phoneNumberId as string, display), customerWaId, direction, waMessageId: message.id,
          ...content, providerOccurredAt: occurredAt });
      }
      if (field === "smb_message_echoes" || field === "messages") {
        const messages = field === "messages" ? value.messages : value.message_echoes;
        // A statuses-only live messages change remains handled by the existing status adapter.
        if (field === "messages" && messages === undefined && Array.isArray(value.statuses)) continue;
        if (!Array.isArray(messages) || messages.length > MAX_EVENTS) { error("INVALID_EVENT"); continue; }
        for (const message of messages) parseMessage(message, field === "messages" ? "live_inbound" : "mobile_echo");
      } else if (field === "smb_app_state_sync") {
        if (!Array.isArray(value.state_sync) || value.state_sync.length > MAX_EVENTS) { error("INVALID_EVENT"); continue; }
        for (const raw of value.state_sync) {
          const synced = record(raw);
          if (synced?.type !== "contact") { if (!synced) error("INVALID_EVENT"); continue; }
          const contact = record(synced.contact);
          const customerWaId = number(contact?.phone_number);
          const action = synced.action;
          const occurredAt = time(record(synced.metadata)?.timestamp);
          const name = contact?.full_name ?? contact?.first_name ?? null;
          if (!customerWaId || !["add", "remove"].includes(String(action)) || !occurredAt) { error("INVALID_EVENT"); continue; }
          emit({ ...base("contact", wabaId, phoneNumberId, display), customerWaId, contactAction: action as "add" | "remove",
            contactName: action === "remove" ? null : name as string | null, providerOccurredAt: occurredAt });
        }
      } else if (field === "history") {
        if (value.history !== undefined) {
          if (!Array.isArray(value.history) || value.history.length > 100) { error("INVALID_EVENT"); continue; }
          for (const raw of value.history) {
            const chunk = record(raw);
            if (!chunk) { error("INVALID_EVENT"); continue; }
            const context = record(chunk.metadata);
            const historyPhase = numeric(context?.phase, 2);
            const historyChunkOrder = numeric(context?.chunk_order, 2_147_483_647);
            const historyProgress = numeric(context?.progress, 100);
            const errors = chunk.errors;
            if (errors !== undefined && !Array.isArray(errors)) { error("INVALID_EVENT"); continue; }
            if (Array.isArray(errors) && errors.length) {
              for (const problem of errors) {
                const code = numeric(record(problem)?.code, 2_147_483_647);
                if (code === null) { error("INVALID_EVENT"); continue; }
                emit({ ...base("history_chunk", wabaId, phoneNumberId, display), historyPhase, historyChunkOrder, historyProgress, historyErrorCode: code });
              }
            } else {
              if (!context || historyPhase === null || historyChunkOrder === null || historyProgress === null) { error("INVALID_EVENT"); continue; }
            }
            if (chunk.threads === undefined && Array.isArray(errors) && errors.length) continue;
            if (!Array.isArray(chunk.threads) || chunk.threads.length > MAX_EVENTS) { error("INVALID_EVENT"); continue; }
            for (const rawThread of chunk.threads) {
              const thread = record(rawThread);
              const threadId = number(thread?.id);
              if (!threadId || !Array.isArray(thread?.messages) || thread.messages.length > MAX_EVENTS) { error("INVALID_EVENT"); continue; }
              for (const message of thread.messages) parseMessage(message, "history", threadId);
            }
            // Persist all known messages before provider progress can report this
            // chunk complete. A failed message receipt prevents a premature 100%.
            if (!Array.isArray(errors) || errors.length === 0) {
              emit({ ...base("history_chunk", wabaId, phoneNumberId, display), historyPhase, historyChunkOrder, historyProgress });
            }
          }
        }
        if (value.messages !== undefined) {
          if (!Array.isArray(value.messages) || value.messages.length > MAX_EVENTS) { error("INVALID_EVENT"); continue; }
          for (const raw of value.messages) {
            const message = record(raw);
            const content = message && messageContent(message);
            const mediaId = message && record(message[String(message.type)])?.id;
            const occurredAt = message?.timestamp === undefined ? null : time(message.timestamp);
            if (!message || !id(message.id) || !content || !asset(mediaId) || (message.timestamp !== undefined && !occurredAt)) { error("INVALID_EVENT"); continue; }
            emit({ ...base("history_media", wabaId, phoneNumberId, display), waMessageId: message.id, ...content, mediaId, providerOccurredAt: occurredAt });
          }
        }
        if (value.history === undefined && value.messages === undefined) error("INVALID_EVENT");
      }
    }
  }
  return result;
}
