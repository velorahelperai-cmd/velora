import { createHmac, timingSafeEqual } from "node:crypto";

export type InboundMessage = {
  /** Signed entry.id; optional only for the explicit legacy single-tenant contract. */
  wabaId?: string;
  phoneNumberId: string;
  customerWaId: string;
  customerName: string;
  waMessageId: string;
  body: string;
  messageType: string;
  receivedAt: string;
};

export type DeliveryStatus = {
  wabaId?: string;
  phoneNumberId: string;
  waMessageId: string;
  status: string;
  recipientWaId: string;
  occurredAt: string;
};

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyChallenge(
  params: { mode: string | null; token: string | null; challenge: string | null },
  expectedToken: string,
) {
  if (!expectedToken || params.mode !== "subscribe" || !params.token || !params.challenge) return null;
  if (!safeEqual(params.token, expectedToken)) return null;
  return params.challenge;
}

export function signatureMatches(rawBody: string | Uint8Array, header: string | null, appSecret: string) {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(header, expected);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function identifier(value: unknown) {
  return typeof value === "string" && value.trim() && value === value.trim() ? value : null;
}

function unixToIso(value: unknown): string | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const seconds = Number(value);
  // Date's representable range is bounded. Never invent a timestamp for invalid evidence.
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8_640_000_000_000) return null;
  return new Date(seconds * 1000).toISOString();
}

function messageText(message: Record<string, unknown>) {
  const type = identifier(message.type);
  if (!type || type.length > 32) return null;
  const text = asRecord(message.text);
  if (type === "text") {
    return typeof text?.body === "string" && text.body.trim()
      ? { type, body: text.body.trim().slice(0, 4096) }
      : null;
  }
  const typed = asRecord(message[type]);
  if (typeof typed?.caption === "string" && typed.caption.trim()) {
    return { type, body: typed.caption.trim().slice(0, 4096) };
  }
  return { type, body: `[${type}]` };
}

export function splitWebhook(payload: unknown) {
  const messages: InboundMessage[] = [];
  const statuses: DeliveryStatus[] = [];
  const seenMessages = new Set<string>();
  const root = asRecord(payload);
  if (root?.object !== "whatsapp_business_account") return { messages, statuses };
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const wabaId = identifier(asRecord(entry)?.id) ?? undefined;
    const changes = Array.isArray(asRecord(entry)?.changes) ? asRecord(entry)!.changes as unknown[] : [];
    for (const change of changes) {
      const changed = asRecord(change);
      if (changed?.field !== "messages") continue;
      const value = asRecord(changed.value);
      if (value?.messaging_product !== "whatsapp") continue;
      const metadata = asRecord(value.metadata);
      const phoneNumberId = identifier(metadata?.phone_number_id);
      if (!phoneNumberId) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const raw of Array.isArray(value.messages) ? value.messages : []) {
        const message = asRecord(raw);
        if (!message) continue;
        const waMessageId = identifier(message.id);
        const customerWaId = identifier(message.from);
        const receivedAt = unixToIso(message.timestamp);
        const text = messageText(message);
        if (!waMessageId || !customerWaId || !receivedAt || !text) continue;
        const key = JSON.stringify([wabaId, phoneNumberId, waMessageId]);
        if (seenMessages.has(key)) continue;
        seenMessages.add(key);
        const contact = contacts
          .map(asRecord)
          .find((item) => item?.wa_id === customerWaId);
        const profile = asRecord(contact?.profile);
        messages.push({
          wabaId,
          phoneNumberId,
          customerWaId,
          customerName: typeof profile?.name === "string" ? profile.name.trim().slice(0, 120) : "",
          waMessageId,
          body: text.body,
          messageType: text.type,
          receivedAt,
        });
      }

      for (const raw of Array.isArray(value.statuses) ? value.statuses : []) {
        const status = asRecord(raw);
        if (!status) continue;
        const waMessageId = identifier(status.id);
        const name = identifier(status.status);
        const occurredAt = unixToIso(status.timestamp);
        const recipientWaId = identifier(status.recipient_id);
        if (!waMessageId || !name || name.length > 32 || !occurredAt || !recipientWaId) continue;
        statuses.push({
          wabaId,
          phoneNumberId,
          waMessageId,
          status: name,
          recipientWaId,
          occurredAt,
        });
      }
    }
  }

  return { messages, statuses };
}

