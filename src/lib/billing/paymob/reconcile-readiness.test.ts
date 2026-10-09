import { describe, expect, it } from "vitest";
import { defaultPaymobTestConfigSkeleton } from "@/lib/billing/paymob/config";
import { paymobAdapterFixtures } from "@/lib/billing/paymob/fixtures";
import { createMockPaymobHttpClient, type PaymobHttpClient } from "@/lib/billing/paymob/http";
import { parseReconcileTransactionBody, reconcilePaymobTransaction, type ReconcileLookup } from "@/lib/billing/paymob/reconcile";

function inquiryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 800001, amount_cents: 5000, currency: "OMR", success: true, pending: false,
    error_occured: false, integration_id: 71610, owner: 1001, is_live: false,
    is_auth: false, is_capture: false, is_voided: false, is_refunded: false,
    has_parent_transaction: false, is_standalone_payment: true,
    order: { id: 900001, merchant_order_id: "VEL_PAYMOB_SR_FIXTURE_1", is_cancel: false, is_canceled: false },
    ...overrides,
  };
}

async function inquire(row: Record<string, unknown>, lookup: ReconcileLookup = { by: "order_id", orderId: "900001" }) {
  const http = createMockPaymobHttpClient([
    { match: (request) => request.url.endsWith("/api/auth/tokens"), result: { kind: "response", response: { status: 201, headers: {}, bodyText: '{"token":"INQUIRY_FIXTURE_ONLY"}' } } },
    { match: () => true, result: { kind: "response", response: { status: 200, headers: {}, bodyText: JSON.stringify(row) } } },
  ]);
  return reconcilePaymobTransaction({
    config: {
      ...defaultPaymobTestConfigSkeleton(), secretKey: paymobAdapterFixtures.secretKey,
      publicKey: paymobAdapterFixtures.publicKey, hmacSecret: paymobAdapterFixtures.hmacSecret,
      apiKeyShared: paymobAdapterFixtures.apiKeyShared, integrationId: 71610, merchantOwnerId: "1001",
    }, http, lookup,
  });
}

describe("Paymob inquiry lifecycle evidence", () => {
  it.each([
    ["authorization", { is_auth: true }],
    ["capture", { is_capture: true }],
    ["refunded", { is_refunded: true }],
    ["voided", { is_voided: true }],
    ["refund action", { is_refund: true }],
    ["void action", { is_void: true }],
    ["child", { has_parent_transaction: true }],
    ["non-standalone", { is_standalone_payment: false }],
    ["cancelled order", { order: { id: 900001, is_canceled: true } }],
  ])("retains a successful %s as an observation without settlement success", (_name, overrides) => {
    expect(parseReconcileTransactionBody(JSON.stringify(inquiryRow(overrides)), true)).toMatchObject({
      ok: true, transaction: { success: true, eventStatus: "other" },
    });
  });

  it("keeps incomplete lifecycle evidence out of settlement success", () => {
    const row: Record<string, unknown> = inquiryRow();
    delete row.is_auth;
    expect(parseReconcileTransactionBody(JSON.stringify(row), true)).toMatchObject({ ok: true, transaction: { eventStatus: "other" } });
  });

  it("does not invent latest ordering by selecting the last array item", () => {
    const row = inquiryRow();
    expect(parseReconcileTransactionBody(JSON.stringify([row, { ...row, id: 800000 }]), true)).toMatchObject({
      ok: false, code: "invalid_response", allowsNewCollection: false,
    });
  });

  it.each([
    { is_refund: "true" },
    { is_void: {} },
    { order: { id: 900001, is_canceled: "true" } },
  ])("rejects malformed authenticated action/cancellation flags %j", (overrides) => {
    expect(parseReconcileTransactionBody(JSON.stringify(inquiryRow(overrides)), true)).toMatchObject({
      ok: false, code: "invalid_response", allowsNewCollection: false,
    });
  });
});

describe("Paymob inquiry response trust", () => {
  it("accepts complete test-account evidence for the requested order", async () => {
    expect(await inquire(inquiryRow())).toMatchObject({
      ok: true, transaction: { id: "800001", orderId: "900001", ownerId: "1001", isLive: false, eventStatus: "success" },
    });
  });

  it.each([
    ["different order", { order: { id: 900002 } }],
    ["different integration", { integration_id: 71611 }],
    ["missing integration", { integration_id: undefined }],
    ["different owner", { owner: 1002 }],
    ["missing owner", { owner: undefined }],
    ["live payment", { is_live: true }],
    ["unknown environment", { is_live: undefined }],
    ["different currency", { currency: "EGP" }],
    ["missing lifecycle", { is_auth: undefined }],
  ])("rejects %s returned through the shared account API key", async (_name, overrides) => {
    expect(await inquire(inquiryRow(overrides))).toMatchObject({ ok: false, code: "invalid_response", allowsNewCollection: false });
  });

  it("rejects a response for a different transaction ID", async () => {
    expect(await inquire(inquiryRow(), { by: "transaction_id", transactionId: "800002" })).toMatchObject({
      ok: false, code: "invalid_response", allowsNewCollection: false,
    });
  });

  it("rejects an authenticated order whose merchant reference differs from the inquiry", async () => {
    expect(await inquire(inquiryRow(), { by: "merchant_order_id", merchantOrderId: "another-order" })).toMatchObject({
      ok: false, code: "invalid_response", allowsNewCollection: false,
    });
  });

  it.each(["auth", "inquiry"])("keeps a thrown %s network request uncertain without retries", async (stage) => {
    let calls = 0;
    const http: PaymobHttpClient = { async request() {
      calls += 1;
      if (stage === "auth" || calls > 1) throw new Error("connection failed");
      return { kind: "response", response: { status: 201, headers: {}, bodyText: '{"token":"INQUIRY_FIXTURE_ONLY"}' } };
    } };
    await expect(reconcilePaymobTransaction({
      config: { ...defaultPaymobTestConfigSkeleton(), secretKey: paymobAdapterFixtures.secretKey,
        publicKey: paymobAdapterFixtures.publicKey, hmacSecret: paymobAdapterFixtures.hmacSecret,
        apiKeyShared: paymobAdapterFixtures.apiKeyShared, integrationId: 71610, merchantOwnerId: "1001" },
      http, lookup: { by: "order_id", orderId: "900001" },
    })).resolves.toMatchObject({ ok: false, code: "network_error", allowsNewCollection: false });
    expect(calls).toBe(stage === "auth" ? 1 : 2);
  });
});
