import { describe, expect, it, vi } from "vitest";
import { buildProcessedCallbackBody, paymobAdapterFixtures as f } from "../paymob/fixtures";
import { receivePaymobWebhook } from "./webhook-receive";
import { buildPaymobHmacSettlementEvidence } from "./settlement-bridge";
import { processStoredPaymobEvent } from "./event-process";

const order = { companyId: f.companyId, orderId: f.orderId, paymentAttemptId: "attempt", status: "provider_submitted", providerOrderId: f.providerOrderId, specialReference: f.specialReference, amountBaisa: 5000, currency: "OMR" as const, providerAmount: f.providerAmount, providerAccountRef: String(f.integrationId), providerEnvironment: "test" as const, integrationId: f.integrationId, merchantOwnerId: f.merchantOwnerId };
describe("P1/P2 signed receipt and RPC contract", () => {
  it("retains legacy currency plus P1 expected-currency alias", () => {
    expect(buildPaymobHmacSettlementEvidence({ companyId: order.companyId, orderId: order.orderId, paymentAttemptId: order.paymentAttemptId, providerAccountRef: order.providerAccountRef, providerTransactionId: "transaction", specialReference: order.specialReference, amountBaisa: 5000 })).toMatchObject({ currency: "OMR", currency_expected: "OMR" });
  });
  it("selects provider binding from signed account and trusted environment", async () => {
    const fixture = buildProcessedCallbackBody(), find = vi.fn().mockResolvedValue(order);
    await receivePaymobWebhook({ rawBody: JSON.stringify(fixture.body), hmacQueryParam: fixture.hmac, deps: { webhookEnabled: true, hmacSecret: f.hmacSecret, findOrderByProviderOrderId: find, insertProviderEvent: async () => ({ ok: true, inserted: true, eventId: "event" }) } });
    expect(find).toHaveBeenCalledWith(f.providerOrderId, { providerAccountRef: String(f.integrationId), providerEnvironment: "test" });
  });
  it("durably retains signed reversal without claiming collection", async () => {
    const fixture = buildProcessedCallbackBody({ is_refunded: true }), insert = vi.fn().mockResolvedValue({ ok: true, inserted: true, eventId: "event" });
    await receivePaymobWebhook({ rawBody: JSON.stringify(fixture.body), hmacQueryParam: fixture.hmac, deps: { webhookEnabled: true, hmacSecret: f.hmacSecret, findOrderByProviderOrderId: async () => order, insertProviderEvent: insert } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ eventStatus: "refunded", rawSummary: expect.objectContaining({ hmac_verified: true, is_refunded: true }) }));
  });
  it("dispatches a stored refund to review, preserving the RPC outcome", async () => {
    const settle = vi.fn().mockResolvedValue({ ok: true, outcome: "lifecycle_review" });
    const result = await processStoredPaymobEvent({ event: { id: "event", companyId: order.companyId, orderId: order.orderId, paymentAttemptId: order.paymentAttemptId, providerTransactionId: "transaction", eventStatus: "refunded" as never, providerAccountRef: order.providerAccountRef, specialReference: order.specialReference, amountBaisa: 5000, observationKey: "signed-observation" }, deps: { settleEnabled: true, settleHmacVerified: settle } });
    expect(result).toEqual({ ok: true, outcome: "lifecycle_review" });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ event_status: "refunded", currency_expected: "OMR" }));
  });
});
