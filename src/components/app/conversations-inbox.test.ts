import { describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canUseInboxControl, currentThreadRequest, mergeInboxPageRows, mergeThreadPage, threadReadBoundary, matchesUnifiedInboxFilter, inboxSendLocked, updateInboxPageCache } from "./conversations-inbox";
import type { WhatsappInboxItem, WhatsappInboxPage, WhatsappThreadMessage, WhatsappThreadPage } from "@/lib/whatsapp/inbox-contracts";
import type { WhatsappInboxMeta } from "@/lib/whatsapp/inbox";

const navigation = vi.hoisted(() => ({ selectedId: null as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(navigation.selectedId ? { c: navigation.selectedId } : {}) }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
// The workspace shell's account loading is outside this Inbox contract; keep the actual Inbox and UI components.
vi.mock("@/components/app/workspace-shell", () => ({ WorkspaceShell: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => React.createElement("main", null, actions, children) }));
vi.mock("@/lib/whatsapp/actions", () => ({ controlWhatsappConversation: vi.fn(), replyWhatsappConversation: vi.fn(), upsertConversationLeadState: vi.fn() }));
vi.mock("@/lib/whatsapp/inbox-actions", () => ({ refreshWhatsappInboxInitialPage: vi.fn(), refreshWhatsappInboxPage: vi.fn(), refreshWhatsappThreadPage: vi.fn(),
  refreshWhatsappControlAuditPage: vi.fn(), refreshWhatsappConnectionStatus: vi.fn(), markWhatsappThreadSeen: vi.fn() }));
import { ConversationsPage } from "./conversations";
vi.mock('./channel-ai-draft',()=>({ChannelAIDraft:()=>null}));
vi.mock('./channel-review',()=>({ChannelReviewStatus:()=>null}));

function item(id: string, sequence: string, unreadCount = 0): WhatsappInboxItem {
  return { id, inboxSequence: sequence, unreadCount, intervention: { reasons: [] }, customer: id,
    phone: "synthetic", topic: "WhatsApp", summary: "", status: "open", owner: "assistant",
    assistantPaused: false, automationAllowed: true, revision: 1, messages: [] };
}
function message(id: string, sequence: string): WhatsappThreadMessage {
  return { id, arrivalSequence: sequence, direction: "inbound", from: "customer", text: id, at: 1 };
}
function page(messages: WhatsappThreadMessage[], boundary: string | null = null): WhatsappThreadPage {
  return { kind: "partial", companyId: "company", conversationId: "thread", conversation: item("thread", "2", 3),
    messages, displayedInboundMessageId: boundary, unreadCount: 3, nextCursor: "1", hasMore: true };
}

describe("bounded Inbox UI contracts", () => {
  it("keeps previously loaded rows when another partial page arrives and orders int64 sequences exactly", () => {
    const rows = mergeInboxPageRows([item("first", "9007199254740992")], [item("second", "9007199254740993")]);
    expect(rows.map(row => row.id)).toEqual(["second", "first"]);
  });
  it("refreshes durable unread state without regressing a newer control revision", () => {
    const current = { ...item("thread", "2", 4), revision: 8, assistantPaused: true, automationAllowed: false };
    const rows = mergeInboxPageRows([current], [item("thread", "2", 0)]);
    expect(rows[0]).toMatchObject({ unreadCount: 0, revision: 8, assistantPaused: true });
  });
  it("deduplicates older messages in arrival order even when provider timestamps are identical", () => {
    const latest = mergeThreadPage(undefined, page([message("new", "9007199254740993")], "new"));
    const older = mergeThreadPage(latest, page([message("old", "9007199254740992"), message("new", "9007199254740993")]), "2");
    expect(older.messages.map(row => row.id)).toEqual(["old", "new"]);
    expect(older.latestPage.displayedInboundMessageId).toBe("new");
    expect(older.readVersion).toBe(latest.readVersion);
  });
  it("keeps a cursor for the gap when new arrivals no longer overlap the cached latest page", () => {
    const old = mergeThreadPage(undefined, { ...page([message("old", "2")], "old"), nextCursor: null, hasMore: false });
    const refreshed = mergeThreadPage(old, { ...page([message("new", "100")], "new"), nextCursor: "100", hasMore: true });
    expect(refreshed.nextCursor).toBe("100");
    expect(refreshed.hasMore).toBe(true);
  });
  it("acknowledges only an issued inbound boundary rendered in the visible selected thread", () => {
    const view = mergeThreadPage(undefined, page([message("shown", "4")], "shown"));
    expect(threadReadBoundary(view, "thread", true)).toBe("shown");
    expect(threadReadBoundary(view, "other", true)).toBeNull();
    expect(threadReadBoundary(view, "thread", false)).toBeNull();
    expect(threadReadBoundary(mergeThreadPage(undefined, page([message("history", "1")]), "2"), "thread", true)).toBeNull();
  });
  it("rejects a late thread result after selection or workspace generation changes", () => {
    const request = { scopeKey: "company:all_company", opGen: 1, snapshotGen: 0 };
    expect(currentThreadRequest({ request, current: request, generation: 2, currentGeneration: 2, conversationId: "a", selectedId: "b" })).toBe(false);
    expect(currentThreadRequest({ request, current: { ...request, opGen: 2 }, generation: 2, currentGeneration: 2, conversationId: "a", selectedId: "a" })).toBe(false);
    expect(currentThreadRequest({ request, current: request, generation: 1, currentGeneration: 2, conversationId: "a", selectedId: "a" })).toBe(false);
  });
  it("uses unread markers and durable interventions rather than latest sender or paused state", () => {
    const read = { ...item("read", "1"), messages: [message("customer", "1")] };
    expect(matchesUnifiedInboxFilter(read, "unread")).toBe(false);
    expect(matchesUnifiedInboxFilter({ ...read, unreadCount: 2, status: "resolved" }, "unread")).toBe(true);
    expect(matchesUnifiedInboxFilter({ ...read, intervention: { reasons: ["send_unknown"] } }, "staff")).toBe(true);
    expect(matchesUnifiedInboxFilter({ ...read, assistantPaused: true }, "staff")).toBe(false);
  });
  it("requires each control capability explicitly instead of inferring it from reply access", () => {
    const meta = { canReply: true, canAssign: true, canResume: true, canClose: false } as WhatsappInboxMeta;
    expect(canUseInboxControl(meta, "take_over")).toBe(false);
    expect(canUseInboxControl(meta, "resume")).toBe(true);
    expect(canUseInboxControl(meta, "close")).toBe(false);
  });
  it("keeps an unknown send locked after unread acknowledgement reaches zero", () => {
    const unknown = { ...item("thread", "2", 0), intervention: { reasons: ["send_unknown" as const] } };
    expect(inboxSendLocked(unknown, false)).toBe(true);
    expect(inboxSendLocked(item("thread", "2"), true)).toBe(true);
    expect(inboxSendLocked(item("thread", "2"), false)).toBe(false);
  });
  it("invalidates revoked membership caches but preserves the deliberate unknown send operation", () => {
    const initial: WhatsappInboxPage = { kind: "partial", companyId: "company", conversationScope: "assigned_only", ordering: "newest_created",
      conversations: [item("revoked", "2")], nextCursor: "2", hasMore: true, total: 20, unreadTotal: 2, interventionTotal: 1, membershipFingerprint: "old" };
    const operation = { clientOpId: "stable-operation-id", body: "deliberate body" };
    const cache = { page: initial, rows: initial.conversations, threads: { revoked: mergeThreadPage(undefined, page([message("seen", "2")], "seen")) },
      audits: { revoked: { kind: "partial" as const, companyId: "company", conversationId: "revoked", events: [], hasMore: false, nextCursor: null } },
      sendOperations: { revoked: operation }, unknownSends: { revoked: true } };
    const unchanged = updateInboxPageCache(cache, { ...initial, conversations: [item("older", "1")] }, true);
    expect(unchanged.rows.map(row => row.id)).toEqual(["revoked", "older"]);
    const changed = updateInboxPageCache(cache, { ...initial, conversations: [item("authorized", "3")], membershipFingerprint: "new" });
    expect(changed.rows.map(row => row.id)).toEqual(["authorized"]);
    expect(changed.threads).toEqual({});
    expect(changed.audits).toEqual({});
    expect(changed.sendOperations.revoked).toBe(operation);
    expect(changed.unknownSends).toEqual({ revoked: true });
    expect(changed.membershipChanged).toBe(true);
  });
});

describe("Inbox renders authoritative data", () => {
  it("shows workspace totals with partial coverage and waits for a current thread before enabling mutations", () => {
    // Vite's standalone TSX transform uses the classic runtime for this Next source.
    vi.stubGlobal("React", React);
    const row = { ...item("thread", "2", 0), messages: [message("already-read-customer", "4")] };
    const initialPage: WhatsappInboxPage = { kind: "partial", companyId: "company", conversationScope: "all_company", ordering: "newest_created",
      conversations: [row], total: 20, unreadTotal: 7, interventionTotal: 3, membershipFingerprint: "same", nextCursor: "2", hasMore: true };
    const meta: WhatsappInboxMeta = { companyId: "company", conversationScope: "all_company", timezone: null, timezoneAnnouncedUtc: true,
      canReply: true, canAssign: false, canTakeOver: false, canResume: false, canClose: false, assignees: [],
      counts: { all: 1, awaiting_staff: 0, follow_up_today: 0, overdue: 0, trial_or_quote: 0 } };
    navigation.selectedId = "thread";
    const html = renderToStaticMarkup(React.createElement(ConversationsPage, { inbox: [row], page: initialPage, meta }));
    const unreadTab = html.match(/<button[^>]*title="Unread messages across the workspace"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    expect(unreadTab).toContain(">7</span>");
    expect(html).toContain("1 of 20 conversations loaded");
    expect(html).not.toContain('title="Unread messages"');
    expect(html).toContain("Connection status unavailable");
    expect(html).not.toContain("Synced");
    const takeover = html.match(/<button[^>]*title="Take over from Velora"[^>]*>/)?.[0];
    expect(takeover).toContain("disabled");
    expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain("disabled");
    expect(html).toContain("Refreshing thread");
    navigation.selectedId = null;
    vi.unstubAllGlobals();
  });
});
