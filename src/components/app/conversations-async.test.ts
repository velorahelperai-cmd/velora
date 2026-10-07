import { describe, expect, it, vi } from "vitest";
import {
  applySingleRowIfAllowed,
  canApplySingleRowRead,
  captureInboxEpoch,
  createInboxAsyncEpoch,
  invalidateInboxOpsOnScopeChange,
  isInboxEpochCurrent,
  runControlActionPath,
  runLeadSavePath,
  runSendReplyPath,
  runSyncControlViewPath,
  shouldClearBusyForOp,
  type InboxAsyncEpochStore,
} from "./conversations-async";
import { inboxScopeKey, type InboxSnapshotState } from "@/lib/whatsapp/live-inbox";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Row = {
  id: string;
  revision?: number;
  leadRevision?: number;
  status?: string;
  messages?: { at?: number }[];
  summary?: string;
};

describe("conversations async component paths", () => {
  const scopeA = inboxScopeKey("co-a", "all_company");
  const scopeB = inboxScopeKey("co-b", "all_company");

  it("A→B during single-row read: late A reply does not update B membership", async () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const readGenById: Record<string, number> = {};
    let snapshot: InboxSnapshotState<Row> = {
      base: [{ id: "a1", revision: 1, messages: [{ at: 1 }] }],
      overrides: {},
      scopeKey: scopeA,
    };
    const commits: InboxSnapshotState<Row>[] = [];
    const pending = deferred<{ ok: true; conversation: Row } | { ok: false }>();

    const syncPromise = runSyncControlViewPath({
      conversationId: "a1",
      store,
      readGenById,
      getSnapshot: () => snapshot,
      refresh: async () => pending.promise,
      commit: (next) => {
        snapshot = next;
        commits.push(next);
      },
    });

    invalidateInboxOpsOnScopeChange(store, scopeB);
    snapshot = {
      base: [{ id: "b1", revision: 1, messages: [{ at: 2 }] }],
      overrides: {},
      scopeKey: scopeB,
    };

    pending.resolve({
      ok: true,
      conversation: {
        id: "a1",
        revision: 9,
        status: "handed_over",
        messages: [{ at: 1 }, { at: 99 }],
      },
    });

    await expect(syncPromise).resolves.toBe(false);
    expect(commits).toEqual([]);
    expect(snapshot.base.map((row) => row.id)).toEqual(["b1"]);
    expect(snapshot.overrides).toEqual({});
  });

  it("full snapshot revokes a row while single-row read is in flight — late read cannot re-add it", async () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const readGenById: Record<string, number> = {};
    let snapshot: InboxSnapshotState<Row> = {
      base: [
        { id: "keep", revision: 1, messages: [{ at: 1 }] },
        { id: "gone", revision: 1, messages: [{ at: 2 }] },
      ],
      overrides: {
        gone: { id: "gone", revision: 3, status: "handed_over", messages: [{ at: 2 }, { at: 5 }] },
      },
      scopeKey: scopeA,
    };
    const commits: InboxSnapshotState<Row>[] = [];
    const pending = deferred<{ ok: true; conversation: Row } | { ok: false }>();

    const syncPromise = runSyncControlViewPath({
      conversationId: "gone",
      store,
      readGenById,
      getSnapshot: () => snapshot,
      refresh: async () => pending.promise,
      commit: (next) => {
        snapshot = next;
        commits.push(next);
      },
    });

    // Same company/scope full refresh removes access to "gone".
    store.current = {
      ...store.current,
      snapshotGen: store.current.snapshotGen + 1,
    };
    snapshot = {
      base: [{ id: "keep", revision: 1, messages: [{ at: 1 }] }],
      overrides: {},
      scopeKey: scopeA,
    };

    pending.resolve({
      ok: true,
      conversation: {
        id: "gone",
        revision: 4,
        status: "resolved",
        messages: [{ at: 2 }, { at: 5 }, { at: 8 }],
      },
    });

    await expect(syncPromise).resolves.toBe(false);
    expect(commits).toEqual([]);
    expect(snapshot.base.map((row) => row.id)).toEqual(["keep"]);
    expect(
      canApplySingleRowRead({
        request: captureInboxEpoch(store),
        current: store.current,
        conversationId: "gone",
        visibleIds: new Set(snapshot.base.map((row) => row.id)),
      }),
    ).toBe(false);
  });

  it("A→B during send: late A result does not clear/patch ops on B", async () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const pending = deferred<{ ok: true; message: { id: string } }>();
    const onResult = vi.fn();
    const onThrow = vi.fn();

    const sendPromise = runSendReplyPath({
      store,
      conversationId: "a1",
      send: async () => pending.promise,
      onResult,
      onThrow,
    });

    invalidateInboxOpsOnScopeChange(store, scopeB);
    pending.resolve({ ok: true, message: { id: "m1" } });
    await sendPromise;

    expect(onResult).not.toHaveBeenCalled();
    expect(onThrow).not.toHaveBeenCalled();
  });

  it("A→B during control save: late A result does not patch B; old finally does not clear new busy", async () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const pending = deferred<{ ok: true; state: { revision: number } }>();
    let busyId: string | null = null;
    const setBusy = vi.fn((busy: boolean, id: string | null) => {
      busyId = busy ? id : null;
    });
    const onResult = vi.fn(async () => undefined);
    const onThrow = vi.fn(async () => undefined);
    const syncView = vi.fn(async () => true);

    const controlPromise = runControlActionPath({
      store,
      busyId: "a1",
      getBusyId: () => busyId,
      setBusy,
      mutate: async () => pending.promise,
      onResult,
      onThrow,
      syncView,
    });

    expect(busyId).toBe("a1");

    // Switch to B and start a new busy op for b1.
    invalidateInboxOpsOnScopeChange(store, scopeB);
    busyId = "b1";
    setBusy.mockClear();

    pending.resolve({ ok: true, state: { revision: 8 } });
    await controlPromise;

    expect(onResult).not.toHaveBeenCalled();
    expect(onThrow).not.toHaveBeenCalled();
    // Stale finally must not clear the newer B busy.
    expect(setBusy).not.toHaveBeenCalledWith(false, null);
    expect(busyId).toBe("b1");
    expect(
      shouldClearBusyForOp({
        requestOpGen: 0,
        currentOpGen: store.current.opGen,
        requestBusyId: "a1",
        currentBusyId: busyId,
      }),
    ).toBe(false);
  });

  it("A→B during lead save: late A patch/refresh is dropped; busy cleanup is gen-scoped", async () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const pending = deferred<{ ok: true; state: { leadRevision: number } }>();
    let leadBusyId: string | null = null;
    const setLeadBusy = vi.fn((busy: boolean, id: string | null) => {
      leadBusyId = busy ? id : null;
    });
    const onResult = vi.fn(async () => undefined);
    const onThrow = vi.fn();
    const afterSaved = vi.fn(async () => true);

    const leadPromise = runLeadSavePath({
      store,
      busyId: "a1",
      getLeadBusyOwner: () => leadBusyId,
      setLeadBusy,
      save: async () => pending.promise,
      onResult,
      onThrow,
      afterSaved,
    });

    invalidateInboxOpsOnScopeChange(store, scopeB);
    leadBusyId = "b1";
    setLeadBusy.mockClear();

    pending.resolve({ ok: true, state: { leadRevision: 4 } });
    await leadPromise;

    expect(onResult).not.toHaveBeenCalled();
    expect(onThrow).not.toHaveBeenCalled();
    expect(afterSaved).not.toHaveBeenCalled();
    expect(setLeadBusy).not.toHaveBeenCalledWith(false, null);
    expect(leadBusyId).toBe("b1");
  });

  it("keeps newer control/lead/messages when a same-scope single-row read is still allowed", () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const request = captureInboxEpoch(store);
    const snapshot: InboxSnapshotState<Row> = {
      base: [{ id: "a1", revision: 2, leadRevision: 1, status: "open", messages: [{ at: 1 }] }],
      overrides: {
        a1: {
          id: "a1",
          revision: 5,
          leadRevision: 4,
          status: "handed_over",
          messages: [{ at: 1 }, { at: 7 }],
        },
      },
      scopeKey: scopeA,
    };
    const applied = applySingleRowIfAllowed({
      request,
      store,
      snapshot,
      conversation: {
        id: "a1",
        revision: 3,
        leadRevision: 2,
        status: "open",
        messages: [{ at: 1 }],
      },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const row = applied.snapshot.overrides.a1;
    expect(row?.revision).toBe(5);
    expect(row?.leadRevision).toBe(4);
    expect(row?.status).toBe("handed_over");
    expect(row?.messages).toEqual([{ at: 1 }, { at: 7 }]);
  });

  it("epoch helpers reject cross-scope attribution", () => {
    const store: InboxAsyncEpochStore = { current: createInboxAsyncEpoch(scopeA) };
    const request = captureInboxEpoch(store);
    invalidateInboxOpsOnScopeChange(store, scopeB);
    expect(isInboxEpochCurrent(request, store.current)).toBe(false);
    expect(
      canApplySingleRowRead({
        request,
        current: store.current,
        conversationId: "a1",
        visibleIds: new Set(["a1"]),
      }),
    ).toBe(false);
  });
});
