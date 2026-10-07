/**
 * VEL-PAYMOB-ATTEMPT-LIFECYCLE-FIX-04 — confirmed-fail evidence, idempotent open, current resolve.
 * Pure unit doubles — no Paymob network.
 */

import { describe, expect, it } from "vitest";
import {
  mapConfirmFailedRpcPayload,
  mapOpenAfterFailedRpcPayload,
  mapResolveOrCreateRpcPayload,
} from "@/lib/billing/wiring/attempt-resolve-rpc";
import { resolveAttemptForOrder } from "@/lib/billing/wiring/order-create-persist";

const ORDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Attempt = {
  id: string;
  status: string;
  seq: number;
  supersedes?: string | null;
  openClientOp?: string | null;
  failedEventId?: string | null;
};

/** In-memory FIX-04 semantics under an order lock. */
function createLifecycleStore() {
  const attempts: Attempt[] = [];
  let seq = 0;
  let orderLock: Promise<void> = Promise.resolve();

  async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
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

  function current(): Attempt | null {
    if (attempts.length === 0) return null;
    return [...attempts].sort((a, b) => b.seq - a.seq)[0] ?? null;
  }

  return {
    attempts,
    current,
    resolveOrCreate: () =>
      withLock(() => {
        const cur = current();
        if (cur) {
          return {
            ok: true as const,
            action: "reuse" as const,
            paymentAttemptId: cur.id,
            status: cur.status,
            attemptSeq: cur.seq,
            isCurrent: true,
          };
        }
        seq += 1;
        const row: Attempt = { id: `attempt-${seq}`, status: "intent_created", seq };
        attempts.push(row);
        return {
          ok: true as const,
          action: "repaired" as const,
          paymentAttemptId: row.id,
          status: row.status,
          attemptSeq: row.seq,
          isCurrent: true,
        };
      }),
    setLifecycle: (attemptId: string, status: string) =>
      withLock(() => {
        if (status === "failed") {
          throw new Error("failed requires confirm-with-evidence");
        }
        const row = attempts.find((a) => a.id === attemptId);
        if (!row) throw new Error("missing");
        if (row.status === "failed") throw new Error("immutable failed");
        row.status = status;
        return row;
      }),
    attachFailedEvent: (attemptId: string, eventId: string) => {
      const row = attempts.find((a) => a.id === attemptId);
      if (!row) throw new Error("missing");
      row.failedEventId = eventId;
    },
    confirmFailed: (attemptId: string, evidence: { provider_event_id?: string; force?: boolean }) =>
      withLock(() => {
        if (evidence.force || evidence.provider_event_id == null) {
          if (evidence.force) throw new Error("cosmetic flags rejected");
          throw new Error("evidence required");
        }
        const row = attempts.find((a) => a.id === attemptId);
        if (!row) throw new Error("missing");
        if (row.failedEventId !== evidence.provider_event_id) {
          throw new Error("no failed provider event bound");
        }
        row.status = "failed";
        return { ok: true as const, paymentAttemptId: row.id, status: "failed" as const };
      }),
    openAfterFailed: (priorId: string, openClientOp: string) =>
      withLock(() => {
        const prior = attempts.find((a) => a.id === priorId);
        if (!prior || prior.status !== "failed" || !prior.failedEventId) {
          throw new Error("prior must be evidenced failed");
        }
        const byPrior = attempts.find((a) => a.supersedes === priorId);
        if (byPrior) {
          if (byPrior.openClientOp !== openClientOp) {
            throw new Error("open_client_op mismatch");
          }
          return {
            ok: true as const,
            action: "reuse_opened" as const,
            paymentAttemptId: byPrior.id,
            priorAttemptId: priorId,
            created: false,
            attemptSeq: byPrior.seq,
          };
        }
        const byOp = attempts.find((a) => a.openClientOp === openClientOp);
        if (byOp) {
          if (byOp.supersedes !== priorId) throw new Error("op bound to different prior");
          return {
            ok: true as const,
            action: "reuse_opened" as const,
            paymentAttemptId: byOp.id,
            priorAttemptId: priorId,
            created: false,
            attemptSeq: byOp.seq,
          };
        }
        const cur = current();
        if (!cur || cur.id !== priorId) throw new Error("prior not current");
        if (attempts.some((a) => ["intent_created", "provider_submitted", "unresolved"].includes(a.status))) {
          throw new Error("unsettled exists");
        }
        seq += 1;
        const row: Attempt = {
          id: `attempt-${seq}`,
          status: "intent_created",
          seq,
          supersedes: priorId,
          openClientOp,
        };
        attempts.push(row);
        return {
          ok: true as const,
          action: "opened_after_failed" as const,
          paymentAttemptId: row.id,
          priorAttemptId: priorId,
          created: true,
          attemptSeq: row.seq,
        };
      }),
  };
}

