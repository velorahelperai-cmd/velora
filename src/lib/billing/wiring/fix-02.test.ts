/**
 * VEL-PAYMOB-TEST-WIRING-FIX-02 — concurrent orphan repair + semantic settle outcomes.
 */

import { describe, expect, it } from "vitest";
import {
  persistOrderWithAttempt,
  resolveAttemptForOrder,
} from "@/lib/billing/wiring/order-create-persist";
import { processStoredPaymobEvent } from "@/lib/billing/wiring/event-process";
import { runBillingEventProcessing } from "@/lib/billing/wiring/process-runner";
import { mapBillingReturnDbParts } from "@/lib/billing/wiring/return-load";
import { mapBillingReturnDisplay } from "@/lib/billing/wiring/return-status";
import { provenReturnQualification } from "./financial-truth.fixtures";
import { decideCreateBillingOrder } from "@/lib/billing/wiring/order-create";

const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAID_THROUGH = "2027-06-01T00:00:00.000Z";

/** In-memory attempt store with bootstrap uniqueness (mirrors partial unique index). */
function createAtomicAttemptStore() {
  const byOrder = new Map<string, { id: string; status: string }>();
  let seq = 0;
  return {
    byOrder,
    async findLatest(orderId: string) {
      const row = byOrder.get(orderId);
      return row ? { id: row.id, status: row.status } : null;
    },
    async insertBootstrap(orderId: string) {
      if (byOrder.has(orderId)) {
        return { ok: false as const, code: "23505" };
      }
      seq += 1;
      const id = `attempt-${seq}`;
      byOrder.set(orderId, { id, status: "intent_created" });
      return { ok: true as const, id };
    },
    markFailed(orderId: string) {
      const row = byOrder.get(orderId);
      if (row) row.status = "failed";
    },
    markUnresolved(orderId: string) {
      const row = byOrder.get(orderId);
      if (row) row.status = "unresolved";
    },
    /** Legitimate new attempt after confirmed rejection (status left the bootstrap predicate). */
    insertAfterFailed(orderId: string) {
      const row = byOrder.get(orderId);
      if (!row || row.status !== "failed") {
        throw new Error("only after confirmed failed");
      }
      seq += 1;
      const id = `attempt-${seq}`;
      byOrder.set(orderId, { id, status: "intent_created" });
      return id;
    },
  };
}

