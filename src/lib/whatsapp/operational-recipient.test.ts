import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { bindOperationalRecipient } from "./operational-recipient";

afterEach(() => vi.unstubAllEnvs());
describe("trusted operational recipient snapshot", () => {
  it("passes server configuration with the original job claim, without accepting a browser classification", async () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", "synthetic-test-phone");
    vi.stubEnv("WHATSAPP_TEST_RECIPIENTS", "+96890000000,96890000001");
    const invoke = vi.fn().mockResolvedValue({ ok: true, recipientClass: "test_number" });
    await bindOperationalRecipient(invoke, { jobId: "job", claimToken: "claim" });
    expect(invoke).toHaveBeenCalledWith("es02_classify_claimed_reply", {
      p_job_id: "job", p_claim_token: "claim", p_configuration_mode: "meta_test",
      p_test_phone_number_id: "synthetic-test-phone", p_test_recipients: ["+96890000000", "96890000001"],
    });
  });
  it.each([null, {}, { ok: true }, { ok: true, recipientClass: "unknown" }, { ok: false, code: "CLASSIFICATION_CHANGED" }])("fails closed before any dispatch for invalid classification %j", async value => {
    await expect(bindOperationalRecipient(async () => value, { jobId: "job", claimToken: "claim" })).rejects.toThrow("RECIPIENT_CLASSIFICATION_UNAVAILABLE");
  });
  it.each(["real_customer", "test_number", "legacy"])("accepts only the native classification: %s", async recipientClass => {
    await expect(bindOperationalRecipient(async () => ({ ok: true, recipientClass }), { jobId: "job", claimToken: "claim" })).resolves.toBeUndefined();
  });
});
