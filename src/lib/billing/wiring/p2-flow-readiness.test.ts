import { describe, expect, it, vi } from "vitest";
import { buildProcessedCallbackBody, paymobAdapterFixtures as f } from "../paymob/fixtures";
import { receivePaymobWebhook, type SavedOrderForWebhook } from "./webhook-receive";
import { decideCreateBillingOrder } from "./order-create";
import { processStoredPaymobEvent, type StoredProviderEvent } from "./event-process";
import { mapBillingReturnDisplay } from "./return-status";

const order: SavedOrderForWebhook = { companyId: f.companyId, orderId: f.orderId, paymentAttemptId: "attempt",
  providerOrderId: f.providerOrderId, specialReference: f.specialReference, amountBaisa: 5000, currency: "OMR",
  providerAmount: f.providerAmount, providerAccountRef: String(f.integrationId), providerEnvironment: "test",
  integrationId: f.integrationId, merchantOwnerId: f.merchantOwnerId, status: "provider_submitted" };
const event: StoredProviderEvent = { id: "event", companyId: f.companyId, orderId: f.orderId, paymentAttemptId: "attempt",
  providerTransactionId: "800001", eventStatus: "success", providerAccountRef: String(f.integrationId),
  specialReference: f.specialReference, amountBaisa: 5000, observationKey: "observation" };

describe("signed callback rejects the wrong locked financial binding", () => {
  it.each([
    [{ amount_cents: 5001 }, "amount_mismatch"], [{ currency: "EGP" }, "currency_mismatch"],
    [{ integration_id: 71611 }, "integration_mismatch"], [{ owner: 1002 }, "owner_mismatch"],
  ] as const)("rejects valid-HMAC mismatch %j", async (difference, reason) => {
    const fixture = buildProcessedCallbackBody(difference), insert = vi.fn();
    const result = await receivePaymobWebhook({ rawBody: JSON.stringify(fixture.body), hmacQueryParam: fixture.hmac,
      deps: { webhookEnabled: true, hmacSecret: f.hmacSecret, findOrderByProviderOrderId: async () => order, insertProviderEvent: insert } });
    expect(result).toEqual({ status: 409, body: reason });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("server-priced order publication and tenant checks", () => {
  const input = { companyId: f.companyId, planVersionId: "version", clientOpId: "operation",
    membership: { companyId: f.companyId, role: "owner" as const, status: "active" as const }, existingSameClientOp: null };
  const plan = { id: "version", status: "published" as const, amountBaisa: 5000, currency: "OMR" as const,
    periodDays: 30, periodUnit: "month" as const, periodCount: 1 };
  it.each(["draft", "retired"] as const)("rejects a %s version directly at the order decision", status => {
    expect(decideCreateBillingOrder({ ...input, planVersion: { ...plan, status } })).toEqual({ ok: false, code: "plan_not_published" });
  });
  it("rejects membership from another tenant", () => {
    expect(decideCreateBillingOrder({ ...input, planVersion: plan, membership: { ...input.membership, companyId: "other-company" } })).toEqual({ ok: false, code: "not_owner" });
  });
});

describe("application ordering and parallel RPC replay contract", () => {
  it.each(["pending", "failed", "other"] as const)("does not settle %s after a completed success", async eventStatus => {
    const settle = vi.fn().mockResolvedValue({ ok: true, outcome: "granted" });
    const deps = { settleEnabled: true, settleHmacVerified: settle };
    expect(await processStoredPaymobEvent({ event, deps })).toEqual({ ok: true, outcome: "granted" });
    await processStoredPaymobEvent({ event: { ...event, eventStatus }, deps });
    expect(settle).toHaveBeenCalledTimes(1);
  });
  it("retains the atomic port's replay result for concurrent duplicate requests", async () => {
    const settle = vi.fn().mockResolvedValueOnce({ ok: true, outcome: "granted" }).mockResolvedValueOnce({ ok: true, outcome: "idempotent_replay" });
    const results = await Promise.all([0, 1].map(() => processStoredPaymobEvent({ event, deps: { settleEnabled: true, settleHmacVerified: settle } })));
    expect(results).toEqual([{ ok: true, outcome: "granted" }, { ok: true, outcome: "idempotent_replay" }]);
    for (const [evidence] of settle.mock.calls) expect(evidence).toMatchObject({ company_id: f.companyId, order_id: f.orderId, provider_transaction_id: "800001", observation_key: "observation" });
    // This checks application evidence/outcome preservation, not Postgres atomicity.
  });
  it("never displays a proven collection as failed because a late failure arrived", () => {
    expect(mapBillingReturnDisplay({ requestCompanyId: f.companyId, row: { companyId: f.companyId, orderId: f.orderId,
      orderStatus: "closed", attemptStatus: "paid", latestEventStatus: "failed", hasGrant: true,
      financial: provenReturnQualification(f.companyId, f.orderId, "2026-11-08T00:00:00.000Z"),
      paidThrough: "2026-11-08T00:00:00.000Z", successEventStored: true, awaitingProcessing: false } }))
      .toEqual({ kind: "success", messageKey: "payment_confirmed", paidThrough: "2026-11-08T00:00:00.000Z", environment: "test" });
  });
});
import { provenReturnQualification } from "./financial-truth.fixtures";
