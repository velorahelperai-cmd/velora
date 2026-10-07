/**
 * VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01 — single product, purposes, 23505 semantics.
 * Local/pure only — no cloud, no Paymob.
 */

import { describe, expect, it } from "vitest";
import {
  decidePurchaseGate,
  purchaseGateToUiState,
  purchasePurposeKey,
  selectOpenOrderForPurpose,
  normalizePurchasePurpose,
  VELORA_SUBSCRIPTION_PRODUCT_CODE,
  type OpenPurchaseOrder,
} from "@/lib/billing/wiring/purchase-gate";
import {
  buildEarlyRenewQuote,
  confirmationFromQuote,
} from "@/lib/billing/wiring/renew-gate";
import { persistOrderWithAttempt } from "@/lib/billing/wiring/order-create-persist";
import type { SubscriptionSnapshot } from "@/lib/billing/types";

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TIER_MONTHLY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TIER_YEARLY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TIER_HIGHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function subActive(paidThrough: Date, planVersionId = TIER_MONTHLY): SubscriptionSnapshot {
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
    planVersionId: TIER_MONTHLY,
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

describe("single product purpose key", () => {
  it("monthly→yearly and tier switch share the same open-purchase key", () => {
    const monthly = purchasePurposeKey(COMPANY_A, "initial");
    const yearly = purchasePurposeKey(COMPANY_A, "initial");
    expect(monthly).toBe(yearly);
    expect(monthly).toBe(
      `${COMPANY_A}|${VELORA_SUBSCRIPTION_PRODUCT_CODE}|initial`,
    );
    // plan_version is not part of the key
    expect(monthly).not.toContain(TIER_MONTHLY);
    expect(monthly).not.toContain(TIER_YEARLY);
  });

  it("companies stay isolated; renew/upgrade are distinct purposes", () => {
    expect(purchasePurposeKey(COMPANY_A, "initial")).not.toBe(
      purchasePurposeKey(COMPANY_B, "initial"),
    );
    expect(purchasePurposeKey(COMPANY_A, "initial")).not.toBe(
      purchasePurposeKey(COMPANY_A, "renew"),
    );
    expect(purchasePurposeKey(COMPANY_A, "renew")).not.toBe(
      purchasePurposeKey(COMPANY_A, "upgrade"),
    );
  });

  it("two tabs: open monthly order reused when requesting yearly / other tier", () => {
    const openMonthly = openOrder({
      id: "ord-monthly",
      clientOpId: "op-tab-1",
      planVersionId: TIER_MONTHLY,
      attemptStatus: "provider_submitted",
    });
    const gateYearly = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: TIER_YEARLY,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [openMonthly],
    });
    expect(gateYearly.ok && gateYearly.action === "reuse_open_order").toBe(true);
    if (!(gateYearly.ok && gateYearly.action === "reuse_open_order")) return;
    expect(gateYearly.openOrder?.id).toBe("ord-monthly");
    expect(gateYearly.blockNewCollection).toBe(true);

    const gateHigher = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: TIER_HIGHER,
      purchasePurpose: "initial",
      subscription: null,
      companyStatus: "active",
      openOrdersForPurpose: [openMonthly],
    });
    expect(gateHigher.ok && gateHigher.openOrder?.id).toBe("ord-monthly");
    expect(selectOpenOrderForPurpose([openMonthly])?.id).toBe("ord-monthly");
  });
});

