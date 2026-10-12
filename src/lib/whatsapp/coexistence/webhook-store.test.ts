import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { splitCoexistenceWebhook } from "./webhook-events";
import { ingestCoexistenceWebhookEvent } from "./webhook-store";

function event() {
  return splitCoexistenceWebhook({ object: "whatsapp_business_account", entry: [{ id: "123", changes: [{ field: "smb_message_echoes", value: {
    metadata: { phone_number_id: "456", display_phone_number: "+96899001122" },
    message_echoes: [{ id: "wamid.original", from: "96899001122", to: "96899003344", timestamp: "1790848800", type: "text", text: { body: "Original" } }],
  } }] }] }).events[0];
}
function receipt(input = event(), projectionStatus = "projected") {
  return { ok: true, durable: true, receipt_id: "10000000-0000-4000-8000-000000000001", inserted: true, duplicate: false,
    event_key: input.eventKey, kind: input.kind, waba_id: input.wabaId, phone_number_id: input.phoneNumberId,
    display_phone_number: input.displayPhoneNumber?.slice(1) ?? null,
    company_id: "10000000-0000-4000-8000-000000000002", binding_state: "active_link", link_id: "10000000-0000-4000-8000-000000000003", link_generation: 1,
    projection_status: projectionStatus };
}
describe("durable normalized coexistence ingress adapter", () => {
  it("waits for one bound durable receipt and passes only the scalar ingest contract", async () => {
    const input = event();
    const rpc = vi.fn().mockResolvedValue({ data: receipt(input), error: null });
    const result = await ingestCoexistenceWebhookEvent({ rpc }, input);
    expect(result).toMatchObject({ ok: true, durable: true, inserted: true, duplicate: false, projectionStatus: "projected" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("whatsapp_ingest_coexistence_event", expect.objectContaining({
      p_waba_id: "123", p_phone_number_id: "456", p_kind: "mobile_echo", p_customer_wa_id: "96899003344", p_wa_message_id: "wamid.original", p_body: "Original",
    }));
    expect(Object.keys(rpc.mock.calls[0][1])).toHaveLength(20);
    expect(Object.values(rpc.mock.calls[0][1]).every(value => value === null || ["string", "number"].includes(typeof value))).toBe(true);
  });
  it.each(["pending", "conflict_review"])("acknowledges durable %s evidence without claiming successful projection", async projectionStatus => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt(event(), projectionStatus), error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toMatchObject({ ok: true, durable: true, projectionStatus });
  });
  it.each([
    { durable: false }, { event_key: "other" }, { kind: "history" }, { waba_id: "999" }, { phone_number_id: "999" },
    { receipt_id: "invalid" }, { company_id: "invalid" }, { link_generation: 0 }, { duplicate: true }, { projection_status: "complete" }, { binding_state: "invented" },
  ])("refuses an unbound or malformed persistence acknowledgment", async patch => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt(), ...patch }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toEqual({ ok: false, durable: false, code: "UNAVAILABLE", retry: true });
  });
  it("does not retry or acknowledge an unknown transport outcome", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("private-secret"));
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toEqual({ ok: false, durable: false, code: "UNAVAILABLE", retry: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["96899005566", "+96899001122", null, undefined])("rejects lifecycle acknowledgments without the exact normalized display number: %s", async displayPhoneNumber => {
    const input = splitCoexistenceWebhook({ object: "whatsapp_business_account", entry: [{ id: "123", time: 1790848800,
      changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED", phone_number: "+96899001122" } }] }] }).events[0];
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt(input), phone_number_id: "456", display_phone_number: displayPhoneNumber }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, input)).toEqual({ ok: false, durable: false, code: "UNAVAILABLE", retry: true });
  });
  it("accepts phone-scoped lifecycle receipts only with their exact display-number echo", async () => {
    const input = splitCoexistenceWebhook({ object: "whatsapp_business_account", entry: [{ id: "123", time: 1790848800,
      changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED", phone_number: "+96899001122" } }] }] }).events[0];
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt(input), phone_number_id: "456" }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, input)).toMatchObject({ ok: true, durable: true });
  });
  it("requires a null display-number echo when signed live metadata omits it", async () => {
    const input = splitCoexistenceWebhook({ object: "whatsapp_business_account", entry: [{ id: "123", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "456" }, messages: [{ id: "wamid.live", from: "96899003344", timestamp: "1790848800", type: "text", text: { body: "Live" } }],
    } }] }] }, { includeLiveInbound: true }).events[0];
    const rpc = vi.fn().mockResolvedValue({ data: receipt(input), error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, input)).toMatchObject({ ok: true, durable: true });
    rpc.mockResolvedValueOnce({ data: { ...receipt(input), display_phone_number: "96899001122" }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, input)).toEqual({ ok: false, durable: false, code: "UNAVAILABLE", retry: true });
  });
  it("accepts durable signup-checkpoint evidence without inventing a verified link or projection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt(), binding_state: "signup_checkpoint", signup_attempt_id: "10000000-0000-4000-8000-000000000004", link_id: null, link_generation: null, projection_status: "pending" }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toMatchObject({ ok: true, durable: true, projectionStatus: "pending" });
  });
  it.each([
    { signup_attempt_id: "invalid" }, { link_id: "10000000-0000-4000-8000-000000000003" }, { link_generation: 1 }, { projection_status: "projected" },
  ])("refuses an ambiguous or falsely projected checkpoint receipt", async patch => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt(), binding_state: "signup_checkpoint", signup_attempt_id: "10000000-0000-4000-8000-000000000004", link_id: null, link_generation: null, projection_status: "pending", ...patch }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toEqual({ ok: false, durable: false, code: "UNAVAILABLE", retry: true });
  });
  it("rejects malformed normalized evidence before issuing the RPC", async () => {
    const rpc = vi.fn();
    expect(await ingestCoexistenceWebhookEvent({ rpc }, { ...event(), direction: "inbound" })).toEqual({ ok: false, durable: false, code: "INVALID_INPUT", retry: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("projects no caller extras, secrets, jobs or provider writes into persistence", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt(), error: null });
    await ingestCoexistenceWebhookEvent({ rpc }, { ...event(), rawPayload: { secret: "private" }, accessToken: "private", companyId: "other-company" });
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain("private");
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain("p_company_id");
  });
  it.each([
    ["CONNECTION_UNAVAILABLE", false], ["INVALID_INPUT", false], ["IDENTITY_CONFLICT", false], ["UNAVAILABLE", true], ["NOT_COEXISTENCE", false],
  ])("classifies a bounded database denial %s", async (code, retry) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, code }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toEqual({ ok: false, durable: false, code, retry });
  });
  it.each([
    ["invalid_input", "INVALID_INPUT"],
    ["unknown_or_ambiguous_asset", "CONNECTION_UNAVAILABLE"],
    ["binding_changed", "CONNECTION_UNAVAILABLE"],
    ["unknown_or_inactive", "CONNECTION_UNAVAILABLE"],
    ["stale_or_inactive_lifecycle", "CONNECTION_UNAVAILABLE"],
  ])("rejects the exact permanent database denial %s without inviting repeated delivery", async (databaseCode, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, durable: false, code: databaseCode }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toEqual({ ok: false, durable: false, code, retry: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["unknown_or_inactive_future", "connection_unavailable", "new_provider_error", undefined])("keeps unrecognized database denial %s retryable", async code => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, durable: false, code }, error: null });
    expect(await ingestCoexistenceWebhookEvent({ rpc }, event())).toEqual({ ok: false, durable: false, code: "UNAVAILABLE", retry: true });
  });
});
