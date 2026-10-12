import { describe, expect, it } from "vitest";
import { splitCoexistenceWebhook } from "./webhook-events";

const metadata = { phone_number_id: "987654321", display_phone_number: "+968 9900 1122" };
const timestamp = "1790848800";
function payload(field: string, value: Record<string, unknown>) {
  return { object: "whatsapp_business_account", entry: [{ id: "123456789", time: 1790848800, changes: [{ field, value }] }] };
}
function message(id = "wamid.original", body = " Original\nmessage ") {
  return { id, from: "96899003344", timestamp, type: "text", text: { body } };
}
function history(messages: unknown[] = [message()]) {
  return payload("history", { metadata, history: [{ metadata: { phase: 0, chunk_order: 2, progress: 75 }, threads: [{ id: "96899003344", messages }] }] });
}

describe("documented signed coexistence event parsing", () => {
  it("separates historical customer messages and progress without changing original text", () => {
    const result = splitCoexistenceWebhook(history());
    expect(result.errors).toEqual([]);
    expect(result.supportedCount).toBe(1);
    expect(result.events).toHaveLength(2);
    expect(result.events.find(event => event.kind === "history")).toMatchObject({
      wabaId: "123456789", phoneNumberId: "987654321", customerWaId: "96899003344",
      direction: "inbound", body: " Original\nmessage ", providerOccurredAt: "2026-10-01T10:00:00.000Z",
    });
    expect(result.events.find(event => event.kind === "history_chunk")).toMatchObject({ historyPhase: 0, historyChunkOrder: 2, historyProgress: 75 });
  });
  it("places each normal chunk's progress after its messages before durable ingestion", () => {
    const input = payload("history", { metadata, history: [
      { metadata: { phase: 0, chunk_order: 0, progress: 50 }, threads: [{ id: "96899003344", messages: [message("wamid.first")] }] },
      { metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: "96899003344", messages: [message("wamid.second"), message("wamid.third")] }] },
    ] });
    const result = splitCoexistenceWebhook(input);
    expect(result.errors).toEqual([]);
    expect(result.events.map(event => event.kind === "history_chunk" ? event.historyProgress : event.waMessageId)).toEqual([
      "wamid.first", 50, "wamid.second", "wamid.third", 100,
    ]);
  });
  it("classifies historical outbound only using the documented business and thread numbers", () => {
    const result = splitCoexistenceWebhook(history([{ ...message(), from: "96899001122" }]));
    expect(result.events.find(event => event.kind === "history")).toMatchObject({ direction: "outbound", customerWaId: "96899003344" });
    expect(splitCoexistenceWebhook(history([{ ...message(), from: "96899005566" }])).errors).not.toEqual([]);
  });
  it("keeps repeated message IDs for the database to detect contradictory redelivery", () => {
    const result = splitCoexistenceWebhook(history([message(), message("wamid.original", "changed")]));
    const events = result.events.filter(event => event.kind === "history");
    expect(events).toHaveLength(2);
    expect(events[0].eventKey).toBe(events[1].eventKey);
    expect(events.map(event => event.body)).toEqual([" Original\nmessage ", "changed"]);
  });
  it("preserves outbound mobile echoes independently of customer messages and statuses", () => {
    const result = splitCoexistenceWebhook(payload("smb_message_echoes", { metadata, message_echoes: [{ ...message(), from: "96899001122", to: "96899003344" }], statuses: [{ id: "ignored" }] }));
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: "mobile_echo", direction: "outbound", customerWaId: "96899003344" });
    expect(splitCoexistenceWebhook(payload("smb_message_echoes", { metadata, message_echoes: [{ ...message(), to: "96899003344" }] })).errors).not.toEqual([]);
  });
  it("normalizes contact edits and tombstones with their original ordering timestamps", () => {
    const value = { metadata, state_sync: [
      { type: "contact", action: "add", contact: { phone_number: "+968 9900 3344", full_name: "Sara" }, metadata: { timestamp } },
      { type: "contact", action: "remove", contact: { phone_number: "96899003344" }, metadata: { timestamp: "1790848801" } },
    ] };
    const result = splitCoexistenceWebhook(payload("smb_app_state_sync", value));
    expect(result.errors).toEqual([]);
    expect(result.events.map(event => [event.kind, event.contactAction, event.contactName, event.customerWaId])).toEqual([
      ["contact", "add", "Sara", "96899003344"], ["contact", "remove", null, "96899003344"],
    ]);
    expect(result.events[0].eventKey).not.toBe(result.events[1].eventKey);
  });
  it("retains a history decline without inventing completion or phase", () => {
    const result = splitCoexistenceWebhook(payload("history", { metadata, history: [{ errors: [{ code: 2593109 }] }] }));
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ kind: "history_chunk", historyErrorCode: 2593109, historyProgress: null, historyPhase: null });
  });
  it("captures media placeholder and later media ID as separate evidence without a download", () => {
    const initial = splitCoexistenceWebhook(history([{ ...message(), type: "media_placeholder", text: undefined }]));
    expect(initial.events.find(event => event.kind === "history")).toMatchObject({ messageType: "media_placeholder", body: "[media_placeholder]" });
    const later = splitCoexistenceWebhook(payload("history", { metadata, messages: [{ id: "wamid.original", timestamp, type: "image", image: { id: "456789", mime_type: "image/jpeg", sha256: "provider-hash" } }] }));
    expect(later.errors).toEqual([]);
    expect(later.events[0]).toMatchObject({ kind: "history_media", waMessageId: "wamid.original", mediaId: "456789", body: "[image]", customerWaId: null });
  });
  it("parses the phone-scoped PARTNER_REMOVED contract without requiring waba_info", () => {
    const result = splitCoexistenceWebhook(payload("account_update", { event: "PARTNER_REMOVED", phone_number: "+968 9900 1122", disconnection_info: { reason: "ACCOUNT_DISCONNECTED", initiated_by: "USER" } }));
    expect(result.errors).toEqual([]);
    expect(result.events[0]).toMatchObject({ kind: "partner_removed", wabaId: "123456789", phoneNumberId: null, displayPhoneNumber: "+96899001122", disconnectionReason: "ACCOUNT_DISCONNECTED", initiatedBy: "USER" });
  });
  it("leaves every legacy WABA-only removal to the existing parser including contradictory IDs", () => {
    const input = { object: "whatsapp_business_account", entry: [{ id: "123456789", changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED", waba_info: { waba_id: "other-waba" } } }] }] };
    expect(splitCoexistenceWebhook(input)).toEqual({ events: [], supportedCount: 0, errors: [] });
    const malformedPhone = payload("account_update", { event: "PARTNER_REMOVED", phone_number: "bad-number", waba_info: { waba_id: "123456789" } });
    expect(splitCoexistenceWebhook(malformedPhone).errors).not.toEqual([]);
  });
  it("includes explicitly requested live inbound without creating an AI job contract", () => {
    const input = payload("messages", { messaging_product: "whatsapp", metadata, messages: [message()] });
    expect(splitCoexistenceWebhook(input).events).toEqual([]);
    const result = splitCoexistenceWebhook(input, { includeLiveInbound: true });
    expect(result.events[0]).toMatchObject({ kind: "live_inbound", direction: "inbound" });
    expect(Object.keys(result.events[0])).not.toContain("jobId");
  });
  it.each([
    history([{ ...message(), id: "bad\nid" }]),
    history([{ ...message(), timestamp: "not-time" }]),
    history([{ ...message(), text: { body: "x".repeat(4097) } }]),
    payload("history", { metadata, history: [{ metadata: { phase: 2, chunk_order: 0, progress: 101 }, threads: [] }] }),
    payload("smb_message_echoes", { metadata: { phone_number_id: "other" }, message_echoes: [message()] }),
    payload("smb_app_state_sync", { metadata, state_sync: [{ type: "contact", action: "remove", contact: { phone_number: "local" }, metadata: { timestamp } }] }),
  ])("reports malformed supported evidence rather than silently acknowledging it", input => {
    const result = splitCoexistenceWebhook(input);
    expect(result.supportedCount).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.errors)).not.toContain("wamid");
  });
  it("ignores authentic unsupported families without a database requirement", () => {
    expect(splitCoexistenceWebhook(payload("future_family", { arbitrary: true }))).toEqual({ events: [], supportedCount: 0, errors: [] });
  });
});
