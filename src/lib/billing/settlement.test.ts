/**
 * VEL-BILLING-ATOMIC-SETTLEMENT-01 — pure period + evidence contract tests.
 * Synthetic evidence only. Real Paymob HMAC verification is a later package.
 */

import { describe, expect, it } from "vitest";
import { computePaidThroughAfterSuccessfulPayment } from "@/lib/billing/apply-entitlement";
import { fixedClock } from "@/lib/billing/clock";
import {
  addCalendarPeriod,
  computePaidThroughAfterPeriod,
  periodFromLockedOrder,
} from "@/lib/billing/period";
import {
  SETTLEMENT_SERVER_ADAPTER_SOURCE,
  SETTLEMENT_SYNTHETIC_EVIDENCE_MARKER,
  buildSyntheticSettlementEvidence,
  toSettlementEvidenceJson,
} from "@/lib/billing/settlement-evidence";
import { evaluateSubscriptionEntitlement } from "@/lib/billing/subscription-state";
import { billingTestFixtures } from "@/lib/billing/fixtures";

describe("calendar period arithmetic", () => {
  it("adds whole UTC days (calendar, not session-local DST)", () => {
    const from = new Date("2026-03-08T06:30:00.000Z");
    expect(addCalendarPeriod(from, { unit: "day", count: 1 }).toISOString()).toBe(
      "2026-03-09T06:30:00.000Z",
    );
  });

  it("adds whole UTC days across generic spans", () => {
    const from = new Date("2026-01-15T12:00:00.000Z");
    expect(addCalendarPeriod(from, { unit: "day", count: 30 }).toISOString()).toBe(
      "2026-02-14T12:00:00.000Z",
    );
  });

  it("clamps end-of-month for calendar months (non-leap)", () => {
    const from = new Date("2026-01-31T12:00:00.000Z");
    expect(addCalendarPeriod(from, { unit: "month", count: 1 }).toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
  });

  it("clamps end-of-month for leap February", () => {
    const from = new Date("2024-01-31T12:00:00.000Z");
    expect(addCalendarPeriod(from, { unit: "month", count: 1 }).toISOString()).toBe(
      "2024-02-29T12:00:00.000Z",
    );
  });

  it("handles leap day + one year → Feb 28 next year", () => {
    const from = new Date("2024-02-29T08:30:00.000Z");
    expect(addCalendarPeriod(from, { unit: "year", count: 1 }).toISOString()).toBe(
      "2025-02-28T08:30:00.000Z",
    );
  });

  it("preserves Dec 31 across years", () => {
    const from = new Date("2025-12-31T00:00:00.000Z");
    expect(addCalendarPeriod(from, { unit: "year", count: 1 }).toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });
});

describe("early renew / late notice paid_through", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("keeps remaining time then adds calendar month", () => {
    const current = new Date("2026-11-01T12:00:00.000Z");
    const next = computePaidThroughAfterPeriod({
      now,
      currentPaidThrough: current,
      period: { unit: "month", count: 1 },
    });
    expect(next.toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  it("starts from server now when current is expired (late notice does not backdate)", () => {
    const expired = new Date("2026-09-01T12:00:00.000Z");
    const next = computePaidThroughAfterPeriod({
      now,
      currentPaidThrough: expired,
      period: { unit: "day", count: 7 },
    });
    expect(next.toISOString()).toBe("2026-10-13T12:00:00.000Z");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("periodFromLockedOrder prefers unit+count over bare days for months", () => {
    const period = periodFromLockedOrder({
      periodDays: 30,
      periodUnit: "month",
      periodCount: 1,
    });
    expect(period).toEqual({ unit: "month", count: 1 });
    const applied = computePaidThroughAfterSuccessfulPayment({
      now,
      currentPaidThrough: null,
      period,
    });
    expect(applied.toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });
});

describe("synthetic settlement evidence contract", () => {
  it("marks synthetic evidence and requires server_adapter_attestation", () => {
    const evidence = buildSyntheticSettlementEvidence({
      companyId: billingTestFixtures.companyA,
      orderId: "85000000-0000-4000-8000-000000000001",
      paymentAttemptId: "86000000-0000-4000-8000-000000000001",
      providerAccountRef: billingTestFixtures.providerAccountRef,
      providerEnvironment: "test",
      providerTransactionId: "SYNTHETIC_TXN_1",
      specialReference: "sr-1",
      amountBaisa: billingTestFixtures.amountBaisa,
    });
    expect(evidence.evidenceMarker).toBe(SETTLEMENT_SYNTHETIC_EVIDENCE_MARKER);
    expect(evidence.authenticity.source).toBe(SETTLEMENT_SERVER_ADAPTER_SOURCE);
    expect(evidence.authenticity.method).toBe("synthetic_test_only");
    const json = toSettlementEvidenceJson(evidence);
    expect(json.signature_verified).toBeUndefined();
    expect(json.authenticity.verified).toBe(true);
  });
});

describe("settlement does not clear security suspend", () => {
  it("paid period remains security-blocked when company suspended", () => {
    const caps = evaluateSubscriptionEntitlement({
      subscription: {
        companyId: billingTestFixtures.companyA,
        status: "active",
        paidThrough: new Date("2026-12-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        planVersionId: "pv",
      },
      companyStatus: "suspended",
      clock: fixedClock("2026-10-06T12:00:00.000Z"),
    });
    expect(caps.securityBlocked).toBe(true);
    expect(caps.liveAi).toBe(false);
    expect(caps.withinPaidPeriod).toBe(false);
  });
});
