import { describe, expect, it } from "vitest";
import { buildProcessedCallbackBody, paymobAdapterFixtures } from "@/lib/billing/paymob/fixtures";
import { mapRedirectionDisplay, verifyAndMapProcessedCallback } from "@/lib/billing/paymob/callback";
import { buildPaymobHmacConcatString, verifyPaymobTransactionHmac } from "@/lib/billing/paymob/hmac";

function mappedCallback(overrides: Record<string, unknown>) {
  const { body, hmac } = buildProcessedCallbackBody(overrides);
  return verifyAndMapProcessedCallback({ body, hmacQueryParam: hmac, hmacSecret: paymobAdapterFixtures.hmacSecret });
}

describe("Paymob settlement callback classification", () => {
  it.each([
    ["authorization", { is_auth: true }],
    ["capture", { is_capture: true }],
    ["refunded payment", { is_refunded: true }],
    ["voided payment", { is_voided: true }],
    ["child transaction", { has_parent_transaction: true }],
    ["non-standalone action", { is_standalone_payment: false }],
  ])("does not classify a successful %s as settlement", (_name, overrides) => {
    expect(mappedCallback(overrides)).toMatchObject({ ok: true, observation: { success: true, eventStatus: "other" } });
  });

  it.each([
    { id: 0 },
    { id: -1 },
    { order: { id: 0 } },
    { integration_id: -1 },
    { owner: "not-a-merchant-owner" },
  ])("rejects signed invalid provider identity %j", (overrides) => {
    expect(mappedCallback(overrides)).toMatchObject({ ok: false, reason: "incomplete_payload" });
  });

  it("accepts the documented standalone payment and keeps pending/failed observations", () => {
    expect(mappedCallback({})).toMatchObject({ ok: true, observation: { eventStatus: "success" } });
    expect(mappedCallback({ pending: true, success: false })).toMatchObject({ ok: true, observation: { eventStatus: "pending" } });
    expect(mappedCallback({ success: false })).toMatchObject({ ok: true, observation: { eventStatus: "failed" } });
    expect(mappedCallback({ error_occured: true })).toMatchObject({ ok: true, observation: { eventStatus: "failed" } });
  });
});

describe("Paymob HMAC official field coverage", () => {
  it("reproduces the primary documentation concatenation vector", () => {
    const source = {
      amount_cents: 100000, created_at: "2024-06-13T11:33:44.592345", currency: "EGP",
      error_occured: false, has_parent_transaction: false, id: 192036465, integration_id: 4097558,
      is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false,
      is_standalone_payment: true, is_voided: false, order: { id: 217503754 }, owner: 302852,
      pending: false, source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
    };
    expect(buildPaymobHmacConcatString("processed_post", source)).toEqual({
      ok: true,
      concat: "1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue",
    });
  });

  it.each([
    "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id",
    "integration_id", "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment",
    "is_voided", "order.id", "owner", "pending", "source_data.pan", "source_data.sub_type", "source_data.type", "success",
  ])("rejects tampering with signed field %s", (key) => {
    const { body, hmac } = buildProcessedCallbackBody();
    const parts = key.split(".");
    const target = parts.length === 1 ? body.obj : body.obj[parts[0]] as Record<string, unknown>;
    const leaf = parts.at(-1)!;
    const old = target[leaf];
    target[leaf] = typeof old === "boolean" ? !old : typeof old === "number" ? old + 1 : `${old}x`;
    expect(verifyPaymobTransactionHmac({
      channel: "processed_post", fieldSource: body.obj, providedHmac: hmac, hmacSecret: paymobAdapterFixtures.hmacSecret,
    })).toEqual({ ok: false, reason: "hmac_mismatch" });
  });
});

describe("Paymob browser return authenticity", () => {
  it("does not display a forged unsigned success as a verified payment result", () => {
    expect(mapRedirectionDisplay({ query: { success: "true", pending: "false", id: "800001" }, hmacSecret: paymobAdapterFixtures.hmacSecret })).toMatchObject({
      grantsEntitlement: false, hmacVerified: false, displayHint: "unknown", success: null, pending: null,
    });
  });
});
