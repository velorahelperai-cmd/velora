/**
 * VEL-BILLING-FOUNDATION-01 unit tests (pure domain).
 * Covers T7–T9, T13–T15, T18 + pending→success, dedup apply, company/env mismatch,
 * missing limits, renew failure, cancel-at-period-end, security suspend.
 *
 * These are NOT proofs of RLS or SQL transactions — those need a test database.
 */

import { describe, expect, it } from "vitest";
import {
  canInsertProviderEvent,
  computePaidThroughAfterSuccessfulPayment,
  decideEntitlementApplication,
  applyEntitlementToSubscription,
} from "@/lib/billing/apply-entitlement";
import { fixedClock } from "@/lib/billing/clock";
import {
  evaluateCompanyEntitlement,
  entitlementAllowsAutomation,
  readCompanyEntitlement,
} from "@/lib/billing/entitlement";
import {
  assertTestFixture,
  BILLING_TEST_FIXTURE_MARKER,
  billingTestFixtures,
} from "@/lib/billing/fixtures";
import { decideInboundStorage, isSuccessfulStore } from "@/lib/billing/inbound-retention";
import { assertOperationAllowedByLimit } from "@/lib/billing/limits";
import { canManageCompanyBilling, membershipImpliesBillingPower } from "@/lib/billing/membership";
import {
  assertCommercialMoney,
  commercialBaisaToPaymobAmount,
  getPaymobAmountConversion,
  parseCommercialBaisa,
  singleFileLimitIsCompanyStorageQuota,
} from "@/lib/billing/money";
import {
  applyCancelAtPeriodEnd,
  applyRenewalFailure,
  evaluateSubscriptionEntitlement,
} from "@/lib/billing/subscription-state";
import type { LockedOrderSnapshot, SubscriptionSnapshot } from "@/lib/billing/types";

assertTestFixture(billingTestFixtures.marker);

const now = fixedClock("2026-10-06T12:00:00.000Z");

function sub(partial: Partial<SubscriptionSnapshot> & Pick<SubscriptionSnapshot, "companyId">): SubscriptionSnapshot {
  return {
    status: "unprovisioned",
    paidThrough: null,
    cancelAtPeriodEnd: false,
    planVersionId: null,
    ...partial,
  };
}

function order(partial?: Partial<LockedOrderSnapshot>): LockedOrderSnapshot {
  return {
    companyId: billingTestFixtures.companyA,
    planVersionId: "plan-ver-1",
    amountBaisa: billingTestFixtures.amountBaisa,
    currency: "OMR",
    periodDays: billingTestFixtures.periodDays,
    providerAccountRef: billingTestFixtures.providerAccountRef,
    providerEnvironment: billingTestFixtures.providerEnvironment,
    specialReference: "sr-1",
    clientOpId: "op-1",
    inputFingerprint: "fp-1",
    providerAmount: null,
    providerAmountUnit: null,
    ...partial,
  };
}

describe("membership reuse (owner only)", () => {
  it("allows active owner only", () => {
    expect(
      canManageCompanyBilling({
        companyId: billingTestFixtures.companyA,
        role: "owner",
        status: "active",
      }),
    ).toBe(true);
    expect(
      canManageCompanyBilling({
        companyId: billingTestFixtures.companyA,
        role: "staff",
        status: "active",
      }),
    ).toBe(false);
    expect(membershipImpliesBillingPower("staff")).toBe(false);
  });
});

