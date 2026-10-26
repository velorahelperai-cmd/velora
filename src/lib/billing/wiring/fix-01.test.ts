/**
 * VEL-PAYMOB-TEST-WIRING-FIX-01 — closes review findings.
 */

import { describe, expect, it } from "vitest";
import { persistOrderWithAttempt } from "@/lib/billing/wiring/order-create-persist";
import { decideCreateBillingOrder } from "@/lib/billing/wiring/order-create";
import { mapBillingReturnDbParts } from "@/lib/billing/wiring/return-load";
import { mapBillingReturnDisplay } from "@/lib/billing/wiring/return-status";
import { provenReturnQualification } from "./financial-truth.fixtures";

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTEMPT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PAID_THROUGH = "2027-06-01T00:00:00.000Z";

describe("FIX-01 return paid_through + isolation", () => {
  it("settled order uses applied_paid_through from a qualified receipt", () => {
    const row = mapBillingReturnDbParts(COMPANY_A, {
      order: { id: ORDER_ID, company_id: COMPANY_A, status: "closed" },
      attempt: { id: ATTEMPT_ID, status: "paid" },
      latestEvent: { event_status: "success", observation_key: "v1_abc" },
      grant: { id: "grant-1", applied_paid_through: PAID_THROUGH },
      financial: provenReturnQualification(COMPANY_A, ORDER_ID, PAID_THROUGH),
    });
    expect(row?.hasGrant).toBe(true);
    expect(row?.paidThrough).toBe(PAID_THROUGH);
    const display = mapBillingReturnDisplay({ requestCompanyId: COMPANY_A, row });
    expect(display.kind).toBe("success");
    if (display.kind === "success") {
      expect(display.paidThrough).toBe(PAID_THROUGH);
    }
  });

  it("rejects cross-company order read", () => {
    const row = mapBillingReturnDbParts(COMPANY_A, {
      order: { id: ORDER_ID, company_id: COMPANY_B, status: "locked" },
      attempt: null,
      latestEvent: null,
      grant: null,
    });
    expect(row).toBeNull();
    expect(
      mapBillingReturnDisplay({
        requestCompanyId: COMPANY_A,
        row: mapBillingReturnDbParts(COMPANY_B, {
          order: { id: ORDER_ID, company_id: COMPANY_B, status: "locked" },
          attempt: null,
          latestEvent: null,
          grant: null,
        }),
      }).kind,
    ).toBe("forbidden");
  });

  it("success event without grant → awaiting_processing (not entitlement)", () => {
    const row = mapBillingReturnDbParts(COMPANY_A, {
      order: { id: ORDER_ID, company_id: COMPANY_A, status: "submitted" },
      attempt: { id: ATTEMPT_ID, status: "provider_submitted" },
      latestEvent: { event_status: "success", observation_key: "v1_x" },
      grant: null,
    });
    expect(row?.awaitingProcessing).toBe(true);
    const display = mapBillingReturnDisplay({ requestCompanyId: COMPANY_A, row });
    expect(display.kind).toBe("awaiting_processing");
    if (display.kind === "awaiting_processing") {
      expect(display.grantsEntitlement).toBe(false);
    }
  });
});

describe("FIX-01 order + attempt persist / repair", () => {
  it("attempt insert failure does not succeed; retry repairs", async () => {
    const orders = new Map<string, { fingerprint: string; specialReference: string }>();
    const attempts = new Map<string, string>();
    let failAttemptOnce = true;
    const companyId = COMPANY_A;
    const clientOpId = "op-repair-1";

    const plan = {
      id: "plan-v",
      status: "published" as const,
      amountBaisa: 1000,
      currency: "OMR" as const,
      periodDays: 30,
      periodUnit: "day" as const,
      periodCount: 30,
    };

    const decision = decideCreateBillingOrder({
      companyId,
      planVersionId: plan.id,
      clientOpId,
      membership: { companyId, role: "owner", status: "active" },
      planVersion: plan,
      existingSameClientOp: null,
    });
    expect(decision.ok && decision.action === "insert").toBe(true);
    if (!(decision.ok && decision.action === "insert")) return;

    const deps = {
      insertOrder: async () => {
        const id = "order-repair-1";
        orders.set(`${companyId}:${clientOpId}`, {
          fingerprint: decision.inputFingerprint,
          specialReference: decision.specialReference,
        });
        return { ok: true as const, id, specialReference: decision.specialReference };
      },
      findOrderByClientOp: async (cid: string, op: string) => {
        const o = orders.get(`${cid}:${op}`);
        return o ? { id: "order-repair-1", specialReference: o.specialReference, inputFingerprint: o.fingerprint } : null;
      },
      findLatestAttempt: async (orderId: string) =>
        attempts.has(orderId) ? { id: attempts.get(orderId)! } : null,
      insertAttempt: async (orderId: string) => {
        if (failAttemptOnce) {
          failAttemptOnce = false;
          return { ok: false as const, code: "attempt_insert_failed" };
        }
        attempts.set(orderId, "attempt-repair-1");
        return { ok: true as const, id: "attempt-repair-1" };
      },
    };

    const first = await persistOrderWithAttempt({
      deps,
      companyId,
      decision,
      orderInsertRow: {},
    });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe("attempt_insert_failed");

    const reuseDecision = decideCreateBillingOrder({
      companyId,
      planVersionId: plan.id,
      clientOpId,
      membership: { companyId, role: "owner", status: "active" },
      planVersion: plan,
      existingSameClientOp: {
        id: "order-repair-1",
        companyId,
        planVersionId: plan.id,
        clientOpId,
        inputFingerprint: decision.inputFingerprint,
        amountBaisa: 1000,
        currency: "OMR",
        specialReference: decision.specialReference,
        status: "locked",
      },
    });
    expect(reuseDecision.ok && reuseDecision.action === "reuse").toBe(true);
    if (!(reuseDecision.ok && reuseDecision.action === "reuse")) return;

    const second = await persistOrderWithAttempt({
      deps,
      companyId,
      decision: reuseDecision,
      orderInsertRow: {},
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.action).toBe("repaired");
      expect(second.paymentAttemptId).toBe("attempt-repair-1");
    }
    expect(attempts.size).toBe(1);
  });
});
