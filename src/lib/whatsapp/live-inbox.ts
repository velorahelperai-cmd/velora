/**
 * Live WhatsApp inbox selection — never merges local demo/sample conversations.
 * Local overrides may only refresh rows already present in the server inbox.
 * Control revision and message timeline are independent: an equal (or older)
 * control_revision must not hide newer server messages, and a newer control
 * result must not be wiped by a stale read.
 */

type RevisionRow = { id: string; revision?: number | null };

type MessageStamp = { at?: number };

type MessageCarrier = {
  messages?: MessageStamp[];
  summary?: string;
};

const CONTROL_KEYS = [
  "revision",
  "status",
  "owner",
  "assistantPaused",
  "automationAllowed",
  "automationGeneration",
  "assignedTo",
] as const;

const LEAD_KEYS = [
  "leadStage",
  "leadStageReason",
  "internalNote",
  "followUpStatus",
  "followUpAt",
  "lastTouchAt",
  "leadRevision",
] as const;

type LeadRevisionRow = { id: string; leadRevision?: number | null };

function leadRevisionOf(row: LeadRevisionRow | undefined | null): number | null {
  return typeof row?.leadRevision === "number" ? row.leadRevision : null;
}

/** True when candidate leadRevision is strictly older. */
export function isStaleLeadRead(
  candidate: LeadRevisionRow | null | undefined,
  current: LeadRevisionRow | null | undefined,
): boolean {
  const a = leadRevisionOf(candidate);
  const b = leadRevisionOf(current);
  if (a == null || b == null) return false;
  return a < b;
}

function overlayLead<T extends LeadRevisionRow>(base: T, lead: T): T {
  const next = { ...base };
  for (const key of LEAD_KEYS) {
    if (key in (lead as object)) {
      (next as Record<string, unknown>)[key] = (lead as Record<string, unknown>)[key];
    }
  }
  return next;
}

function revisionOf(row: RevisionRow | undefined | null): number | null {
  return typeof row?.revision === "number" ? row.revision : null;
}

/** True when `candidate` is strictly older than `current` by control revision. */
export function isStaleConversationRead(
  candidate: RevisionRow | null | undefined,
  current: RevisionRow | null | undefined,
): boolean {
  const a = revisionOf(candidate);
  const b = revisionOf(current);
  if (a == null || b == null) return false;
  return a < b;
}

function messageWatermark(row: MessageCarrier | null | undefined): { at: number; length: number } | null {
  if (!row || !("messages" in row) || !row.messages) return null;
  let at = 0;
  for (const message of row.messages) {
    if (typeof message.at === "number" && message.at > at) at = message.at;
  }
  return { at, length: row.messages.length };
}

function hasNewerMessages(candidate: MessageCarrier, current: MessageCarrier): boolean {
  const next = messageWatermark(candidate);
  const prev = messageWatermark(current);
  if (!next) return false;
  if (!prev) return true;
  if (next.at !== prev.at) return next.at > prev.at;
  return next.length > prev.length;
}

function overlayControl<T extends RevisionRow>(base: T, control: T): T {
  const next = { ...base };
  for (const key of CONTROL_KEYS) {
    if (key in (control as object)) {
      (next as Record<string, unknown>)[key] = (control as Record<string, unknown>)[key];
    }
  }
  return next;
}

function overlayMessages<T extends MessageCarrier>(base: T, from: T): T {
  const next = { ...base };
  if ("messages" in from) next.messages = from.messages;
  if ("summary" in from) next.summary = from.summary;
  return next;
}

/** Newest control fields, independently newest lead fields and message timeline. */
export function mergeConversationOverride<T extends RevisionRow & MessageCarrier & LeadRevisionRow>(
  current: T | undefined,
  next: T,
): T {
  if (!current) return next;
  const control = isStaleConversationRead(current, next) ? next : current;
  const lead = isStaleLeadRead(current, next) ? next : current;
  const messages = hasNewerMessages(current, next) ? current : next;
  return overlayMessages(
    overlayLead(overlayControl({ ...next, ...current }, control), lead),
    messages,
  );
}

