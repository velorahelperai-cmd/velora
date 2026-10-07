/**
 * VEL-PAYMOB-ADAPTER-FIX-01 — official adapter tests (mock only).
 * Includes closed reproductions from paymobprep01/review.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  assertAllowedPaymobBaseUrl,
  assertPaymobConfigForCalls,
  assertPositiveProviderAmount,
  assertSpecialReferenceIsNotIdempotencyKey,
  buildOmanHostedCheckoutUrl,
  buildProcessedCallbackBody,
  buildProcessedObj,
  buildPaymobHmacConcatString,
  classifyNotificationPayload,
  computePaymobHmacSha512,
  createMockPaymobHttpClient,
  createPaymobIntention,
  defaultPaymobTestConfigSkeleton,
  getPaymobOmrConversionState,
  mapIntentionHttpResult,
  mapRedirectionDisplay,
  matchVerifiedObservationToOrder,
  parseIntentionSuccessResponse,
  parseReconcileTransactionBody,
  PAYMOB_ADAPTER_TEST_FIXTURE_MARKER,
  PAYMOB_OMAN_API_BASE_URL,
  PAYMOB_OMAN_CHECKOUT_BASE_URL,
  PAYMOB_ORDER_TRANSACTION_INQUIRY_PATH,
  PAYMOB_SETTING_NAMES,
  paymobAdapterFixtures,
  reconcileMissAllowsNewCollection,
  reconcilePaymobTransaction,
  signProcessedObj,
  verifyAndMapProcessedCallback,
  type LockedIntentionOrder,
  type PaymobAdapterConfig,
  type ServerOrderBinding,
} from "@/lib/billing/paymob";

function testConfig(partial?: Partial<PaymobAdapterConfig>): PaymobAdapterConfig {
  return {
    ...defaultPaymobTestConfigSkeleton(),
    secretKey: paymobAdapterFixtures.secretKey,
    publicKey: paymobAdapterFixtures.publicKey,
    hmacSecret: paymobAdapterFixtures.hmacSecret,
    apiKeyShared: paymobAdapterFixtures.apiKeyShared,
    integrationId: paymobAdapterFixtures.integrationId,
    merchantOwnerId: paymobAdapterFixtures.merchantOwnerId,
    ...partial,
  };
}

function lockedOrder(partial?: Partial<LockedIntentionOrder>): LockedIntentionOrder {
  return {
    companyId: paymobAdapterFixtures.companyId,
    orderId: paymobAdapterFixtures.orderId,
    paymentAttemptId: "33333333-3333-4333-8333-333333333333",
    specialReference: paymobAdapterFixtures.specialReference,
    currency: "OMR",
    providerAmount: paymobAdapterFixtures.providerAmount,
    providerAmountUnit: "paymob_amount",
    providerAccountRef: String(paymobAdapterFixtures.integrationId),
    providerEnvironment: "test",
    integrationId: paymobAdapterFixtures.integrationId,
    billingPhone: "+96890000000",
    itemName: "Velora subscription fixture",
    notificationUrl: "https://example.test/api/billing/paymob/webhook",
    redirectionUrl: "https://example.test/api/billing/paymob/return",
    ...partial,
  };
}

function serverOrder(partial?: Partial<ServerOrderBinding>): ServerOrderBinding {
  return {
    companyId: paymobAdapterFixtures.companyId,
    orderId: paymobAdapterFixtures.orderId,
    providerOrderId: paymobAdapterFixtures.providerOrderId,
    specialReference: paymobAdapterFixtures.specialReference,
    amountBaisa: 5000,
    currency: "OMR",
    providerAmount: paymobAdapterFixtures.providerAmount,
    providerAccountRef: String(paymobAdapterFixtures.integrationId),
    providerEnvironment: "test",
    integrationId: paymobAdapterFixtures.integrationId,
    merchantOwnerId: paymobAdapterFixtures.merchantOwnerId,
    ...partial,
  };
}

describe("FIX-01 URL allowlist (closes review destination bypass)", () => {
  it("accepts only exact Oman API/checkout hosts; rejects decoys before secrets", () => {
    expect(assertAllowedPaymobBaseUrl(PAYMOB_OMAN_API_BASE_URL, "api").ok).toBe(true);
    expect(assertAllowedPaymobBaseUrl(PAYMOB_OMAN_CHECKOUT_BASE_URL, "checkout").ok).toBe(true);

    expect(assertAllowedPaymobBaseUrl("https://example.invalid", "api").ok).toBe(false);
    expect(
      assertAllowedPaymobBaseUrl("https://om.checkout.paymob.com.example.invalid", "checkout").ok,
    ).toBe(false);
    expect(
      assertAllowedPaymobBaseUrl("https://user:pass@oman.paymob.com", "api").ok,
    ).toBe(false);
    expect(assertAllowedPaymobBaseUrl("https://oman.paymob.com:8443", "api").ok).toBe(false);

    expect(() =>
      assertPaymobConfigForCalls({ ...testConfig(), apiBaseUrl: "https://example.invalid" }),
    ).toThrow(/allowlisted|unparseable|https/i);

    const decoyCheckout = buildOmanHostedCheckoutUrl({
      config: {
        ...testConfig(),
        checkoutBaseUrl: "https://om.checkout.paymob.com.example.invalid",
      },
      clientSecret: "FIXTURE",
    });
    expect(decoyCheckout.ok).toBe(false);
    if (!decoyCheckout.ok) expect(decoyCheckout.code).toBe("config_invalid");
  });
});

describe("FIX-01 match binding (closes missing providerOrderId success)", () => {
  it("missing saved providerOrderId needs reconciliation; unsigned fields cannot bind", () => {
    const { body, hmac } = buildProcessedCallbackBody({ order: { merchant_order_id: null } });
    const mapped = verifyAndMapProcessedCallback({
      body,
      hmacQueryParam: hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    expect(
      matchVerifiedObservationToOrder({
        observation: mapped.observation,
        order: serverOrder({ providerOrderId: null }),
      }),
    ).toEqual({ ok: false, reason: "provider_order_id_missing_needs_reconciliation" });

    expect(
      matchVerifiedObservationToOrder({
        observation: mapped.observation,
        order: serverOrder({ providerOrderId: null }),
        unsignedOnlyBindingAttempt: true,
      }),
    ).toEqual({ ok: false, reason: "unsigned_fields_cannot_bind" });
  });

  it("matches signed order.id + owner + account ref; rejects wrong order signature", () => {
    const good = buildProcessedCallbackBody();
    const mapped = verifyAndMapProcessedCallback({
      body: good.body,
      hmacQueryParam: good.hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.observation.signedOwner).toBe(paymobAdapterFixtures.merchantOwnerId);
    expect(matchVerifiedObservationToOrder({ observation: mapped.observation, order: serverOrder() })).toEqual({
      ok: true,
    });

    const otherOrder = buildProcessedCallbackBody({
      order: { id: 999999, merchant_order_id: paymobAdapterFixtures.specialReference },
    });
    const otherMapped = verifyAndMapProcessedCallback({
      body: otherOrder.body,
      hmacQueryParam: otherOrder.hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(otherMapped.ok).toBe(true);
    if (!otherMapped.ok) return;
    expect(
      matchVerifiedObservationToOrder({
        observation: otherMapped.observation,
        order: serverOrder(),
      }),
    ).toEqual({ ok: false, reason: "provider_order_mismatch" });

    expect(
      matchVerifiedObservationToOrder({
        observation: mapped.observation,
        order: serverOrder({ providerAccountRef: "ignored" }),
      }),
    ).toEqual({ ok: false, reason: "provider_account_ref_mismatch" });
  });

  it("unsigned is_live / merchant_order_id changes do not break HMAC but cannot replace binding", () => {
    const { body, hmac } = buildProcessedCallbackBody();
    body.obj.is_live = true;
    (body.obj.order as Record<string, unknown>).merchant_order_id = "changed-unsigned";
    const mapped = verifyAndMapProcessedCallback({
      body,
      hmacQueryParam: hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    // Still matches via signed order.id — unsigned fields are not the binding proof.
    expect(
      matchVerifiedObservationToOrder({
        observation: mapped.observation,
        order: serverOrder(),
      }),
    ).toEqual({ ok: true });
  });
});

describe("FIX-01 intention / conversion / amount", () => {
  it("keeps OMR NOT_CONFIGURED; manual amount cannot bypass; nonpositive never reaches HTTP", async () => {
    expect(getPaymobOmrConversionState().status).toBe("NOT_CONFIGURED");
    const http = createMockPaymobHttpClient([{ match: () => true, result: { kind: "timeout" } }]);
    const blocked = await createPaymobIntention({
      config: testConfig(),
      http,
      locked: lockedOrder({ providerAmount: 5000, providerAmountUnit: "paymob_amount" }),
    });
    expect(blocked).toMatchObject({ ok: false, code: "conversion_not_configured" });
    expect(http.calls).toHaveLength(0);

    const neg = await createPaymobIntention({
      config: testConfig(),
      http,
      locked: lockedOrder({ providerAmount: -1 }),
    });
    expect(neg).toMatchObject({ ok: false, code: "conversion_not_configured" });
    expect(http.calls).toHaveLength(0);
    expect(assertPositiveProviderAmount(-1)).toEqual({ ok: false, code: "provider_amount_invalid" });
    expect(assertPositiveProviderAmount(0)).toEqual({ ok: false, code: "provider_amount_invalid" });
  });

  it("null / malformed intention bodies are invalid_response with reconciliation — no throw", () => {
    expect(parseIntentionSuccessResponse("null")).toMatchObject({
      ok: false,
      code: "invalid_response",
      needsReconciliation: true,
    });
    expect(parseIntentionSuccessResponse('{"client_secret":"x","intention_order_id":{}}')).toMatchObject({
      ok: false,
      code: "invalid_response",
    });
    expect(
      mapIntentionHttpResult({
        kind: "timeout",
      }),
    ).toMatchObject({ ok: false, code: "timeout_unknown", needsReconciliation: true });
  });
});

describe("FIX-01 reconcile Postman paths + malformed responses", () => {
  it("order/reference inquiry uses POST transaction_inquiry JSON; txn id stays GET", async () => {
    const http = createMockPaymobHttpClient([
      {
        match: (r) => r.method === "POST" && r.url.includes("/api/auth/tokens"),
        result: {
          kind: "response",
          response: { status: 201, headers: {}, bodyText: JSON.stringify({ token: "tok_fixture" }) },
        },
      },
      {
        match: (r) =>
          r.method === "POST" && r.url.includes(PAYMOB_ORDER_TRANSACTION_INQUIRY_PATH),
        result: {
          kind: "response",
          response: {
            status: 200,
            headers: {},
            bodyText: JSON.stringify({
              id: 2,
              success: true,
              pending: false,
              amount_cents: 5000,
              currency: "OMR",
              order: { id: 900001 },
              integration_id: 71610,
            }),
          },
        },
      },
    ]);
    const latest = await reconcilePaymobTransaction({
      config: testConfig(),
      http,
      lookup: { by: "order_id", orderId: "900001" },
    });
    expect(latest.ok).toBe(true);
    const inquiryCall = http.calls.find((c) => c.url.includes(PAYMOB_ORDER_TRANSACTION_INQUIRY_PATH));
    expect(inquiryCall?.method).toBe("POST");
    expect(JSON.parse(inquiryCall!.body!)).toEqual({ order_id: "900001" });

    const txnHttp = createMockPaymobHttpClient([
      {
        match: (r) => r.method === "POST" && r.url.includes("/api/auth/tokens"),
        result: {
          kind: "response",
          response: { status: 201, headers: {}, bodyText: JSON.stringify({ token: "tok" }) },
        },
      },
      {
        match: (r) => r.method === "GET" && r.url.includes("/api/acceptance/transactions/"),
        result: {
          kind: "response",
          response: {
            status: 200,
            headers: {},
            bodyText: JSON.stringify({
              id: 9,
              success: true,
              pending: false,
              amount_cents: 5000,
              currency: "OMR",
              order: { id: 900001 },
            }),
          },
        },
      },
    ]);
    const byTxn = await reconcilePaymobTransaction({
      config: testConfig(),
      http: txnHttp,
      lookup: { by: "transaction_id", transactionId: "9" },
    });
    expect(byTxn.ok).toBe(true);
    expect(txnHttp.calls.some((c) => c.method === "GET")).toBe(true);
  });

  it("null / object id / negative amount → invalid_response, no throw, no success", async () => {
    expect(parseReconcileTransactionBody("null", false)).toMatchObject({
      ok: false,
      code: "invalid_response",
      allowsNewCollection: false,
    });
    expect(parseReconcileTransactionBody('{"id":{},"amount_cents":-1}', false)).toMatchObject({
      ok: false,
      code: "invalid_response",
    });

    const http = (value: string) =>
      createMockPaymobHttpClient([
        {
          match: (r) => r.method === "POST" && r.url.includes("/api/auth/tokens"),
          result: {
            kind: "response",
            response: { status: 201, headers: {}, bodyText: JSON.stringify({ token: "FIXTURE" }) },
          },
        },
        {
          match: (r) => r.method === "GET",
          result: { kind: "response", response: { status: 200, headers: {}, bodyText: value } },
        },
      ]);

    await expect(
      reconcilePaymobTransaction({
        config: testConfig(),
        http: http("null"),
        lookup: { by: "transaction_id", transactionId: "1" },
      }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_response", allowsNewCollection: false });

    const malformed = await reconcilePaymobTransaction({
      config: testConfig(),
      http: http('{"id":{},"amount_cents":-1}'),
      lookup: { by: "transaction_id", transactionId: "1" },
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(reconcileMissAllowsNewCollection(malformed)).toBe(false);
    }
  });
});

describe("HMAC / callbacks / display (retained)", () => {
  it("rejects wrong hmac and tampered signed field; isolates null signed fields", () => {
    const { body, hmac } = buildProcessedCallbackBody();
    expect(
      verifyAndMapProcessedCallback({
        body,
        hmacQueryParam: hmac,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
      }).ok,
    ).toBe(true);
    expect(
      verifyAndMapProcessedCallback({
        body,
        hmacQueryParam: "0".repeat(hmac.length),
        hmacSecret: paymobAdapterFixtures.hmacSecret,
      }),
    ).toMatchObject({ ok: false, reason: "hmac_failed" });

    const tamperedObj = buildProcessedObj({ amount_cents: 1 });
    expect(
      verifyAndMapProcessedCallback({
        body: { type: "TRANSACTION", obj: tamperedObj },
        hmacQueryParam: hmac,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
      }),
    ).toMatchObject({ ok: false, reason: "hmac_failed" });

    expect(
      verifyAndMapProcessedCallback({
        body: { type: "TRANSACTION", obj: buildProcessedObj({ created_at: null }) },
        hmacQueryParam: "deadbeef",
        hmacSecret: paymobAdapterFixtures.hmacSecret,
      }),
    ).toMatchObject({ ok: false, reason: "isolated_incomplete_fields" });
  });

  it("pending→success mapping; card-token separated; redirect never grants", () => {
    const pendingBody = buildProcessedCallbackBody({ pending: true, success: false });
    const pending = verifyAndMapProcessedCallback({
      body: pendingBody.body,
      hmacQueryParam: pendingBody.hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(pending.ok && pending.observation.eventStatus).toBe("pending");

    expect(classifyNotificationPayload({ type: "TOKEN" })).toBe("card_token");

    const obj = buildProcessedObj();
    const flat: Record<string, string> = {
      amount_cents: String(obj.amount_cents),
      created_at: String(obj.created_at),
      currency: String(obj.currency),
      error_occured: String(obj.error_occured),
      has_parent_transaction: String(obj.has_parent_transaction),
      id: String(obj.id),
      integration_id: String(obj.integration_id),
      is_3d_secure: String(obj.is_3d_secure),
      is_auth: String(obj.is_auth),
      is_capture: String(obj.is_capture),
      is_refunded: String(obj.is_refunded),
      is_standalone_payment: String(obj.is_standalone_payment),
      is_voided: String(obj.is_voided),
      order_id: String((obj.order as { id: number }).id),
      owner: String(obj.owner),
      pending: String(obj.pending),
      "source_data.pan": "2346",
      "source_data.sub_type": "MasterCard",
      "source_data.type": "card",
      success: String(obj.success),
    };
    const built = buildPaymobHmacConcatString("response_get", flat);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    flat.hmac = computePaymobHmacSha512(paymobAdapterFixtures.hmacSecret, built.concat);
    const display = mapRedirectionDisplay({
      query: flat,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(display.grantsEntitlement).toBe(false);
  });

  it("stable callback txn id is not by itself a durable DB dedupe proof", () => {
    const a = buildProcessedCallbackBody();
    const b = buildProcessedCallbackBody();
    const first = verifyAndMapProcessedCallback({
      body: a.body,
      hmacQueryParam: a.hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    const second = verifyAndMapProcessedCallback({
      body: b.body,
      hmacQueryParam: b.hmac,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.observation.providerTransactionId).toBe(second.observation.providerTransactionId);
    }
    // Adapter observes identity only — persistence/dedupe is a DB concern (not proven here).
    expect(assertSpecialReferenceIsNotIdempotencyKey().specialReferenceIsIdempotency).toBe(false);
    expect(paymobAdapterFixtures.marker).toBe(PAYMOB_ADAPTER_TEST_FIXTURE_MARKER);
    expect(PAYMOB_SETTING_NAMES.merchantOwnerId).toBe("PAYMOB_MERCHANT_OWNER_ID");
    expect(signProcessedObj(buildProcessedObj({ success: false }))).not.toBe(a.hmac);
  });
});
