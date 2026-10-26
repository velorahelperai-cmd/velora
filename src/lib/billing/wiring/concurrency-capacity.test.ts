/**
 * VEL-PAYMENT-CONCURRENCY-CAPACITY-01 — updated for single-product purpose key.
 * In-memory / pure only — no cloud Supabase, no Paymob network.
 */

import { describe, expect, it } from "vitest";
import {
  decidePurchaseGate,
  purchaseGateToUiState,
  purchasePurposeKey,
  selectOpenOrderForPurpose,
  VELORA_SUBSCRIPTION_PRODUCT_CODE,
  type OpenPurchaseOrder,
} from "@/lib/billing/wiring/purchase-gate";
import {
  buildEarlyRenewQuote,
  confirmationFromQuote,
  earlyRenewClientOpFingerprint,
} from "@/lib/billing/wiring/renew-gate";
import { decideCreateBillingOrder } from "@/lib/billing/wiring/order-create";
import { persistOrderWithAttempt } from "@/lib/billing/wiring/order-create-persist";
import type { SubscriptionSnapshot } from "@/lib/billing/types";

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN_OTHER_TIER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function subActive(paidThrough: Date): SubscriptionSnapshot {
  return {
    companyId: COMPANY_A,
    status: "active",
    paidThrough,
    cancelAtPeriodEnd: false,
    planVersionId: PLAN,
  };
}

function openOrder(
  overrides: Partial<OpenPurchaseOrder> & { id: string; clientOpId: string },
): OpenPurchaseOrder {
  return {
    companyId: COMPANY_A,
    planVersionId: PLAN,
    inputFingerprint: "fp",
    amountBaisa: 9000,
    currency: "OMR",
    specialReference: "sr",
    status: "locked",
    attemptStatus: "intent_created",
    productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
    purchasePurpose: "initial",
    ...overrides,
  };
}

describe("purchase purpose — not clientOp alone", () => {
  it("double press / two tabs / two devices with different clientOpId reuse open order", () => {
    const open = openOrder({ id: "ord-1", clientOpId: "op-tab-1" });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [open],
    });
    expect(gate.ok && gate.action === "reuse_open_order").toBe(true);
    if (!(gate.ok && gate.action === "reuse_open_order")) return;
    expect(gate.openOrder?.id).toBe("ord-1");
    expect(gate.blockNewCollection).toBe(false);

    const create = decideCreateBillingOrder({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      clientOpId: "op-tab-2",
      membership: { companyId: COMPANY_A, role: "owner", status: "active" },
      planVersion: {
        id: PLAN,
        status: "published",
        amountBaisa: 9000,
        currency: "OMR",
        periodDays: 30,
        periodUnit: "day",
        periodCount: 30,
      },
      existingSameClientOp: null,
    });
    expect(create.ok && create.action === "insert").toBe(true);
    expect(purchasePurposeKey(COMPANY_A, "initial")).toBe(
      `${COMPANY_A}|${VELORA_SUBSCRIPTION_PRODUCT_CODE}|initial`,
    );
  });

  it("pending/unknown blocks new collection until reconcile", () => {
    const open = openOrder({
      id: "ord-p",
      clientOpId: "op-1",
      attemptStatus: "provider_submitted",
    });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [open],
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.blockNewCollection).toBe(true);
    expect(gate.action).toBe("reuse_open_order");

    const unknown = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [
        openOrder({ id: "ord-u", clientOpId: "op-u", attemptStatus: "unresolved" }),
      ],
    });
    expect(unknown.ok && unknown.blockNewCollection).toBe(true);
  });

  it("different tier/cycle is still the same subscription product purpose", () => {
    const openMain = openOrder({ id: "ord-main", clientOpId: "op-m", planVersionId: PLAN });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: PLAN_OTHER_TIER,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [openMain],
    });
    expect(gate.ok && gate.action === "reuse_open_order").toBe(true);
    expect(selectOpenOrderForPurpose([openMain])?.planVersionId).toBe(PLAN);
    expect(purchasePurposeKey(COMPANY_A, "initial")).toBe(
      purchasePurposeKey(COMPANY_A, "initial"),
    );
  });
});

