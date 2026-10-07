/**
 * VEL-PAYMOB-ATTEMPT-REPAIR-FIX-03 — order-locked resolve-or-create closes lifecycle race.
 * Pure / in-memory unit doubles. Settlement untouched.
 */

import { describe, expect, it } from "vitest";
import {
  persistOrderWithAttempt,
  resolveAttemptForOrder,
} from "@/lib/billing/wiring/order-create-persist";
import { mapResolveOrCreateRpcPayload } from "@/lib/billing/wiring/attempt-resolve-rpc";
import { processStoredPaymobEvent } from "@/lib/billing/wiring/event-process";

const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/**
 * Simulates FIX-03 server txn: exclusive order lock → re-read → create-or-reuse.
 * Lifecycle status changes also take the same lock (order first).
 */
function createOrderLockedAttemptStore() {
  const byOrder = new Map<
    string,
    {
      id: string;
      status: string;
      failedEventId?: string | null;
      successorId?: string | null;
    }
  >();
  let seq = 0;
  let orderLock: Promise<void> = Promise.resolve();

  async function withOrderLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const mine = new Promise<void>((r) => {
      release = r;
    });
    const prev = orderLock;
    orderLock = mine;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    byOrder,
    resolveOrCreate: (orderId: string) =>
      withOrderLock(async () => {
        const existing = byOrder.get(orderId);
        if (existing) {
          return {
            ok: true as const,
            action: "reuse" as const,
            paymentAttemptId: existing.id,
            status: existing.status,
          };
        }
        seq += 1;
        const id = `attempt-${seq}`;
        byOrder.set(orderId, { id, status: "intent_created" });
        return {
          ok: true as const,
          action: "repaired" as const,
          paymentAttemptId: id,
          status: "intent_created",
        };
      }),
    setLifecycleStatus: (orderId: string, status: string) =>
      withOrderLock(() => {
        if (status === "failed") {
          throw new Error("failed requires confirm-with-evidence");
        }
        const row = byOrder.get(orderId);
        if (!row) throw new Error("no attempt");
        if (row.status === "paid") throw new Error("paid is settlement-owned");
        row.status = status;
        return { ok: true as const, paymentAttemptId: row.id, status };
      }),
    attachFailedEvent: (orderId: string, eventId: string) => {
      const row = byOrder.get(orderId);
      if (row) row.failedEventId = eventId;
    },
    confirmFailedWithEvidence: (orderId: string, eventId: string) =>
      withOrderLock(() => {
        const row = byOrder.get(orderId);
        if (!row || row.failedEventId !== eventId) {
          throw new Error("no failed provider event bound");
        }
        row.status = "failed";
        return row.id;
      }),
    openAfterConfirmedFailed: (orderId: string) =>
      withOrderLock(() => {
        const row = byOrder.get(orderId);
        if (!row || row.status !== "failed" || !row.failedEventId) {
          throw new Error("latest must be confirmed failed with evidence");
        }
        if (row.successorId) return row.successorId;
        seq += 1;
        const id = `attempt-${seq}`;
        row.successorId = id;
        byOrder.set(orderId, { id, status: "intent_created" });
        return id;
      }),
  };
}