/** Only signed, WABA-scoped partner removal is supported; other account changes are acknowledged. */
export function splitMetaAuthorizationRevocations(payload: unknown): Array<{ wabaId: string; reason: "PARTNER_REMOVED"; occurredAt: string }> {
  const root = asRecord(payload);
  if (root?.object !== "whatsapp_business_account") return [];
  const seen = new Map<string, string>();
  for (const raw of Array.isArray(root.entry) ? root.entry : []) {
    const entry = asRecord(raw);
    const wabaId = identifier(entry?.id);
    const occurredAt = unixToIso(entry?.time);
    if (!wabaId || !occurredAt || Date.parse(occurredAt) > Date.now()) continue;
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const changed = asRecord(change);
      if (changed?.field !== "account_update") continue;
      const value = asRecord(changed.value);
      // Business App removal is scoped to its documented phone_number and is
      // persisted by the coexistence handler, even when optional legacy data exists.
      if (value && Object.prototype.hasOwnProperty.call(value, "phone_number")) continue;
      if (value?.event === "PARTNER_REMOVED" && identifier(asRecord(value.waba_info)?.waba_id) === wabaId) {
        // Retain the newest signed removal time for this WABA in the batch.
        if (!seen.has(wabaId) || occurredAt > seen.get(wabaId)!) seen.set(wabaId, occurredAt);
      }
    }
  }
  return [...seen].map(([wabaId, occurredAt]) => ({ wabaId, reason: "PARTNER_REMOVED", occurredAt }));
}

/**
 * HTTP / retry for the Cloud API webhook:
 * - 401 invalid signature — rejected, no persist
 * - 400 bad JSON — rejected
 * - 503 not configured
 * - 500 resolver unavailable or durable persist failed — retryable redelivery;
 *   saveInbound / saveStatus are idempotent
 * - 200 every event was persisted or explicitly rejected (unknown, inactive,
 *   suspended, phone mismatch). Unknown numbers are not routed to an env default.
 * Tenant-registry mode never falls back to env company/phone after resolver failure.
 */
export const WEBHOOK_HTTP = {
  invalidSignature: 401,
  badJson: 400,
  notConfigured: 503,
  retryable: 500,
  completed: 200,
} as const;

export type WebhookEventDisposition = {
  kind: "message" | "status";
  phoneNumberId: string;
  waMessageId: string;
  result: "persisted" | "rejected" | "retry";
  code?: string;
  companyId?: string;
};

export type WebhookRouteResult = {
  retry: boolean;
  dispositions: WebhookEventDisposition[];
};

export function webhookHttpStatus(result: WebhookRouteResult): number {
  return result.retry ? WEBHOOK_HTTP.retryable : WEBHOOK_HTTP.completed;
}

type PhoneMap =
  | { ok: true; companyId: string }
  | { ok: false; retry: true; code: "unavailable" }
  | { ok: false; retry: false; code: string };

