"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type Conversation,
  type ConversationStatus,
  type FollowUpStatus,
  type LeadStage,
  useDemo,
} from "@/lib/demo-state";
import {
  controlWhatsappConversation,
  refreshWhatsappConversation,
  refreshWhatsappInboxSnapshot,
  replyWhatsappConversation,
  upsertConversationLeadState,
  type ControlAction,
  type ControlState,
  type LeadState,
} from "@/lib/whatsapp/actions";
import type { WhatsappInboxMeta } from "@/lib/whatsapp/inbox";
import {
  countLeadWorklist,
  MANUAL_LEAD_STAGES,
  matchesLeadWorklist,
  type LeadWorklist,
} from "@/lib/whatsapp/leads";
import {
  applyInboxSnapshot,
  inboxScopeKey,
  isStaleInboxRefresh,
  selectLiveConversations,
} from "@/lib/whatsapp/live-inbox";
import {
  captureInboxEpoch,
  commitFullSnapshotEpoch,
  createInboxAsyncEpoch,
  invalidateInboxOpsOnScopeChange,
  isInboxEpochCurrent,
  runControlActionPath,
  runLeadSavePath,
  runSendReplyPath,
  runSyncControlViewPath,
  type InboxAsyncEpochStore,
} from "@/components/app/conversations-async";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { Button, EmptyState, Notice, useAppCopy } from "@/components/app/ui";

const statusStyle: Record<ConversationStatus, string> = {
  open: "bg-[var(--color-hover-wash)] text-[var(--color-on-dark)]",
  follow_up: "bg-[#d9a467]/15 text-[var(--color-warn-fg)]",
  handed_over: "bg-[#38dc89]/15 text-[var(--color-success-fg)]",
  resolved: "bg-[var(--color-hover-wash)] text-[var(--color-muted-soft)]",
};

const WORKLISTS: LeadWorklist[] = [
  "all",
  "awaiting_staff",
  "follow_up_today",
  "overdue",
  "trial_or_quote",
];

function applyControlState(base: Conversation, state: ControlState): Conversation {
  return {
    ...base,
    status: state.status,
    assistantPaused: state.assistantPaused,
    automationAllowed: state.automationAllowed,
    automationGeneration: state.automationGeneration,
    revision: state.revision,
    owner: state.owner,
  };
}