describe("active subscription blocks new purchase; upgrade not configured", () => {
  it("ALREADY_SUBSCRIBED for initial while within paid period", () => {
    const paidThrough = new Date(Date.now() + 86400000 * 10);
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: TIER_YEARLY,
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

  it("upgrade returns UPGRADE_NOT_CONFIGURED — no second subscription path", () => {
    const paidThrough = new Date(Date.now() + 86400000 * 10);
    const gate = decidePurchaseGate({
      companyId: COMPANY_A,
      planVersionId: TIER_HIGHER,
      purchasePurpose: "upgrade",
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
    });
    expect(gate).toMatchObject({
      ok: false,
      code: "UPGRADE_NOT_CONFIGURED",
      manageSubscriptionHint: true,
    });
    expect(purchaseGateToUiState(gate).upgradeNotConfigured).toBe(true);
    expect(normalizePurchasePurpose("upgrade")).toBe("upgrade");
  });

  it("renew still requires explicit confirmation", () => {
    const paidThrough = new Date("2027-01-01T00:00:00.000Z");
    const clock = { now: () => new Date("2026-12-01T00:00:00.000Z") };
    const quote = buildEarlyRenewQuote({
      amountBaisa: 9000,
      period: { unit: "year", count: 1 },
      currentPaidThrough: paidThrough,
      clock,
    });
    expect(
      decidePurchaseGate({
        companyId: COMPANY_A,
        purchasePurpose: "renew",
        subscription: subActive(paidThrough),
        companyStatus: "active",
        openOrdersForPurpose: [],
        clock,
      }),
    ).toMatchObject({ ok: false, code: "EARLY_RENEW_REQUIRED_EXPLICIT" });

    const ok = decidePurchaseGate({
      companyId: COMPANY_A,
      purchasePurpose: "renew",
      subscription: subActive(paidThrough),
      companyStatus: "active",
      openOrdersForPurpose: [],
      earlyRenewConfirmation: confirmationFromQuote(quote),
      serverProjectedPaidThroughIso: quote.projectedPaidThroughIso,
      publishedAmountBaisa: 9000,
      publishedPeriodUnit: "year",
      publishedPeriodCount: 1,
      clock,
    });
    expect(ok.ok && ok.action === "proceed_create").toBe(true);
  });
});

describe("23505 constraint-aware persist", () => {
  const baseDecision = {
    ok: true as const,
    action: "insert" as const,
    companyId: COMPANY_A,
    planVersionId: TIER_YEARLY,
    clientOpId: "op-loser",
    inputFingerprint: "fp-loser",
    amountBaisa: 9000,
    currency: "OMR" as const,
    periodDays: 365,
    periodUnit: "year" as const,
    periodCount: 1,
    providerAmount: null,
    providerAmountUnit: null,
    providerEnvironment: "test" as const,
    specialReference: "sr-loser",
  };

  it("client_op conflict with different fingerprint rejects — does not return another order", async () => {
    const result = await persistOrderWithAttempt({
      companyId: COMPANY_A,
      productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
      purchasePurpose: "initial",
      decision: baseDecision,
      orderInsertRow: {},
      deps: {
        insertOrder: async () => ({
          ok: false as const,
          code: "23505",
          constraint: "billing_orders_company_client_op_uidx",
        }),
        findOrderByClientOp: async () => ({
          id: "ord-other-fp",
          specialReference: "sr-other",
          inputFingerprint: "fp-DIFFERENT",
        }),
        findOpenOrderForPurpose: async () => ({
          id: "ord-should-not-use",
          specialReference: "sr-open",
          inputFingerprint: "fp-open",
        }),
        findLatestAttempt: async () => ({ id: "att" }),
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
    });
    expect(result).toEqual({ ok: false, code: "CONTENT_MISMATCH" });
  });

  it("open product-purpose race reuses winner and keeps blockNewCollection when unresolved", async () => {
    const result = await persistOrderWithAttempt({
      companyId: COMPANY_A,
      productCode: VELORA_SUBSCRIPTION_PRODUCT_CODE,
      purchasePurpose: "initial",
      decision: baseDecision,
      orderInsertRow: {},
      deps: {
        insertOrder: async () => ({
          ok: false as const,
          code: "23505",
          constraint: "billing_orders_open_product_purpose_uidx",
        }),
        findOrderByClientOp: async () => null,
        findOpenOrderForPurpose: async (cid, product, purpose) => {
          expect(cid).toBe(COMPANY_A);
          expect(product).toBe(VELORA_SUBSCRIPTION_PRODUCT_CODE);
          expect(purpose).toBe("initial");
          return {
            id: "ord-win",
            specialReference: "sr-win",
            inputFingerprint: "fp-win",
            attemptStatus: "unresolved",
          };
        },
        findLatestAttempt: async () => ({ id: "att-win", status: "unresolved" }),
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
    });
    expect(result).toEqual({
      ok: true,
      action: "reuse",
      orderId: "ord-win",
      specialReference: "sr-win",
      paymentAttemptId: "att-win",
      blockNewCollection: true,
    });
  });
});