describe("FIX-02 concurrent orphan repair", () => {
  it("two concurrent repairs return the same attempt id", async () => {
    const store = createAtomicAttemptStore();
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });

    const deps = {
      insertOrder: async () => {
        throw new Error("must not insert order");
      },
      findOrderByClientOp: async () => null,
      findLatestAttempt: async (orderId: string) => {
        reads += 1;
        if (reads === 2) release();
        await barrier;
        return store.findLatest(orderId);
      },
      insertAttempt: async (orderId: string) => store.insertBootstrap(orderId),
    };

    const decision = {
      ok: true as const,
      action: "reuse" as const,
      order: {
        id: ORDER,
        companyId: COMPANY,
        planVersionId: "p",
        clientOpId: "op",
        inputFingerprint: "fp",
        amountBaisa: 1,
        currency: "OMR" as const,
        specialReference: "sr",
        status: "locked",
      },
    };

    const [a, b] = await Promise.all([
      persistOrderWithAttempt({ deps, companyId: COMPANY, decision, orderInsertRow: {} }),
      persistOrderWithAttempt({ deps, companyId: COMPANY, decision, orderInsertRow: {} }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (!(a.ok && b.ok)) return;
    expect(a.paymentAttemptId).toBe(b.paymentAttemptId);
    expect(store.byOrder.size).toBe(1);
  });

  it("failure then retry repairs once; unresolved does not spawn another", async () => {
    const store = createAtomicAttemptStore();
    let failOnce = true;
    const deps = {
      findLatestAttempt: (orderId: string) => store.findLatest(orderId),
      insertAttempt: async (orderId: string) => {
        if (failOnce) {
          failOnce = false;
          return { ok: false as const, code: "attempt_insert_failed" };
        }
        return store.insertBootstrap(orderId);
      },
    };

    const first = await resolveAttemptForOrder({ deps, orderId: ORDER, companyId: COMPANY });
    expect(first.ok).toBe(false);

    const second = await resolveAttemptForOrder({ deps, orderId: ORDER, companyId: COMPANY });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe("repaired");

    store.markUnresolved(ORDER);
    const third = await resolveAttemptForOrder({ deps, orderId: ORDER, companyId: COMPANY });
    expect(third).toEqual({
      ok: true,
      action: "reuse",
      paymentAttemptId: second.paymentAttemptId,
    });
    expect(store.byOrder.size).toBe(1);
  });

  it("after confirmed failed, legitimate new attempt is not blocked by bootstrap uniqueness", () => {
    const store = createAtomicAttemptStore();
    // Seed bootstrap then mark failed (leaves unique predicate).
    store.byOrder.set(ORDER, { id: "attempt-old", status: "failed" });
    const next = store.insertAfterFailed(ORDER);
    expect(next).toBe("attempt-1");
    expect(store.byOrder.get(ORDER)?.id).toBe(next);
  });
});

describe("FIX-02 settle semantic outcomes", () => {
  const baseEvent = {
    id: "e1",
    companyId: COMPANY,
    orderId: ORDER,
    paymentAttemptId: "attempt-1",
    providerTransactionId: "tx-1",
    eventStatus: "success" as const,
    providerAccountRef: "71610",
    specialReference: "sr",
    amountBaisa: 9000,
    observationKey: "v1_a",
  };

  it("maps granted / idempotent_replay / duplicate_collection_review distinctly", async () => {
    expect(
      await processStoredPaymobEvent({
        event: baseEvent,
        deps: {
          settleEnabled: true,
          settleHmacVerified: async () => ({ ok: true, outcome: "granted" }),
        },
      }),
    ).toEqual({ ok: true, outcome: "granted" });

    expect(
      await processStoredPaymobEvent({
        event: baseEvent,
        deps: {
          settleEnabled: true,
          settleHmacVerified: async () => ({ ok: true, outcome: "idempotent_replay" }),
        },
      }),
    ).toEqual({ ok: true, outcome: "idempotent_replay" });

    expect(
      await processStoredPaymobEvent({
        event: baseEvent,
        deps: {
          settleEnabled: true,
          settleHmacVerified: async () => ({
            ok: true,
            outcome: "duplicate_collection_review",
          }),
        },
      }),
    ).toEqual({ ok: true, outcome: "duplicate_collection_review" });
  });

  it("two different collections: two financial records, one grant, review outcome", async () => {
    const ledger: Array<{ txn: string; outcome: string }> = [];
    let grants = 0;

    async function settle(evidence: Record<string, unknown>) {
      const txn = String(evidence.provider_transaction_id);
      if (grants === 0) {
        grants = 1;
        ledger.push({ txn, outcome: "granted" });
        return { ok: true as const, outcome: "granted" };
      }
      ledger.push({ txn, outcome: "duplicate_collection_review" });
      return { ok: true as const, outcome: "duplicate_collection_review" };
    }

    const e1 = { ...baseEvent, providerTransactionId: "tx-A", observationKey: "v1_a" };
    const e2 = { ...baseEvent, providerTransactionId: "tx-B", observationKey: "v1_b" };

    const r1 = await processStoredPaymobEvent({
      event: e1,
      deps: { settleEnabled: true, settleHmacVerified: settle },
    });
    const r2 = await processStoredPaymobEvent({
      event: e2,
      deps: { settleEnabled: true, settleHmacVerified: settle },
    });

    expect(r1).toEqual({ ok: true, outcome: "granted" });
    expect(r2).toEqual({ ok: true, outcome: "duplicate_collection_review" });
    expect(ledger).toHaveLength(2);
    expect(grants).toBe(1);

    const runner = await runBillingEventProcessing({
      deps: {
        settleEnabled: true,
        loadAwaitingSuccessEvents: async () => [e2],
        settleHmacVerified: settle,
      },
    });
    expect(runner).toMatchObject({
      ok: true,
      outcomes: { duplicate_collection_review: 1 },
    });
    expect(grants).toBe(1);
  });

  it("stored → process fail → retry grant → return success", async () => {
    let grants = 0;
    let calls = 0;
    const event = { ...baseEvent };

    const load = async () => (grants ? [] : [event]);
    const settle = async () => {
      calls += 1;
      if (calls === 1) return { ok: false as const, code: "fixture_failure" };
      grants = 1;
      return { ok: true as const, outcome: "granted" };
    };

    expect(
      await runBillingEventProcessing({
        deps: { settleEnabled: true, loadAwaitingSuccessEvents: load, settleHmacVerified: settle },
      }),
    ).toMatchObject({ ok: false, code: "fixture_failure" });

    const awaiting = mapBillingReturnDbParts(COMPANY, {
      order: { id: ORDER, company_id: COMPANY, status: "submitted" },
      attempt: { id: "attempt-1", status: "provider_submitted" },
      latestEvent: { event_status: "success", observation_key: "v1_a" },
      grant: null,
    });
    expect(mapBillingReturnDisplay({ requestCompanyId: COMPANY, row: awaiting }).kind).toBe(
      "awaiting_processing",
    );

    expect(
      await runBillingEventProcessing({
        deps: { settleEnabled: true, loadAwaitingSuccessEvents: load, settleHmacVerified: settle },
      }),
    ).toMatchObject({ ok: true, outcomes: { granted: 1 } });

    const done = mapBillingReturnDbParts(COMPANY, {
      order: { id: ORDER, company_id: COMPANY, status: "closed" },
      attempt: { id: "attempt-1", status: "paid" },
      latestEvent: { event_status: "success", observation_key: "v1_a" },
      grant: { id: "g1", applied_paid_through: PAID_THROUGH },
      financial: provenReturnQualification(COMPANY, ORDER, PAID_THROUGH),
    });
    expect(mapBillingReturnDisplay({ requestCompanyId: COMPANY, row: done }).kind).toBe("success");
    expect(grants).toBe(1);
  });
});

describe("FIX-02 decideCreate still rejects browser money (unchanged)", () => {
  it("sanity", () => {
    expect(
      decideCreateBillingOrder({
        companyId: COMPANY,
        planVersionId: "p",
        clientOpId: "op",
        membership: { companyId: COMPANY, role: "owner", status: "active" },
        planVersion: {
          id: "p",
          status: "published",
          amountBaisa: 1,
          currency: "OMR",
          periodDays: 30,
          periodUnit: "day",
          periodCount: 30,
        },
        existingSameClientOp: null,
        untrustedBrowserMoney: { amountBaisa: 9 },
      }).ok,
    ).toBe(false);
  });
});