describe("FIX-03 resolve-or-create under order lock", () => {
  it("lifecycle race: create then unresolved; concurrent second reuses — one attempt", async () => {
    const store = createOrderLockedAttemptStore();
    let firstCreated: string | null = null;
    let releaseSecond!: () => void;
    const secondMayFinish = new Promise<void>((r) => {
      releaseSecond = r;
    });

    const first = (async () => {
      const created = await store.resolveOrCreate(ORDER);
      firstCreated = created.paymentAttemptId;
      await store.setLifecycleStatus(ORDER, "unresolved");
      releaseSecond();
      return created;
    })();

    const second = (async () => {
      // Start while first is in flight — queue behind order lock.
      const pending = store.resolveOrCreate(ORDER);
      await secondMayFinish;
      return pending;
    })();

    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.paymentAttemptId).toBe(firstCreated);
    expect(b.paymentAttemptId).toBe(firstCreated);
    expect(a.paymentAttemptId).toBe(b.paymentAttemptId);
    expect(store.byOrder.size).toBe(1);
    expect(store.byOrder.get(ORDER)?.status).toBe("unresolved");
  });

  it("both empty readers serialize on lock and share one bootstrap identity", async () => {
    const store = createOrderLockedAttemptStore();
    const [a, b] = await Promise.all([
      resolveAttemptForOrder({
        deps: {
          resolveOrCreateAttempt: (oid) => store.resolveOrCreate(oid),
          findLatestAttempt: async () => {
            throw new Error("must use resolveOrCreate");
          },
          insertAttempt: async () => {
            throw new Error("must use resolveOrCreate");
          },
        },
        orderId: ORDER,
        companyId: COMPANY,
      }),
      resolveAttemptForOrder({
        deps: {
          resolveOrCreateAttempt: (oid) => store.resolveOrCreate(oid),
          findLatestAttempt: async () => {
            throw new Error("must use resolveOrCreate");
          },
          insertAttempt: async () => {
            throw new Error("must use resolveOrCreate");
          },
        },
        orderId: ORDER,
        companyId: COMPANY,
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!(a.ok && b.ok)) return;
    expect(a.paymentAttemptId).toBe(b.paymentAttemptId);
    expect(store.byOrder.size).toBe(1);
  });

  it("unresolved does not create bootstrap; after evidenced failed uses explicit path", async () => {
    const store = createOrderLockedAttemptStore();
    const first = await store.resolveOrCreate(ORDER);
    await store.setLifecycleStatus(ORDER, "unresolved");
    const again = await store.resolveOrCreate(ORDER);
    expect(again.paymentAttemptId).toBe(first.paymentAttemptId);
    expect(store.byOrder.size).toBe(1);

    store.attachFailedEvent(ORDER, "evt-1");
    await store.confirmFailedWithEvidence(ORDER, "evt-1");
    const reused = await resolveAttemptForOrder({
      deps: {
        resolveOrCreateAttempt: (oid) => store.resolveOrCreate(oid),
        findLatestAttempt: async () => null,
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
      orderId: ORDER,
      companyId: COMPANY,
    });
    expect(reused.ok).toBe(true);
    if (!reused.ok) return;
    expect(reused.action).toBe("reuse");
    expect(reused.paymentAttemptId).toBe(first.paymentAttemptId);

    const opened = await store.openAfterConfirmedFailed(ORDER);
    expect(opened).not.toBe(first.paymentAttemptId);
    expect(store.byOrder.get(ORDER)?.id).toBe(opened);
  });

  it("persistOrderWithAttempt prefers resolveOrCreateAttempt", async () => {
    const store = createOrderLockedAttemptStore();
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
    const result = await persistOrderWithAttempt({
      companyId: COMPANY,
      decision,
      orderInsertRow: {},
      deps: {
        insertOrder: async () => {
          throw new Error("no");
        },
        findOrderByClientOp: async () => null,
        resolveOrCreateAttempt: (oid) => store.resolveOrCreate(oid),
        findLatestAttempt: async () => {
          throw new Error("fallback forbidden");
        },
        insertAttempt: async () => {
          throw new Error("fallback forbidden");
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paymentAttemptId).toBe(store.byOrder.get(ORDER)?.id);
  });
});

describe("FIX-03 RPC payload mapping", () => {
  it("maps created → repaired and reuse → reuse", () => {
    expect(
      mapResolveOrCreateRpcPayload({
        ok: true,
        action: "created",
        payment_attempt_id: "a1",
        created: true,
        status: "intent_created",
      }),
    ).toEqual({
      ok: true,
      action: "repaired",
      paymentAttemptId: "a1",
      status: "intent_created",
    });
    expect(
      mapResolveOrCreateRpcPayload({
        ok: true,
        action: "reuse",
        payment_attempt_id: "a2",
        created: false,
        status: "unresolved",
      }),
    ).toEqual({
      ok: true,
      action: "reuse",
      paymentAttemptId: "a2",
      status: "unresolved",
    });
  });
});

describe("FIX-03 settlement semantics unchanged", () => {
  it("granted / idempotent_replay / duplicate_collection_review still distinct", async () => {
    const base = {
      id: "e",
      companyId: COMPANY,
      orderId: ORDER,
      paymentAttemptId: "a",
      providerTransactionId: "t",
      eventStatus: "success" as const,
      providerAccountRef: "71610",
      specialReference: "sr",
      amountBaisa: 1,
      observationKey: "k",
    };
    expect(
      await processStoredPaymobEvent({
        event: base,
        deps: {
          settleEnabled: true,
          settleHmacVerified: async () => ({ ok: true, outcome: "granted" }),
        },
      }),
    ).toEqual({ ok: true, outcome: "granted" });
    expect(
      await processStoredPaymobEvent({
        event: base,
        deps: {
          settleEnabled: true,
          settleHmacVerified: async () => ({ ok: true, outcome: "idempotent_replay" }),
        },
      }),
    ).toEqual({ ok: true, outcome: "idempotent_replay" });
    expect(
      await processStoredPaymobEvent({
        event: base,
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
});