describe("money: baisa ≠ Paymob units + safe integers", () => {
  it("keeps Paymob conversion unconfigured (T15 fixture marker present)", () => {
    expect(billingTestFixtures.marker).toBe(BILLING_TEST_FIXTURE_MARKER);
    expect(getPaymobAmountConversion()).toEqual({
      configured: false,
      reason: "paymob_omr_factor_unconfirmed",
    });
    expect(commercialBaisaToPaymobAmount(billingTestFixtures.amountBaisa)).toEqual({
      ok: false,
      code: "paymob_amount_conversion_unconfigured",
    });
    expect(singleFileLimitIsCompanyStorageQuota()).toBe(false);
  });

  it("rejects unsafe Number amounts (silent rounding)", () => {
    const unsafe = Number("9007199254740993");
    expect(Number.isSafeInteger(unsafe)).toBe(false);
    expect(parseCommercialBaisa(unsafe)).toEqual({ ok: false, code: "not_safe_integer" });
    expect(() => assertCommercialMoney({ currency: "OMR", amountBaisa: unsafe })).toThrow(
      /not_safe_integer|precision_loss/,
    );
    expect(parseCommercialBaisa("9007199254740993")).toEqual({
      ok: true,
      amountBaisa: BigInt("9007199254740993"),
    });
    expect(() =>
      assertCommercialMoney({ currency: "OMR", amountBaisa: Number("9007199254740993") }),
    ).toThrow();
  });
});

describe("T7 — never paid (paid_through null)", () => {
  it("is not ended and has no unpaid grace window", () => {
    const caps = evaluateSubscriptionEntitlement({
      subscription: sub({ companyId: billingTestFixtures.companyA }),
      companyStatus: "active",
      clock: now,
    });
    expect(caps.neverPaid).toBe(true);
    expect(caps.layerB).toBe("unprovisioned");
    expect(caps.periodEnded).toBe(false);
    expect(caps.inboundRetentionEligible).toBe(false);
    expect(caps.liveAi).toBe(false);

    const inbound = decideInboundStorage({
      subscription: sub({ companyId: billingTestFixtures.companyA }),
      companyStatus: "active",
      retentionMessageCap: billingTestFixtures.retentionMessageCap,
      retentionMessagesUsed: 0,
      clock: now,
    });
    expect(inbound).toEqual({
      outcome: "rejected_by_policy",
      reason: "never_paid",
      policyCode: "inbound_rejected_unpaid_retention",
    });
    expect(isSuccessfulStore(inbound)).toBe(false);
  });
});

describe("T8 — period ended cuts live ops; access paths stay orthogonal", () => {
  it("ends live AI/send when now >= paid_through", () => {
    const paidThrough = new Date("2026-10-01T00:00:00.000Z");
    const caps = evaluateSubscriptionEntitlement({
      subscription: sub({
        companyId: billingTestFixtures.companyA,
        status: "active",
        paidThrough,
      }),
      companyStatus: "active",
      clock: now,
    });
    expect(caps.periodEnded).toBe(true);
    expect(caps.layerB).toBe("ended");
    expect(caps.liveAi).toBe(false);
    expect(caps.manualSendViaVelora).toBe(false);
    expect(caps.inboundRetentionEligible).toBe(true);
  });
});

