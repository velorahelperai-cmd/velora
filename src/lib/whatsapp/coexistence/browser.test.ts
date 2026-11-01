import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_JSON_LENGTH,
  coexistenceLoginOptions,
  createSignupAttempt,
  joinSignupSignal,
  parseEmbeddedSignupMessage,
} from "./browser";

const origin = "https://www.facebook.com";
const event = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
const finish = (data: Record<string, unknown> = { waba_id: "123" }, extra = {}) =>
  JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data, ...extra });
const parse = (data: unknown, from = origin, mode: "coexistence" | "cloud-api-v4" = "coexistence") =>
  parseEmbeddedSignupMessage({ origin: from, data }, mode);

describe("Embedded Signup browser boundary", () => {
  it.each([
    "https://evilfacebook.com", "https://www.facebook.com.evil.test",
    "http://www.facebook.com", "https://www.facebook.com:444",
    "https://www.facebook.com/", "https://facebook.com@evil.test", "null",
  ])("ignores spoofed or non-exact origin %s", (from) => {
    expect(parse(finish(), from).kind).toBe("ignored");
  });

  it("accepts the second exact Facebook origin", () => {
    expect(parse(finish(), "https://web.facebook.com").kind).toBe("finish");
  });

  it.each(["{", "null", "[]", "1", {}, finish({ waba_id: 123 }), finish({ waba_id: "123x" })])(
    "rejects malformed or non-contract messages", (input) => {
      expect(parse(input).kind).toBe("invalid");
    },
  );

  it("rejects oversized JSON before parsing", () => {
    expect(parse(" ".repeat(MAX_SESSION_JSON_LENGTH + 1)).kind).toBe("invalid");
  });

  it("distinguishes unrelated messages and unknown signup events", () => {
    expect(parse(JSON.stringify({ type: "OTHER" })).kind).toBe("ignored");
    expect(parse(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "NEW_EVENT", data: {} })))
      .toEqual({ kind: "unknown", event: "NEW_EVENT" });
  });

  it("accepts the documented v3 waba-only compatibility payload", () => {
    expect(parse(finish({ waba_id: "123" }, { version: 3 }))).toEqual({
      kind: "finish", event, data: { waba_id: "123" }, contract: "coexistence-v3-compat",
    });
  });

  it("accepts current coexistence IDs without inventing a version", () => {
    expect(parse(finish({ waba_id: "123", phone_number_id: "456", business_id: "789" })))
      .toMatchObject({ kind: "finish", contract: "coexistence", data: { phone_number_id: "456" } });
    expect(parse(finish({ waba_id: "123" }, { version: 4 })).kind).toBe("finish");
  });

  it("requires an explicit Cloud API mode and all documented core fields for FINISH", () => {
    const input = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: {
      waba_id: "123", phone_number_id: "456", business_id: "789", page_ids: ["111"],
    } });
    // v5: a Cloud API FINISH arriving in the Coexistence route is an explicit wrong-route rejection.
    expect(parse(input)).toEqual({ kind: "rejected", reason: "wrong_route" });
    expect(parse(input, origin, "cloud-api-v4")).toMatchObject({ kind: "finish", contract: "cloud-api-v4" });
    expect(parse(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "123" } }), origin, "cloud-api-v4").kind).toBe("invalid");
    expect(parse(finish(), origin, "cloud-api-v4").kind).toBe("invalid");
  });

  it("rejects inferred or malformed completion fields", () => {
    expect(parse(finish({ waba_id: "123", connected: true })).kind).toBe("finish");
    expect(parse(finish({ waba_id: "abc" })).kind).toBe("invalid");
    expect(parse(finish({ waba_id: "123", page_ids: ["111", 222] })).kind).toBe("invalid");
    expect(parse(finish({ waba_id: "123", phone_number_id: null })).kind).toBe("invalid");
  });

  it("distinguishes abandoned, reported-error, and ERROR events", () => {
    const payload = (event: string, data: unknown) => JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data });
    expect(parse(payload("CANCEL", { current_step: "PHONE_NUMBER_SETUP" })))
      .toEqual({ kind: "cancel", currentStep: "PHONE_NUMBER_SETUP" });
    expect(parse(payload("CANCEL", { error_message: "Failed", error_code: "524126", session_id: "abc", timestamp: "1746041036" })))
      .toEqual({ kind: "error", event: "CANCEL" });
    expect(parse(payload("ERROR", {}))).toEqual({ kind: "error", event: "ERROR" });
  });

  it("builds Embedded Signup v5 coexistence options without featureType or sessionInfoVersion", () => {
    expect(coexistenceLoginOptions("config-1")).toEqual({
      config_id: "config-1", response_type: "code", override_default_response_type: true,
      extras: { setup: {}, version: "v5" },
    });
    expect(JSON.stringify(coexistenceLoginOptions("config-1"))).not.toMatch(/featureType|sessionInfoVersion|enabled/);
    expect(() => coexistenceLoginOptions(" ")).toThrow();
  });
});

