import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOmanHostedCheckoutUrl } from "./checkout";
import { defaultPaymobTestConfigSkeleton, type PaymobAdapterConfig } from "./config";
import { createMockPaymobHttpClient, type PaymobHttpClient } from "./http";
import { createPaymobIntention, mapIntentionHttpResult, type LockedIntentionOrder } from "./intention";
import { fetchPaymobHttp } from "../wiring/test-checkout";
import { commercialBaisaToVerifiedPaymobAmount } from "../money";

function config(overrides: Partial<PaymobAdapterConfig> = {}): PaymobAdapterConfig {
  return {
    ...defaultPaymobTestConfigSkeleton(),
    secretKey: "om_sk_test_SYNTHETIC",
    publicKey: "om_pk_test_SYNTHETIC",
    hmacSecret: "synthetic",
    verifiedOmrUnitsPerOmr: 1000,
    ...overrides,
  };
}

function locked(overrides: Partial<LockedIntentionOrder> = {}): LockedIntentionOrder {
  return {
    companyId: "company",
    orderId: "order",
    paymentAttemptId: "attempt",
    specialReference: "velora-order-attempt",
    currency: "OMR",
    providerAmount: 5000,
    providerAmountUnit: "paymob_amount",
    providerAccountRef: "71610",
    providerEnvironment: "test",
    integrationId: 71610,
    billingPhone: "+96890000000",
    itemName: "Velora subscription",
    notificationUrl: "https://example.test/api/billing/paymob/webhook",
    redirectionUrl: "https://example.test/app/subscription/orders/order",
    ...overrides,
  };
}

// Mirrors the documented Create Intention response; values are synthetic.
function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    payment_keys: [{ integration: 71610, key: "SYNTHETIC", gateway_type: "MIGS", iframe_id: null, order_id: 987 }],
    intention_order_id: 987,
    id: "pi_test_SYNTHETIC",
    intention_detail: {
      amount: 5000,
      items: [{ name: "Velora subscription", amount: 5000, description: "Velora subscription", quantity: 1, image: null }],
      currency: "OMR",
      billing_data: {
        apartment: "", floor: "", first_name: "Test", last_name: "Customer",
        street: "", building: "", phone_number: "+96890000000", shipping_method: "",
        city: "Muscat", country: "OM", state: "", email: "synthetic@example.test", postal_code: "",
      },
    },
    client_secret: "om_csk_test_SYNTHETIC",
    payment_methods: [{ integration_id: 71610, alias: null, name: "Card", method_type: "online", currency: "OMR", live: false, use_cvc_with_moto: false }],
    special_reference: "velora-order-attempt",
    extras: { creation_extras: {}, confirmation_extras: null },
    confirmed: false,
    status: "intended",
    created: "2026-10-08T12:00:00.000000",
    card_detail: null,
    card_tokens: [],
    object: "paymentintention",
    ...overrides,
  };
}

function httpFor(body: Record<string, unknown>) {
  return createMockPaymobHttpClient([{ match: () => true, result: { kind: "response", response: { status: 201, headers: {}, bodyText: JSON.stringify(body) } } }]);
}

afterEach(() => vi.unstubAllGlobals());

describe("P2 locked intention boundaries", () => {
  it.each([
    ["currency", { currency: "EGP" }],
    ["unconfigured unit", { providerAmountUnit: "unconfigured" }],
    ["missing unit", { providerAmountUnit: null }],
    ["account", { providerAccountRef: "other-merchant" }],
    ["empty reference", { specialReference: " " }],
  ])("refuses invalid locked %s before sending provider credentials", async (_name, changes) => {
    const http = httpFor(response());
    const result = await createPaymobIntention({ config: config(), locked: locked(changes as Partial<LockedIntentionOrder>), http });
    expect(result.ok).toBe(false);
    expect(http.calls).toHaveLength(0);
  });

  it("refuses a live secret with test settings before sending it", async () => {
    const http = httpFor(response());
    expect(await createPaymobIntention({ config: config({ secretKey: "om_sk_live_SYNTHETIC" }), locked: locked(), http })).toMatchObject({ ok: false, code: "config_invalid" });
    expect(http.calls).toHaveLength(0);
  });

  it("refuses an invalid integration even when the locked order repeats it", async () => {
    const http = httpFor(response());
    expect(await createPaymobIntention({ config: config({ integrationId: -1 }), locked: locked({ integrationId: -1, providerAccountRef: "-1" }), http })).toMatchObject({ ok: false, code: "config_invalid" });
    expect(http.calls).toHaveLength(0);
  });

  it("sends the exact locked provider amount, OMR currency, integration and reference", async () => {
    const http = httpFor(response());
    expect(await createPaymobIntention({ config: config(), locked: locked(), http })).toMatchObject({ ok: true, intentionOrderId: 987 });
    expect(http.calls).toHaveLength(1);
    expect(JSON.parse(http.calls[0].body!)).toMatchObject({ amount: 5000, currency: "OMR", payment_methods: [71610], special_reference: "velora-order-attempt", items: [{ amount: 5000, quantity: 1 }] });
  });
});

