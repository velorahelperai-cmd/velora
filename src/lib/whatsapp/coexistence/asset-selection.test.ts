import { describe, expect, it } from "vitest";
import { selectServerCoexistenceAsset } from "./asset-selection";

const management = "whatsapp_business_management";
const messaging = "whatsapp_business_messaging";
const now = 1_800_000_000;
const phone = {
  id: "333", display_phone_number: "+968 9900 1122",
  is_on_biz_app: true, platform_type: "CLOUD_API",
};
function validInput() {
  return {
    expectedAppId: "111", trustedNowEpochSeconds: now,
    serverDebugTokenData: {
      app_id: "111", is_valid: true, expires_at: now + 600,
      data_access_expires_at: now + 1200, scopes: [management, messaging],
      granular_scopes: [
        { scope: management, target_ids: ["222"] },
        { scope: messaging, target_ids: ["222"] },
      ],
    },
    serverPhoneAssets: [{ wabaId: "222", paginationComplete: true, phones: [phone] }],
    requestedSelection: { kind: "phone_id" as const, phoneNumberId: "333" },
  };
}
// Deliberately exercise malformed provider data at the server parsing boundary.
function select(input: unknown) {
  return selectServerCoexistenceAsset(input as Parameters<typeof selectServerCoexistenceAsset>[0]);
}
const selected = { ok: true, wabaId: "222", phoneNumberId: "333", normalizedPhoneNumber: "+96899001122" };

