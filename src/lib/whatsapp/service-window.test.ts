import { describe, expect, it, vi } from "vitest";
import { readServiceWindow } from "./service-window";

const binding = { companyId: "company", conversationId: "conversation", phoneNumberId: "123", recipientWaId: "999" };
const now = Date.parse("2026-10-08T12:00:00Z");
const proof = { ok: true, company_id: "company", conversation_id: "conversation", phone_number_id: "123", recipient_wa_id: "999", last_inbound_at: "2026-10-08T11:00:00Z", valid_until: "2026-10-09T11:00:00Z" };
function client(data: unknown, error: unknown = null) { return { rpc: vi.fn().mockResolvedValue({ data, error }) }; }

describe("persisted customer service window", () => {
  it("uses server evidence with all conversation identities", async () => {
    const db = client(proof);
    expect(await readServiceWindow(db, binding, now)).toEqual(proof.valid_until);
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_check_service_window", { p_company_id: "company", p_conversation_id: "conversation", p_phone_number_id: "123", p_recipient_wa_id: "999" });
  });
  it.each(["company_id", "conversation_id", "phone_number_id", "recipient_wa_id"])("rejects mismatched %s", async key => {
    expect(await readServiceWindow(client({ ...proof, [key]: "other" }), binding, now)).toBeNull();
  });
  it.each([
    { ok: false },
    { valid_until: "2026-10-08T12:00:00Z" },
    { valid_until: "bad" },
    { last_inbound_at: "2026-10-08T13:00:00Z" },
    { valid_until: "2026-10-10T11:00:00Z" },
  ])("rejects expired, future or malformed evidence %#", async patch => {
    expect(await readServiceWindow(client({ ...proof, ...patch }), binding, now)).toBeNull();
  });
  it("fails closed when persistence is unavailable", async () => {
    expect(await readServiceWindow(client(proof, true), binding, now)).toBeNull();
  });
});