function applyLeadState(base: Conversation, state: LeadState): Conversation {
  return {
    ...base,
    leadStage: state.leadStage as LeadStage,
    leadStageReason: state.leadStageReason,
    internalNote: state.internalNote,
    followUpStatus: state.followUpStatus as FollowUpStatus,
    followUpAt: state.followUpAt,
    lastTouchAt: state.lastTouchAt,
    leadRevision: state.leadRevision,
    assignedTo: state.assignedTo,
  };
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(local: string): string | null {
  const trimmed = local.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

type LeadPanelCopy = ReturnType<typeof useAppCopy>["app"];

function LeadFollowUpPanel({
  conversation,
  copy,
  locale,
  canReply,
  canAssign,
  assignees,
  timezoneAnnouncedUtc,
  live,
  busyControl,
  pending,
  selectedUnresolved,
  onPatchLead,
  onPatchControl,
  onSync,
  onNotice,
  onError,
  onWarn,
  onBusyControl,
  onAfterLeadSaved,
  getEpochStore,
  getControlBusyId,
}: {
  conversation: Conversation;
  copy: LeadPanelCopy;
  locale: string;
  canReply: boolean;
  canAssign: boolean;
  assignees: WhatsappInboxMeta["assignees"];
  timezoneAnnouncedUtc?: boolean;
  live: boolean;
  busyControl: boolean;
  pending: boolean;
  selectedUnresolved: boolean;
  onPatchLead: (state: LeadState) => void;
  onPatchControl: (state: ControlState) => void;
  onSync: () => Promise<boolean>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onWarn: (message: string) => void;
  onBusyControl: (busy: boolean, busyId: string | null) => void;
  /** Re-read list/counts only — never re-saves. */
  onAfterLeadSaved: () => Promise<boolean>;
  getEpochStore: () => InboxAsyncEpochStore;
  getControlBusyId: () => string | null;
}) {
  const [leadBusy, setLeadBusy] = useState(false);
  const leadBusyIdRef = useRef<string | null>(null);
  const [leadStageDraft, setLeadStageDraft] = useState<LeadStage>(conversation.leadStage ?? "new");
  const [leadReasonDraft, setLeadReasonDraft] = useState(conversation.leadStageReason ?? "");
  const [leadNoteDraft, setLeadNoteDraft] = useState(conversation.internalNote ?? "");
  const [followUpStatusDraft, setFollowUpStatusDraft] = useState<FollowUpStatus>(
    conversation.followUpStatus ?? "none",
  );
  const [followUpAtDraft, setFollowUpAtDraft] = useState(toDatetimeLocalValue(conversation.followUpAt));
  const [assignDraft, setAssignDraft] = useState(conversation.assignedTo ?? "");

  async function saveLead(nextFollowUp?: FollowUpStatus) {
    if (!live || leadBusy || !canReply) return;
    const status = nextFollowUp ?? followUpStatusDraft;
    let followUpAt: string | null = fromDatetimeLocalValue(followUpAtDraft);
    if (status === "none") followUpAt = null;
    if (status === "scheduled" && !followUpAt) {
      onError(copy.leadFollowUpAtRequired);
      return;
    }
    if (
      (leadStageDraft === "trial_or_quote_requested" || leadStageDraft === "closed_no_subscribe")
      && !leadReasonDraft.trim()
    ) {
      onError(copy.leadReasonRequired);
      return;
    }

    await runLeadSavePath({
      store: getEpochStore(),
      busyId: conversation.id,
      getLeadBusyOwner: () => leadBusyIdRef.current,
      setLeadBusy: (busy, id) => {
        leadBusyIdRef.current = busy ? id : null;
        setLeadBusy(busy);
      },
      save: () =>
        upsertConversationLeadState({
          conversationId: conversation.id,
          expectedLeadRevision: conversation.leadRevision ?? 1,
          leadStage: leadStageDraft,
          leadStageReason: leadReasonDraft,
          internalNote: leadNoteDraft,
          followUpStatus: status,
          followUpAt,
        }),
      afterSaved: onAfterLeadSaved,
      onThrow: () => onError(copy.leadFailed),
      onResult: async (result, _request, helpers) => {
        if (!result.ok) {
          if (result.code === "CONFLICT" && result.state) {
            onPatchLead(result.state);
            onError(copy.leadConflict);
            return;
          }
          if (result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED") {
            onError(copy.leadForbidden);
            return;
          }
          if (result.code === "SUBSCRIBED_FORBIDDEN") {
            onError(copy.leadSubscribedForbidden);
            return;
          }
          if (result.code === "REASON_REQUIRED") {
            onError(copy.leadReasonRequired);
            return;
          }
          if (result.code === "FOLLOW_UP_AT_REQUIRED") {
            onError(copy.leadFollowUpAtRequired);
            return;
          }
          onError(copy.leadFailed);
          return;
        }
        onPatchLead(result.state);
        setFollowUpStatusDraft(result.state.followUpStatus as FollowUpStatus);
        setFollowUpAtDraft(toDatetimeLocalValue(result.state.followUpAt));
        onNotice(copy.leadSaved);
        const synced = await helpers.afterSaved();
        if (!helpers.stillCurrent()) return;
        if (!synced) onWarn(copy.leadCountsRefreshFailed);
      },
    });
  }

  async function saveAssignee() {
    if (!live || busyControl || !canAssign) return;
    await runControlActionPath({
      store: getEpochStore(),
      busyId: conversation.id,
      getBusyId: getControlBusyId,
      setBusy: (busy, id) => onBusyControl(busy, id),
      mutate: () =>
        controlWhatsappConversation({
          conversationId: conversation.id,
          action: "assign",
          expectedRevision: conversation.revision ?? 1,
          assigneeUserId: assignDraft || null,
        }),
      syncView: onSync,
      onThrow: async () => onError(copy.controlFailed),
      onResult: async (result, _request, helpers) => {
        if (!result.ok) {
          if (result.code === "CONFLICT" && result.state) {
            onPatchControl(result.state);
            onError(copy.controlConflict);
            return;
          }
          if (result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED") {
            onError(copy.leadAssignForbidden);
            return;
          }
          onError(copy.controlFailed);
          return;
        }
        onPatchControl(result.state);
        const synced = await helpers.syncView();
        if (!helpers.stillCurrent()) return;
        onNotice(copy.leadAssignSaved);
        if (!synced) onWarn(copy.controlRefreshFailed);
      },
    });
  }

  return (
    <>
      <h3 className="mt-3 font-bold">{copy.leadPanelTitle}</h3>
      {timezoneAnnouncedUtc ? (
        <p className="text-xs text-[var(--color-warn-fg)]">{copy.timezoneUtcNotice}</p>
      ) : null}
      <label className="grid gap-1 text-xs text-[var(--color-muted-on-dark)]">
        {copy.leadStageLabel}
        <select
          value={leadStageDraft}
          disabled={!canReply || leadBusy || !live}
          onChange={(e) => setLeadStageDraft(e.target.value as LeadStage)}
          className="min-h-10 rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 text-sm text-[var(--color-on-dark)]"
        >
          {MANUAL_LEAD_STAGES.map((stage) => (
            <option key={stage} value={stage}>{copy.leadStages[stage]}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-muted-on-dark)]">
        {copy.leadReasonLabel}
        <textarea
          value={leadReasonDraft}
          disabled={!canReply || leadBusy || !live}
          onChange={(e) => setLeadReasonDraft(e.target.value)}
          rows={2}
          className="rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 py-1 text-sm text-[var(--color-on-dark)]"
        />
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-muted-on-dark)]">
        {copy.leadNoteLabel}
        <textarea
          value={leadNoteDraft}
          disabled={!canReply || leadBusy || !live}
          onChange={(e) => setLeadNoteDraft(e.target.value)}
          rows={3}
          className="rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 py-1 text-sm text-[var(--color-on-dark)]"
        />
      </label>
      <label className="grid gap-1 text-xs text-[var(--color-muted-on-dark)]">
        {copy.leadFollowUpLabel}
        <input
          type="datetime-local"
          value={followUpAtDraft}
          disabled={!canReply || leadBusy || !live}
          onChange={(e) => {
            setFollowUpAtDraft(e.target.value);
            if (e.target.value) setFollowUpStatusDraft("scheduled");
          }}
          className="min-h-10 rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 text-sm text-[var(--color-on-dark)]"
        />
      </label>
      <p className="text-xs text-[var(--color-muted-soft)]">
        {copy.leadFollowUpStatus[followUpStatusDraft]}
        {conversation.followUpStatus === "scheduled" && conversation.followUpAt
          ? ` · ${new Date(conversation.followUpAt).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}`
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          busy={leadBusy}
          disabled={!canReply || leadBusy || busyControl || pending || !live}
          onClick={() => void saveLead("scheduled")}
        >
          {copy.leadSchedule}
        </Button>
        <Button
          variant="ghost"
          busy={leadBusy}
          disabled={!canReply || leadBusy || !live}
          onClick={() => void saveLead("completed")}
        >
          {copy.leadComplete}
        </Button>
        <Button
          variant="ghost"
          busy={leadBusy}
          disabled={!canReply || leadBusy || !live}
          onClick={() => void saveLead("cancelled")}
        >
          {copy.leadCancel}
        </Button>
      </div>
      <Button
        busy={leadBusy}
        disabled={!canReply || leadBusy || busyControl || pending || !live}
        onClick={() => void saveLead()}
      >
        {copy.leadSave}
      </Button>

      <h3 className="mt-2 font-bold">{copy.leadAssigneeLabel}</h3>
      <p className="text-xs text-[var(--color-muted-on-dark)]">
        {copy.ownerLabel}: {conversation.owner === "assistant" ? copy.assistant : conversation.owner === "staff" ? copy.staff : conversation.owner}
      </p>
      {canAssign ? (
        <div className="grid gap-2">
          <select
            value={assignDraft}
            disabled={busyControl || !live}
            onChange={(e) => setAssignDraft(e.target.value)}
            className="min-h-10 rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 text-sm text-[var(--color-on-dark)]"
          >
            <option value="">{copy.assistant}</option>
            {assignees.map((member) => (
              <option key={member.userId} value={member.userId}>{member.name}</option>
            ))}
          </select>
          <Button
            variant="secondary"
            busy={busyControl}
            disabled={busyControl || pending || selectedUnresolved || !live}
            onClick={() => void saveAssignee()}
          >
            {copy.leadAssignSave}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ConversationsPage({
  inbox = [],
  loadFailed = false,
  noCompany = false,
  meta,
}: {
  inbox?: Conversation[];
  loadFailed?: boolean;
  noCompany?: boolean;
  meta?: WhatsappInboxMeta;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get("c");
  /** Latest selected conversation — async handlers must not use closure `selectedId`. */
  const selectedIdRef = useRef<string | null>(selectedId);
  useLayoutEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const isSelected = (conversationId: string) => selectedIdRef.current === conversationId;
  const [query, setQuery] = useState("");
  const [worklist, setWorklist] = useState<LeadWorklist>(()=>{const requested=params.get("worklist");return WORKLISTS.includes(requested as LeadWorklist)?requested as LeadWorklist:"all";});
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [localInbox, setLocalInbox] = useState<Record<string, Conversation>>({});
  /** Server membership for the active company/scope — full snapshots add/remove here. */
  const [serverInbox, setServerInbox] = useState<Conversation[]>(inbox);
  const [inboxScope, setInboxScope] = useState<string | null>(() =>
    meta?.companyId ? inboxScopeKey(meta.companyId, meta.conversationScope) : null,
  );
  /** Per-conversation: prior control attempt outcome unknown and server state not re-read yet. */
  const [unresolvedOutcomes, setUnresolvedOutcomes] = useState<Record<string, true>>({});
  /** Per-conversation: prior send outcome unknown — no normal resend until reviewed. */
  const [unresolvedSends, setUnresolvedSends] = useState<Record<string, true>>({});
  /** Pending durable op: keep original clientOpId + body until settled — draft edits must not replace it. */
  const sendOpByConversation = useRef<Record<string, { clientOpId: string; body: string }>>({});
  const [pending, startTransition] = useTransition();
  const [controlBusy, setControlBusy] = useState(false);
  const [controlBusyId, setControlBusyId] = useState<string | null>(null);
  const controlBusyIdRef = useRef<string | null>(null);
  const [inboxMeta, setInboxMeta] = useState<WhatsappInboxMeta | undefined>(meta);
  const inboxRefreshGen = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const readGenById = useRef<Record<string, number>>({});
  const initialScope = meta?.companyId
    ? inboxScopeKey(meta.companyId, meta.conversationScope)
    : null;
  /** Mutable epoch store in a ref — advanced on scope switch / full snapshots (not render state). */
  const epochStoreRef = useRef<InboxAsyncEpochStore>({
    current: createInboxAsyncEpoch(initialScope),
  });
  const snapshotRef = useRef({
    base: inbox,
    overrides: {} as Record<string, Conversation>,
    scopeKey: initialScope,
  });
  const liveIds = useMemo(() => new Set(serverInbox.map((item) => item.id)), [serverInbox]);
  const selectedUnresolved = Boolean(selectedId && unresolvedOutcomes[selectedId]);
  const selectedSendLocked = Boolean(selectedId && unresolvedSends[selectedId]);
  const timezone = inboxMeta?.timezone ?? meta?.timezone ?? null;
  const canReply = (inboxMeta ?? meta)?.canReply === true;
  const canAssign = (inboxMeta ?? meta)?.canAssign === true;
  const assignees = (inboxMeta ?? meta)?.assignees ?? [];

  function commitSnapshot(
    next: {
      base: Conversation[];
      overrides: Record<string, Conversation>;
      scopeKey: string | null;
    },
    opts?: { full?: boolean },
  ) {
    snapshotRef.current = next;
    setServerInbox(next.base);
    setLocalInbox(next.overrides);
    setInboxScope(next.scopeKey);
    if (opts?.full && next.scopeKey) {
      commitFullSnapshotEpoch(epochStoreRef.current, next.scopeKey);
    } else if (next.scopeKey && epochStoreRef.current.current.scopeKey !== next.scopeKey) {
      epochStoreRef.current.current = {
        ...epochStoreRef.current.current,
        scopeKey: next.scopeKey,
      };
    }
  }

  /** Drop pending ops / unresolved flags that belong to the previous company/scope. */
  function clearCompanyEphemeralState() {
    sendOpByConversation.current = {};
    setUnresolvedOutcomes({});
    setUnresolvedSends({});
    controlBusyIdRef.current = null;
    setControlBusy(false);
    setControlBusyId(null);
    setNotice(null);
    setError(null);
    setWarn(null);
    setDraft("");
  }

  /** Invalidate in-flight refreshes + every pending send/control/read on scope change. */
  function invalidateAllInboxOps(nextScopeKey: string | null) {
    inboxRefreshGen.current += 1;
    invalidateInboxOpsOnScopeChange(epochStoreRef.current, nextScopeKey);
    for (const id of Object.keys(readGenById.current)) {
      readGenById.current[id] = (readGenById.current[id] ?? 0) + 1;
    }
  }

  useLayoutEffect(() => {
    snapshotRef.current = { base: serverInbox, overrides: localInbox, scopeKey: inboxScope };
  }, [serverInbox, localInbox, inboxScope]);

  // Clock for today/overdue filters — must advance; refresh on tab focus; clear on unmount.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const intervalId = window.setInterval(tick, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Workspace/company switch (scope change) adopts the SSR full snapshot.
  // Same-scope prop updates must not prune rows already reconciled by client refresh.
  useLayoutEffect(() => {
    if (!meta?.companyId) {
      if (snapshotRef.current.scopeKey == null) {
        setInboxMeta(meta);
        return;
      }
      invalidateAllInboxOps(null);
      clearCompanyEphemeralState();
      commitSnapshot({ base: inbox, overrides: {}, scopeKey: null }, { full: true });
      setInboxMeta(meta);
      return;
    }
    const key = inboxScopeKey(meta.companyId, meta.conversationScope);
    if (snapshotRef.current.scopeKey === key) {
      setInboxMeta((current) => current ?? meta);
      return;
    }
    invalidateAllInboxOps(key);
    clearCompanyEphemeralState();
    commitSnapshot(
      applyInboxSnapshot(snapshotRef.current, {
        kind: "full",
        scopeKey: key,
        conversations: inbox,
      }),
      { full: true },
    );
    setInboxMeta(meta);
  }, [inbox, meta]);

  // Live server inbox only — never merge local demo/sample conversations into customer work.
  const conversations = useMemo(
    () => selectLiveConversations(serverInbox, localInbox),
    [serverInbox, localInbox],
  );

  // Counts and list share the same conversation set + filters (not stale SSR meta.counts).
  const counts = useMemo(() => {
    const next: Record<LeadWorklist, number> = {
      all: conversations.length,
      awaiting_staff: 0,
      follow_up_today: 0,
      overdue: 0,
      trial_or_quote: 0,
    };
    for (const key of WORKLISTS) {
      if (key === "all") continue;
      next[key] = countLeadWorklist(conversations, key, nowMs, timezone);
    }
    return next;
  }, [conversations, nowMs, timezone]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (
        !matchesLeadWorklist(
          {
            id: c.id,
            status: c.status,
            leadStage: c.leadStage,
            followUpStatus: c.followUpStatus,
            followUpAt: c.followUpAt,
            messages: c.messages,
          },
          worklist,
          nowMs,
          timezone,
        )
      ) {
        return false;
      }
      return !q || `${c.customer} ${c.topic} ${c.summary}`.toLowerCase().includes(q);
    });
  }, [conversations, query, statusFilter, worklist, nowMs, timezone]);
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const select = (id: string | null) => router.replace(id ? `/app/conversations?c=${id}` : "/app/conversations");
  const patch = (id: string, fn: (c: Conversation) => Partial<Conversation>) => {
    setLocalInbox((current) => {
      const base = current[id] ?? snapshotRef.current.base.find((item) => item.id === id);
      if (!base) return current;
      return { ...current, [id]: { ...base, ...fn(base) } };
    });
  };
  function retainConversationIds(): Set<string> {
    const ids = new Set<string>();
    for (const id of Object.keys(unresolvedOutcomes)) ids.add(id);
    for (const id of Object.keys(unresolvedSends)) ids.add(id);
    for (const id of Object.keys(sendOpByConversation.current)) ids.add(id);
    if (controlBusyId) ids.add(controlBusyId);
    return ids;
  }

  async function refreshInboxView(): Promise<boolean> {
    const requestGen = inboxRefreshGen.current + 1;
    inboxRefreshGen.current = requestGen;
    const requestEpoch = captureInboxEpoch(epochStoreRef.current);
    const requestScopeKey = requestEpoch.scopeKey;
    try {
      const loaded = await refreshWhatsappInboxSnapshot();
      if (!loaded.ok) return false;
      if (!isInboxEpochCurrent(requestEpoch, epochStoreRef.current.current)) return false;
      const responseScopeKey = inboxScopeKey(
        loaded.meta.companyId,
        loaded.meta.conversationScope,
      );
      if (
        isStaleInboxRefresh({
          requestGen,
          currentGen: inboxRefreshGen.current,
          requestScopeKey,
          responseScopeKey,
          activeScopeKey: snapshotRef.current.scopeKey,
        })
      ) {
        return false;
      }
      const kind = loaded.kind === "full" ? "full" : "partial";
      commitSnapshot(
        applyInboxSnapshot(
          snapshotRef.current,
          {
            kind,
            scopeKey: responseScopeKey,
            conversations: loaded.conversations,
          },
          { retainIds: retainConversationIds() },
        ),
        { full: kind === "full" },
      );
      setInboxMeta(loaded.meta);
      return true;
    } catch {
      return false;
    }
  }

  const time = (at: number) => new Date(at).toLocaleTimeString(locale === "ar" ? "ar-OM" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  function send(c: Conversation) {
    const draftText = draft.trim();
    if (!draftText || pending || controlBusy || unresolvedSends[c.id]) return;
    setError(null);
    setNotice(null);
    setWarn(null);

    if (!liveIds.has(c.id)) {
      setError(copy.app.inboxLiveOnly);
      return;
    }

    // Pending op keeps original identity + body until settled; draft edits stay local and do not mint a new op.
    const existing = sendOpByConversation.current[c.id];
    const clientOpId = existing?.clientOpId ?? (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const body = existing?.body ?? draftText;
    sendOpByConversation.current[c.id] = { clientOpId, body };

    startTransition(async () => {
      await runSendReplyPath({
        store: epochStoreRef.current,
        conversationId: c.id,
        send: () => replyWhatsappConversation({ conversationId: c.id, body, clientOpId }),
        onThrow: () => {
          setUnresolvedSends((prev) => ({ ...prev, [c.id]: true }));
          if (isSelected(c.id)) setError(copy.app.sendUnknownOutcome);
        },
        onResult: (result) => {
          if (!result.ok) {
            if (
              result.code === "UNKNOWN_OUTCOME"
              || result.outcome === "unknown"
              || result.code === "PERSIST_PENDING"
              || result.code === "IN_PROGRESS"
              || result.code === "SAVE_FAILED"
              || result.code === "CONTENT_MISMATCH"
            ) {
              if (
                result.code === "UNKNOWN_OUTCOME"
                || result.outcome === "unknown"
                || result.code === "IN_PROGRESS"
                || result.code === "SAVE_FAILED"
                || result.code === "CONTENT_MISMATCH"
              ) {
                setUnresolvedSends((prev) => ({ ...prev, [c.id]: true }));
              }
              if (isSelected(c.id)) {
                if (result.code === "IN_PROGRESS") setError(copy.app.sendInProgress);
                else if (result.code === "PERSIST_PENDING") setWarn(copy.app.sendPersistPending);
                else if (result.code === "CONTENT_MISMATCH") setError(copy.app.sendPendingOpKept);
                else if (result.code === "SAVE_FAILED") setError(copy.app.sendUnresolvedKeepOp);
                else setError(copy.app.sendUnknownOutcome);
              }
              return;
            }
            delete sendOpByConversation.current[c.id];
            const message =
              result.code === "SEND_DISABLED" ? copy.app.sendDisabled
                : result.code === "NOT_CONFIGURED" ? copy.app.sendNotConfigured
                  : result.code === "PHONE_MISMATCH" ? copy.app.sendPhoneMismatch
                    : result.code === "COMPANY_SUSPENDED" ? copy.app.sendCompanySuspended
                      : result.code === "REJECTED" ? copy.app.sendRejected
                        : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED" ? copy.app.sendForbidden
                          : copy.app.sendFailed;
            if (isSelected(c.id)) setError(message);
            return;
          }
          delete sendOpByConversation.current[c.id];
          setUnresolvedSends((prev) => {
            if (!prev[c.id]) return prev;
            const next = { ...prev };
            delete next[c.id];
            return next;
          });
          if (result.message.id) {
            patch(c.id, (cur) => ({
              messages: cur.messages.some((m) => m.id === result.message.id)
                ? cur.messages
                : [...cur.messages, {
                  id: result.message.id,
                  from: "staff" as const,
                  text: result.message.text,
                  at: result.message.at,
                  deliveryState: result.message.deliveryState,
                }],
              summary: result.message.text,
            }));
          }
          if (isSelected(c.id)) {
            setDraft("");
            setNotice(copy.app.sentNote);
          }
        },
      });
    });
  }

  function markUnresolved(conversationId: string) {
    setUnresolvedOutcomes((prev) => (prev[conversationId] ? prev : { ...prev, [conversationId]: true }));
  }

  function clearUnresolved(conversationId: string) {
    setUnresolvedOutcomes((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }

  /** Drop in-flight reads for this conversation (e.g. before a new control action). */
  function bumpReadGeneration(conversationId: string) {
    readGenById.current[conversationId] = (readGenById.current[conversationId] ?? 0) + 1;
  }

  /** Server read only. Never re-sends a control action. Ignores superseded responses. */
  async function syncControlView(conversationId: string): Promise<boolean> {
    return runSyncControlViewPath({
      conversationId,
      store: epochStoreRef.current,
      readGenById: readGenById.current,
      getSnapshot: () => snapshotRef.current,
      retainIds: retainConversationIds(),
      refresh: refreshWhatsappConversation,
      commit: (snapshot) => commitSnapshot(snapshot),
    });
  }

  async function retryRefresh(conversationId: string) {
    // Recovery button: read only. Never re-sends control. Failed read keeps an existing lock.
    const request = captureInboxEpoch(epochStoreRef.current);
    const wasUnresolved = Boolean(unresolvedOutcomes[conversationId]);
    if (isSelected(conversationId)) {
      setWarn(null);
      setError(null);
    }
    const synced = await syncControlView(conversationId);
    if (!isInboxEpochCurrent(request, epochStoreRef.current.current)) return;
    if (!synced) {
      if (wasUnresolved) {
        markUnresolved(conversationId);
        if (isSelected(conversationId)) setError(copy.app.controlOutcomeLocked);
      } else if (isSelected(conversationId)) {
        setWarn(copy.app.controlRefreshFailed);
      }
      return;
    }
    clearUnresolved(conversationId);
    if (isSelected(conversationId)) {
      setError(null);
      setWarn(null);
      setNotice(copy.app.controlRefreshed);
    }
  }

  function runControl(c: Conversation, action: ControlAction) {
    if (!liveIds.has(c.id) || controlBusy || pending) return;
    // Hard stop inside the action path — not only disabled buttons.
    if (unresolvedOutcomes[c.id]) return;

    const expectedRevision = c.revision ?? 1;
    // Invalidate reads that started before this control — they must not overwrite CONFLICT/success state.
    bumpReadGeneration(c.id);
    if (isSelected(c.id)) {
      setError(null);
      setNotice(null);
      setWarn(null);
    }

    void runControlActionPath({
      store: epochStoreRef.current,
      busyId: c.id,
      getBusyId: () => controlBusyIdRef.current,
      setBusy: (busy, id) => {
        controlBusyIdRef.current = busy ? id : null;
        setControlBusy(busy);
        setControlBusyId(id);
      },
      mutate: () =>
        controlWhatsappConversation({
          conversationId: c.id,
          action,
          expectedRevision,
        }),
      syncView: () => syncControlView(c.id),
      onResult: async (result, _request, helpers) => {
        let mutationConfirmed = false;
        if (!result.ok) {
          if (result.code === "CONFLICT" && result.state) {
            mutationConfirmed = true;
            clearUnresolved(c.id);
            patch(c.id, (cur) => applyControlState(cur, result.state!));
            if (isSelected(c.id)) setError(copy.app.controlConflict);
            return;
          }
          if (result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED") {
            if (isSelected(c.id)) setError(copy.app.controlForbidden);
            return;
          }
          if (result.code === "UNAVAILABLE") {
            const synced = await helpers.syncView();
            if (!helpers.stillCurrent()) return;
            if (synced) {
              clearUnresolved(c.id);
              if (isSelected(c.id)) setError(copy.app.controlUnavailable);
            } else {
              markUnresolved(c.id);
              if (isSelected(c.id)) setError(copy.app.controlOutcomeLocked);
            }
            return;
          }
          if (isSelected(c.id)) setError(copy.app.controlFailed);
          return;
        }

        mutationConfirmed = true;
        void mutationConfirmed;
        clearUnresolved(c.id);
        patch(c.id, (cur) => applyControlState(cur, result.state));
        if (isSelected(c.id)) {
          if (action === "take_over") setNotice(copy.app.controlTaken);
          else if (action === "resume") setNotice(copy.app.resumed);
          else setNotice(copy.app.controlClosed);
        }

        const synced = await helpers.syncView();
        if (!helpers.stillCurrent()) return;
        if (!synced && isSelected(c.id)) setWarn(copy.app.controlRefreshFailed);
      },
      onThrow: async (_request, helpers) => {
        const synced = await helpers.syncView();
        if (!helpers.stillCurrent()) return;
        if (synced) {
          clearUnresolved(c.id);
          if (isSelected(c.id)) setError(copy.app.controlUnknownOutcome);
        } else {
          markUnresolved(c.id);
          if (isSelected(c.id)) setError(copy.app.controlOutcomeLocked);
        }
      },
    });
  }

  const detail = selected ? (
    <section className="flex min-h-[min(70svh,100dvh-10rem)] flex-col rounded-2xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] lg:min-h-[60svh]" aria-label={selected.customer}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-border-soft)] bg-[#0d1a14]/95 p-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => select(null)} className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[color:var(--color-border-soft)] px-3 text-xs lg:hidden">{copy.app.backToList}</button>
          <div className="min-w-0">
            <h2 className="truncate font-bold">{selected.customer} · {selected.topic}</h2>
            <p className="text-xs text-[var(--color-muted-soft)]">{copy.app.ownerLabel}: {selected.owner === "assistant" ? copy.app.assistant : selected.owner === "staff" ? copy.app.staff : selected.owner} · <span className={`rounded-full px-2 py-0.5 ${statusStyle[selected.status]}`}>{copy.app.statuses[selected.status]}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {liveIds.has(selected.id) ? (
            <>
              {selected.assistantPaused ? (
                <Button
                  variant="secondary"
                  busy={controlBusy && controlBusyId === selected.id}
                  disabled={controlBusy || pending || selectedUnresolved}
                  onClick={() => runControl(selected, "resume")}
                >
                  {copy.app.resume}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  busy={controlBusy && controlBusyId === selected.id}
                  disabled={controlBusy || pending || selectedUnresolved}
                  onClick={() => runControl(selected, "take_over")}
                >
                  {copy.app.takeOver}
                </Button>
              )}
              {selected.status !== "resolved" ? (
                <Button
                  variant="ghost"
                  busy={controlBusy && controlBusyId === selected.id}
                  disabled={controlBusy || pending || selectedUnresolved}
                  onClick={() => runControl(selected, "close")}
                >
                  {copy.app.markResolved}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>
      {selected.assistantPaused ? <div className="border-b border-[#d9a467]/30 bg-[#d9a467]/10 px-4 py-2 text-sm text-[var(--color-warn-fg)]">{copy.app.pausedBanner}</div> : null}
      {!selected.assistantPaused && liveIds.has(selected.id) ? (
        <div className="border-b border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] px-4 py-2 text-sm text-[var(--color-muted-on-dark)]">{copy.app.resumeNotLive}</div>
      ) : null}
      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_260px]">
        <div className="flex min-h-0 flex-col" dir={locale === "ar" ? "rtl" : "ltr"}>
          <p className="mb-2 text-xs text-[var(--color-muted-soft)]">{copy.app.history}</p>
          <div className="flex min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto pb-3">
            {selected.messages.map((m) => (
              <div key={m.id} className={`max-w-[85%] ${m.from === "customer" ? "me-auto" : "ms-auto"}`}>
                <div className={`rounded-2xl px-3 py-2 text-[15px] leading-6 ${m.from === "customer" ? "rounded-ss-md bg-[var(--color-hover-wash)] text-[var(--color-on-dark)]" : m.from === "staff" ? "rounded-es-md bg-[#38dc89] text-[#072317]" : "rounded-es-md bg-[#def5e7] text-[#101b16]"}`}>
                  {m.text}
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-muted-soft)]">
                  {m.from === "customer" ? selected.customer : m.from === "staff" ? copy.app.staff : copy.app.assistant}
                  {" · "}
                  <span dir="ltr">{time(m.at)}</span>
                  {m.source ? ` · ${copy.tester.source}: ${m.source}` : ""}
                  {m.from !== "customer" && m.deliveryState ? ` · ${copy.app.deliveryStates[m.deliveryState]}` : ""}
                </p>
              </div>
            ))}
            {selectedSendLocked ? (
              <Notice tone="error">{copy.app.sendUnknownOutcome}</Notice>
            ) : null}
            {notice && !selectedUnresolved ? <Notice tone="info">{notice}</Notice> : null}
            {warn && !selectedUnresolved ? (
              <Notice tone="warn">
                <span className="flex flex-wrap items-center gap-2">
                  <span>{warn}</span>
                  {liveIds.has(selected.id) ? (
                    <button type="button" className="min-h-8 text-[#38dc89] underline" disabled={controlBusy} onClick={() => void retryRefresh(selected.id)}>
                      {copy.app.controlRetryRefresh}
                    </button>
                  ) : null}
                </span>
              </Notice>
            ) : null}
            {selectedUnresolved ? (
              <Notice tone="error">
                <span className="flex flex-wrap items-center gap-2">
                  <span>{copy.app.controlOutcomeLocked}</span>
                  <button type="button" className="min-h-8 text-[#38dc89] underline" disabled={controlBusy} onClick={() => void retryRefresh(selected.id)}>
                    {copy.app.controlRetryRefresh}
                  </button>
                </span>
              </Notice>
            ) : error ? (
              <Notice tone="error">
                <span className="flex flex-wrap items-center gap-2">
                  <span>{error}</span>
                  {liveIds.has(selected.id)
                    && (error === copy.app.controlUnavailable || error === copy.app.controlUnknownOutcome) ? (
                    <button type="button" className="min-h-8 text-[#38dc89] underline" disabled={controlBusy} onClick={() => void retryRefresh(selected.id)}>
                      {copy.app.controlRetryRefresh}
                    </button>
                  ) : null}
                </span>
              </Notice>
            ) : null}
          </div>
          <form className="sticky bottom-0 -mx-1 mt-auto flex gap-2 border-t border-[color:var(--color-border-soft)] bg-[#0d1a14] px-1 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]" onSubmit={(e) => { e.preventDefault(); send(selected); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={copy.app.reply} aria-label={copy.app.reply} disabled={pending || controlBusy} className="min-h-11 flex-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] disabled:opacity-60" />
            <Button type="submit" disabled={!draft.trim() || pending || controlBusy || selectedSendLocked || !liveIds.has(selected.id)} className="shrink-0">{copy.app.sendReply}</Button>
          </form>
        </div>
        <aside className="grid content-start gap-3 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3 text-sm lg:sticky lg:top-4">
          <h3 className="font-bold">{copy.app.customerDetails}</h3>
          <p>{selected.customer}</p>
          <p dir="ltr" className="text-[var(--color-muted-on-dark)]">{selected.phone}</p>
          <h3 className="mt-2 font-bold">{copy.app.summary}</h3>
          <p className="leading-6 text-[var(--color-muted-on-dark)]">{selected.summary}</p>
          {selected.needsInfo ? (
            <div className="grid gap-2">
              <p className="rounded-lg bg-[#e07a5f]/10 px-2 py-1 text-xs text-[var(--color-danger-fg)]">{copy.app.needsInfoTag}: {selected.needsInfo}</p>
              <Link href={`/app/knowledge?topic=${encodeURIComponent(selected.needsInfo)}`} className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#38dc89] px-3 text-xs font-medium text-[#072317]">{copy.app.addKnowledge}</Link>
            </div>
          ) : null}

          <LeadFollowUpPanel
            key={`${selected.id}:${selected.leadRevision ?? 1}:${selected.revision ?? 1}`}
            conversation={selected}
            copy={copy.app}
            locale={locale}
            canReply={canReply}
            canAssign={canAssign}
            assignees={assignees}
            timezoneAnnouncedUtc={meta?.timezoneAnnouncedUtc}
            live={liveIds.has(selected.id)}
            busyControl={controlBusy && controlBusyId === selected.id}
            pending={pending}
            selectedUnresolved={selectedUnresolved}
            onPatchLead={(state) => patch(selected.id, (cur) => applyLeadState(cur, state))}
            onPatchControl={(state) => patch(selected.id, (cur) => applyControlState(cur, state))}
            onSync={() => syncControlView(selected.id)}
            onNotice={(message) => {
              setError(null);
              setWarn(null);
              setNotice(message);
            }}
            onError={(message) => {
              setNotice(null);
              setError(message);
            }}
            onWarn={(message) => setWarn(message)}
            onBusyControl={(busy, busyId) => {
              controlBusyIdRef.current = busy ? busyId : null;
              setControlBusy(busy);
              setControlBusyId(busyId);
            }}
            onAfterLeadSaved={() => refreshInboxView()}
            getEpochStore={() => epochStoreRef.current}
            getControlBusyId={() => controlBusyIdRef.current}
          />
        </aside>
      </div>
    </section>
  ) : (
    <EmptyState
      title={copy.app.selectConversation}
      action={list[0] ? <Button variant="secondary" onClick={() => select(list[0].id)}>{copy.app.openConversation}</Button> : undefined}
    />
  );

  const emptyTitle = loadFailed
    ? copy.app.inboxLoadFailed
    : noCompany
      ? copy.app.inboxNoCompany
      : inbox.length === 0
        ? copy.app.inboxEmpty
        : copy.app.noResults;
  const emptyBody = loadFailed
    ? copy.app.inboxLoadFailedBody
    : noCompany
      ? copy.app.inboxNoCompanyBody
      : inbox.length === 0
        ? copy.app.inboxLiveOnly
        : undefined;

  return (
    <WorkspaceShell title={copy.app.conversationsTitle}>
      <Notice tone="info">{copy.app.inboxLiveOnly}</Notice>
      {loadFailed ? <Notice tone="error">{copy.app.inboxLoadFailedBody}</Notice> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className={`${selected ? "hidden lg:block" : ""}`}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.app.search} aria-label={copy.app.search} className="min-h-11 w-full rounded-xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]" />
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {WORKLISTS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setWorklist(f)}
                aria-pressed={worklist === f}
                className={`min-h-9 shrink-0 rounded-full px-3 text-xs ${worklist === f ? "bg-[#38dc89] text-[#072317]" : "border border-[color:var(--color-border-soft)] text-[var(--color-on-dark)]"}`}
              >
                {f === "all" ? copy.app.filterAll : copy.app.worklists[f]}
                {" "}
                ({f === "all" ? conversations.length : counts[f]})
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {(["all", "open", "handed_over", "resolved"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setStatusFilter(f)} aria-pressed={statusFilter === f} className={`min-h-9 shrink-0 rounded-full px-3 text-xs ${statusFilter === f ? "bg-white/15 text-[var(--color-on-dark)]" : "border border-[color:var(--color-border-soft)] text-[var(--color-muted-on-dark)]"}`}>
                {f === "all" ? copy.app.filterAll : copy.app.statuses[f]}
              </button>
            ))}
          </div>
          {meta?.timezoneAnnouncedUtc || inboxMeta?.timezoneAnnouncedUtc ? (
            <p className="mt-2 text-[11px] text-[var(--color-warn-fg)]">{copy.app.timezoneUtcNotice}</p>
          ) : null}
          <ul className="mt-3 grid gap-2">
            {list.length === 0 ? (
              <li>
                <EmptyState title={emptyTitle} body={emptyBody} />
              </li>
            ) : null}
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => select(c.id)} aria-current={c.id === selectedId ? "true" : undefined} className={`grid w-full gap-1 rounded-xl border p-3 text-start text-sm transition ${c.id === selectedId ? "border-[#38dc89] bg-[#38dc89]/10" : "border-[color:var(--color-border-soft)] hover:bg-[var(--color-hover-wash)]"}`}>
                  <span className="flex items-center justify-between gap-2"><strong>{c.customer}</strong><span className={`rounded-full px-2 py-0.5 text-[11px] ${statusStyle[c.status]}`}>{copy.app.statuses[c.status]}</span></span>
                  <span className="truncate text-[var(--color-muted-on-dark)]">
                    {c.leadStage ? copy.app.leadStages[c.leadStage] : copy.app.leadStages.new}
                    {c.followUpStatus === "scheduled" && c.followUpAt
                      ? ` · ${copy.app.leadFollowUpStatus.scheduled}`
                      : ""}
                    {" · "}
                    {c.messages[c.messages.length - 1]?.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={`${selected ? "" : "hidden lg:block"}`}>{detail}</div>
      </div>
    </WorkspaceShell>
  );
}