describe("active subscription — no implicit renew", () => {
  it("returns ALREADY_SUBSCRIBED with manage hint", () => {
    const paidThrough = new Date(Date.now() + 86400000 * 10);
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      purchasePurpose: "initial",
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
    });
    expect(gate).toMatchObject({
      ok: false,
      code: "ALREADY_SUBSCRIBED",
      manageSubscriptionHint: true,
    });
    expect(purchaseGateToUiState(gate).showManageSubscription).toBe(true);
  });

  it("early renew requires explicit confirmation matching server quote", () => {
    const paidThrough = new Date("2027-01-01T00:00:00.000Z");
    const clock = { now: () => new Date("2026-12-01T00:00:00.000Z") };
    const quote = buildEarlyRenewQuote({
      amountBaisa: 9000,
      period: { unit: "day", count: 30 },
      currentPaidThrough: paidThrough,
      clock,
    });
    const missing = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      purchasePurpose: "renew",
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
      clock,
    });
    expect(missing).toMatchObject({ ok: false, code: "EARLY_RENEW_REQUIRED_EXPLICIT" });

    const mismatch = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      purchasePurpose: "renew",
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
      earlyRenewConfirmation: {
        ...confirmationFromQuote(quote),
        amountBaisa: 1,
      },
      serverProjectedPaidThroughIso: quote.projectedPaidThroughIso,
      publishedAmountBaisa: 9000,
      publishedPeriodUnit: "day",
      publishedPeriodCount: 30,
      clock,
    });
    expect(mismatch).toMatchObject({ ok: false, code: "EARLY_RENEW_CONFIRMATION_MISMATCH" });

    const ok = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      purchasePurpose: "renew",
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
      earlyRenewConfirmation: confirmationFromQuote(quote),
      serverProjectedPaidThroughIso: quote.projectedPaidThroughIso,
      publishedAmountBaisa: 9000,
      publishedPeriodUnit: "day",
      publishedPeriodCount: 30,
      clock,
    });
    expect(ok.ok && ok.action === "proceed_create").toBe(true);

    const fp1 = earlyRenewClientOpFingerprint({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      projectedPaidThroughIso: quote.projectedPaidThroughIso,
      amountBaisa: 9000,
    });
    const fp2 = earlyRenewClientOpFingerprint({
      companyId: COMPANY_A,
      planVersionId: PLAN,
      projectedPaidThroughIso: quote.projectedPaidThroughIso,
      amountBaisa: 9000,
    });
    expect(fp1).toBe(fp2);
  });
});

describe("company isolation of purpose keys", () => {
  it("same product concurrent for A and B are distinct purposes", () => {
    expect(purchasePurposeKey(COMPANY_A, "initial")).not.toBe(
      purchasePurposeKey(COMPANY_B, "initial"),
    );
  });
});

describe("atomic open-purpose race (distinct clientOpId)", () => {
  it("second insert unique-violation reuses winning open order — no second charge path", async () => {
    const winner = {
      id: "ord-win",
      specialReference: "sr-win",
      inputFingerprint: "fp-other",
      attemptStatus: "intent_created" as const,
    };
    let inserts = 0;
    const result = await persistOrderWithAttempt({
      companyId: COMPANY_A,
      productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
      purchasePurpose: "initial",
      decision: {
        ok: true,
        action: "insert",
        companyId: COMPANY_A,
        planVersionId: PLAN,
        clientOpId: "op-loser",
        inputFingerprint: "fp-loser",
        amountBaisa: 9000,
        currency: "OMR",
        periodDays: 30,
        periodUnit: "day",
        periodCount: 30,
        providerAmount: null,
        providerAmountUnit: null,
        providerEnvironment: "test",
        specialReference: "sr-loser",
      },
      orderInsertRow: { company_id: COMPANY_A },
      deps: {
        insertOrder: async () => {
          inserts += 1;
          return {
            ok: false as const,
            code: "23505",
            constraint: "billing_orders_open_product_purpose_uidx",
          };
        },
        findOrderByClientOp: async () => null,
        findOpenOrderForPurpose: async (cid, product, purpose) => {
          expect(cid).toBe(COMPANY_A);
          expect(product).toBe(VELORA_SUBSCRIPTION_PRODUCT_CODE);
          expect(purpose).toBe("initial");
          return winner;
        },
        findLatestAttempt: async () => ({ id: "att-win", status: "intent_created" }),
        insertAttempt: async () => ({ ok: false as const, code: "should_not_insert" }),
      },
    });
    expect(inserts).toBe(1);
    expect(result).toEqual({
      ok: true,
      action: "reuse",
      orderId: "ord-win",
      specialReference: "sr-win",
      paymentAttemptId: "att-win",
      blockNewCollection: false,
    });
  });
});
