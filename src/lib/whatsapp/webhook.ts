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
