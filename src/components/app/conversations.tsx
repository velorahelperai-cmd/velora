"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  type Conversation,
  type FollowUpStatus,
  type LeadStage,
  type Message,
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
import { Button, Notice, useAppCopy } from "@/components/app/ui";

export type UnifiedInboxFilter = "all" | "unread" | "noura" | "staff" | "resolved";

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

function formatConversationTime(timestampMs: number, locale: string): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const date = new Date(timestampMs);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString(locale === "ar" ? "ar-OM" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return locale === "ar" ? "أمس" : "Yesterday";
  }

  return date.toLocaleDateString(locale === "ar" ? "ar-OM" : "en-GB", {
    month: "short",
    day: "numeric",
  });
}

type LeadPanelCopy = ReturnType<typeof useAppCopy>["app"];

function DeliveryStateTick({ state, locale }: { state?: Message["deliveryState"]; locale: string }) {
  if (!state) return null;
  if (state === "read") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[#38dc89]" title={locale === "ar" ? "تمت القراءة" : "Read"}>
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 1.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-3 0a.5.5 0 0 0-.708-.708L5 7.293 6.146 8.44l2.5-2.5 1-1.586z" />
        </svg>
        <span className="text-[10px]">{locale === "ar" ? "قُرئت" : "Read"}</span>
      </span>
    );
  }
  if (state === "delivered") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[#9af0c3]" title={locale === "ar" ? "تم التسليم" : "Delivered"}>
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 1.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7z" />
        </svg>
        <span className="text-[10px]">{locale === "ar" ? "وُصّلت" : "Delivered"}</span>
      </span>
    );
  }
  if (state === "sent") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[var(--color-muted-soft)]" title={locale === "ar" ? "أُرسلت" : "Sent"}>
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
        </svg>
        <span className="text-[10px]">{locale === "ar" ? "أُرسلت" : "Sent"}</span>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[var(--color-danger-fg)]" title={locale === "ar" ? "تعذر التسليم" : "Failed"}>
        <span>⚠️</span>
        <span className="text-[10px]">{locale === "ar" ? "فشل" : "Failed"}</span>
      </span>
    );
  }
  return null;
}

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
      (leadStageDraft === "trial_or_quote_requested" || leadStageDraft === "closed_no_subscribe") &&
      !leadReasonDraft.trim()
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
          assigneeUserId: assignDraft ? assignDraft : null,
        }),
      syncView: onSync,
      onResult: async (result, _request, helpers) => {
        if (!result.ok) {
          if (result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED") {
            onError(copy.leadAssignForbidden);
            return;
          }
          if (result.code === "CONFLICT" && result.state) {
            onPatchControl(result.state);
            onError(copy.controlConflict);
            return;
          }
          onError(copy.controlFailed);
          return;
        }
        onPatchControl(result.state);
        onNotice(copy.leadAssignSaved);
        const synced = await helpers.syncView();
        if (!helpers.stillCurrent()) return;
        if (!synced) onWarn(copy.controlRefreshFailed);
      },
      onThrow: async (_request, helpers) => {
        const synced = await helpers.syncView();
        if (!helpers.stillCurrent()) return;
        if (!synced) onError(copy.controlOutcomeLocked);
      },
    });
  }

  const reasonRequired =
    leadStageDraft === "trial_or_quote_requested" || leadStageDraft === "closed_no_subscribe";
  const disabled = !live || leadBusy || pending || selectedUnresolved || !canReply;

  return (
    <div className="space-y-4 text-xs font-[family-name:Tajawal,var(--font-ar),sans-serif]">
      <div className="flex items-center justify-between border-b border-[color:var(--color-border-soft)] pb-2">
        <h4 className="font-bold text-sm text-[var(--color-on-dark)] flex items-center gap-1.5">
          <span>📋</span>
          {copy.leadPanelTitle}
        </h4>
        <span className="text-[11px] text-[var(--color-muted-soft)]">
          {locale === "ar" ? "تتبع التحويل والمبيعات" : "CRM & Follow-up"}
        </span>
      </div>

      <label className="grid gap-1">
        <span className="font-medium text-[var(--color-muted-on-dark)]">{copy.leadStageLabel}</span>
        <select
          value={leadStageDraft}
          disabled={disabled}
          onChange={(e) => setLeadStageDraft(e.target.value as LeadStage)}
          className="min-h-9 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[#38dc89] outline-none disabled:opacity-60"
        >
          {MANUAL_LEAD_STAGES.map((st) => (
            <option key={st} value={st}>
              {copy.leadStages[st]}
            </option>
          ))}
        </select>
      </label>

      {reasonRequired ? (
        <label className="grid gap-1">
          <span className="font-medium text-[var(--color-muted-on-dark)]">
            {copy.leadReasonLabel} <span className="text-[var(--color-danger-fg)]">*</span>
          </span>
          <input
            value={leadReasonDraft}
            disabled={disabled}
            onChange={(e) => setLeadReasonDraft(e.target.value)}
            placeholder={copy.leadReasonRequired}
            className="min-h-9 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[#38dc89] outline-none disabled:opacity-60"
          />
        </label>
      ) : null}

      <label className="grid gap-1">
        <span className="font-medium text-[var(--color-muted-on-dark)]">{copy.leadNoteLabel}</span>
        <textarea
          rows={2}
          value={leadNoteDraft}
          disabled={disabled}
          onChange={(e) => setLeadNoteDraft(e.target.value)}
          placeholder={locale === "ar" ? "ملاحظات داخلية لفريق العمل..." : "Internal team notes..."}
          className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[#38dc89] outline-none disabled:opacity-60 resize-none"
        />
      </label>

      <div className="grid gap-2 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-[var(--color-muted-on-dark)]">{copy.leadFollowUpLabel}</span>
          <span className="text-[11px] font-semibold text-[#f0cf9d]">
            {copy.leadFollowUpStatus[followUpStatusDraft]}
          </span>
        </div>

        {followUpStatusDraft === "scheduled" ? (
          <label className="grid gap-1">
            <input
              type="datetime-local"
              value={followUpAtDraft}
              disabled={disabled}
              onChange={(e) => setFollowUpAtDraft(e.target.value)}
              className="min-h-9 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[#38dc89] outline-none disabled:opacity-60"
            />
            {timezoneAnnouncedUtc ? (
              <p className="text-[10px] text-[var(--color-warn-fg)]">{copy.timezoneUtcNotice}</p>
            ) : null}
          </label>
        ) : null}

        <div className="flex flex-wrap gap-1.5 pt-1">
          {followUpStatusDraft !== "scheduled" ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setFollowUpStatusDraft("scheduled");
                void saveLead("scheduled");
              }}
              className="inline-flex min-h-7 items-center rounded-lg border border-[#38dc89]/40 bg-[#38dc89]/15 px-2.5 text-[11px] font-medium text-[#9af0c3] hover:bg-[#38dc89]/25 disabled:opacity-50"
            >
              📅 {copy.leadSchedule}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setFollowUpStatusDraft("completed");
                  void saveLead("completed");
                }}
                className="inline-flex min-h-7 items-center rounded-lg border border-[#38dc89]/40 bg-[#38dc89]/15 px-2.5 text-[11px] font-medium text-[#9af0c3] hover:bg-[#38dc89]/25 disabled:opacity-50"
              >
                ✓ {copy.leadComplete}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setFollowUpStatusDraft("cancelled");
                  void saveLead("cancelled");
                }}
                className="inline-flex min-h-7 items-center rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-[11px] font-medium text-[var(--color-muted-soft)] hover:bg-[var(--color-hover-wash)] disabled:opacity-50"
              >
                ✕ {copy.leadCancel}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          busy={leadBusy}
          onClick={() => void saveLead()}
          className="text-xs min-h-8 py-1 px-4"
        >
          {copy.leadSave}
        </Button>
      </div>

      {canAssign && assignees.length ? (
        <div className="mt-3 pt-3 border-t border-[color:var(--color-border-soft)]">
          <label className="grid gap-1">
            <span className="font-medium text-[var(--color-muted-on-dark)]">{copy.leadAssigneeLabel}</span>
            <div className="flex gap-1.5">
              <select
                value={assignDraft}
                disabled={!live || busyControl || pending || selectedUnresolved}
                onChange={(e) => setAssignDraft(e.target.value)}
                className="min-h-9 flex-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[#38dc89] outline-none disabled:opacity-60"
              >
                <option value="">{locale === "ar" ? "غير معيّن (الجميع)" : "Unassigned"}</option>
                {assignees.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                disabled={!live || busyControl || pending || selectedUnresolved || assignDraft === (conversation.assignedTo ?? "")}
                onClick={() => void saveAssignee()}
                className="text-xs min-h-9 px-3 shrink-0"
              >
                {copy.leadAssignSave}
              </Button>
            </div>
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function ConversationsPage({
  inbox,
  loadFailed,
  noCompany,
  meta,
}: {
  inbox: Conversation[];
  loadFailed?: boolean;
  noCompany?: boolean;
  meta?: WhatsappInboxMeta;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedParam = searchParams.get("c");

  const [serverInbox, setServerInbox] = useState<Conversation[]>(inbox);
  const [localInbox, setLocalInbox] = useState<Record<string, Conversation>>({});
  const [inboxMeta, setInboxMeta] = useState<WhatsappInboxMeta | undefined>(meta);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<UnifiedInboxFilter>("all");
  const [worklist, setWorklist] = useState<LeadWorklist>("all");
  const [draft, setDraft] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();

  const [controlBusy, setControlBusy] = useState(false);
  const [controlBusyId, setControlBusyId] = useState<string | null>(null);
  const controlBusyIdRef = useRef<string | null>(null);

  const [unresolvedOutcomes, setUnresolvedOutcomes] = useState<Record<string, boolean>>({});
  const [unresolvedSends, setUnresolvedSends] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  // Column 3 Drawer toggle for mobile and tablet screens
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);

  const epochStoreRef = useRef<InboxAsyncEpochStore>({
    current: createInboxAsyncEpoch(meta?.companyId ? inboxScopeKey(meta.companyId, meta.conversationScope) : null),
  });

  const inboxScope = meta?.companyId ? inboxScopeKey(meta.companyId, meta.conversationScope) : null;
  const snapshotRef = useRef<{
    base: Conversation[];
    overrides: Record<string, Conversation>;
    scopeKey: string | null;
  }>({
    base: inbox,
    overrides: {},
    scopeKey: inboxScope,
  });

  const readGenById = useRef<Record<string, number>>({});
  const sendOpByConversation = useRef<Record<string, { clientOpId: string; body: string }>>({});
  const inboxRefreshGen = useRef(0);

  const canReply = meta?.canReply ?? inboxMeta?.canReply ?? false;
  const canAssign = meta?.canAssign ?? inboxMeta?.canAssign ?? false;
  const assignees = meta?.assignees ?? inboxMeta?.assignees ?? [];
  const timezone = meta?.timezone ?? inboxMeta?.timezone ?? null;

  const liveIds = useMemo(() => new Set(inbox.map((c) => c.id)), [inbox]);
  const selectedId = selectedParam ?? null;

  function isSelected(id: string) {
    return id === selectedId;
  }

  function commitSnapshot(
    next: { base: Conversation[]; overrides: Record<string, Conversation>; scopeKey: string | null },
    opts?: { full?: boolean },
  ) {
    snapshotRef.current = next;
    setServerInbox(next.base);
    setLocalInbox(next.overrides);
    if (opts?.full && next.scopeKey) {
      commitFullSnapshotEpoch(epochStoreRef.current, next.scopeKey);
    }
  }

  function bumpReadGeneration(id: string): number {
    const next = (readGenById.current[id] ?? 0) + 1;
    readGenById.current[id] = next;
    return next;
  }

  function markUnresolved(id: string) {
    setUnresolvedOutcomes((prev) => ({ ...prev, [id]: true }));
  }

  function clearUnresolved(id: string) {
    setUnresolvedOutcomes((prev) => {
      if (!prev[id]) return prev;
      const copyObj = { ...prev };
      delete copyObj[id];
      return copyObj;
    });
  }

  function clearCompanyEphemeralState() {
    setLocalInbox({});
    setUnresolvedOutcomes({});
    setUnresolvedSends({});
    sendOpByConversation.current = {};
    readGenById.current = {};
    controlBusyIdRef.current = null;
    setControlBusy(false);
    setControlBusyId(null);
    setNotice(null);
    setError(null);
    setWarn(null);
    setDraft("");
  }

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

  const conversations = useMemo(
    () => selectLiveConversations(serverInbox, localInbox),
    [serverInbox, localInbox],
  );

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

  const filterCounts = useMemo(() => {
    let unreadCount = 0;
    let nouraCount = 0;
    let staffCount = 0;
    let resolvedCount = 0;

    for (const c of conversations) {
      if (c.status === "resolved") {
        resolvedCount++;
        continue;
      }
      if (c.assistantPaused) {
        staffCount++;
      } else if (c.automationAllowed) {
        nouraCount++;
      }
      const lastMsg = c.messages[c.messages.length - 1];
      if (lastMsg?.from === "customer" || c.status === "handed_over") {
        unreadCount++;
      }
    }

    return {
      all: conversations.length,
      unread: unreadCount,
      noura: nouraCount,
      staff: staffCount,
      resolved: resolvedCount,
    };
  }, [conversations]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      // Unified Filter check
      if (activeFilter === "resolved" && c.status !== "resolved") return false;
      if (activeFilter === "noura") {
        if (c.status === "resolved" || c.assistantPaused || !c.automationAllowed) return false;
      }
      if (activeFilter === "staff") {
        if (c.status === "resolved" || !c.assistantPaused) return false;
      }
      if (activeFilter === "unread") {
        const lastMsg = c.messages[c.messages.length - 1];
        const isAwaiting = lastMsg?.from === "customer" || c.status === "handed_over";
        if (c.status === "resolved" || !isAwaiting) return false;
      }

      // Secondary worklist check
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

      // Search query check
      if (!q) return true;
      const haystack = `${c.customer} ${c.phone} ${c.topic} ${c.summary} ${c.messages.map((m) => m.text).join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [conversations, activeFilter, worklist, query, nowMs, timezone]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const select = (id: string | null) =>
    router.replace(id ? `/app/conversations?c=${id}` : "/app/conversations");

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

    const existing = sendOpByConversation.current[c.id];
    const clientOpId =
      existing?.clientOpId ??
      (typeof crypto !== "undefined" && crypto.randomUUID
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
              result.code === "UNKNOWN_OUTCOME" ||
              result.outcome === "unknown" ||
              result.code === "PERSIST_PENDING" ||
              result.code === "IN_PROGRESS" ||
              result.code === "SAVE_FAILED" ||
              result.code === "CONTENT_MISMATCH"
            ) {
              if (
                result.code === "UNKNOWN_OUTCOME" ||
                result.outcome === "unknown" ||
                result.code === "IN_PROGRESS" ||
                result.code === "SAVE_FAILED" ||
                result.code === "CONTENT_MISMATCH"
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
              result.code === "SEND_DISABLED"
                ? copy.app.sendDisabled
                : result.code === "NOT_CONFIGURED"
                  ? copy.app.sendNotConfigured
                  : result.code === "PHONE_MISMATCH"
                    ? copy.app.sendPhoneMismatch
                    : result.code === "COMPANY_SUSPENDED"
                      ? copy.app.sendCompanySuspended
                      : result.code === "REJECTED"
                        ? copy.app.sendRejected
                        : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
                          ? copy.app.sendForbidden
                          : copy.app.sendFailed;
            if (isSelected(c.id)) setError(message);
            return;
          }
          delete sendOpByConversation.current[c.id];
          setUnresolvedSends((prev) => {
            if (!prev[c.id]) return prev;
            const updated = { ...prev };
            delete updated[c.id];
            return updated;
          });
          const newMessage: Message = {
            id: result.message.id,
            from: "staff",
            text: result.message.text,
            at: result.message.at,
            deliveryState: result.message.deliveryState as Message["deliveryState"],
          };
          patch(c.id, (cur) => ({
            messages: [...cur.messages, newMessage],
            summary: newMessage.text,
            status: "handed_over",
            assistantPaused: true,
          }));
          setDraft("");
          if (isSelected(c.id)) setNotice(copy.app.sentNote);
        },
      });
    });
  }

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
    if (unresolvedOutcomes[c.id]) return;

    const expectedRevision = c.revision ?? 1;
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
        if (!result.ok) {
          if (result.code === "CONFLICT" && result.state) {
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

        clearUnresolved(c.id);
        patch(c.id, (cur) => applyControlState(cur, result.state));
        if (isSelected(c.id)) {
          if (action === "take_over") setNotice(locale === "ar" ? "تم استلام المحادثة وإيقاف نورا مؤقتاً." : "Taken over. Noura auto-reply paused.");
          else if (action === "resume") setNotice(locale === "ar" ? "تم تفعيل نورا للرد التلقائي." : "Noura auto-reply enabled.");
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

  const selectedUnresolved = Boolean(selected && unresolvedOutcomes[selected.id]);
  const selectedSendLocked = Boolean(selected && unresolvedSends[selected.id]);

  const copyCustomerPhone = useCallback((phone: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(phone).then(() => {
        setPhoneCopied(true);
        setTimeout(() => setPhoneCopied(false), 2000);
      });
    }
  }, []);

  // Empty / Load Failed status checks
  const emptyTitle = loadFailed
    ? copy.app.inboxLoadFailed
    : noCompany
      ? copy.app.inboxNoCompany
      : inbox.length === 0
        ? (locale === "ar" ? "لا توجد محادثات واتساب بعد" : "No WhatsApp conversations yet")
        : copy.app.noResults;

  const emptyBody = loadFailed
    ? copy.app.inboxLoadFailedBody
    : noCompany
      ? copy.app.inboxNoCompanyBody
      : inbox.length === 0
        ? (locale === "ar"
            ? "عندما يراسل العملاء رقم WhatsApp Business المربوط بشركتك، ستظهر محادثاتهم هنا وستقوم نورا بالرد الفوري وفق المعرفة المعتمدة."
            : "When customers contact your linked WhatsApp Business number, conversations will appear here and Noura will respond using your approved knowledge.")
        : undefined;

  return (
    <WorkspaceShell
      title={locale === "ar" ? "صندوق المحادثات الموحد" : "Unified Inbox"}
      actions={
        <div className="flex items-center gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
          <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 py-1 text-xs text-[var(--color-on-dark)] shadow-sm">
            <span className="h-2 w-2 rounded-full bg-[#38dc89] animate-pulse" />
            <span className="font-medium text-[#38dc89]">Meta WhatsApp</span>
            <span className="text-[var(--color-muted-soft)]">·</span>
            <span>{locale === "ar" ? "المساعد: نورا (Noura)" : "Assistant: Noura"}</span>
          </div>
          <Button
            variant="ghost"
            onClick={() => void refreshInboxView()}
            className="text-xs min-h-9 px-3 gap-1.5"
            title={locale === "ar" ? "تحديث المحادثات" : "Refresh inbox"}
          >
            <span>🔄</span>
            <span className="hidden sm:inline">{locale === "ar" ? "تحديث" : "Refresh"}</span>
          </Button>
        </div>
      }
    >
      {/* Top Banner Notice for Unconnected or Setup States */}
      {noCompany ? (
        <Notice tone="warn">{copy.app.inboxNoCompanyBody}</Notice>
      ) : loadFailed ? (
        <Notice tone="error">{copy.app.inboxLoadFailedBody}</Notice>
      ) : inbox.length === 0 ? (
        <div className="mb-4 rounded-2xl border border-[#38dc89]/30 bg-gradient-to-r from-[#38dc89]/10 via-[#0d1a14]/60 to-[#d9a467]/10 p-4 text-xs font-[family-name:Tajawal,var(--font-ar),sans-serif] text-[var(--color-on-dark)] flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📱</span>
            <div>
              <p className="font-bold text-sm text-[var(--color-success-fg)]">
                {locale === "ar" ? "ربط واتساب بيزنس وتشغيل نورا" : "Connect WhatsApp Business & Activate Noura"}
              </p>
              <p className="text-[var(--color-muted-on-dark)] mt-0.5">
                {locale === "ar"
                  ? "تأكد من إكمال ربط رقم واتساب في الإعدادات وإضافة معرفة شركتك لتبدأ نورا بالرد الفوري."
                  : "Ensure WhatsApp number is linked in settings and approved knowledge is added so Noura can reply."}
              </p>
            </div>
          </div>
          <Link
            href="/app/settings"
            className="inline-flex min-h-8 items-center rounded-xl bg-[#38dc89] px-3.5 text-xs font-semibold text-[#072317] hover:bg-[#4fe79a] transition"
          >
            {locale === "ar" ? "إعدادات الربط ⚙️" : "Connection Settings ⚙️"}
          </Link>
        </div>
      ) : null}

      {/* Main 3-Column Unified Inbox Container */}
      <div className="grid h-[calc(100svh-11rem)] min-h-[620px] max-h-[920px] w-full grid-cols-1 overflow-hidden rounded-2xl border border-[color:var(--color-line)] bg-[var(--color-panel)] shadow-[0_12px_36px_rgba(16,27,22,0.08)] lg:grid-cols-[330px_1fr] xl:grid-cols-[340px_1fr_320px]">
        {/* ============================================================== */}
        {/* COLUMN 1: CONVERSATIONS LIST & FILTERS                         */}
        {/* ============================================================== */}
        <section
          className={`flex h-full flex-col border-e border-[color:var(--color-line)] bg-[var(--color-panel-deep)]/70 ${
            selected ? "hidden lg:flex" : "flex"
          }`}
          aria-label={locale === "ar" ? "قائمة المحادثات" : "Conversations List"}
        >
          {/* Header & Search */}
          <div className="p-3.5 border-b border-[color:var(--color-line)] space-y-2.5">
            <div className="relative">
              <span className="absolute inset-y-0 start-3 flex items-center text-[var(--color-muted-soft)] pointer-events-none">
                🔍
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={locale === "ar" ? "ابحث باسم العميل أو الرقم..." : "Search customer or phone..."}
                className="w-full min-h-10 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] ps-9 pe-8 text-xs text-[var(--color-on-dark)] placeholder:text-[var(--color-muted-soft)] focus:ring-2 focus:ring-[#38dc89] outline-none transition"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute inset-y-0 end-2.5 flex items-center text-xs text-[var(--color-muted-soft)] hover:text-[var(--color-on-dark)]"
                  aria-label={locale === "ar" ? "مسح البحث" : "Clear search"}
                >
                  ✕
                </button>
              ) : null}
            </div>

            {/* Quick Filter Tabs: الكل، غير المقروءة، نورا ترد، تدخل بشري، مغلقة */}
            <div className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[11px] font-medium font-[family-name:Tajawal,var(--font-ar),sans-serif]">
              {(
                [
                  { id: "all", labelAr: "الكل", labelEn: "All", count: filterCounts.all },
                  { id: "unread", labelAr: "بانتظار رد", labelEn: "Awaiting", count: filterCounts.unread },
                  { id: "noura", labelAr: "نورا ترد", labelEn: "Noura", count: filterCounts.noura, badge: "✨" },
                  { id: "staff", labelAr: "تدخل بشري", labelEn: "Staff", count: filterCounts.staff, badge: "👤" },
                  { id: "resolved", labelAr: "مغلقة", labelEn: "Closed", count: filterCounts.resolved },
                ] as const
              ).map((tab) => {
                const active = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1 shrink-0 rounded-xl px-2.5 py-1.5 transition ${
                      active
                        ? "bg-[#38dc89] text-[#072317] font-bold shadow-sm"
                        : "bg-[var(--color-hover-wash)] text-[var(--color-muted-on-dark)] hover:text-[var(--color-on-dark)] border border-transparent"
                    }`}
                  >
                    {"badge" in tab ? <span>{tab.badge}</span> : null}
                    <span>{locale === "ar" ? tab.labelAr : tab.labelEn}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                        active ? "bg-[#072317]/20 text-[#072317]" : "bg-[var(--color-panel)] text-[var(--color-muted-soft)]"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Secondary Worklist Chips */}
            {worklist !== "all" || counts.awaiting_staff > 0 || counts.follow_up_today > 0 ? (
              <div className="flex gap-1 overflow-x-auto pt-1 text-[10px] [scrollbar-width:none]">
                {WORKLISTS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setWorklist(f)}
                    aria-pressed={worklist === f}
                    className={`shrink-0 rounded-lg px-2 py-0.5 border ${
                      worklist === f
                        ? "border-[#d9a467] bg-[#d9a467]/15 text-[#f0cf9d]"
                        : "border-[color:var(--color-border-soft)] text-[var(--color-muted-soft)] hover:text-[var(--color-on-dark)]"
                    }`}
                  >
                    {f === "all" ? copy.app.filterAll : copy.app.worklists[f]} ({counts[f]})
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Conversations Scrollable List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {list.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <p className="text-2xl mb-2">💬</p>
                <p className="font-semibold text-xs text-[var(--color-on-dark)]">{emptyTitle}</p>
                {emptyBody ? (
                  <p className="text-[11px] text-[var(--color-muted-on-dark)] mt-1.5 leading-5">{emptyBody}</p>
                ) : null}
              </div>
            ) : null}

            {list.map((c) => {
              const isCurrent = c.id === selectedId;
              const lastMessage = c.messages[c.messages.length - 1];
              const lastMsgTime = lastMessage?.at ? formatConversationTime(lastMessage.at, locale) : "";
              const isNouraActive = !c.assistantPaused && Boolean(c.automationAllowed) && c.status !== "resolved";
              const isAwaitingStaff = c.assistantPaused && c.status !== "resolved";
              const isCustomerWaiting = lastMessage?.from === "customer" && c.status !== "resolved";

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`group relative grid w-full gap-1.5 rounded-xl p-3 text-start transition duration-150 border ${
                    isCurrent
                      ? "border-[#38dc89]/60 bg-[#38dc89]/10 shadow-[0_2px_12px_rgba(56,220,137,0.12)]"
                      : "border-transparent hover:border-[color:var(--color-border-soft)] hover:bg-[var(--color-hover-wash)]"
                  }`}
                >
                  {/* Top line: Customer name + Time */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#38dc89]/25 to-[#1d7d4c]/30 flex items-center justify-center text-xs font-bold text-[#38dc89] shrink-0 border border-[#38dc89]/30">
                        {c.customer.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-bold text-xs text-[var(--color-on-dark)] truncate">
                        {c.customer}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--color-muted-soft)] shrink-0 font-medium">
                      {lastMsgTime}
                    </span>
                  </div>

                  {/* Middle line: Phone number & Channel */}
                  <div className="flex items-center justify-between text-[11px] text-[var(--color-muted-soft)]">
                    <span dir="ltr" className="font-mono text-[10px] opacity-80">
                      {c.phone}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted-soft)]">واتساب</span>
                  </div>

                  {/* Bottom line: Last message preview */}
                  <p className="truncate text-[11px] text-[var(--color-muted-on-dark)] leading-4">
                    {lastMessage ? (
                      <>
                        <span className="opacity-75">
                          {lastMessage.from === "customer"
                            ? ""
                            : lastMessage.from === "assistant"
                              ? (locale === "ar" ? "نورا: " : "Noura: ")
                              : (locale === "ar" ? "الموظف: " : "Staff: ")}
                        </span>
                        {lastMessage.text}
                      </>
                    ) : (
                      c.summary
                    )}
                  </p>

                  {/* Badges footer: Noura status + conversation status */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                    {isNouraActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium bg-[#38dc89]/15 text-[#38dc89] border border-[#38dc89]/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89] animate-pulse" />
                        ✨ {locale === "ar" ? "نورا ترد" : "Noura Active"}
                      </span>
                    ) : isAwaitingStaff ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium bg-[#d9a467]/15 text-[#f0cf9d] border border-[#d9a467]/30">
                        👤 {locale === "ar" ? "تدخل بشري" : "Staff Takeover"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-[var(--color-hover-wash)] text-[var(--color-muted-soft)] border border-[color:var(--color-border-soft)]">
                        ✓ {copy.app.statuses[c.status]}
                      </span>
                    )}

                    {c.leadStage && c.leadStage !== "new" ? (
                      <span className="rounded-full px-1.5 py-0.2 bg-[var(--color-panel)] text-[var(--color-muted-soft)] border border-[color:var(--color-border-soft)] text-[9px]">
                        {copy.app.leadStages[c.leadStage]}
                      </span>
                    ) : null}

                    {isCustomerWaiting ? (
                      <span
                        className="ms-auto h-2 w-2 rounded-full bg-[#38dc89] shadow-[0_0_8px_#38dc89]"
                        title={locale === "ar" ? "رسالة جديدة بانتظار الرد" : "New message"}
                      />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ============================================================== */}
        {/* COLUMN 2: ACTIVE CONVERSATION TRANSCRIPT & COMPOSER             */}
        {/* ============================================================== */}
        <section
          className={`flex h-full flex-col bg-[var(--color-panel)] ${
            selected ? "flex" : "hidden lg:flex"
          }`}
          aria-label={selected ? selected.customer : (locale === "ar" ? "المحادثة النشطة" : "Active Conversation")}
        >
          {selected ? (
            <>
              {/* Top Header of Chat */}
              <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-line)] px-4 py-3 bg-[var(--color-panel)]/95 backdrop-blur z-10">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Mobile Back Button */}
                  <button
                    type="button"
                    onClick={() => select(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--color-border-soft)] text-sm lg:hidden hover:bg-[var(--color-hover-wash)]"
                    aria-label={copy.app.backToList}
                  >
                    {locale === "ar" ? "→" : "←"}
                  </button>

                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#38dc89]/20 to-[#1d7d4c]/20 border border-[#38dc89]/30 flex items-center justify-center font-bold text-sm text-[#38dc89] shrink-0">
                    {selected.customer.slice(0, 1).toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-sm text-[var(--color-on-dark)] truncate font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                        {selected.customer}
                      </h2>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[#38dc89]/10 text-[#38dc89] border border-[#38dc89]/20">
                        WhatsApp
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs mt-0.5">
                      <span dir="ltr" className="font-mono text-[11px] text-[var(--color-muted-soft)]">
                        {selected.phone}
                      </span>
                      <span className="text-[var(--color-muted-soft)]">·</span>
                      {selected.assistantPaused ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[#f0cf9d] text-[11px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#d9a467]" />
                          {locale === "ar" ? "تدخل الموظف البشري 👤" : "Staff Active 👤"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-[#38dc89] text-[11px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89] animate-pulse" />
                          {locale === "ar" ? "نورا تجيب تلقائياً ✨" : "Noura Auto-Replying ✨"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Chat Top Controls */}
                <div className="flex items-center gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                  {liveIds.has(selected.id) ? (
                    <>
                      {selected.assistantPaused ? (
                        <button
                          type="button"
                          disabled={controlBusy || pending || selectedUnresolved}
                          onClick={() => runControl(selected, "resume")}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[#38dc89]/40 bg-[#38dc89]/15 px-3 text-xs font-bold text-[#38dc89] transition hover:bg-[#38dc89]/25 disabled:opacity-50"
                          title={locale === "ar" ? "السماح لنورا بالرد التلقائي مجدداً" : "Resume Noura"}
                        >
                          <span>🤖</span>
                          <span>{locale === "ar" ? "تفعيل نورا" : "Resume Noura"}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={controlBusy || pending || selectedUnresolved}
                          onClick={() => runControl(selected, "take_over")}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[#d9a467]/40 bg-[#d9a467]/15 px-3 text-xs font-bold text-[#f0cf9d] transition hover:bg-[#d9a467]/25 disabled:opacity-50"
                          title={locale === "ar" ? "إيقاف نورا وتولي المحادثة كبشري" : "Take over from Noura"}
                        >
                          <span>👤</span>
                          <span>{locale === "ar" ? "استلام يدوي" : "Take Over"}</span>
                        </button>
                      )}

                      {selected.status !== "resolved" ? (
                        <Button
                          variant="ghost"
                          busy={controlBusy && controlBusyId === selected.id}
                          disabled={controlBusy || pending || selectedUnresolved}
                          onClick={() => runControl(selected, "close")}
                          className="text-xs min-h-8 py-1 px-2.5"
                        >
                          {copy.app.markResolved}
                        </Button>
                      ) : null}
                    </>
                  ) : null}

                  {/* Toggle Column 3 Drawer Button (on screen < xl) */}
                  <button
                    type="button"
                    onClick={() => setMobileDetailsOpen((prev) => !prev)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] xl:hidden hover:bg-[var(--color-hover-wash)]"
                    aria-label={locale === "ar" ? "تفاصيل العميل" : "Customer Details"}
                  >
                    <span>ℹ️</span>
                    <span className="hidden sm:inline">{locale === "ar" ? "التفاصيل" : "Details"}</span>
                  </button>
                </div>
              </header>

              {/* Status Notice Banners */}
              {selected.assistantPaused ? (
                <div className="border-b border-[#d9a467]/30 bg-[#d9a467]/10 px-4 py-2 text-xs text-[#f0cf9d] flex items-center justify-between font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                  <div className="flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{locale === "ar" ? "الرد التلقائي لنورا متوقف حالياً. أنت الآن تتولى الرد على العميل." : "Noura auto-reply is paused. You are chatting directly with customer."}</span>
                  </div>
                  <button
                    type="button"
                    disabled={controlBusy}
                    onClick={() => runControl(selected, "resume")}
                    className="text-xs font-bold underline hover:opacity-80"
                  >
                    {locale === "ar" ? "إعادة تفعيل نورا" : "Activate Noura"}
                  </button>
                </div>
              ) : (
                <div className="border-b border-[#38dc89]/20 bg-[#38dc89]/5 px-4 py-2 text-xs text-[#38dc89] flex items-center gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                  <span>✨</span>
                  <span>{locale === "ar" ? "نورا ترد على استفسارات هذا العميل بالاعتماد الكامل على قاعدة المعرفة المعتمدة لشركتك." : "Noura auto-replies using approved company knowledge."}</span>
                </div>
              )}

              {/* Messages Transcript Scroll Area */}
              <div
                className="flex-1 overflow-y-auto p-4 space-y-4"
                dir={locale === "ar" ? "rtl" : "ltr"}
              >
                {selected.messages.length === 0 ? (
                  <div className="py-16 text-center text-xs text-[var(--color-muted-soft)]">
                    {locale === "ar" ? "لا توجد رسائل سابقة في هذه المحادثة." : "No messages in this conversation yet."}
                  </div>
                ) : null}

                {selected.messages.map((m) => {
                  const isCustomer = m.from === "customer";
                  const isAssistant = m.from === "assistant";

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${
                        isCustomer ? "me-auto items-start" : "ms-auto items-end"
                      }`}
                    >
                      {/* Sender Tag Header */}
                      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] font-medium font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                        {isCustomer ? (
                          <span className="text-[var(--color-muted-soft)]">{selected.customer}</span>
                        ) : isAssistant ? (
                          <span className="inline-flex items-center gap-1 text-[#38dc89] font-bold">
                            <span>✨</span>
                            <span>{locale === "ar" ? "نورا (ذكاء اصطناعي معتمد)" : "Noura (Velora AI)"}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#f0cf9d] font-bold">
                            <span>👤</span>
                            <span>{copy.app.staff}</span>
                          </span>
                        )}
                        <span className="text-[var(--color-muted-soft)] text-[10px]">·</span>
                        <span dir="ltr" className="text-[10px] text-[var(--color-muted-soft)]">
                          {new Date(m.at).toLocaleTimeString(locale === "ar" ? "ar-OM" : "en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      {/* Bubble Container */}
                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm leading-6 shadow-sm transition ${
                          isCustomer
                            ? "rounded-ss-sm bg-[var(--color-panel-deep)] text-[var(--color-on-dark)] border border-[color:var(--color-border-soft)]"
                            : isAssistant
                              ? "rounded-se-sm bg-gradient-to-br from-[#0c2e1f]/90 to-[#072317] text-[#e6fbf0] border border-[#227249]/60 shadow-[0_4px_16px_rgba(56,220,137,0.08)]"
                              : "rounded-se-sm bg-[#1b3a2a] text-white border border-[#38dc89]/40"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      </div>

                      {/* Message Delivery State & Source Tag */}
                      <div className="mt-1 flex items-center gap-2 px-1 text-[10px] text-[var(--color-muted-soft)]">
                        {m.source ? <span>المصدر: {m.source}</span> : null}
                        {!isCustomer && m.deliveryState ? (
                          <DeliveryStateTick state={m.deliveryState} locale={locale} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {/* Inline Notices & Errors */}
                {selectedSendLocked ? (
                  <Notice tone="error">{copy.app.sendUnknownOutcome}</Notice>
                ) : null}
                {notice && !selectedUnresolved ? <Notice tone="info">{notice}</Notice> : null}
                {warn && !selectedUnresolved ? (
                  <Notice tone="warn">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{warn}</span>
                      {liveIds.has(selected.id) ? (
                        <button
                          type="button"
                          className="min-h-8 text-[#38dc89] underline font-bold"
                          disabled={controlBusy}
                          onClick={() => void retryRefresh(selected.id)}
                        >
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
                      <button
                        type="button"
                        className="min-h-8 text-[#38dc89] underline font-bold"
                        disabled={controlBusy}
                        onClick={() => void retryRefresh(selected.id)}
                      >
                        {copy.app.controlRetryRefresh}
                      </button>
                    </span>
                  </Notice>
                ) : error ? (
                  <Notice tone="error">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{error}</span>
                      {liveIds.has(selected.id) &&
                      (error === copy.app.controlUnavailable || error === copy.app.controlUnknownOutcome) ? (
                        <button
                          type="button"
                          className="min-h-8 text-[#38dc89] underline font-bold"
                          disabled={controlBusy}
                          onClick={() => void retryRefresh(selected.id)}
                        >
                          {copy.app.controlRetryRefresh}
                        </button>
                      ) : null}
                    </span>
                  </Notice>
                ) : null}
              </div>

              {/* Bottom Composer Box */}
              <div className="border-t border-[color:var(--color-line)] p-3 bg-[var(--color-panel)]">
                {canReply ? (
                  <form
                    className="flex flex-col gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send(selected);
                    }}
                  >
                    {!selected.assistantPaused ? (
                      <p className="text-[11px] text-[#f0cf9d] flex items-center gap-1.5">
                        <span>ℹ️</span>
                        <span>
                          {locale === "ar"
                            ? "ملاحظة: إرسال رد يدوي سيوقف نورا تلقائياً لتمكين الموظف من متابعة المحادثة."
                            : "Note: Sending a manual reply will pause Noura to ensure no conflicting answers."}
                        </span>
                      </p>
                    ) : null}

                    <div className="flex gap-2 items-end">
                      <textarea
                        rows={2}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (draft.trim() && !pending && !controlBusy && !selectedSendLocked) {
                              send(selected);
                            }
                          }
                        }}
                        placeholder={
                          selected.assistantPaused
                            ? (locale === "ar" ? "اكتب ردك للعميل عبر واتساب (Enter للإرسال)..." : "Type reply to customer (Enter to send)...")
                            : (locale === "ar" ? "اكتب ردك للتدخل يدويًا ومراسلة العميل..." : "Type reply to take over and message customer...")
                        }
                        aria-label={copy.app.reply}
                        disabled={pending || controlBusy}
                        className="flex-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-2.5 text-xs text-[var(--color-on-dark)] placeholder:text-[var(--color-muted-soft)] focus:ring-2 focus:ring-[#38dc89] outline-none disabled:opacity-60 resize-none transition"
                      />
                      <Button
                        type="submit"
                        disabled={!draft.trim() || pending || controlBusy || selectedSendLocked || !liveIds.has(selected.id)}
                        className="shrink-0 min-h-10 px-4 text-xs font-bold gap-1.5"
                      >
                        <span>📨</span>
                        <span>{copy.app.sendReply}</span>
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3 text-center text-xs text-[var(--color-muted-soft)]">
                    {copy.app.sendForbidden}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#38dc89]/20 to-[#1d7d4c]/10 border border-[#38dc89]/30 flex items-center justify-center text-3xl mb-4 shadow-sm">
                💬
              </div>
              <h3 className="font-bold text-base text-[var(--color-on-dark)] mb-1 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                {copy.app.selectConversation}
              </h3>
              <p className="text-xs text-[var(--color-muted-on-dark)] max-w-sm mb-4 leading-5 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                {locale === "ar"
                  ? "اختر أي محادثة من القائمة لمراجعة ردود نورا أو الرد يدويًا ومتابعة حالة العميل."
                  : "Select a conversation from the list to review Noura's responses or take over manually."}
              </p>
              {list[0] ? (
                <Button variant="secondary" onClick={() => select(list[0].id)} className="text-xs">
                  {copy.app.openConversation}
                </Button>
              ) : null}
            </div>
          )}
        </section>

        {/* ============================================================== */}
        {/* COLUMN 3: CUSTOMER DETAILS, NOURA PERSONA & CRM CONTROLS       */}
        {/* ============================================================== */}
        {selected ? (
          <aside
            className={`flex flex-col border-s border-[color:var(--color-line)] bg-[var(--color-panel-deep)]/90 overflow-y-auto p-4 space-y-4 font-[family-name:Tajawal,var(--font-ar),sans-serif] ${
              mobileDetailsOpen
                ? "fixed inset-y-0 end-0 z-50 w-full max-w-sm bg-[var(--color-panel)] shadow-2xl xl:static xl:w-auto xl:shadow-none"
                : "hidden xl:flex"
            }`}
            aria-label={locale === "ar" ? "بيانات العميل والأتمتة" : "Customer & Automation Details"}
          >
            {/* Header with Close Button for Mobile Drawer */}
            <div className="flex items-center justify-between pb-2 border-b border-[color:var(--color-line)]">
              <h3 className="font-bold text-sm text-[var(--color-on-dark)] flex items-center gap-1.5">
                <span>👤</span>
                {locale === "ar" ? "بيانات العميل والأتمتة" : "Customer & AI Details"}
              </h3>
              <button
                type="button"
                onClick={() => setMobileDetailsOpen(false)}
                className="xl:hidden h-8 w-8 rounded-lg border border-[color:var(--color-border-soft)] text-xs text-[var(--color-on-dark)] flex items-center justify-center hover:bg-[var(--color-hover-wash)]"
                aria-label={locale === "ar" ? "إغلاق" : "Close"}
              >
                ✕
              </button>
            </div>

            {/* Card 1: Customer Profile */}
            <div className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#38dc89]/25 to-[#1d7d4c]/30 flex items-center justify-center font-bold text-sm text-[#38dc89] border border-[#38dc89]/40 shrink-0">
                  {selected.customer.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-xs text-[var(--color-on-dark)] truncate">{selected.customer}</p>
                  <p className="text-[11px] text-[var(--color-muted-soft)]">{selected.topic || "واتساب"}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-[color:var(--color-border-soft)] space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-muted-soft)]">{locale === "ar" ? "رقم الهاتف:" : "Phone:"}</span>
                  <div className="flex items-center gap-1.5">
                    <span dir="ltr" className="font-mono text-[11px] font-medium text-[var(--color-on-dark)]">
                      {selected.phone}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyCustomerPhone(selected.phone)}
                      className="text-[10px] text-[#38dc89] hover:underline"
                      title={locale === "ar" ? "نسخ الرقم" : "Copy phone"}
                    >
                      {phoneCopied ? (locale === "ar" ? "تم!" : "Copied!") : "📋"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-muted-soft)]">{locale === "ar" ? "القناة:" : "Channel:"}</span>
                  <span className="font-medium text-[#38dc89]">WhatsApp Cloud API</span>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-muted-soft)]">{locale === "ar" ? "حالة المحادثة:" : "Status:"}</span>
                  <span className="font-medium text-[var(--color-on-dark)]">{copy.app.statuses[selected.status]}</span>
                </div>
              </div>
            </div>

            {/* Card 2: AI Persona (Noura) Card */}
            <div className="rounded-xl border border-[#38dc89]/30 bg-gradient-to-br from-[#0c2e1f]/40 to-[var(--color-panel)] p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xl">✨</span>
                <div>
                  <p className="font-bold text-xs text-[#38dc89]">
                    {locale === "ar" ? "المساعد الذكي: نورا (Noura)" : "AI Persona: Noura"}
                  </p>
                  <p className="text-[10px] text-[var(--color-muted-soft)]">
                    {locale === "ar" ? "مساعدة فيلورا الذكية المعتمدة لشركتك" : "Velora's Official AI Assistant"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-[var(--color-panel-deep)] p-2 text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-muted-soft)]">{locale === "ar" ? "حالة الأتمتة:" : "Automation:"}</span>
                  {selected.assistantPaused ? (
                    <span className="font-bold text-[#f0cf9d]">{locale === "ar" ? "متوقفة مؤقتاً" : "Paused"}</span>
                  ) : (
                    <span className="font-bold text-[#38dc89]">{locale === "ar" ? "نشطة وترد فوراً" : "Active & Replying"}</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-muted-soft)]">
                  <span>{locale === "ar" ? "المعرفة المعتمدة:" : "Knowledge base:"}</span>
                  <span className="text-[#38dc89] font-medium">{locale === "ar" ? "متزامنة 🧠" : "Synced 🧠"}</span>
                </div>
              </div>

              {liveIds.has(selected.id) ? (
                <div className="flex flex-col gap-1.5 pt-1">
                  {selected.assistantPaused ? (
                    <button
                      type="button"
                      disabled={controlBusy || pending || selectedUnresolved}
                      onClick={() => runControl(selected, "resume")}
                      className="w-full inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[#38dc89]/50 bg-[#38dc89]/20 text-xs font-bold text-[#38dc89] hover:bg-[#38dc89]/30 transition disabled:opacity-50"
                    >
                      <span>🤖</span>
                      <span>{locale === "ar" ? "إعادة تشغيل نورا" : "Activate Noura"}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={controlBusy || pending || selectedUnresolved}
                      onClick={() => runControl(selected, "take_over")}
                      className="w-full inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[#d9a467]/50 bg-[#d9a467]/20 text-xs font-bold text-[#f0cf9d] hover:bg-[#d9a467]/30 transition disabled:opacity-50"
                    >
                      <span>👤</span>
                      <span>{locale === "ar" ? "استلام المحادثة يدويًا" : "Take Over Manually"}</span>
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Card 3: Lead & CRM Follow-up Panel */}
            <div className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-3">
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
            </div>

            {/* Card 4: Channel & Subscription Health */}
            <div className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3 text-[11px] space-y-1.5">
              <p className="font-bold text-xs text-[var(--color-on-dark)] flex items-center gap-1.5">
                <span>🛡️</span>
                {locale === "ar" ? "حالة الاشتراك والربط" : "Subscription & Integration"}
              </p>
              <div className="flex items-center justify-between text-[var(--color-muted-soft)]">
                <span>{locale === "ar" ? "باقة الشركة:" : "Plan:"}</span>
                <span className="text-[#38dc89] font-medium">{locale === "ar" ? "نشطة (Velora SaaS)" : "Active (Velora SaaS)"}</span>
              </div>
              <div className="flex items-center justify-between text-[var(--color-muted-soft)]">
                <span>{locale === "ar" ? "حماية البيانات:" : "Tenant Isolation:"}</span>
                <span className="text-[var(--color-on-dark)] font-medium">{locale === "ar" ? "معزولة مشفرة" : "RLS Enforced"}</span>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
