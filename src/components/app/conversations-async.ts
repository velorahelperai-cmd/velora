/**
 * Inbox async operation gate for ConversationsPage.
 * Captures company/scope + op generation before awaits; rejects stale replies
 * before state writes, dependent reads, or busy cleanup.
 */

import {
  applyInboxSnapshot,
  type InboxSnapshotState,
} from "@/lib/whatsapp/live-inbox";

export type InboxAsyncEpoch = {
  scopeKey: string | null;
  /** Bumped on company/access-scope switch — invalidates all in-flight ops. */
  opGen: number;
  /** Bumped on each accepted full snapshot commit. */
  snapshotGen: number;
};

export type InboxAsyncEpochStore = {
  current: InboxAsyncEpoch;
};

export function createInboxAsyncEpoch(scopeKey: string | null = null): InboxAsyncEpoch {
  return { scopeKey, opGen: 0, snapshotGen: 0 };
}

export function captureInboxEpoch(store: InboxAsyncEpochStore): InboxAsyncEpoch {
  return { ...store.current };
}

export function isInboxEpochCurrent(
  request: InboxAsyncEpoch,
  current: InboxAsyncEpoch,
): boolean {
  return request.opGen === current.opGen && request.scopeKey === current.scopeKey;
}

/** Invalidate every pending send/control/read/refresh when company or access scope changes. */
export function invalidateInboxOpsOnScopeChange(
  store: InboxAsyncEpochStore,
  nextScopeKey: string | null,
): InboxAsyncEpoch {
  store.current = {
    scopeKey: nextScopeKey,
    opGen: store.current.opGen + 1,
    snapshotGen: store.current.snapshotGen + 1,
  };
  return store.current;
}

export function bumpInboxSnapshotGen(store: InboxAsyncEpochStore): number {
  store.current = {
    ...store.current,
    snapshotGen: store.current.snapshotGen + 1,
  };
  return store.current.snapshotGen;
}

export function setInboxEpochScope(
  store: InboxAsyncEpochStore,
  scopeKey: string | null,
): void {
  store.current = { ...store.current, scopeKey };
}

/**
 * Single-row read may apply only while the op epoch is current and the row is
 * still in the latest full membership. A stale read must not re-insert a row
 * excluded by a newer full snapshot, nor attribute an old company row to the
 * active scope.
 */
export function canApplySingleRowRead(input: {
  request: InboxAsyncEpoch;
  current: InboxAsyncEpoch;
  conversationId: string;
  visibleIds: ReadonlySet<string>;
}): boolean {
  if (!isInboxEpochCurrent(input.request, input.current)) return false;
  if (!input.visibleIds.has(input.conversationId)) return false;
  return true;
}

/** Old op cleanup must not clear busy owned by a newer op after scope switch. */
export function shouldClearBusyForOp(input: {
  requestOpGen: number;
  currentOpGen: number;
  requestBusyId: string;
  currentBusyId: string | null;
}): boolean {
  if (input.requestOpGen !== input.currentOpGen) return false;
  if (input.currentBusyId != null && input.currentBusyId !== input.requestBusyId) {
    return false;
  }
  return true;
}

export type ConversationRow = {
  id: string;
  revision?: number | null;
  leadRevision?: number | null;
  messages?: { at?: number }[];
  summary?: string;
  status?: string;
  [key: string]: unknown;
};

/** Apply a single-row refresh only when epoch + membership allow it. */
export function applySingleRowIfAllowed<T extends ConversationRow>(input: {
  request: InboxAsyncEpoch;
  store: InboxAsyncEpochStore;
  snapshot: InboxSnapshotState<T>;
  conversation: T;
  retainIds?: ReadonlySet<string>;
}): { ok: true; snapshot: InboxSnapshotState<T> } | { ok: false } {
  const current = input.store.current;
  const visibleIds = new Set(input.snapshot.base.map((row) => row.id));
  if (
    !canApplySingleRowRead({
      request: input.request,
      current,
      conversationId: input.conversation.id,
      visibleIds,
    })
  ) {
    return { ok: false };
  }
  if (!current.scopeKey) return { ok: false };
  const next = applyInboxSnapshot(
    input.snapshot,
    {
      kind: "partial",
      scopeKey: current.scopeKey,
      conversations: [input.conversation],
    },
    { retainIds: input.retainIds },
  );
  return { ok: true, snapshot: next };
}