describe("T9 — early renew keeps remainder", () => {
  it("extends from max(now, paid_through)", () => {
    const current = new Date("2026-10-20T12:00:00.000Z");
    const next = computePaidThroughAfterSuccessfulPayment({
      now: now.now(),
      currentPaidThrough: current,
      periodDays: 30,
    });
    expect(next.toISOString()).toBe("2026-11-19T12:00:00.000Z");

    const fromNull = computePaidThroughAfterSuccessfulPayment({
      now: now.now(),
      currentPaidThrough: null,
      periodDays: 30,
    });
    expect(fromNull.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });
});

describe("T13 — missing required limit blocks operation", () => {
  it("fail-closes when limit absent", () => {
    expect(assertOperationAllowedByLimit(null)).toEqual({
      allowed: false,
      code: "limit_not_configured",
    });
    expect(assertOperationAllowedByLimit(undefined)).toEqual({
      allowed: false,
      code: "limit_not_configured",
    });
    expect(assertOperationAllowedByLimit(10)).toEqual({ allowed: true, limit: 10 });
  });

  it("preserves read-only incoming messages even without the old retention cap", () => {
    const inbound=decideInboundStorage({subscription:sub({companyId:billingTestFixtures.companyA,paidThrough:new Date("2026-10-01T00:00:00Z"),status:"ended"}),companyStatus:"active",retentionMessageCap:null,retentionMessagesUsed:1000,clock:now});
    expect(inbound).toEqual({outcome:"stored",reason:"within_retention_window"});expect(isSuccessfulStore(inbound)).toBe(true);
  });
});

describe("T14 — single-file limit is not company storage quota", () => {
  it("documents the separation", () => {
    expect(singleFileLimitIsCompanyStorageQuota()).toBe(false);
  });
});

describe("T15 — synthetic values only via labeled fixtures", () => {
  it("keeps fixture marker", () => {
    expect(billingTestFixtures.marker).toBe(BILLING_TEST_FIXTURE_MARKER);
    expect(billingTestFixtures.amountBaisa).toBe(5000);
  });
});

describe("T18 — entitlement checked at evaluation time (not cron-only)", () => {
  it("evaluateCompanyEntitlement reflects clock without cron", () => {
    const paidThrough = new Date("2026-10-10T00:00:00.000Z");
    const before = evaluateCompanyEntitlement({
      subscription: sub({
        companyId: billingTestFixtures.companyA,
        paidThrough,
        status: "active",
      }),
      companyStatus: "active",
      clock: fixedClock("2026-10-06T12:00:00.000Z"),
    });
    expect(before.paid).toBe(true);
    expect(entitlementAllowsAutomation(before)).toBe(true);

    const after = evaluateCompanyEntitlement({
      subscription: sub({
        companyId: billingTestFixtures.companyA,
        paidThrough,
        status: "active",
      }),
      companyStatus: "active",
      clock: fixedClock("2026-10-11T00:00:00.000Z"),
    });
    expect(after.paid).toBe(false);
    expect(entitlementAllowsAutomation(after)).toBe(false);
  });

  it("readCompanyEntitlement remains fail-closed until DB wiring (P2)", () => {
    expect(readCompanyEntitlement(billingTestFixtures.companyA)).toEqual({
      status: "not_configured",
      paid: false,
      liveSendAllowed: false,
      liveAnswerAllowed: false,
      source: "none",
    });
  });
});

describe("inbound 30-day grace + outcomes", () => {
  it("stores within retention window under cap", () => {
    const paidThrough = new Date("2026-10-01T00:00:00.000Z");
    const inbound = decideInboundStorage({
      subscription: sub({ companyId: billingTestFixtures.companyA, paidThrough }),
      companyStatus: "active",
      retentionMessageCap: billingTestFixtures.retentionMessageCap,
      retentionMessagesUsed: 3,
      clock: fixedClock("2026-10-05T12:00:00.000Z"),
    });
    expect(inbound).toEqual({ outcome: "stored", reason: "within_retention_window" });
  });

  it("rejects exactly at day 30", () => {
    const paidThrough = new Date("2026-10-01T00:00:00.000Z");
    const inbound = decideInboundStorage({
      subscription: sub({ companyId: billingTestFixtures.companyA, paidThrough }),
      companyStatus: "active",
      retentionMessageCap: billingTestFixtures.retentionMessageCap,
      retentionMessagesUsed: 0,
      clock: fixedClock("2026-10-31T00:00:00.000Z"),
    });
    expect(inbound.outcome).toBe("rejected_by_policy");
    if (inbound.outcome === "rejected_by_policy") {
      expect(inbound.reason).toBe("retention_window_elapsed");
    }
  });

  it("returns retryable_failure when storage fails for eligible message", () => {
    const paidThrough = new Date("2026-11-01T00:00:00.000Z");
    const inbound = decideInboundStorage({
      subscription: sub({ companyId: billingTestFixtures.companyA, paidThrough, status: "active" }),
      companyStatus: "active",
      retentionMessageCap: billingTestFixtures.retentionMessageCap,
      retentionMessagesUsed: 0,
      storageFailed: true,
      clock: now,
    });
    expect(inbound).toEqual({ outcome: "retryable_failure", reason: "storage_failed" });
    expect(isSuccessfulStore(inbound)).toBe(false);
  });
});

function verifiedEvent(
  partial: Partial<Parameters<typeof decideEntitlementApplication>[0]["event"]> & {
    providerTransactionId: string;
    eventStatus: "pending" | "success" | "failed" | "other";
  },
  locked: LockedOrderSnapshot = order(),
) {
  return {
    providerTransactionId: partial.providerTransactionId,
    eventStatus: partial.eventStatus,
    companyId: partial.companyId ?? locked.companyId,
    providerEnvironment: partial.providerEnvironment ?? locked.providerEnvironment,
    providerAccountRef: partial.providerAccountRef ?? locked.providerAccountRef,
    specialReference: partial.specialReference ?? locked.specialReference,
    amountBaisa: partial.amountBaisa ?? locked.amountBaisa,
    currency: "OMR" as const,
    signatureVerified: partial.signatureVerified ?? true,
    observationKey: partial.observationKey,
  };
}

describe("provider events: pending then success (scoped)", () => {
  const scope = {
    provider: "paymob",
    providerAccountRef: billingTestFixtures.providerAccountRef,
    providerEnvironment: "test" as const,
    providerTransactionId: "txn-1",
  };

  it("allows success after pending; allows distinct same-status observation", () => {
    expect(
      canInsertProviderEvent({
        existing: [{ scope, eventStatus: "pending", observationKey: "default" }],
        next: { scope, eventStatus: "success", observationKey: "default" },
      }),
    ).toEqual({ ok: true });

    expect(
      canInsertProviderEvent({
        existing: [
          { scope, eventStatus: "pending", observationKey: "default" },
          { scope, eventStatus: "success", observationKey: "default" },
        ],
        next: { scope, eventStatus: "success", observationKey: "refunded" },
      }),
    ).toEqual({ ok: true });

    expect(
      canInsertProviderEvent({
        existing: [{ scope, eventStatus: "success", observationKey: "default" }],
        next: { scope, eventStatus: "success", observationKey: "default" },
      }),
    ).toEqual({ ok: false, reason: "duplicate_observation" });

    expect(
      canInsertProviderEvent({
        existing: [{ scope, eventStatus: "success", observationKey: "default" }],
        next: {
          scope: { ...scope, providerEnvironment: "live", providerAccountRef: "other-merchant" },
          eventStatus: "success",
          observationKey: "default",
        },
      }),
    ).toEqual({ ok: true });
  });

  it("fail-closes without full evidence; applies once with evidence; blocks second order grant", () => {
    const locked = order();
    const subscription = sub({ companyId: billingTestFixtures.companyA });

    expect(
      decideEntitlementApplication({
        event: verifiedEvent({ providerTransactionId: "txn-1", eventStatus: "success", signatureVerified: false }, locked),
        order: locked,
        subscription,
        alreadyAppliedForTransaction: false,
        alreadyAppliedForOrder: false,
        clock: now,
      }),
    ).toEqual({ action: "skip", reason: "signature_unverified" });

    const pending = decideEntitlementApplication({
      event: verifiedEvent({ providerTransactionId: "txn-1", eventStatus: "pending" }, locked),
      order: locked,
      subscription,
      alreadyAppliedForTransaction: false,
      alreadyAppliedForOrder: false,
      clock: now,
    });
    expect(pending).toEqual({ action: "skip", reason: "event_not_success" });

    const success = decideEntitlementApplication({
      event: verifiedEvent({ providerTransactionId: "txn-1", eventStatus: "success" }, locked),
      order: locked,
      subscription,
      alreadyAppliedForTransaction: false,
      alreadyAppliedForOrder: false,
      clock: now,
    });
    expect(success.action).toBe("apply");
    if (success.action === "apply") {
      expect(success.settlement).toBe("pure_model_only");
      const next = applyEntitlementToSubscription(subscription, success, locked.planVersionId);
      expect(next.status).toBe("active");
      expect(next.paidThrough?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    }

    expect(
      decideEntitlementApplication({
        event: verifiedEvent({ providerTransactionId: "txn-1", eventStatus: "success" }, locked),
        order: locked,
        subscription,
        alreadyAppliedForTransaction: true,
        alreadyAppliedForOrder: false,
        clock: now,
      }),
    ).toEqual({ action: "skip", reason: "already_applied_for_transaction" });

    expect(
      decideEntitlementApplication({
        event: verifiedEvent({ providerTransactionId: "txn-2", eventStatus: "success" }, locked),
        order: locked,
        subscription,
        alreadyAppliedForTransaction: false,
        alreadyAppliedForOrder: true,
        clock: now,
      }),
    ).toEqual({ action: "skip", reason: "already_applied_for_order" });
  });
});

describe("company / environment / account / order mismatch", () => {
  it("skips apply on company, env, account, or order reference mismatch", () => {
    const locked = order();
    const subscription = sub({ companyId: billingTestFixtures.companyA });

    const companyMismatch = decideEntitlementApplication({
      event: verifiedEvent(
        {
          providerTransactionId: "txn-2",
          eventStatus: "success",
          companyId: billingTestFixtures.companyB,
        },
        locked,
      ),
      order: locked,
      subscription,
      alreadyAppliedForTransaction: false,
      alreadyAppliedForOrder: false,
      clock: now,
    });
    expect(companyMismatch.action).toBe("skip");
    if (companyMismatch.action === "skip") {
      expect(companyMismatch.reason).toBe("company_mismatch");
    }

    expect(
      decideEntitlementApplication({
        event: verifiedEvent(
          { providerTransactionId: "txn-3", eventStatus: "success", providerEnvironment: "live" },
          locked,
        ),
        order: locked,
        subscription,
        alreadyAppliedForTransaction: false,
        alreadyAppliedForOrder: false,
        clock: now,
      }),
    ).toEqual({ action: "skip", reason: "environment_mismatch" });

    expect(
      decideEntitlementApplication({
        event: verifiedEvent(
          {
            providerTransactionId: "txn-4",
            eventStatus: "success",
            providerAccountRef: "wrong-account",
          },
          locked,
        ),
        order: locked,
        subscription,
        alreadyAppliedForTransaction: false,
        alreadyAppliedForOrder: false,
        clock: now,
      }),
    ).toEqual({ action: "skip", reason: "provider_account_mismatch" });

    expect(
      decideEntitlementApplication({
        event: verifiedEvent(
          {
            providerTransactionId: "txn-5",
            eventStatus: "success",
            specialReference: "wrong-order",
          },
          locked,
        ),
        order: locked,
        subscription,
        alreadyAppliedForTransaction: false,
        alreadyAppliedForOrder: false,
        clock: now,
      }),
    ).toEqual({ action: "skip", reason: "order_reference_mismatch" });
  });
});

describe("renewal failure / cancel / security", () => {
  it("failed renew keeps paid_through and marks past_due", () => {
    const paidThrough = new Date("2026-10-20T00:00:00.000Z");
    const next = applyRenewalFailure(
      sub({ companyId: billingTestFixtures.companyA, status: "active", paidThrough }),
    );
    expect(next.paidThrough).toEqual(paidThrough);
    expect(next.status).toBe("past_due");
  });

  it("cancel_at_period_end keeps live until paid_through", () => {
    const paidThrough = new Date("2026-10-20T00:00:00.000Z");
    const cancelled = applyCancelAtPeriodEnd(
      sub({ companyId: billingTestFixtures.companyA, status: "active", paidThrough }),
    );
    expect(cancelled.status).toBe("cancel_at_period_end");
    const caps = evaluateSubscriptionEntitlement({
      subscription: cancelled,
      companyStatus: "active",
      clock: now,
    });
    expect(caps.layerB).toBe("cancel_at_period_end");
    expect(caps.withinPaidPeriod).toBe(true);
    expect(caps.liveAi).toBe(true);
  });

  it("security suspend outranks paid period", () => {
    const paidThrough = new Date("2026-11-01T00:00:00.000Z");
    const caps = evaluateSubscriptionEntitlement({
      subscription: sub({
        companyId: billingTestFixtures.companyA,
        status: "active",
        paidThrough,
      }),
      companyStatus: "suspended",
      clock: now,
    });
    expect(caps.securityBlocked).toBe(true);
    expect(caps.withinPaidPeriod).toBe(false);
    expect(caps.liveAi).toBe(false);
  });
});
