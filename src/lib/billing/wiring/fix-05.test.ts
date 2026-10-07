/**
 * VEL-PAYMOB-FAILURE-EVIDENCE-FIX-05 — evidence identity + success precedence.
 * Pure unit doubles — no Paymob network / purchase-gate changes.
 */

import { describe, expect, it } from "vitest";
import {
  mapConfirmFailedRpcPayload,
  mapOpenAfterFailedRpcPayload,
} from "@/lib/billing/wiring/attempt-resolve-rpc";

type Ev = {
  id: string;
  attemptId: string;
  txn: string;
  obs: string;
  status: "pending" | "success" | "failed";
  account: string;
  env: string;
};

type Attempt = {
  id: string;
  status: string;
  seq: number;
  supersedes?: string | null;
  openClientOp?: string | null;
};

const ORDER_ACCOUNT = "71610";
const ORDER_ENV = "test";

function createFix05Store() {
  const attempts: Attempt[] = [];
  const events: Ev[] = [];
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

  function seedAttempt(status = "unresolved") {
    seq += 1;
    const row: Attempt = { id: `attempt-${seq}`, status, seq };
    attempts.push(row);
    return row;
  }

  return {
    attempts,
    events,
    seedAttempt,
    attachEvent: (e: Ev) => {
      events.push(e);
    },
    confirmFailed: (
      attemptId: string,
      evidence: {
        provider_event_id?: string;
        provider_transaction_id?: string;
        observation_key?: string;
      },
    ) =>
      withLock(() => {
        const row = attempts.find((a) => a.id === attemptId);
        if (!row) throw new Error("attempt not found");
        if (row.status === "paid") throw new Error("paid is settlement-owned");

        if (events.some((e) => e.attemptId === attemptId && e.status === "success")) {
          throw new Error("stored success awaiting settlement blocks failed confirm");
        }

        if (row.status === "failed") {
          /* idempotent path continues to re-validate evidence */
        } else if (!["intent_created", "provider_submitted", "unresolved"].includes(row.status)) {
          throw new Error("status not confirmable");
        }

        let ev: Ev | undefined;
        if (evidence.provider_event_id) {
          ev = events.find(
            (e) => e.id === evidence.provider_event_id && e.attemptId === attemptId,
          );
          if (!ev || ev.status !== "failed") throw new Error("no failed provider event bound");
          if (
            evidence.provider_transaction_id != null
            && ev.txn !== evidence.provider_transaction_id
          ) {
            throw new Error("evidence transaction identity mismatch");
          }
          if (
            evidence.observation_key != null
            && ev.obs !== evidence.observation_key
          ) {
            throw new Error("evidence observation identity mismatch");
          }
        } else if (evidence.provider_transaction_id) {
          ev = [...events]
            .reverse()
            .find(
              (e) =>
                e.attemptId === attemptId
                && e.txn === evidence.provider_transaction_id
                && e.status === "failed"
                && (evidence.observation_key == null || e.obs === evidence.observation_key),
            );
          if (!ev) throw new Error("no failed provider event bound");
        } else {
          throw new Error("evidence required");
        }

        if (ev.account !== ORDER_ACCOUNT || ev.env !== ORDER_ENV) {
          throw new Error("evidence provider account/environment mismatch");
        }

        if (
          events.some(
            (e) =>
              e.attemptId === attemptId
              && e.txn !== ev!.txn
              && (e.status === "pending" || e.status === "success"),
          )
        ) {
          throw new Error("other transaction outcome still open on attempt");
        }

        row.status = "failed";
        return {
          ok: true as const,
          paymentAttemptId: row.id,
          status: "failed" as const,
          providerEventId: ev.id,
        };
      }),
    openAfterFailed: (priorId: string, openClientOp: string) =>
      withLock(() => {
        const prior = attempts.find((a) => a.id === priorId);
        if (!prior) throw new Error("prior not found");

        if (events.some((e) => e.attemptId === priorId && e.status === "success")) {
          throw new Error("stored success awaiting settlement blocks retry open");
        }
        if (events.some((e) => e.attemptId === priorId && e.status === "pending")) {
          throw new Error("unresolved provider outcome blocks retry open");
        }
        if (prior.status !== "failed") throw new Error("prior must be confirmed failed");
        if (
          !events.some(
            (e) =>
              e.attemptId === priorId
              && e.status === "failed"
              && e.account === ORDER_ACCOUNT
              && e.env === ORDER_ENV,
          )
        ) {
          throw new Error("prior lacks bound failed provider event");
        }

        const byPrior = attempts.find((a) => a.supersedes === priorId);
        if (byPrior) {
          if (byPrior.openClientOp !== openClientOp) throw new Error("open_client_op mismatch");
          return {
            ok: true as const,
            action: "reuse_opened" as const,
            paymentAttemptId: byPrior.id,
            priorAttemptId: priorId,
            created: false,
            attemptSeq: byPrior.seq,
          };
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

describe("FIX-05 mapping still accepts confirm payload", () => {
  it("maps confirm with provider_event_id", () => {
    expect(
      mapConfirmFailedRpcPayload({
        ok: true,
        payment_attempt_id: "a1",
        status: "failed",
        provider_event_id: "e1",
        provider_transaction_id: "txn-a",
      }),
    ).toEqual({
      ok: true,
      paymentAttemptId: "a1",
      status: "failed",
      providerEventId: "e1",
    });
    expect(
      mapOpenAfterFailedRpcPayload({
        ok: false,
      }),
    ).toEqual({ ok: false, code: "open_after_failed_rpc_rejected" });
  });
});

describe("FIX-05 evidence identity + success precedence (in-memory)", () => {
  it("different-transaction failed does not clear pending A / open retry", async () => {
    const store = createFix05Store();
    const a = store.seedAttempt("unresolved");
    store.attachEvent({
      id: "evt-pending-a",
      attemptId: a.id,
      txn: "840050",
      obs: "obs-a",
      status: "pending",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });
    store.attachEvent({
      id: "evt-fail-b",
      attemptId: a.id,
      txn: "840051",
      obs: "obs-b",
      status: "failed",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });

    await expect(
      store.confirmFailed(a.id, {
        provider_event_id: "evt-fail-b",
        provider_transaction_id: "840050",
        observation_key: "obs-a",
      }),
    ).rejects.toThrow(/transaction identity mismatch/);

    await expect(
      store.confirmFailed(a.id, { provider_event_id: "evt-fail-b" }),
    ).rejects.toThrow(/other transaction outcome still open/);

    expect(a.status).toBe("unresolved");
    expect(store.events.filter((e) => e.status === "pending")).toHaveLength(1);
    expect(store.events.filter((e) => e.status === "failed")).toHaveLength(1);
    expect(store.attempts).toHaveLength(1);
  });

  it("event id vs transaction id conflict rejects", async () => {
    const store = createFix05Store();
    const a = store.seedAttempt("unresolved");
    store.attachEvent({
      id: "evt-fail-1",
      attemptId: a.id,
      txn: "txn-real",
      obs: "obs-1",
      status: "failed",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });

    await expect(
      store.confirmFailed(a.id, {
        provider_event_id: "evt-fail-1",
        provider_transaction_id: "txn-OTHER",
      }),
    ).rejects.toThrow(/transaction identity mismatch/);
    expect(a.status).toBe("unresolved");
  });

  it("stored success then stale failed: confirm and open reject; success kept; no new collection", async () => {
    const store = createFix05Store();
    const a = store.seedAttempt("provider_submitted");
    store.attachEvent({
      id: "evt-success",
      attemptId: a.id,
      txn: "840060",
      obs: "captured",
      status: "success",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });
    store.attachEvent({
      id: "evt-stale-fail",
      attemptId: a.id,
      txn: "840060",
      obs: "failed-notice",
      status: "failed",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });

    await expect(
      store.confirmFailed(a.id, { provider_event_id: "evt-stale-fail" }),
    ).rejects.toThrow(/stored success awaiting settlement blocks failed confirm/);

    a.status = "failed"; // simulate stale status-only mistake
    await expect(store.openAfterFailed(a.id, "open-op")).rejects.toThrow(
      /stored success awaiting settlement blocks retry open/,
    );

    expect(store.events.some((e) => e.id === "evt-success" && e.status === "success")).toBe(true);
    expect(store.attempts).toHaveLength(1);
  });

  it("concurrent success+failed arrival: neither opens collection; success retained", async () => {
    const store = createFix05Store();
    const a = store.seedAttempt("unresolved");
    store.attachEvent({
      id: "evt-success",
      attemptId: a.id,
      txn: "840070",
      obs: "captured",
      status: "success",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });
    store.attachEvent({
      id: "evt-fail",
      attemptId: a.id,
      txn: "840070",
      obs: "failed-notice",
      status: "failed",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });

    const [c1, c2] = await Promise.allSettled([
      store.confirmFailed(a.id, { provider_event_id: "evt-fail" }),
      store.confirmFailed(a.id, { provider_event_id: "evt-fail" }),
    ]);
    expect(c1.status).toBe("rejected");
    expect(c2.status).toBe("rejected");

    await expect(store.openAfterFailed(a.id, "open-op")).rejects.toThrow(/success|failed/i);
    expect(store.attempts).toHaveLength(1);
    expect(store.events.filter((e) => e.status === "success")).toHaveLength(1);
    expect(store.events.filter((e) => e.status === "failed")).toHaveLength(1);
  });

  it("idempotent evidenced fail + open still works when only failed evidence", async () => {
    const store = createFix05Store();
    const a = store.seedAttempt("unresolved");
    store.attachEvent({
      id: "evt-fail",
      attemptId: a.id,
      txn: "txn-only",
      obs: "obs",
      status: "failed",
      account: ORDER_ACCOUNT,
      env: ORDER_ENV,
    });

    await store.confirmFailed(a.id, {
      provider_event_id: "evt-fail",
      provider_transaction_id: "txn-only",
      observation_key: "obs",
    });
    await store.confirmFailed(a.id, { provider_event_id: "evt-fail" });

    const [o1, o2] = await Promise.all([
      store.openAfterFailed(a.id, "open-op-1"),
      store.openAfterFailed(a.id, "open-op-1"),
    ]);
    expect(o1.paymentAttemptId).toBe(o2.paymentAttemptId);
    expect(store.attempts).toHaveLength(2);
    expect(store.attempts.map((x) => x.seq).sort()).toEqual([1, 2]);
  });
});