/** Component path: syncControlView — capture before await; gate before replaceLive. */
export async function runSyncControlViewPath<T extends ConversationRow>(input: {
  conversationId: string;
  store: InboxAsyncEpochStore;
  readGenById: Record<string, number>;
  getSnapshot: () => InboxSnapshotState<T>;
  retainIds?: ReadonlySet<string>;
  refresh: (
    conversationId: string,
  ) => Promise<{ ok: true; conversation: T } | { ok: false; code?: string }>;
  commit: (snapshot: InboxSnapshotState<T>) => void;
}): Promise<boolean> {
  const request = captureInboxEpoch(input.store);
  const gen = (input.readGenById[input.conversationId] ?? 0) + 1;
  input.readGenById[input.conversationId] = gen;
  try {
    const refreshed = await input.refresh(input.conversationId);
    if (!isInboxEpochCurrent(request, input.store.current)) return false;
    if (input.readGenById[input.conversationId] !== gen) return false;
    if (!refreshed.ok || refreshed.conversation.id !== input.conversationId) return false;
    const applied = applySingleRowIfAllowed({
      request,
      store: input.store,
      snapshot: input.getSnapshot(),
      conversation: refreshed.conversation,
      retainIds: input.retainIds,
    });
    if (!applied.ok) return false;
    input.commit(applied.snapshot);
    return true;
  } catch {
    return false;
  }
}

/** Component path: send reply — gate after await before op cleanup / patches. */
export async function runSendReplyPath<TResult>(input: {
  store: InboxAsyncEpochStore;
  conversationId: string;
  send: () => Promise<TResult>;
  onResult: (result: TResult, request: InboxAsyncEpoch) => void;
  onThrow: (request: InboxAsyncEpoch) => void;
}): Promise<void> {
  const request = captureInboxEpoch(input.store);
  try {
    const result = await input.send();
    if (!isInboxEpochCurrent(request, input.store.current)) return;
    input.onResult(result, request);
  } catch {
    if (!isInboxEpochCurrent(request, input.store.current)) return;
    input.onThrow(request);
  }
}

/** Component path: control / assign — gate after each await; busy clear is gen-scoped. */
export async function runControlActionPath<TResult>(input: {
  store: InboxAsyncEpochStore;
  busyId: string;
  getBusyId: () => string | null;
  setBusy: (busy: boolean, id: string | null) => void;
  mutate: () => Promise<TResult>;
  onResult: (
    result: TResult,
    request: InboxAsyncEpoch,
    helpers: {
      stillCurrent: () => boolean;
      syncView: () => Promise<boolean>;
    },
  ) => Promise<void>;
  onThrow: (
    request: InboxAsyncEpoch,
    helpers: {
      stillCurrent: () => boolean;
      syncView: () => Promise<boolean>;
    },
  ) => Promise<void>;
  syncView: () => Promise<boolean>;
}): Promise<void> {
  const request = captureInboxEpoch(input.store);
  input.setBusy(true, input.busyId);
  const stillCurrent = () => isInboxEpochCurrent(request, input.store.current);
  const helpers = { stillCurrent, syncView: input.syncView };
  try {
    const result = await input.mutate();
    if (!stillCurrent()) return;
    await input.onResult(result, request, helpers);
  } catch {
    if (!stillCurrent()) return;
    await input.onThrow(request, helpers);
  } finally {
    if (
      shouldClearBusyForOp({
        requestOpGen: request.opGen,
        currentOpGen: input.store.current.opGen,
        requestBusyId: input.busyId,
        currentBusyId: input.getBusyId(),
      })
    ) {
      input.setBusy(false, null);
    }
  }
}

/** Component path: lead save — gate after mutate and after dependent refresh. */
export async function runLeadSavePath<TResult>(input: {
  store: InboxAsyncEpochStore;
  busyId: string;
  getLeadBusyOwner: () => string | null;
  setLeadBusy: (busy: boolean, id: string | null) => void;
  save: () => Promise<TResult>;
  onResult: (
    result: TResult,
    request: InboxAsyncEpoch,
    helpers: { stillCurrent: () => boolean; afterSaved: () => Promise<boolean> },
  ) => Promise<void>;
  onThrow: (request: InboxAsyncEpoch) => void;
  afterSaved: () => Promise<boolean>;
}): Promise<void> {
  const request = captureInboxEpoch(input.store);
  input.setLeadBusy(true, input.busyId);
  const stillCurrent = () => isInboxEpochCurrent(request, input.store.current);
  try {
    const result = await input.save();
    if (!stillCurrent()) return;
    await input.onResult(result, request, { stillCurrent, afterSaved: input.afterSaved });
  } catch {
    if (!stillCurrent()) return;
    input.onThrow(request);
  } finally {
    if (
      shouldClearBusyForOp({
        requestOpGen: request.opGen,
        currentOpGen: input.store.current.opGen,
        requestBusyId: input.busyId,
        currentBusyId: input.getLeadBusyOwner(),
      })
    ) {
      input.setLeadBusy(false, null);
    }
  }
}

/** Full snapshot commit helper — bumps snapshot gen when kind is full. */
export function commitFullSnapshotEpoch(store: InboxAsyncEpochStore, scopeKey: string): void {
  store.current = {
    scopeKey,
    opGen: store.current.opGen,
    snapshotGen: store.current.snapshotGen + 1,
  };
}
