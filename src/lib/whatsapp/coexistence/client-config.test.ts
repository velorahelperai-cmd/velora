import { describe, expect, it } from "vitest";
import { createSignupAttempt, joinSignupSignal, parseEmbeddedSignupMessage } from "./browser";
import {
  parsePublicCoexistenceConfig, normalizeConfirmedCompanyPhone, coexistenceCodeFromResponse,
  coexistenceCompletionInput, signupSignalDeadline,
} from "./client-config";

describe("Coexistence client configuration and completion boundary", () => {
  const config = { appId: "123", configId: "456", graphVersion: "v26.0" };
  it("copies and freezes only public SDK configuration", () => {
    const parsed = parsePublicCoexistenceConfig(config);
    expect(parsed).toEqual(config);
    expect(parsed).not.toBe(config);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
  it.each([null, {}, { ...config, appId: "123.evil" }, { ...config, configId: "" },
    { ...config, graphVersion: "https://evil.test" }, { ...config, appSecret: "hidden" },
    { ...config, sessionInfoVersion: "4" }])("rejects malformed or secret-bearing configuration", (input) => {
    expect(parsePublicCoexistenceConfig(input)).toBeNull();
  });
  it("requires explicit confirmation and a country-code number without guessing", () => {
    expect(normalizeConfirmedCompanyPhone("+968 9123-4567", true)).toBe("+96891234567");
    expect(normalizeConfirmedCompanyPhone("+96891234567", false)).toBeNull();
    expect(normalizeConfirmedCompanyPhone("91234567", true)).toBeNull();
    expect(normalizeConfirmedCompanyPhone("+96891234567 ext 2", true)).toBeNull();
    expect(normalizeConfirmedCompanyPhone("+0001234567", true)).toBeNull();
  });
  it("extracts a bounded exchange code without exposing other callback data", () => {
    expect(coexistenceCodeFromResponse({ authResponse: { code: "code", accessToken: "ignored" } })).toBe("code");
    expect(coexistenceCodeFromResponse({ authResponse: { code: " ".repeat(10) } })).toBeNull();
    expect(coexistenceCodeFromResponse({ authResponse: { code: "x".repeat(8193) } })).toBeNull();
    expect(coexistenceCodeFromResponse({ authResponse: { code: 1 } })).toBeNull();
    expect(coexistenceCodeFromResponse(null)).toBeNull();
  });
  const metadata = { attemptId: "a", nonce: "nonce", confirmedPhoneNumber: "+96891234567" };
  const ready = (data: object, event = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", mode: "coexistence" | "cloud-api-v4" = "coexistence") =>
    joinSignupSignal(joinSignupSignal(createSignupAttempt("a"), "a", { kind: "code", code: "code" }), "a",
      parseEmbeddedSignupMessage({ origin: "https://www.facebook.com", data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data }) }, mode));

  it("sends confirmed company number together with the exact FINISH phone ID", () => {
    expect(coexistenceCompletionInput(metadata, ready({ waba_id: "123", phone_number_id: "456" })))
      .toEqual({ ...metadata, code: "code", wabaId: "123", phoneNumberId: "456" });
  });
  it("preserves missing phone ID for server discovery instead of guessing", () => {
    expect(coexistenceCompletionInput(metadata, ready({ waba_id: "123" })))
      .toEqual({ ...metadata, code: "code", wabaId: "123" });
  });
  it("rejects stale, incomplete, conflicted or wrong-mode completion", () => {
    const state = ready({ waba_id: "123" });
    expect(coexistenceCompletionInput({ ...metadata, attemptId: "old" }, state)).toBeNull();
    expect(coexistenceCompletionInput(metadata, createSignupAttempt("a"))).toBeNull();
    expect(coexistenceCompletionInput(metadata, joinSignupSignal(state, "a", { kind: "code", code: "other" }))).toBeNull();
    expect(coexistenceCompletionInput(metadata, ready({ waba_id: "123", phone_number_id: "456", business_id: "789" }, "FINISH", "cloud-api-v4"))).toBeNull();
  });
  it("bounds waiting by persisted expiry and a shorter-than-30-second code deadline", () => {
    expect(signupSignalDeadline("2026-10-12T00:01:00.000Z")).toBe(Date.parse("2026-10-12T00:01:00.000Z"));
    const codeAt = Date.parse("2026-10-12T00:00:10.000Z");
    expect(signupSignalDeadline("2026-10-12T00:01:00.000Z", codeAt)).toBe(codeAt + 25_000);
    expect(signupSignalDeadline("2026-10-12T00:00:20.000Z", codeAt)).toBe(Date.parse("2026-10-12T00:00:20.000Z"));
    expect(signupSignalDeadline("invalid")).toBeNull();
    expect(signupSignalDeadline("2026-10-12T00:00:20.000Z", NaN)).toBeNull();
  });
});