describe("attempt-scoped code and session joining", () => {
  const session = parse(finish({ waba_id: "123", phone_number_id: "456" }));
  it.each([true, false])("joins signals in either order (session first: %s)", (sessionFirst) => {
    const initial = createSignupAttempt("attempt-a");
    const code = { kind: "code" as const, code: "exchange-code" };
    const first = joinSignupSignal(initial, "attempt-a", sessionFirst ? session : code);
    expect(first.status).toBe("waiting");
    const joined = joinSignupSignal(first, "attempt-a", sessionFirst ? code : session);
    expect(joined.status).toBe("ready-for-server-validation");
    expect(joined.code).toBe("exchange-code");
    expect(initial.code).toBeUndefined();
  });

  it("ignores old attempts and resets only by creating an explicit new attempt", () => {
    const state = joinSignupSignal(createSignupAttempt("new"), "old", session);
    expect(state.session).toBeUndefined();
    const old = joinSignupSignal(createSignupAttempt("old"), "old", session);
    expect(createSignupAttempt("new").session).toBeUndefined();
    expect(old.session).toBeDefined();
    expect(() => createSignupAttempt(" ")).toThrow();
  });

  it("accepts exact duplicates but blocks conflicting completion IDs and clears selectors", () => {
    const state = joinSignupSignal(createSignupAttempt("a"), "a", session);
    expect(joinSignupSignal(state, "a", session)).toBe(state);
    const conflict = joinSignupSignal(state, "a", parse(finish({ waba_id: "999", phone_number_id: "456" })));
    expect(conflict).toEqual({ attemptId: "a", status: "conflict" });
    expect(joinSignupSignal(conflict, "a", { kind: "code", code: "later" })).toBe(conflict);
  });

  it("does not enrich partial sessions or replace a previously received code", () => {
    const partial = joinSignupSignal(createSignupAttempt("a"), "a", parse(finish()));
    expect(joinSignupSignal(partial, "a", session).status).toBe("conflict");
    const withCode = joinSignupSignal(createSignupAttempt("a"), "a", { kind: "code", code: "first" });
    expect(joinSignupSignal(withCode, "a", { kind: "code", code: "second" }))
      .toEqual({ attemptId: "a", status: "conflict" });
  });

  it("snapshots caller-owned completion IDs before joining a later code", () => {
    const mutable = {
      kind: "finish" as const, event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" as const,
      contract: "coexistence" as const,
      data: { waba_id: "123", phone_number_id: "456", page_ids: ["111"] },
    };
    const waiting = joinSignupSignal(createSignupAttempt("a"), "a", mutable);
    mutable.data.waba_id = "999";
    mutable.data.page_ids.push("222");
    const ready = joinSignupSignal(waiting, "a", { kind: "code", code: "later" });
    expect(ready.session?.data).toEqual({ waba_id: "123", phone_number_id: "456", page_ids: ["111"] });
    expect(ready.session).not.toBe(mutable);
    expect(Object.isFrozen(ready.session)).toBe(true);
    expect(Object.isFrozen(ready.session?.data)).toBe(true);
    expect(Object.isFrozen(ready.session?.data.page_ids)).toBe(true);
    expect(joinSignupSignal(waiting, "a", mutable).status).toBe("conflict");
  });

  it("rejects a structurally typed completion with invalid selectors at the join boundary", () => {
    const malformed = {
      kind: "finish" as const, event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" as const,
      contract: "coexistence" as const, data: { waba_id: "invalid" },
    };
    expect(joinSignupSignal(createSignupAttempt("a"), "a", malformed))
      .toEqual({ attemptId: "a", status: "error" });
  });

  it("makes cancel/error terminal and ignores non-completion events without changing assets", () => {
    const state = joinSignupSignal(createSignupAttempt("a"), "a", session);
    expect(joinSignupSignal(state, "a", { kind: "unknown", event: "OTHER" })).toBe(state);
    const cancelled = joinSignupSignal(state, "a", { kind: "cancel" });
    expect(cancelled).toEqual({ attemptId: "a", status: "cancelled" });
    expect(joinSignupSignal(cancelled, "a", session)).toBe(cancelled);
    expect(joinSignupSignal(state, "a", { kind: "error", event: "ERROR" }))
      .toEqual({ attemptId: "a", status: "error" });
  });
  const v5 = (ev: string, data: Record<string, unknown>) => parse(JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: ev, data, extra: true }));
  const docV5 = { phone_number_id: "456", is_on_biz_app: true, messaging_account_ids: ["123"], primary_waac_ids: [], page_ids: [], catalog_ids: [], dataset_ids: [], business_id: "789", instagram_account_ids: [] };
  it("parses the documented v5 session info and normalizes messaging_account_ids", () => {
    const obs = v5(event, { ...docV5, unknown_key: "x" });
    expect(obs).toMatchObject({ kind: "finish", event, contract: "coexistence", data: { waba_id: "123", phone_number_id: "456", business_id: "789" } });
    let state = joinSignupSignal(createSignupAttempt("a"), "a", obs as never);
    state = joinSignupSignal(state, "a", { kind: "code", code: "c" });
    expect(state.status).toBe("ready-for-server-validation");
    expect(joinSignupSignal(createSignupAttempt("b"), "a", obs as never).status).toBe("waiting");
  });
  it.each([
    ["FINISH", { ...docV5, is_on_biz_app: false }, "wrong_route"],
    ["FINISH_ONLY_WABA", { messaging_account_ids: ["123"] }, "only_waba"],
    ["FINISH_GRANT_ONLY_API_ACCESS", {}, "grant_only"],
    [event, { ...docV5, messaging_account_ids: ["123", "124"] }, "multiple_accounts"],
    [event, { ...docV5, waba_id: "999" }, "multiple_accounts"],
  ] as const)("rejects %s with reason %s and never auto-chooses", (ev, data, reason) => {
    const obs = v5(ev, data);
    expect(obs).toEqual({ kind: "rejected", reason });
    expect(joinSignupSignal(createSignupAttempt("a"), "a", obs as never).status).toBe("error");
  });
  it.each([
    [{ ...docV5, is_on_biz_app: false }], [{ ...docV5, is_on_biz_app: "true" }],
    [{ ...docV5, messaging_account_ids: ["x"] }], [{ ...docV5, messaging_account_ids: [] }],
  ])("treats inconsistent or malformed v5 data as invalid %#", (data) => {
    const ev = data.is_on_biz_app === false ? "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" : event;
    expect(v5(ev, data).kind).toBe("invalid");
  });
  it("keeps v5 cancel and error events unchanged from session info v3", () => {
    expect(v5("CANCEL", { current_step: "PHONE_NUMBER_SETUP" })).toEqual({ kind: "cancel", currentStep: "PHONE_NUMBER_SETUP" });
    expect(v5("ERROR", { error_message: "x" })).toEqual({ kind: "error", event: "ERROR" });
  });
});
