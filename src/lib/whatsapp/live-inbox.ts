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
] as const;

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

/** Newest control fields, independently newest message timeline. */
export function mergeConversationOverride<T extends RevisionRow & MessageCarrier>(
  current: T | undefined,
  next: T,
): T {
  if (!current) return next;
  const control = isStaleConversationRead(current, next) ? next : current;
  const messages = hasNewerMessages(current, next) ? current : next;
  return overlayMessages(overlayControl({ ...next, ...current }, control), messages);
}

export function selectLiveConversations<T extends RevisionRow & MessageCarrier>(
  inbox: T[],
  localOverrides: Record<string, T> = {},
): T[] {
  return inbox.map((item) => {
    const override = localOverrides[item.id];
    if (!override) return item;
    const control = isStaleConversationRead(override, item) ? item : override;
    const messages = hasNewerMessages(override, item) ? override : item;
    return overlayMessages(overlayControl({ ...item, ...override }, control), messages);
  });
}
