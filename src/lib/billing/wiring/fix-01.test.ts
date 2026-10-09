/**
 * VEL-PAYMOB-TEST-WIRING-FIX-01 — closes review findings.
 */

import { describe, expect, it } from "vitest";
import {
  buildProcessedCallbackBody,
  paymobAdapterFixtures,
} from "@/lib/billing/paymob/fixtures";
import { observationKeyFromVerified } from "@/lib/billing/wiring/observation-key";
import { persistOrderWithAttempt } from "@/lib/billing/wiring/order-create-persist";
import { decideCreateBillingOrder } from "@/lib/billing/wiring/order-create";
import { receivePaymobWebhook, type DurableEventInsert } from "@/lib/billing/wiring/webhook-receive";
import { processStoredPaymobEvent } from "@/lib/billing/wiring/event-process";
import { runBillingEventProcessing } from "@/lib/billing/wiring/process-runner";
import { mapBillingReturnDbParts } from "@/lib/billing/wiring/return-load";
import { mapBillingReturnDisplay } from "@/lib/billing/wiring/return-status";
import { provenReturnQualification } from "./financial-truth.fixtures";
import type { SavedOrderForWebhook } from "@/lib/billing/wiring/webhook-receive";

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTEMPT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PAID_THROUGH = "2027-06-01T00:00:00.000Z";

function seededOrder(): SavedOrderForWebhook {
  return {
    companyId: COMPANY_A,
    orderId: ORDER_ID,
    paymentAttemptId: ATTEMPT_ID,
    status: "provider_submitted",
    providerOrderId: paymobAdapterFixtures.providerOrderId,
    specialReference: paymobAdapterFixtures.specialReference,
    amountBaisa: 9000,
    currency: "OMR",
    providerAmount: paymobAdapterFixtures.providerAmount,
    providerAccountRef: String(paymobAdapterFixtures.integrationId),
    providerEnvironment: "test",
    integrationId: paymobAdapterFixtures.integrationId,
    merchantOwnerId: paymobAdapterFixtures.merchantOwnerId,
  };
}

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

describe("FIX-01 observation_key + webhook bodies", () => {
  it("capture change → different keys; exact replay → duplicate", async () => {
    const order = seededOrder();
    const rows: DurableEventInsert[] = [];

    const auth = buildProcessedCallbackBody({ is_capture: false, id: 810001 });
    const capture = buildProcessedCallbackBody({ is_capture: true, id: 810001 });

    const deps = {
      webhookEnabled: true,
      hmacSecret: paymobAdapterFixtures.hmacSecret,
      findOrderByProviderOrderId: async () => order,
      insertProviderEvent: async (row: DurableEventInsert) => {
        const dup = rows.find(
          (r) =>
            r.providerTransactionId === row.providerTransactionId &&
            r.eventStatus === row.eventStatus &&
            r.observationKey === row.observationKey,
        );
        if (dup) return { ok: true as const, inserted: false, eventId: "dup" };
        rows.push(row);
        return { ok: true as const, inserted: true, eventId: `ev-${rows.length}` };
      },
    };

    const r1 = await receivePaymobWebhook({
      rawBody: JSON.stringify(auth.body),
      hmacQueryParam: auth.hmac,
      deps,
    });
    const r2 = await receivePaymobWebhook({
      rawBody: JSON.stringify(capture.body),
      hmacQueryParam: capture.hmac,
      deps,
    });
    expect(r1.body).toBe("stored_awaiting_processing");
    expect(r2.body).toBe("stored");
    expect(rows[1]!.eventStatus).toBe("other");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.observationKey).not.toBe(rows[1]!.observationKey);

    const dup = await receivePaymobWebhook({
      rawBody: JSON.stringify(capture.body),
      hmacQueryParam: capture.hmac,
      deps,
    });
    expect(dup.body).toBe("duplicate");
    expect(rows).toHaveLength(2);
  });
});

describe("FIX-01 stored → process → settle → return (schema store mock)", () => {
  it("full internal path without live Paymob", async () => {
    const signed = buildProcessedCallbackBody({ id: 820001 });
    const verified = await import("@/lib/billing/paymob/callback").then((m) =>
      m.verifyAndMapProcessedCallback({
        body: signed.body,
        hmacQueryParam: signed.hmac,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
      }),
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const obsKey = observationKeyFromVerified(verified.observation);
    const store = {
      grant: null as { applied_paid_through: string } | null,
      event: {
        id: "ev-1",
        companyId: COMPANY_A,
        orderId: ORDER_ID,
        paymentAttemptId: ATTEMPT_ID,
        providerTransactionId: verified.observation.providerTransactionId,
        eventStatus: "success" as const,
        providerAccountRef: String(paymobAdapterFixtures.integrationId),
        specialReference: paymobAdapterFixtures.specialReference,
        amountBaisa: 9000,
        observationKey: obsKey,
      },
    };

    const rowBefore = mapBillingReturnDbParts(COMPANY_A, {
      order: { id: ORDER_ID, company_id: COMPANY_A, status: "submitted" },
      attempt: { id: ATTEMPT_ID, status: "provider_submitted" },
      latestEvent: { event_status: "success", observation_key: obsKey },
      grant: null,
    });
    expect(mapBillingReturnDisplay({ requestCompanyId: COMPANY_A, row: rowBefore }).kind).toBe(
      "awaiting_processing",
    );

    const processed = await runBillingEventProcessing({
      deps: {
        settleEnabled: true,
        loadAwaitingSuccessEvents: async () => [store.event],
        settleHmacVerified: async () => {
          store.grant = { applied_paid_through: PAID_THROUGH };
          return { ok: true, outcome: "granted" };
        },
      },
      limit: 5,
    });
    expect(processed.ok).toBe(true);

    await processStoredPaymobEvent({
      deps: {
        settleEnabled: true,
        settleHmacVerified: async (evidence) => {
          expect(evidence.observation_key).toBe(obsKey);
          return { ok: true, outcome: "granted" };
        },
      },
      event: store.event,
    });

    const rowAfter = mapBillingReturnDbParts(COMPANY_A, {
      order: { id: ORDER_ID, company_id: COMPANY_A, status: "closed" },
      attempt: { id: ATTEMPT_ID, status: "paid" },
      latestEvent: { event_status: "success", observation_key: obsKey },
      grant: { id: "g1", applied_paid_through: store.grant!.applied_paid_through },
      financial: provenReturnQualification(COMPANY_A, ORDER_ID, store.grant!.applied_paid_through),
    });
    expect(mapBillingReturnDisplay({ requestCompanyId: COMPANY_A, row: rowAfter }).kind).toBe("success");
  });
});
