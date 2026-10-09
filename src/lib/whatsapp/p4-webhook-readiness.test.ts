import { describe, expect, it, vi } from "vitest";
import { routeWebhookEvents, splitWebhook, webhookHttpStatus, type InboundMessage } from "./webhook";

const inbound = {
  id: "wamid.synthetic-inbound",
  from: "synthetic-customer",
  timestamp: "1710000000",
  type: "text",
  text: { body: "مرحبا" },
};

function change(phone = "synthetic-phone-a", messages: unknown[] = [inbound]) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: phone },
      contacts: [{ wa_id: inbound.from, profile: { name: "Synthetic customer" } }],
      messages,
    },
  };
}

function payload(changes: unknown[] = [change()]) {
  return { object: "whatsapp_business_account", entry: [{ id: "synthetic-waba", changes }] };
}

describe("P4 webhook envelope and message validation", () => {
  it("accepts a complete Cloud API message envelope", () => {
    expect(splitWebhook(payload()).messages).toEqual([{
      wabaId: "synthetic-waba",
      phoneNumberId: "synthetic-phone-a",
      customerWaId: inbound.from,
      customerName: "Synthetic customer",
      waMessageId: inbound.id,
      body: "مرحبا",
      messageType: "text",
      receivedAt: "2024-03-09T16:00:00.000Z",
    }]);
  });

  it.each([undefined, "page", "instagram"])("ignores events with a foreign or absent object %s", (object) => {
    expect(splitWebhook({ ...payload(), object }).messages).toEqual([]);
  });

  it.each([undefined, "message_template_status_update", "account_update"])("ignores a foreign change field %s", (field) => {
    expect(splitWebhook(payload([{ ...change(), field }])).messages).toEqual([]);
  });

  it.each([undefined, "messenger"])("ignores a foreign messaging product %s", (messaging_product) => {
    const entry = change();
    expect(splitWebhook(payload([{ ...entry, value: { ...entry.value, messaging_product } }])).messages).toEqual([]);
  });

  it("does not collapse the same provider message id across two business phones", () => {
    expect(splitWebhook(payload([change(), change("synthetic-phone-b")])).messages.map((message) => message.phoneNumberId))
      .toEqual(["synthetic-phone-a", "synthetic-phone-b"]);
  });

  it("collapses repeated message ids for the same business phone", () => {
    expect(splitWebhook(payload([change(), change()])).messages).toHaveLength(1);
  });

  it.each(["1e100", "1710000000.5", true, [], null, "", "-1", "8640000000001"])
    ("skips invalid timestamps without inventing a reception time or throwing (%j)", (timestamp) => {
      expect(splitWebhook(payload([change(undefined, [{ ...inbound, timestamp }])])).messages).toEqual([]);
    });

  it("skips malformed identifiers without string-coercing them into customer or phone identities", () => {
    const malformed = [
      { ...inbound, id: {} },
      { ...inbound, from: true },
      { ...inbound, from: " " },
      { ...inbound, type: [] },
      { ...inbound, text: [] },
      { ...inbound, text: { body: " " } },
    ];
    expect(splitWebhook(payload([change(undefined, malformed)])).messages).toEqual([]);
    const entry = change();
    expect(splitWebhook(payload([{ ...entry, value: { ...entry.value, metadata: { phone_number_id: {} } } }])).messages)
      .toEqual([]);
  });

  it("retains unsupported message types for worker handling without pretending they are text", () => {
    expect(splitWebhook(payload([change(undefined, [{ ...inbound, type: "unknown", text: undefined }])])).messages[0])
      .toMatchObject({ messageType: "unknown", body: "[unknown]" });
  });

  it("ignores malformed delivery events and keeps valid evidence separate from messages", () => {
    const entry = change();
    const status = { id: "wamid.synthetic-outbound", status: "delivered", recipient_id: "synthetic-customer", timestamp: "1710000002" };
    const split = splitWebhook(payload([{
      ...entry,
      value: {
        ...entry.value,
        messages: [],
        statuses: [status, { ...status, id: {} }, { ...status, timestamp: "1e100" }, { ...status, status: [] }],
      },
    }]));
    expect(split.messages).toEqual([]);
    expect(split.statuses).toEqual([{
      wabaId: "synthetic-waba",
      phoneNumberId: "synthetic-phone-a", waMessageId: status.id, status: "delivered",
      recipientWaId: status.recipient_id, occurredAt: "2024-03-09T16:00:02.000Z",
    }]);
  });
});

function message(phone: string, id: string): InboundMessage {
  return {
    wabaId: "synthetic-waba", phoneNumberId: phone, waMessageId: id, customerWaId: "synthetic-customer",
    customerName: "Synthetic customer", body: "hello", messageType: "text", receivedAt: "2026-10-08T00:00:00.000Z",
  };
}

describe("P4 webhook routing failure isolation", () => {
  it("keeps other tenants' events durable when one resolver throws and requests redelivery", async () => {
    const saved: string[] = [];
    const resolve = vi.fn(async (phone: string) => {
      if (phone === "synthetic-phone-a") throw new Error("temporary transport failure");
      return { ok: true as const, companyId: "synthetic-company-b" };
    });
    const result = await routeWebhookEvents({
      messages: [message("synthetic-phone-a", "a1"), message("synthetic-phone-b", "b1"), message("synthetic-phone-a", "a2")],
      statuses: [], mode: "tenant_registry", envCompanyId: "env-default", envPhoneNumberId: "env-phone",
      resolve,
      saveInbound: async (company, item) => { saved.push(`${company}:${item.waMessageId}`); },
      saveStatus: async () => undefined,
    });
    expect(saved).toEqual(["synthetic-company-b:b1"]);
    expect(result.dispositions.map((item) => item.result)).toEqual(["retry", "persisted", "retry"]);
    expect(webhookHttpStatus(result)).toBe(500);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge successful resolver responses with an empty company id", async () => {
    const saveInbound = vi.fn();
    const result = await routeWebhookEvents({
      messages: [message("synthetic-phone-a", "a1")], statuses: [], mode: "tenant_registry",
      envCompanyId: "env-default", envPhoneNumberId: "env-phone", resolve: async () => ({ ok: true, companyId: "" }),
      saveInbound, saveStatus: async () => undefined,
    });
    expect(saveInbound).not.toHaveBeenCalled();
    expect(result.dispositions[0]).toMatchObject({ result: "retry", code: "unavailable" });
    expect(webhookHttpStatus(result)).toBe(500);
  });
});