describe("FIX-04 mapping", () => {
  it("maps resolve current fields and open reuse", () => {
    expect(
      mapResolveOrCreateRpcPayload({
        ok: true,
        action: "reuse",
        payment_attempt_id: "a2",
        status: "intent_created",
        attempt_seq: 2,
        is_current: true,
        created: false,
      }),
    ).toMatchObject({
      ok: true,
      action: "reuse",
      paymentAttemptId: "a2",
      attemptSeq: 2,
      isCurrent: true,
    });
    expect(
      mapOpenAfterFailedRpcPayload({
        ok: true,
        action: "reuse_opened",
        payment_attempt_id: "a2",
        prior_attempt_id: "a1",
        created: false,
        attempt_seq: 2,
      }),
    ).toEqual({
      ok: true,
      action: "reuse_opened",
      paymentAttemptId: "a2",
      priorAttemptId: "a1",
      created: false,
      attemptSeq: 2,
    });
    expect(
      mapConfirmFailedRpcPayload({
        ok: true,
        payment_attempt_id: "a1",
        status: "failed",
        provider_event_id: "e1",
      }),
    ).toEqual({
      ok: true,
      paymentAttemptId: "a1",
      status: "failed",
      providerEventId: "e1",
    });
  });
});

describe("FIX-04 full lifecycle (in-memory)", () => {
  it("unresolved blocks status-only failed; evidence confirm → idempotent open → resolve returns new", async () => {
    const store = createLifecycleStore();
    const created = await store.resolveOrCreate();
    await store.setLifecycle(created.paymentAttemptId, "unresolved");

    await expect(store.setLifecycle(created.paymentAttemptId, "failed")).rejects.toThrow(
      /confirm-with-evidence/,
    );
    await expect(store.confirmFailed(created.paymentAttemptId, { force: true })).rejects.toThrow(
      /cosmetic/,
    );
    await expect(
      store.confirmFailed(created.paymentAttemptId, { provider_event_id: "missing" }),
    ).rejects.toThrow(/no failed provider event/);

    // unresolved still current — resolve reuses, no new bootstrap
    const still = await store.resolveOrCreate();
    expect(still.paymentAttemptId).toBe(created.paymentAttemptId);
    expect(still.status).toBe("unresolved");
    expect(store.attempts).toHaveLength(1);

    store.attachFailedEvent(created.paymentAttemptId, "evt-fail-1");
    await store.confirmFailed(created.paymentAttemptId, { provider_event_id: "evt-fail-1" });

    const [openA, openB] = await Promise.all([
      store.openAfterFailed(created.paymentAttemptId, "open-op-1"),
      store.openAfterFailed(created.paymentAttemptId, "open-op-1"),
    ]);
    expect(openA.paymentAttemptId).toBe(openB.paymentAttemptId);
    expect(store.attempts).toHaveLength(2);

    await expect(
      store.openAfterFailed(created.paymentAttemptId, "open-op-OTHER"),
    ).rejects.toThrow(/mismatch/);

    const resolved = await resolveAttemptForOrder({
      deps: {
        resolveOrCreateAttempt: () => store.resolveOrCreate(),
        findLatestAttempt: async () => null,
        insertAttempt: async () => ({ ok: false as const, code: "no" }),
      },
      orderId: ORDER,
      companyId: COMPANY,
    });
    expect(resolved).toMatchObject({
      ok: true,
      paymentAttemptId: openA.paymentAttemptId,
    });
    if (resolved.ok) {
      expect(resolved.paymentAttemptId).not.toBe(created.paymentAttemptId);
    }
    expect(store.current()?.id).toBe(openA.paymentAttemptId);
    expect(store.attempts.find((a) => a.id === created.paymentAttemptId)?.status).toBe("failed");
  });
});
