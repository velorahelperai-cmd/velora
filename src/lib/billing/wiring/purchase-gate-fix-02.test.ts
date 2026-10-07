/**
 * VEL-SUBSCRIPTION-PURCHASE-GATE-FIX-02 — renew tier lock, CONTENT_MISMATCH, precise 23505.
 */

import { describe, expect, it } from "vitest";
import {
  decidePurchaseGate,
  purchasePurposeKey,
  VELORA_SUBSCRIPTION_PRODUCT_CODE,
  type OpenPurchaseOrder,
} from "@/lib/billing/wiring/purchase-gate";
import { persistOrderWithAttempt } from "@/lib/billing/wiring/order-create-persist";
import {
  buildEarlyRenewQuote,
  confirmationFromQuote,
} from "@/lib/billing/wiring/renew-gate";
import type { SubscriptionSnapshot } from "@/lib/billing/types";

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN_TIER_A = "plan-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN_TIER_B = "plan-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VER_MONTHLY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VER_YEARLY_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VER_MONTHLY_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function subActive(
  paidThrough: Date,
  planVersionId = VER_MONTHLY_A,
): SubscriptionSnapshot {
  return {
    companyId: COMPANY_A,
    status: "active",
    paidThrough,
    cancelAtPeriodEnd: false,
    planVersionId,
  };
}

function openOrder(
  overrides: Partial<OpenPurchaseOrder> & { id: string; clientOpId: string },
): OpenPurchaseOrder {
  return {
    companyId: COMPANY_A,
    planVersionId: VER_MONTHLY_A,
    inputFingerprint: "fp-monthly",
    amountBaisa: 9000,
    currency: "OMR",
    specialReference: "sr",
    status: "locked",
    attemptStatus: "unresolved",
    productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
    purchasePurpose: "initial",
    ...overrides,
  };
}

describe("FIX-02 renew cannot change tier", () => {
  it("renew to different plan_id → UPGRADE_NOT_CONFIGURED", () => {
    const paidThrough = new Date(Date.now() + 86400000 * 20);
    const clock = { now: () => new Date() };
    const quote = buildEarlyRenewQuote({
      amountBaisa: 12000,
      period: { unit: "month", count: 1 },
      currentPaidThrough: paidThrough,
      clock,
    });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "renew",
      subscriptionPlanId: PLAN_TIER_A,
      requestedPlanId: PLAN_TIER_B,
      planVersionId: VER_MONTHLY_B,
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
      earlyRenewConfirmation: confirmationFromQuote(quote),
      serverProjectedPaidThroughIso: quote.projectedPaidThroughIso,
      publishedAmountBaisa: 12000,
      publishedPeriodUnit: "month",
      publishedPeriodCount: 1,
      clock,
    });
    expect(gate).toMatchObject({
      ok: false,
      code: "UPGRADE_NOT_CONFIGURED",
    });
  });

  it("renew same tier different cycle allowed with confirmation", () => {
    const paidThrough = new Date("2027-01-01T00:00:00.000Z");
    const clock = { now: () => new Date("2026-12-01T00:00:00.000Z") };
    const quote = buildEarlyRenewQuote({
      amountBaisa: 90000,
      period: { unit: "year", count: 1 },
      currentPaidThrough: paidThrough,
      clock,
    });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "renew",
      subscriptionPlanId: PLAN_TIER_A,
      requestedPlanId: PLAN_TIER_A,
      planVersionId: VER_YEARLY_A,
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
      earlyRenewConfirmation: confirmationFromQuote(quote),
      serverProjectedPaidThroughIso: quote.projectedPaidThroughIso,
      publishedAmountBaisa: 90000,
      publishedPeriodUnit: "year",
      publishedPeriodCount: 1,
      clock,
    });
    expect(gate.ok && gate.action === "proceed_create").toBe(true);
  });
});