export function selectLiveConversations<T extends RevisionRow & MessageCarrier & LeadRevisionRow>(
  inbox: T[],
  localOverrides: Record<string, T> = {},
): T[] {
  return inbox.map((item) => {
    const override = localOverrides[item.id];
    if (!override) return item;
    const control = isStaleConversationRead(override, item) ? item : override;
    const lead = isStaleLeadRead(override, item) ? item : override;
    const messages = hasNewerMessages(override, item) ? override : item;
    return overlayMessages(
      overlayLead(overlayControl({ ...item, ...override }, control), lead),
      messages,
    );
  });
}

/** Full company/scope load vs a partial page or single-row refresh. */
export type InboxSnapshotKind = "full" | "partial";

export type InboxSnapshotState<T extends RevisionRow & MessageCarrier & LeadRevisionRow> = {
  /** Last applied server list for the active scope (adds/removes come from full snapshots). */
  base: T[];
  overrides: Record<string, T>;
  /** companyId:conversationScope — different key replaces; never prune by prior ids. */
  scopeKey: string | null;
};

export type InboxSnapshotInput<T extends RevisionRow & MessageCarrier & LeadRevisionRow> = {
  kind: InboxSnapshotKind;
  scopeKey: string;
  conversations: T[];
};

/**
 * Apply a server inbox snapshot.
 * - full + same scope: membership = snapshot only (add + remove/lost access).
 *   retainIds never re-insert a row absent from the full snapshot; they only
 *   keep merge protection for rows still present.
 * - partial: upsert rows only — never remove missing ids (same scope).
 * - scope change: replace base and clear all overrides (no cross-company bleed).
 * Newer local control/lead/messages for rows still in membership survive stale replies.
 */
export function applyInboxSnapshot<T extends RevisionRow & MessageCarrier & LeadRevisionRow>(
  current: InboxSnapshotState<T>,
  snapshot: InboxSnapshotInput<T>,
  options?: { retainIds?: ReadonlySet<string> },
): InboxSnapshotState<T> {
  const retainIds = options?.retainIds ?? new Set<string>();
  const scopeChanged =
    current.scopeKey != null && current.scopeKey !== "" && current.scopeKey !== snapshot.scopeKey;

  if (scopeChanged) {
    return {
      base: snapshot.conversations,
      overrides: {},
      scopeKey: snapshot.scopeKey,
    };
  }

  if (snapshot.kind === "partial") {
    const baseById = new Map(current.base.map((row) => [row.id, row]));
    const overrides = { ...current.overrides };
    for (const row of snapshot.conversations) {
      const prior = overrides[row.id] ?? baseById.get(row.id);
      overrides[row.id] = mergeConversationOverride(prior, row);
      baseById.set(row.id, row);
    }
    return {
      base: [...baseById.values()],
      overrides,
      scopeKey: snapshot.scopeKey,
    };
  }

  // Full snapshot, same (or initial) scope — membership is exactly the snapshot.
  const overrides: Record<string, T> = {};
  const base: T[] = snapshot.conversations.map((row) => {
    const prior = current.overrides[row.id];
    if (prior) {
      overrides[row.id] = mergeConversationOverride(prior, row);
    } else if (retainIds.has(row.id)) {
      const fromBase = current.base.find((item) => item.id === row.id);
      if (fromBase) overrides[row.id] = mergeConversationOverride(fromBase, row);
    }
    return row;
  });

  return {
    base,
    overrides,
    scopeKey: snapshot.scopeKey,
  };
}

/**
 * True when an inbox refresh reply must be ignored before any state write.
 * Binds request generation + company/scope identity to the response.
 */
export function isStaleInboxRefresh(input: {
  requestGen: number;
  currentGen: number;
  requestScopeKey: string | null;
  responseScopeKey: string;
  activeScopeKey: string | null;
}): boolean {
  if (input.requestGen !== input.currentGen) return true;
  if (input.requestScopeKey != null && input.requestScopeKey !== input.responseScopeKey) {
    return true;
  }
  if (input.activeScopeKey != null && input.activeScopeKey !== input.responseScopeKey) {
    return true;
  }
  return false;
}

/** Stable scope key for inbox snapshot replace / prune decisions. */
export function inboxScopeKey(companyId: string, conversationScope: string): string {
  return `${companyId.trim()}:${conversationScope.trim()}`;
}
