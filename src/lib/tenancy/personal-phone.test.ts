import { describe, expect, it, vi } from "vitest";
import { enrollPersonalPhone, verifyPersonalPhone, normalizePersonalPhone, type PersonalPhonePort } from "./personal-phone";

const userId = "f1000000-0000-4000-8000-000000000001";
const intentId = "f2000000-0000-4000-8000-000000000001";
const leaseId = "f3000000-0000-4000-8000-000000000001";
function fixture(configured = true) {
  const currentUser = vi.fn().mockResolvedValue({ ok: true, data: { userId, emailVerified: true } });
  const rpc = vi.fn(async (name: string) => {
    if (name === "master_reserve_personal_phone") return { ok: true, data: { intentId, phone: "+96891234567", executeProvider: true } };
    if (name === "master_claim_personal_phone_verify") return { ok: true, data: { intentId, leaseId, phone: "+96891234567" } };
    return { ok: true, data: { verified: true } };
  });
  const updatePhone = vi.fn().mockResolvedValue({ ok: true });
  const verifyPhone = vi.fn().mockResolvedValue({ ok: true, userId });
  const port = { configured, currentUser, rpc, updatePhone, verifyPhone } as PersonalPhonePort;
  return { port, currentUser, rpc, updatePhone, verifyPhone };
}
const request = { expectedUserId: userId, phone: "+96891234567", requestKey: intentId };
const verification = { expectedUserId: userId, intentId, code: "123456" };
describe("personal phone Auth boundary", () => {
  it.each(["96891234567", "+0123456789", "+968abc12345", "+123", "", "+1234567890123456"])("rejects non E.164 input %s", phone => expect(normalizePersonalPhone(phone)).toBeNull());
  it("normalizes displayed separators without inventing a country", () => expect(normalizePersonalPhone("+968 9123-4567")).toBe("+96891234567"));
  it("UNCONFIGURED makes zero provider or enrollment calls", async () => {
    const f = fixture(false);
    expect(await enrollPersonalPhone(f.port, request)).toEqual({ ok: false, code: "UNCONFIGURED" });
    expect(await verifyPersonalPhone(f.port, verification)).toEqual({ ok: false, code: "UNCONFIGURED" });
    expect(f.updatePhone).not.toHaveBeenCalled(); expect(f.verifyPhone).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("requires confirmed email independently", async () => {
    const f = fixture(); f.currentUser.mockResolvedValue({ ok: true, data: { userId, emailVerified: false } });
    expect(await enrollPersonalPhone(f.port, request)).toMatchObject({ ok: false, code: "EMAIL_REQUIRED" });
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.updatePhone).not.toHaveBeenCalled();
  });
  it("rejects wrong account and an account switch immediately before Auth", async () => {
    const f = fixture(); f.currentUser.mockResolvedValueOnce({ ok: true, data: { userId, emailVerified: true } }).mockResolvedValue({ ok: true, data: { userId: "other", emailVerified: true } });
    expect(await enrollPersonalPhone(f.port, request)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(f.updatePhone).not.toHaveBeenCalled();
  });
  it("a revoked session does not reach the provider", async () => {
    const f = fixture(); f.currentUser.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    expect(await verifyPersonalPhone(f.port, verification)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" }); expect(f.verifyPhone).not.toHaveBeenCalled();
  });
  it("durable repeated send receipt never repeats provider execution", async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ ok: true, data: { intentId, executeProvider: false } } as never);
    expect(await enrollPersonalPhone(f.port, request)).toMatchObject({ ok: true }); expect(f.updatePhone).not.toHaveBeenCalled();
  });
  it("passes normalized phone through Auth without signing up another user", async () => {
    const f = fixture(); await enrollPersonalPhone(f.port, { ...request, phone: "+968 9123-4567" });
    expect(f.updatePhone).toHaveBeenCalledWith("+96891234567");
    expect(f.rpc).toHaveBeenCalledWith("master_personal_phone_send_result", expect.objectContaining({ p_expected_user_id: userId, p_intent_id: intentId, p_sent: true }));
  });
  it("rate/duplicate errors stay safe and do not execute Auth", async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ ok: false, code: "PHONE_IN_USE" } as never);
    expect(await enrollPersonalPhone(f.port, request)).toEqual({ ok: false, code: "PHONE_IN_USE" }); expect(f.updatePhone).not.toHaveBeenCalled();
  });
  it("does not accept an OTP result for a different Auth user", async () => {
    const f = fixture(); f.verifyPhone.mockResolvedValue({ ok: true, userId: "other" });
    expect(await verifyPersonalPhone(f.port, verification)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(f.rpc).not.toHaveBeenCalledWith("master_finish_personal_phone_verify", expect.objectContaining({ p_verified: true }));
  });
  it("server finalization remains authority when provider reports success", async () => {
    const f = fixture(); f.rpc.mockImplementation(async name => name === "master_claim_personal_phone_verify"
      ? { ok: true, data: { intentId, leaseId, phone: "+96891234567" } }
      : { ok: false, code: "VERIFICATION_INCOMPLETE" } as never);
    expect(await verifyPersonalPhone(f.port, verification)).toEqual({ ok: false, code: "VERIFICATION_INCOMPLETE" });
    expect(f.verifyPhone).toHaveBeenCalledWith("+96891234567", "123456");
  });
  it("provider timeout is never automatically replayed or exposed", async () => {
    const f = fixture(); f.verifyPhone.mockRejectedValue(new Error("private OTP and provider detail"));
    f.rpc.mockImplementation(async name => name === "master_claim_personal_phone_verify"
      ? { ok: true, data: { intentId, leaseId, phone: "+96891234567" } }
      : { ok: false, code: "CODE_INVALID" } as never);
    expect(await verifyPersonalPhone(f.port, verification)).toEqual({ ok: false, code: "CODE_INVALID" });
    expect(f.verifyPhone).toHaveBeenCalledTimes(1);
  });
});
