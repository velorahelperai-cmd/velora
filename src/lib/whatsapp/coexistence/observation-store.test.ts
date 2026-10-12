import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { recordCoexistenceObservation, type CoexistenceObservation } from "./observation-store";

const observation: CoexistenceObservation = {
  companyId: "10000000-0000-4000-8000-000000000001",
  linkId: "10000000-0000-4000-8000-000000000002",
  linkGeneration: 3,
  wabaId: "123456789", phoneNumberId: "987654321",
  kind: "history", customerWaId: "96890000000", waMessageId: "wamid.normalized-example",
  direction: "inbound", messageType: "text", body: "Original message\ncontent",
  providerOccurredAt: "2026-10-01T10:20:30.000Z",
};
const receiptId = "10000000-0000-4000-8000-000000000003";
function response(inserted = true) {
  return {
    ok: true, receipt_id: receiptId, inserted, duplicate: !inserted, projection_status: "pending",
    company_id: observation.companyId, link_id: observation.linkId, link_generation: observation.linkGeneration,
    waba_id: observation.wabaId, phone_number_id: observation.phoneNumberId,
    kind: observation.kind, wa_message_id: observation.waMessageId,
  };
}
function client(data: unknown = response(), error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe("normalized coexistence observation adapter", () => {
  it("acknowledges a bound stored receipt while truthfully leaving canonical projection pending", async () => {
    const db = client({ ...response(), access_token: "must-not-escape", body: "must-not-escape" });
    expect(await recordCoexistenceObservation(db, observation)).toEqual({
      ok: true, durable: true, receiptId, inserted: true, duplicate: false, projectionStatus: "pending",
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("whatsapp_record_coexistence_observation", {
      p_company_id: observation.companyId, p_link_id: observation.linkId, p_link_generation: 3,
      p_waba_id: observation.wabaId, p_phone_number_id: observation.phoneNumberId,
      p_kind: "history", p_customer_wa_id: observation.customerWaId, p_wa_message_id: observation.waMessageId,
      p_direction: "inbound", p_message_type: "text", p_body: observation.body,
      p_provider_occurred_at: observation.providerOccurredAt,
    });
  });
  it("acknowledges an exact durable duplicate without issuing another call", async () => {
    const db = client(response(false));
    expect(await recordCoexistenceObservation(db, observation)).toMatchObject({ ok: true, durable: true, inserted: false, duplicate: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("normalizes valid uppercase UUIDs before storage and receipt binding", async () => {
    const input = { ...observation, companyId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", linkId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB" };
    const db = client({ ...response(), company_id: input.companyId.toLowerCase(), link_id: input.linkId.toLowerCase() });
    expect(await recordCoexistenceObservation(db, input)).toMatchObject({ ok: true, durable: true });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_company_id: input.companyId.toLowerCase(), p_link_id: input.linkId.toLowerCase() });
  });
  it("accepts outbound mobile echoes as normalized receipts", async () => {
    const db = client({ ...response(), kind: "mobile_echo" });
    expect(await recordCoexistenceObservation(db, { ...observation, kind: "mobile_echo", direction: "outbound" })).toMatchObject({ ok: true });
  });
  it("projects only scalar allowlisted input fields into the RPC", async () => {
    const db = client();
    await recordCoexistenceObservation(db, { ...observation, accessToken: "private", code: "private", rawPayload: { huge: true } } as CoexistenceObservation);
    const args = db.rpc.mock.calls[0][1];
    expect(Object.keys(args)).toHaveLength(12);
    expect(JSON.stringify(args)).not.toContain("private");
    expect(JSON.stringify(args)).not.toContain("rawPayload");
  });
  it.each([
    { companyId: "other" }, { linkId: "other" }, { linkGeneration: 0 }, { linkGeneration: 1.5 },
    { wabaId: " 123" }, { phoneNumberId: "123x" }, { kind: "live" },
    { customerWaId: "" }, { waMessageId: "id\nforged" }, { waMessageId: "x".repeat(513) },
    { direction: "outboundx" }, { kind: "mobile_echo", direction: "inbound" },
    { messageType: "x".repeat(33) }, { body: "x".repeat(4097) }, { body: "bad\u0000body" },
    { body: "\ud800" }, { providerOccurredAt: "bad-time" }, { providerOccurredAt: "2026-10-01" },
  ])("rejects malformed normalized input before persistence: %j", async patch => {
    const db = client();
    expect(await recordCoexistenceObservation(db, { ...observation, ...patch } as CoexistenceObservation)).toEqual({ ok: false, durable: false, code: "INVALID_INPUT" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, { ok: "true" }, { ...response(), receipt_id: "" },
    { ...response(), company_id: "10000000-0000-4000-8000-000000000004" },
    { ...response(), link_id: "10000000-0000-4000-8000-000000000004" },
    { ...response(), link_generation: 4 }, { ...response(), waba_id: "other" },
    { ...response(), phone_number_id: "other" }, { ...response(), kind: "mobile_echo" },
    { ...response(), wa_message_id: "other" }, { ...response(), inserted: true, duplicate: true },
    { ...response(), inserted: false, duplicate: false }, { ...response(), projection_status: "projected" },
  ])("never acknowledges an unbound or malformed success response: %j", async data => {
    expect(await recordCoexistenceObservation(client(data), observation)).toEqual({ ok: false, durable: false, code: "UNAVAILABLE" });
  });
  it.each(["INVALID_INPUT", "CONNECTION_UNAVAILABLE", "IDENTITY_CONFLICT"])("returns a bounded persistence denial: %s", async code => {
    expect(await recordCoexistenceObservation(client({ ok: false, code, token: "private" }), observation)).toEqual({ ok: false, durable: false, code });
  });
  it("hides unexpected SQL diagnostics and never treats them as durable", async () => {
    expect(await recordCoexistenceObservation(client({ ok: false, code: "secret-diagnostic" }), observation)).toEqual({ ok: false, durable: false, code: "UNAVAILABLE" });
  });
  it("does not retry an ambiguous transport failure or expose its error", async () => {
    const db = client(); db.rpc.mockRejectedValue(new Error("private provider token"));
    expect(await recordCoexistenceObservation(db, observation)).toEqual({ ok: false, durable: false, code: "UNAVAILABLE" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not acknowledge data accompanied by an RPC error", async () => {
    expect(await recordCoexistenceObservation(client(response(), { message: "private" }), observation)).toEqual({ ok: false, durable: false, code: "UNAVAILABLE" });
  });
});
