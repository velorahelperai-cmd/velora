import { describe, expect, it } from "vitest";
import { parseInstagramWebhookPayload } from "./webhook-parse";
const account = "17841400000000001", customer = "12345678901234567";
const inbound = { sender: { id: customer }, recipient: { id: account }, timestamp: 1700000000123, message: { mid: "mid.synthetic", text: "  مرحبا 👋  " } };
function envelope(events: unknown[], entryExtra: object = {}, rootExtra: object = {}) { return { object: "instagram", entry: [{ id: account, time: "1700000000", messaging: events, ...entryExtra }], ...rootExtra }; }
function events(payload: unknown) { const result = parseInstagramWebhookPayload(payload); expect(result.ok).toBe(true); if (!result.ok) throw new Error("expected parse"); return result; }

describe("Instagram messaging evidence parser", () => {
  it("preserves exact account/parties/MID/plain text and raw timestamp values", () => {
    expect(events(envelope([inbound]))).toEqual({ ok: true, ignored: [], events: [{ kind: "message", professionalAccountId: account, senderId: customer, recipientId: account, messageId: "mid.synthetic", rawTimestamp: 1700000000123, rawEntryTimestamp: "1700000000", direction: "inbound", isEcho: null, content: { kind: "text", text: inbound.message.text } }] });
  });
  it.each([1700000000, "1700000000123", "unknown-unit", null])("preserves timestamp without units or date conversion: %s", timestamp => {
    const value = events(envelope([{ ...inbound, timestamp }])).events[0];
    expect(value.rawTimestamp).toBe(timestamp); expect(value).not.toHaveProperty("receivedAt"); expect(value).not.toHaveProperty("windowExpiresAt");
  });
  it("does not substitute local arrival time for missing timestamp", () => {
    const missing = { ...inbound, timestamp: undefined };
    expect(events(envelope([missing], { time: undefined })).events[0].rawTimestamp).toBeUndefined();
    expect(events(envelope([missing], { time: undefined })).events[0].rawEntryTimestamp).toBeUndefined();
  });
  it("maps conditional echo and sender-account direction", () => {
    const echo = { ...inbound, sender: { id: account }, recipient: { id: customer }, message: { ...inbound.message, is_echo: true } };
    expect(events(envelope([echo])).events[0]).toMatchObject({ direction: "outbound", isEcho: true, senderId: account, recipientId: customer });
    expect(events(envelope([{ ...echo, message: inbound.message }])).events[0]).toMatchObject({ direction: "outbound", isEcho: null });
  });
  it("preserves explicit false echo without treating absent flag as provider false", () => {
    expect(events(envelope([{ ...inbound, message: { ...inbound.message, is_echo: false } }])).events[0]).toMatchObject({ isEcho: false });
  });
  it("uses read.mid without inventing delivery evidence", () => {
    const read = { sender: inbound.sender, recipient: inbound.recipient, timestamp: "1700000000123", read: { mid: "mid.synthetic" } };
    const value = events(envelope([read])).events[0];
    expect(value).toMatchObject({ kind: "read", messageId: "mid.synthetic", rawTimestamp: "1700000000123" });
    expect(value).not.toHaveProperty("delivered"); expect(value).not.toHaveProperty("delivery");
  });
  it("emits truthful nontext marker without attachment URLs or fabricated text", () => {
    const value = events(envelope([{ ...inbound, message: { mid: "mid.media", attachments: [{ type: "image", payload: { url: "https://example.invalid/private" } }] } }])).events[0];
    expect(value).toMatchObject({ kind: "message", content: { kind: "non_text" } });
    expect(JSON.stringify(value)).not.toContain("private"); expect(value).not.toHaveProperty("text");
  });
  it("retains HTML-like content as plain text without an HTML field or rendering", () => {
    const value = events(envelope([{ ...inbound, message: { mid: "mid.text", text: "<script>alert(1)</script>" } }])).events[0];
    expect(value).toMatchObject({ content: { kind: "text", text: "<script>alert(1)</script>" } });
    expect(value).not.toHaveProperty("html");
  });
  it("does not route a company or fabricate provider generation/event IDs", () => {
    const payload = envelope([{ ...inbound, company_id: "forged-company", generation: 99, event_id: "forged-event", message: { ...inbound.message, company_id: "forged-company" } }], { company_id: "forged-company" }, { companyId: "forged-company" });
    const value = events(payload).events[0]; for (const key of ["companyId", "company_id", "generation", "eventId", "event_id"]) expect(value).not.toHaveProperty(key);
    expect(JSON.stringify(value)).not.toContain("forged");
  });
  it("preserves repeated evidence rather than claiming durable deduplication", () => {
    const result = events(envelope([inbound, inbound])); expect(result.events).toHaveLength(2); expect(result.events[0]).toEqual(result.events[1]);
  });
  it("keeps the same MID independent across professional accounts", () => {
    const second = "17841400000000002";
    const result = events({ object: "instagram", entry: [envelope([inbound]).entry[0], { id: second, messaging: [{ ...inbound, recipient: { id: second } }] }] });
    expect(result.events.map(e => e.professionalAccountId)).toEqual([account, second]);
  });
  it.each([{ delivery: { mids: ["mid.synthetic"] } }, { reaction: { mid: "mid.synthetic" } }, { postback: { title: "x" } }, { changes: [] }])("explicitly ignores unsupported event shape", changed => {
    const result = events(envelope([{ sender: inbound.sender, recipient: inbound.recipient, ...changed }]));
    expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "UNSUPPORTED_EVENT" }]);
  });
  it("ignores another Meta product rather than translating its events", () => {
    expect(events({ object: "whatsapp_business_account", entry: [] })).toEqual({ ok: true, events: [], ignored: [{ reason: "UNSUPPORTED_OBJECT" }] });
  });
  it.each([null, [], "string", { object: "instagram" }, { object: "instagram", entry: {} }])("rejects malformed envelope", payload => {
    expect(parseInstagramWebhookPayload(payload)).toEqual({ ok: false, code: "INVALID_PAYLOAD" });
  });
  it.each([{ id: "" }, { id: 178414 }, { messaging: null }, { time: {} }])("ignores malformed entries", change => {
    const result = events(envelope([inbound], change)); expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "MALFORMED_ENTRY" }]);
  });
  it.each([{ sender: { id: "" } }, { recipient: { id: 123 } }, { timestamp: {} }, { message: { text: "x" } }, { message: { mid: "" } }, { message: { mid: "mid.synthetic", text: 7 } }, { message: { ...inbound.message, is_echo: "true" } }, { message: { mid: "mid.synthetic", attachments: [] } }, { read: { mid: "" }, message: undefined }])("ignores malformed supported events", change => {
    const result = events(envelope([{ ...inbound, ...change }])); expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "MALFORMED_EVENT" }]);
  });
  it.each([{ recipient: { id: "999" } }, { sender: { id: account } }, { message: { ...inbound.message, is_echo: true } }])("rejects account-party or echo-direction mismatch", change => {
    const result = events(envelope([{ ...inbound, ...change }])); expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "ACCOUNT_MISMATCH" }]);
  });
  it.each([7, [], [{}], [{ type: 7 }], [{ type: "" }], [{ type: "image", payload: 7 }]].map(attachments => ({ attachments })))("rejects malformed attachment fields even beside valid text", ({ attachments }) => {
    const result = events(envelope([{ ...inbound, message: { ...inbound.message, attachments } }]));
    expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "MALFORMED_EVENT" }]);
  });
  it.each([[{}], [{ type: 7 }], [{ type: "" }], [{ type: "image", payload: 7 }]].map(attachments => ({ attachments })))("rejects malformed nontext attachment evidence", ({ attachments }) => {
    const result = events(envelope([{ ...inbound, message: { mid: "mid.synthetic", attachments } }]));
    expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "MALFORMED_EVENT" }]);
  });
  it("does not lose valid neighboring events when a supported event is malformed", () => {
    const result = events(envelope([{ ...inbound, message: { mid: "" } }, inbound])); expect(result.events).toHaveLength(1); expect(result.ignored).toEqual([{ reason: "MALFORMED_EVENT" }]);
  });
  it("rejects mixed read/message evidence rather than manufacturing two events", () => {
    const result = events(envelope([{ ...inbound, read: { mid: "mid.other" } }])); expect(result.events).toEqual([]); expect(result.ignored).toEqual([{ reason: "MALFORMED_EVENT" }]);
  });
});