describe("P2 intention response binding", () => {
  it.each([
    ["reference", { special_reference: "another-order" }],
    ["amount", { intention_detail: { amount: 5001, currency: "OMR" } }],
    ["currency", { intention_detail: { amount: 5000, currency: "EGP" } }],
    ["integration", { payment_methods: [{ integration_id: 999, currency: "OMR", live: false }] }],
    ["mode", { payment_methods: [{ integration_id: 71610, currency: "OMR", live: true }] }],
    ["payment key order", { payment_keys: [{ integration: 71610, order_id: 999 }] }],
    ["ambiguous order", { order_id: 999 }],
    ["blank client secret", { client_secret: " " }],
  ])("keeps a conflicting returned %s pending for reconciliation", async (_name, changes) => {
    const result = await createPaymobIntention({ config: config(), locked: locked(), http: httpFor(response(changes)) });
    expect(result).toMatchObject({ ok: false, code: "invalid_response", needsReconciliation: true });
  });

  it("accepts an otherwise valid response when optional binding echoes are omitted", async () => {
    expect(await createPaymobIntention({ config: config(), locked: locked(), http: httpFor({ intention_order_id: 987, id: "pi_test_SYNTHETIC", client_secret: "om_csk_test_SYNTHETIC" }) })).toMatchObject({ ok: true, intentionOrderId: 987 });
  });

  it("treats a malformed HTTP status as unknown instead of accepting the body", () => {
    expect(mapIntentionHttpResult({ kind: "response", response: { status: Number.NaN, headers: {}, bodyText: JSON.stringify(response()) } })).toMatchObject({ ok: false, needsReconciliation: true });
  });
});

describe("P2 provider network uncertainty", () => {
  it("returns pending reconciliation after a thrown request without retrying the POST", async () => {
    let sends = 0;
    const http: PaymobHttpClient = { async request() { sends += 1; throw new Error("socket closed after send"); } };
    await expect(createPaymobIntention({ config: config(), locked: locked(), http })).resolves.toMatchObject({ ok: false, code: "network_error", needsReconciliation: true });
    expect(sends).toBe(1);
  });

  it("uses the real fetch adapter with a global network stub and sends once on network failure", async () => {
    const fetchStub = vi.fn(async () => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", fetchStub);
    expect(await createPaymobIntention({ config: config(), locked: locked(), http: fetchPaymobHttp })).toMatchObject({ ok: false, code: "network_error", needsReconciliation: true });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("https://oman.paymob.com/v1/intention/", expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store" }));
  });
});

describe("P2 hosted checkout credentials", () => {
  it("does not construct a checkout with an empty public key", () => {
    expect(buildOmanHostedCheckoutUrl({ config: config({ publicKey: " " }), clientSecret: "om_csk_test_SYNTHETIC" })).toMatchObject({ ok: false, code: "config_invalid" });
  });
});

describe("P2 exact verified OMR conversion", () => {
  it("keeps the configured factor explicit instead of assuming cents are baisa", () => {
    expect(commercialBaisaToVerifiedPaymobAmount(5000, 100)).toEqual({ ok: true, amount: 500 });
    expect(commercialBaisaToVerifiedPaymobAmount(5000, 1000)).toEqual({ ok: true, amount: 5000 });
  });

  it("does not round a provider amount that the verified factor cannot represent", () => {
    expect(commercialBaisaToVerifiedPaymobAmount(1, 100)).toEqual({ ok: false, code: "precision_loss" });
  });

  it("avoids Number intermediate multiplication loss at the safe integer boundary", () => {
    expect(commercialBaisaToVerifiedPaymobAmount("9007199254740991", 1000)).toEqual({ ok: true, amount: 9007199254740991 });
  });

  it("refuses an unsafe output instead of truncating it", () => {
    expect(commercialBaisaToVerifiedPaymobAmount("9007199254740992", 1000)).toEqual({ ok: false, code: "not_safe_integer" });
  });

  it("refuses zero and unconfigured factors before producing a collectable amount", () => {
    expect(commercialBaisaToVerifiedPaymobAmount(0, 1000)).toEqual({ ok: false, code: "provider_amount_invalid" });
    expect(commercialBaisaToVerifiedPaymobAmount(5000, 0)).toEqual({ ok: false, code: "paymob_amount_conversion_unconfigured" });
  });
});