describe("server-fetched coexistence asset selection", () => {
  it("selects the exact phone ID in a WABA authorized by both scopes", () => {
    expect(select(validInput())).toEqual(selected);
  });
  it("never selects the first phone instead of the explicit ID", () => {
    const input = validInput();
    input.serverPhoneAssets[0].phones.unshift({ ...phone, id: "999", display_phone_number: "+96899003344" });
    expect(select(input)).toEqual(selected);
    expect(select({ ...input, requestedSelection: { kind: "phone_id", phoneNumberId: "missing" } })).toEqual({ ok: false, code: "PHONE_NOT_FOUND" });
  });
  it("requires an explicit selection even if exactly one phone exists", () => {
    expect(select({ ...validInput(), requestedSelection: undefined })).toEqual({ ok: false, code: "INVALID_SELECTION" });
  });
  it("matches a confirmed international number against the full list", () => {
    expect(select({ ...validInput(), requestedSelection: { kind: "phone_number", internationalPhoneNumber: "+968 (9900)-1122", confirmed: true } })).toEqual(selected);
  });
  it.each(["96899001122", "0096899001122", "+96899001122 ext 2", "+0001234567", "+1", "+1234567890123456"])("rejects non-international or malformed requested number %s", internationalPhoneNumber => {
    expect(select({ ...validInput(), requestedSelection: { kind: "phone_number", internationalPhoneNumber, confirmed: true } })).toEqual({ ok: false, code: "INVALID_SELECTION" });
  });
  it("rejects an unconfirmed requested number", () => {
    expect(select({ ...validInput(), requestedSelection: { kind: "phone_number", internationalPhoneNumber: "+96899001122", confirmed: false } })).toEqual({ ok: false, code: "INVALID_SELECTION" });
  });
  it("rejects two distinct phone IDs with the same matched number", () => {
    const input = validInput();
    input.serverPhoneAssets[0].phones.push({ ...phone, id: "444" });
    expect(select({ ...input, requestedSelection: { kind: "phone_number", internationalPhoneNumber: "+96899001122", confirmed: true } })).toEqual({ ok: false, code: "AMBIGUOUS_PHONE" });
  });
  it.each([undefined, [], [{ wabaId: "222", paginationComplete: false, phones: [phone] }], [{ wabaId: "222", paginationComplete: true }], [{ wabaId: "222", paginationComplete: true, phones: [] }]])("rejects missing, empty or incomplete phone lists", serverPhoneAssets => {
    expect(select({ ...validInput(), serverPhoneAssets })).toEqual({ ok: false, code: "INCOMPLETE_ASSET_LIST" });
  });
  it("rejects duplicate phone IDs even with the same contents", () => {
    const input = validInput();
    input.serverPhoneAssets[0].phones.push({ ...phone });
    expect(select(input)).toEqual({ ok: false, code: "DUPLICATE_ASSET_ID" });
  });
  it("rejects duplicate WABA lists", () => {
    const input = validInput();
    input.serverPhoneAssets.push({ ...input.serverPhoneAssets[0] });
    expect(select(input)).toEqual({ ok: false, code: "DUPLICATE_ASSET_ID" });
  });
  it.each([
    { is_on_biz_app: false }, { is_on_biz_app: "true" }, { is_on_biz_app: undefined },
    { platform_type: "ON_PREMISE" }, { platform_type: undefined },
  ])("rejects a phone without exact coexistence flags", override => {
    const input = validInput();
    input.serverPhoneAssets = [{ wabaId: "222", paginationComplete: true, phones: [{ ...phone, ...override }] }] as typeof input.serverPhoneAssets;
    expect(select(input)).toEqual({ ok: false, code: "NOT_COEXISTENCE_ASSET" });
  });
  it.each([
    { app_id: "wrong-app" }, { is_valid: false }, { is_valid: "true" },
    { expires_at: now }, { expires_at: now - 1 }, { data_access_expires_at: now },
    { expires_at: undefined }, { data_access_expires_at: undefined },
    { expires_at: "0" }, { expires_at: -1 }, { data_access_expires_at: Number.NaN },
  ])("rejects invalid app, token validity or expiry", override => {
    const input = validInput();
    expect(select({ ...input, serverDebugTokenData: { ...input.serverDebugTokenData, ...override } })).toEqual({ ok: false, code: "TOKEN_REJECTED" });
  });
  it("accepts provider nonexpiring zero values", () => {
    const input = validInput();
    expect(select({ ...input, serverDebugTokenData: { ...input.serverDebugTokenData, expires_at: 0, data_access_expires_at: 0 } })).toEqual(selected);
  });
  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, now + 0.5])("requires an injected valid trusted server time", trustedNowEpochSeconds => {
    expect(select({ ...validInput(), trustedNowEpochSeconds })).toEqual({ ok: false, code: "TOKEN_REJECTED" });
  });
  it.each([
    { scopes: [management] }, { scopes: [messaging] }, { scopes: undefined },
    { granular_scopes: undefined },
    { granular_scopes: [{ scope: management, target_ids: ["222"] }, { scope: messaging, target_ids: ["999"] }] },
    { granular_scopes: [{ scope: management }, { scope: messaging, target_ids: ["222"] }] },
  ])("rejects missing or nonoverlapping exact account scope targets", override => {
    const input = validInput();
    expect(select({ ...input, serverDebugTokenData: { ...input.serverDebugTokenData, ...override } })).toEqual({ ok: false, code: "WABA_NOT_AUTHORIZED" });
  });
  it("never lets an explicit browser WABA claim authorize an ungranted account", () => {
    expect(select({ ...validInput(), requestedWabaId: "999" })).toEqual({ ok: false, code: "WABA_NOT_AUTHORIZED" });
  });
  it("requires an exact authorized WABA selection when both scopes grant multiple accounts", () => {
    const input = validInput();
    input.serverDebugTokenData.granular_scopes.forEach(scope => scope.target_ids.push("555"));
    expect(select(input)).toEqual({ ok: false, code: "AMBIGUOUS_WABA" });
    expect(select({ ...input, requestedWabaId: "222" })).toEqual(selected);
  });
  it("does not substitute another WABA's phone list", () => {
    const input = validInput();
    input.serverPhoneAssets[0].wabaId = "555";
    expect(select(input)).toEqual({ ok: false, code: "INCOMPLETE_ASSET_LIST" });
  });
  it("rejects malformed asset identifiers and numbers", () => {
    const input = validInput();
    expect(select({ ...input, serverPhoneAssets: [{ wabaId: "222", paginationComplete: true, phones: [{ ...phone, id: "" }] }] })).toEqual({ ok: false, code: "INVALID_ASSET_DATA" });
    expect(select({ ...input, serverPhoneAssets: [{ wabaId: "222", paginationComplete: true, phones: [{ ...phone, display_phone_number: "local number" }] }] })).toEqual({ ok: false, code: "INVALID_ASSET_DATA" });
  });
  it("returns only a fixed safe failure code for malformed payloads", () => {
    expect(select(null)).toEqual({ ok: false, code: "TOKEN_REJECTED" });
    expect(JSON.stringify(select({ ...validInput(), serverDebugTokenData: { access_token: "secret-value" } }))).not.toContain("secret-value");
  });
});
