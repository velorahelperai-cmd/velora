import type { WhatsappInboxItem, WhatsappInboxPage, WhatsappThreadPage, WhatsappControlAuditPage } from "@/lib/whatsapp/inbox-contracts";
import type { WhatsappInboxMeta } from "@/lib/whatsapp/inbox";
import type { ControlAction } from "@/lib/whatsapp/actions";
import type { InboxAsyncEpoch } from "./conversations-async";
import { isInboxEpochCurrent } from "./conversations-async";
import { mergeConversationOverride } from "@/lib/whatsapp/live-inbox";

export type UnifiedInboxFilter = "all" | "unread" | "noura" | "staff" | "resolved";
export type ThreadView = WhatsappThreadPage & { latestPage: WhatsappThreadPage; readVersion: number };
/** A bounded page adds/updates rows; it never establishes full membership. */
export function mergeInboxPageRows(current: WhatsappInboxItem[], next: WhatsappInboxItem[]) {
  const rows = new Map(current.map(row => [row.id, row]));
  for (const row of next) {
    const merged = mergeConversationOverride(rows.get(row.id), row);
    rows.set(row.id, { ...merged, inboxSequence: row.inboxSequence, unreadCount: row.unreadCount,
      intervention: row.intervention, messages: row.messages, summary: row.summary });
  }
  return [...rows.values()].sort((a, b) => BigInt(a.inboxSequence) > BigInt(b.inboxSequence) ? -1 : BigInt(a.inboxSequence) < BigInt(b.inboxSequence) ? 1 : 0);
}
export function mergeThreadPage(current: ThreadView | undefined, next: WhatsappThreadPage, before?: string | null): ThreadView {
  const sameThread = current?.companyId === next.companyId && current.conversationId === next.conversationId;
  const previous = sameThread ? current : undefined;
  const messages = new Map((previous?.messages ?? []).map(row => [row.id, row]));
  const connected = next.messages.some(row => messages.has(row.id));
  for (const row of next.messages) messages.set(row.id, row);
  const latest = !before;
  return { ...next,
    conversation: latest ? next.conversation : previous?.conversation ?? next.conversation,
    unreadCount: latest ? next.unreadCount : previous?.unreadCount ?? next.unreadCount,
    messages: [...messages.values()].sort((a, b) => BigInt(a.arrivalSequence) < BigInt(b.arrivalSequence) ? -1 : BigInt(a.arrivalSequence) > BigInt(b.arrivalSequence) ? 1 : 0),
    // A latest refresh retains the oldest loaded cursor; history cannot replace the issued latest boundary.
    nextCursor: latest && previous && (connected || !next.hasMore) ? previous.nextCursor : next.nextCursor,
    hasMore: latest && previous && (connected || !next.hasMore) ? previous.hasMore : next.hasMore,
    latestPage: latest ? next : previous?.latestPage ?? { ...next, displayedInboundMessageId: null },
    readVersion: (previous?.readVersion ?? 0) + (latest ? 1 : 0),
  };
}
export function threadReadBoundary(view: ThreadView | undefined, selectedId: string | null, visible: boolean): string | null {
  if (!visible || !view || view.conversationId !== selectedId) return null;
  const boundary = view.latestPage.displayedInboundMessageId;
  return boundary && view.latestPage.messages.some(row => row.id === boundary && row.direction === "inbound")
    && view.messages.some(row => row.id === boundary) ? boundary : null;
}
export function currentThreadRequest(input: { request: InboxAsyncEpoch; current: InboxAsyncEpoch; generation: number; currentGeneration: number; conversationId: string; selectedId?: string | null }) {
  return isInboxEpochCurrent(input.request, input.current) && input.generation === input.currentGeneration
    && (input.selectedId === undefined || input.selectedId === input.conversationId);
}
export function matchesUnifiedInboxFilter(item: WhatsappInboxItem, filter: UnifiedInboxFilter) {
  if (filter === "unread") return item.unreadCount > 0;
  if (filter === "staff") return item.intervention.reasons.length > 0;
  if (filter === "resolved") return item.status === "resolved";
  if (filter === "noura") return item.status !== "resolved" && item.automationAllowed === true && !item.assistantPaused;
  return true;
}
export function canUseInboxControl(meta: WhatsappInboxMeta | undefined, action: ControlAction) {
  if (action === "take_over") return meta?.canTakeOver === true;
  if (action === "resume") return meta?.canResume === true;
  if (action === "close") return meta?.canClose === true;
  return meta?.canAssign === true;
}
export function inboxSendLocked(item: WhatsappInboxItem | undefined, localLock: boolean) {
  return localLock || item?.intervention.reasons.includes("send_unknown") === true;
}
type InboxPageCache = { page?: WhatsappInboxPage; rows: WhatsappInboxItem[]; threads: Record<string, ThreadView>;
  audits: Record<string, WhatsappControlAuditPage>; sendOperations: Record<string, { clientOpId: string; body: string }>; unknownSends: Record<string, boolean> };
export function updateInboxPageCache(current: InboxPageCache, next: WhatsappInboxPage, older = false) {
  const membershipChanged = Boolean(current.page && current.page.membershipFingerprint !== next.membershipFingerprint);
  const connected = next.conversations.some(row => current.rows.some(previous => previous.id === row.id));
  const preserveCursor = !older && !membershipChanged && current.page && (connected || !next.hasMore);
  return { ...current,
    page: preserveCursor ? { ...next, nextCursor: current.page!.nextCursor, hasMore: current.page!.hasMore } : next,
    rows: mergeInboxPageRows(membershipChanged ? [] : current.rows, next.conversations),
    threads: membershipChanged ? {} : current.threads,
    audits: membershipChanged ? {} : current.audits,
    // Invalidated in-flight sends retain their operation identity and become unresolved locally.
    unknownSends: membershipChanged ? { ...current.unknownSends, ...Object.fromEntries(Object.keys(current.sendOperations).map(id => [id, true])) } : current.unknownSends,
    membershipChanged,
  };
}