describe("FIX-02 CONTENT_MISMATCH on sequential reuse", () => {
  it("same clientOpId different fingerprint vs open order → CONTENT_MISMATCH", () => {
    const open = openOrder({
      id: "ord-1",
      clientOpId: "same-op",
      inputFingerprint: "fp-A",
      attemptStatus: "unresolved",
    });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [open],
      clientOpId: "same-op",
      inputFingerprint: "fp-B-different",
    });
    expect(gate).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
  });

  it("different clientOpId still reuses open without changing fields", () => {
    const open = openOrder({
      id: "ord-1",
      clientOpId: "op-1",
      planVersionId: VER_MONTHLY_A,
      attemptStatus: "unresolved",
    });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "initial",
      planVersionId: VER_YEARLY_A,
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [open],
      clientOpId: "op-2",
      inputFingerprint: "fp-yearly",
    });
    expect(gate.ok && gate.action === "reuse_open_order").toBe(true);
    if (!(gate.ok && gate.openOrder)) return;
    expect(gate.openOrder.planVersionId).toBe(VER_MONTHLY_A);
    expect(gate.blockNewCollection).toBe(true);
  });
});

describe("FIX-02 precise 23505", () => {
  const decision = {
    ok: true as const,
    action: "insert" as const,
    companyId: COMPANY_A,
    planVersionId: VER_YEARLY_A,
    clientOpId: "op-x",
    inputFingerprint: "fp-x",
    amountBaisa: 1,
    currency: "OMR" as const,
    periodDays: 365,
    periodUnit: "year" as const,
    periodCount: 1,
    providerAmount: null,
    providerAmountUnit: null,
    providerEnvironment: "test" as const,
    specialReference: "sr-x",
  };

  it("special_reference unique → special_reference_conflict not reuse", async () => {
    const result = await persistOrderWithAttempt({
      companyId: COMPANY_A,
      productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
      purchasePurpose: "initial",
      decision,
      orderInsertRow: {},
      deps: {
        insertOrder: async () => ({
          ok: false as const,
          code: "23505",
          constraint: "billing_orders_special_reference_uidx",
        }),
        findOrderByClientOp: async () => null,
        findOpenOrderForPurpose: async () => ({
          id: "should-not-reuse",
          specialReference: "sr-open",
          inputFingerprint: "fp-open",
          attemptStatus: "intent_created",
        }),
        findLatestAttempt: async () => ({ id: "a" }),
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
    });
    expect(result).toEqual({ ok: false, code: "special_reference_conflict" });
  });

  it("open_product_purpose unique → reuse with blockNewCollection when unresolved", async () => {
    const result = await persistOrderWithAttempt({
      companyId: COMPANY_A,
      productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
      purchasePurpose: "initial",
      decision,
      orderInsertRow: {},
      deps: {
        insertOrder: async () => ({
          ok: false as const,
          code: "23505",
          constraint: "billing_orders_open_product_purpose_uidx",
        }),
        findOrderByClientOp: async () => null,
        findOpenOrderForPurpose: async () => ({
          id: "ord-win",
          specialReference: "sr-win",
          inputFingerprint: "fp-win",
          attemptStatus: "unresolved",
        }),
        findLatestAttempt: async () => ({ id: "att-win", status: "unresolved" }),
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
    });
    expect(result).toMatchObject({
      ok: true,
      action: "reuse",
      orderId: "ord-win",
      blockNewCollection: true,
    });
  });
});

describe("FIX-02 company isolation", () => {
  it("purpose keys remain company-scoped", () => {
    expect(purchasePurposeKey(COMPANY_A, "initial")).not.toBe(
      purchasePurposeKey(COMPANY_B, "initial"),
    );
  });
});

describe("FIX-02 active initial denied", () => {
  it("ALREADY_SUBSCRIBED before open reuse when within paid period", () => {
    const open = openOrder({ id: "stale", clientOpId: "op" });
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "initial",
      subscription: subActive(new Date(Date.now() + 86400000)),
      companyStatus: "active",
      openOrdersForPurpose: [open],
      clientOpId: "other",
      inputFingerprint: "fp",
    });
    expect(gate).toMatchObject({ ok: false, code: "ALREADY_SUBSCRIBED" });
  });
});
