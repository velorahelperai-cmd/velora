import { createHmac, timingSafeEqual } from "node:crypto";

export type InboundMessage = {
  phoneNumberId: string;
  customerWaId: string;
  customerName: string;
  waMessageId: string;
  body: string;
  messageType: string;
  receivedAt: string;
};

export type DeliveryStatus = {
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

export function signatureMatches(rawBody: string, header: string | null, appSecret: string) {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqual(header, expected);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function unixToIso(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

function messageText(message: Record<string, unknown>) {
  const type = String(message.type ?? "unknown").slice(0, 32);
  const text = asRecord(message.text);
  if (type === "text" && typeof text?.body === "string" && text.body.trim()) {
    return { type, body: text.body.trim().slice(0, 4096) };
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
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(asRecord(entry)?.changes) ? asRecord(entry)!.changes as unknown[] : [];
    for (const change of changes) {
      const value = asRecord(asRecord(change)?.value);
      if (!value) continue;
      const metadata = asRecord(value.metadata);
      const phoneNumberId = String(metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const raw of Array.isArray(value.messages) ? value.messages : []) {
        const message = asRecord(raw);
        if (!message) continue;
        const waMessageId = String(message.id ?? "");
        const customerWaId = String(message.from ?? "");
        if (!waMessageId || !customerWaId || seenMessages.has(waMessageId)) continue;
        seenMessages.add(waMessageId);
        const contact = contacts
          .map(asRecord)
          .find((item) => item && String(item.wa_id ?? "") === customerWaId);
        const profile = asRecord(contact?.profile);
        const text = messageText(message);
        messages.push({
          phoneNumberId,
          customerWaId,
          customerName: String(profile?.name ?? "").trim().slice(0, 120),
          waMessageId,
          body: text.body,
          messageType: text.type,
          receivedAt: unixToIso(message.timestamp),
        });
      }

      for (const raw of Array.isArray(value.statuses) ? value.statuses : []) {
        const status = asRecord(raw);
        if (!status) continue;
        const waMessageId = String(status.id ?? "");
        const name = String(status.status ?? "");
        if (!waMessageId || !name) continue;
        statuses.push({
          phoneNumberId,
          waMessageId,
          status: name.slice(0, 32),
          recipientWaId: String(status.recipient_id ?? ""),
          occurredAt: unixToIso(status.timestamp),
        });
      }
    }
  }

  return { messages, statuses };
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
  resolve: (phoneNumberId: string) => Promise<
    | { ok: true; companyId: string }
    | { ok: false; code: string }
  >;
  saveInbound: (companyId: string, message: InboundMessage) => Promise<unknown>;
  saveStatus: (companyId: string, status: DeliveryStatus) => Promise<unknown>;
}): Promise<WebhookRouteResult> {
  const dispositions: WebhookEventDisposition[] = [];
  let retry = false;
  const cache = new Map<string, Promise<PhoneMap>>();

  function mapPhone(phoneNumberId: string): Promise<PhoneMap> {
    const existing = cache.get(phoneNumberId);
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
      const resolved = await input.resolve(phoneNumberId);
      if (!resolved.ok) {
        if (resolved.code === "unavailable") {
          return { ok: false, retry: true, code: "unavailable" };
        }
        return { ok: false, retry: false, code: resolved.code || "unknown_or_inactive" };
      }
      return { ok: true, companyId: resolved.companyId };
    })();
    cache.set(phoneNumberId, pending);
    return pending;
  }

  for (const message of input.messages) {
    const mapped = await mapPhone(message.phoneNumberId);
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
    } catch {
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
    const mapped = await mapPhone(status.phoneNumberId);
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
