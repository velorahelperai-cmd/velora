/**
 * VEL-PAYMOB-TEST-WIRING-FIX-02 — concurrent orphan repair + semantic settle outcomes.
 */

import { describe, expect, it } from "vitest";
import {
  persistOrderWithAttempt,
  resolveAttemptForOrder,
} from "@/lib/billing/wiring/order-create-persist";
import { decideCreateBillingOrder } from "@/lib/billing/wiring/order-create";

const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