export async function routeWebhookEvents(input: {
  messages: InboundMessage[];
  statuses: DeliveryStatus[];
  mode: "single_tenant" | "tenant_registry";
  envCompanyId: string;
  envPhoneNumberId: string;
  resolve: (phoneNumberId: string, wabaId?: string) => Promise<
    | { ok: true; companyId: string }
    | { ok: false; code: string }
  >;
  saveInbound: (companyId: string, message: InboundMessage) => Promise<unknown>;
  saveStatus: (companyId: string, status: DeliveryStatus) => Promise<unknown>;
}): Promise<WebhookRouteResult> {
  const dispositions: WebhookEventDisposition[] = [];
  let retry = false;
  const cache = new Map<string, Promise<PhoneMap>>();

  function mapPhone(phoneNumberId: string, wabaId?: string): Promise<PhoneMap> {
    const key = JSON.stringify([wabaId, phoneNumberId]);
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = (async (): Promise<PhoneMap> => {
      if (input.mode === "single_tenant") {
        if (!input.envCompanyId || !input.envPhoneNumberId) {
          return { ok: false, retry: true, code: "unavailable" };
        }
        if (phoneNumberId !== input.envPhoneNumberId) {
          return { ok: false, retry: false, code: "unknown_or_inactive" };
        }
        return { ok: true, companyId: input.envCompanyId };
      }
      if (!identifier(wabaId)) return { ok: false, retry: false, code: "invalid_input" };
      let resolved: Awaited<ReturnType<typeof input.resolve>>;
      try {
        resolved = await input.resolve(phoneNumberId, wabaId);
      } catch {
        return { ok: false, retry: true, code: "unavailable" };
      }
      if (!resolved.ok) {
        if (resolved.code === "unavailable") {
          return { ok: false, retry: true, code: "unavailable" };
        }
        return { ok: false, retry: false, code: resolved.code || "unknown_or_inactive" };
      }
      if (!resolved.companyId?.trim()) return { ok: false, retry: true, code: "unavailable" };
      return { ok: true, companyId: resolved.companyId };
    })();
    cache.set(key, pending);
    return pending;
  }

  for (const message of input.messages) {
    const mapped = await mapPhone(message.phoneNumberId, message.wabaId);
    if (!mapped.ok) {
      if (mapped.retry) retry = true;
      dispositions.push({
        kind: "message",
        phoneNumberId: message.phoneNumberId,
        waMessageId: message.waMessageId,
        result: mapped.retry ? "retry" : "rejected",
        code: mapped.code,
      });
      continue;
    }
    try {
      await input.saveInbound(mapped.companyId, message);
      dispositions.push({
        kind: "message",
        phoneNumberId: message.phoneNumberId,
        waMessageId: message.waMessageId,
        result: "persisted",
        companyId: mapped.companyId,
      });
    } catch (error) {
      const errObj = error instanceof Error ? (error as Error & { permanent?: unknown; code?: unknown }) : null;
      const permanent =
        errObj && errObj.permanent === true && typeof errObj.code === "string" ? errObj.code : null;
      if (permanent) {
        dispositions.push({
          kind: "message",
          phoneNumberId: message.phoneNumberId,
          waMessageId: message.waMessageId,
          result: "rejected",
          code: permanent,
          companyId: mapped.companyId,
        });
        continue;
      }
      retry = true;
      dispositions.push({
        kind: "message",
        phoneNumberId: message.phoneNumberId,
        waMessageId: message.waMessageId,
        result: "retry",
        code: "store_failed",
        companyId: mapped.companyId,
      });
    }
  }

  for (const status of input.statuses) {
    const mapped = await mapPhone(status.phoneNumberId, status.wabaId);
    if (!mapped.ok) {
      if (mapped.retry) retry = true;
      dispositions.push({
        kind: "status",
        phoneNumberId: status.phoneNumberId,
        waMessageId: status.waMessageId,
        result: mapped.retry ? "retry" : "rejected",
        code: mapped.code,
      });
      continue;
    }
    try {
      await input.saveStatus(mapped.companyId, status);
      dispositions.push({
        kind: "status",
        phoneNumberId: status.phoneNumberId,
        waMessageId: status.waMessageId,
        result: "persisted",
        companyId: mapped.companyId,
      });
    } catch {
      retry = true;
      dispositions.push({
        kind: "status",
        phoneNumberId: status.phoneNumberId,
        waMessageId: status.waMessageId,
        result: "retry",
        code: "store_failed",
        companyId: mapped.companyId,
      });
    }
  }

  return { retry, dispositions };
}
