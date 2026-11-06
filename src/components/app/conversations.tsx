"use client";

import Link from "next/link";
import {InboxDesktop,FollowUpPanel,type InboxDesktopView} from "./inbox-desktop";
import {desktopWhatsappMessages} from "./inbox-desktop-adapter";
import {createPortal} from 'react-dom';
import {ComposerTabs,DetailSection,DetailRow,type ComposerMode} from './conversation-presentation';
import {InboxDetailsTabs,type InboxDetailsTab} from './inbox-details-tabs';
import './conversation-workspace.css';
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  replyWhatsappConversation,
  upsertConversationLeadState,
  type ControlAction,
  type ControlState,
  type LeadState,
} from "@/lib/whatsapp/actions";
import {
  refreshWhatsappInboxInitialPage, refreshWhatsappInboxPage, refreshWhatsappThreadPage,
  refreshWhatsappControlAuditPage, refreshWhatsappConnectionStatus, markWhatsappThreadSeen,
} from "@/lib/whatsapp/inbox-actions";
import type { WhatsappInboxItem, WhatsappInboxPage, WhatsappControlAuditPage, WhatsappConnectionStatus } from "@/lib/whatsapp/inbox-contracts";
import { manualReplyBlock, staffHandlesConversation } from "@/lib/whatsapp/inbox-ownership";
import { canUseInboxControl, currentThreadRequest, mergeInboxPageRows, mergeThreadPage, inboxSendLocked, updateInboxPageCache,
  matchesUnifiedInboxFilter, threadReadBoundary, type ThreadView, type UnifiedInboxFilter } from "./conversations-inbox";
import type { WhatsappInboxMeta } from "@/lib/whatsapp/inbox";
import {
  countLeadWorklist,
  MANUAL_LEAD_STAGES,
  matchesLeadWorklist,
  resolveCompanyTimezone,
  type LeadWorklist,
} from "@/lib/whatsapp/leads";
import {
  inboxScopeKey,
  isStaleInboxRefresh,
  selectLiveConversations,
} from "@/lib/whatsapp/live-inbox";
import {
  captureInboxEpoch,
  createInboxAsyncEpoch,
  invalidateInboxOpsOnScopeChange,
  isInboxEpochCurrent,
  runControlActionPath,
  runLeadSavePath,
  runSendReplyPath,
  type InboxAsyncEpochStore,
} from "@/components/app/conversations-async";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import {IconUsers,IconSparkles,IconMenu,IconRocket,IconShield} from "../admin/admin-icons";
import { ChannelBadge } from "./channel-badge";
import {captureTranscriptPosition,restoreTranscriptPosition,type TranscriptPosition} from './transcript-position';
import {useServerDraftField} from './draft-refresh';
import { ChannelAIDraft } from "./channel-ai-draft";
import {ChannelReviewStatus} from './channel-review';
import { Button, Notice, useAppCopy } from "@/components/app/ui";

export type { UnifiedInboxFilter } from "./conversations-inbox";

const WORKLISTS: LeadWorklist[] = [
  "all",
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
  if (state === "accepted") return <span className="text-[10px] text-[var(--color-muted-soft)]">{locale === "ar" ? "قُبلت للإرسال" : "Accepted"}</span>;
  if (state === "read") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[var(--service-accent)]" title={locale === "ar" ? "تمت القراءة" : "Read"}>
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
  notesHost,
  reference=false,
  timezone,
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
  reference?:boolean;
  timezone?:string|null;
  notesHost?: HTMLElement | null;
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
  const stageField=useServerDraftField<LeadStage>(conversation.leadStage??'new');
  const reasonField=useServerDraftField(conversation.leadStageReason??'');
  const noteField=useServerDraftField(conversation.internalNote??'');
  const followUpField=useServerDraftField<FollowUpStatus>(conversation.followUpStatus??'none');
  const dateField=useServerDraftField(toDatetimeLocalValue(conversation.followUpAt));
  const assignmentField=useServerDraftField(conversation.assignedTo??'');
  const leadStageDraft=stageField.value,setLeadStageDraft=stageField.setValue;
  const leadReasonDraft=reasonField.value,setLeadReasonDraft=reasonField.setValue;
  const leadNoteDraft=noteField.value,setLeadNoteDraft=noteField.setValue;
  const followUpStatusDraft=followUpField.value,setFollowUpStatusDraft=followUpField.setValue;
  const followUpAtDraft=dateField.value,setFollowUpAtDraft=dateField.setValue;
  const assignDraft=assignmentField.value,setAssignDraft=assignmentField.setValue;
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

  const notesEditor=(notesHost ? createPortal(<div className="conversation-note-editor">
        <label className="grid gap-1"><span>{copy.leadNoteLabel}</span><textarea rows={3} value={leadNoteDraft} disabled={disabled} onChange={e=>setLeadNoteDraft(e.target.value)} aria-label={copy.leadNoteLabel}/></label>
        <div className="conversation-note-actions"><p>{locale==='ar'?'داخلية للفريق فقط · لا تُرسل للعميل':'For your team only · never sent to the customer'}</p><Button type="button" variant="secondary" busy={leadBusy} disabled={disabled} onClick={()=>void saveLead()}>{copy.leadSave}</Button></div>
      </div>,notesHost) : <label className="grid gap-1">
        <span className="font-medium text-[var(--color-muted-on-dark)]">{copy.leadNoteLabel}</span>
        <textarea
          rows={2}
          value={leadNoteDraft}
          disabled={disabled}
          onChange={(e) => setLeadNoteDraft(e.target.value)}
          placeholder={locale === "ar" ? "ملاحظات داخلية لفريق العمل..." : "Internal team notes..."}
          className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none disabled:opacity-60 resize-none"
        />
      </label>);
  const assignmentEditor=(canAssign && assignees.length ? (
        <div className="mt-3 pt-3 border-t border-[color:var(--color-border-soft)]">
          <label className="grid gap-1">
            <span className="font-medium text-[var(--color-muted-on-dark)]">{copy.leadAssigneeLabel}</span>
            <div className="flex gap-1.5">
              <select
                value={assignDraft}
                disabled={!live || busyControl || pending || selectedUnresolved}
                onChange={(e) => setAssignDraft(e.target.value)}
                className="min-h-9 flex-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none disabled:opacity-60"
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
      ) : null);
  if(reference)return <div>
    <FollowUpPanel ar={locale==='ar'} model={{values:{stage:leadStageDraft,reason:leadReasonDraft,status:followUpStatusDraft,at:followUpAtDraft},stages:MANUAL_LEAD_STAGES.map(id=>({id,label:copy.leadStages[id]})),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,disabled,pending:leadBusy,
      onChange:patch=>{if(patch.stage!==undefined)setLeadStageDraft(patch.stage as LeadStage);if(patch.reason!==undefined)setLeadReasonDraft(patch.reason);if(patch.status!==undefined)setFollowUpStatusDraft(patch.status as FollowUpStatus);if(patch.at!==undefined)setFollowUpAtDraft(patch.at);},onSave:()=>void saveLead(),
      complete:followUpStatusDraft==='scheduled'?{id:'complete',label:copy.leadComplete,icon:'check',onClick:()=>void saveLead('completed')}:undefined,
      cancel:followUpStatusDraft==='scheduled'?{id:'cancel',label:copy.leadCancel,icon:'close',onClick:()=>void saveLead('cancelled')}:undefined,
    }}/>
    {timezone&&resolveCompanyTimezone(timezone).zone!==Intl.DateTimeFormat().resolvedOptions().timeZone&&<p className="vdi-muted">{locale==='ar'?'توقيت النشاط: ':'Business timezone: '}{resolveCompanyTimezone(timezone).zone}</p>}
    {timezoneAnnouncedUtc&&<p className="vdi-muted">{copy.timezoneUtcNotice}</p>}
    {notesEditor}{assignmentEditor}
  </div>;
  return (
    <div className="space-y-4 text-xs font-[family-name:Tajawal,var(--font-ar),sans-serif]">

      <div className="flex items-center justify-between border-b border-[color:var(--color-border-soft)] pb-2">
        <h4 className="font-bold text-sm text-[var(--color-on-dark)] flex items-center gap-1.5">
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
          className="min-h-9 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none disabled:opacity-60"
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
            className="min-h-9 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none disabled:opacity-60"
          />
        </label>
      ) : null}

      {notesEditor}

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
              className="min-h-9 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none disabled:opacity-60"
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
              className="inline-flex min-h-7 items-center rounded-lg border border-[var(--service-accent)]/40 bg-[var(--service-accent)]/15 px-2.5 text-[11px] font-medium text-[#9af0c3] hover:bg-[var(--service-accent)]/25 disabled:opacity-50"
            >
              {copy.leadSchedule}
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
                className="inline-flex min-h-7 items-center rounded-lg border border-[var(--service-accent)]/40 bg-[var(--service-accent)]/15 px-2.5 text-[11px] font-medium text-[#9af0c3] hover:bg-[var(--service-accent)]/25 disabled:opacity-50"
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

      {assignmentEditor}
    </div>
  );
}

export function ConversationsPage({
  forbidden,
  loadFailed,
  noCompany,
  meta,
  page,
  reviewCompanyId,
  embedded = false,
  selectedConversationId,
  onSelectConversation,
  refreshVersion = 0,
  draftActorId,
  readSuspended = false,
  connectionPaused=false,
  onConnectionUnavailable,
  threadReader = refreshWhatsappThreadPage,
  desktopView,
}: {
  inbox: Conversation[];
  forbidden?: boolean;
  loadFailed?: boolean;
  noCompany?: boolean;
  meta?: WhatsappInboxMeta;
  page?: WhatsappInboxPage;
  reviewCompanyId?: string;
  embedded?: boolean;
  selectedConversationId?: string | null;
  onSelectConversation?: (id:string|null)=>void;
  refreshVersion?:number;
  /** Current actor, used only to keep this browser's unsent draft separate from another user. */
  draftActorId?: string;
  readSuspended?:boolean;
  connectionPaused?:boolean;
  onConnectionUnavailable?:()=>void;
  threadReader?:typeof refreshWhatsappThreadPage;
  desktopView?:InboxDesktopView;
}) {
  const [threadTransportPaused,setThreadTransportPaused]=useState(false);
  const writesPaused=connectionPaused||threadTransportPaused;
  const suspendedRef=useRef(readSuspended||writesPaused);suspendedRef.current=readSuspended||writesPaused;
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedParam = embedded ? selectedConversationId ?? null : searchParams.get("c");
  const [detailsTab,setDetailsTab]=useState<InboxDetailsTab>('details');
  const [connectionDetailsOpen,setConnectionDetailsOpen]=useState(false);

  const [serverInbox, setServerInbox] = useState<WhatsappInboxItem[]>(page?.conversations ?? []);
  const [localInbox, setLocalInbox] = useState<Record<string, WhatsappInboxItem>>({});
  const [inboxMeta, setInboxMeta] = useState<WhatsappInboxMeta | undefined>(meta);
  const [inboxPage, setInboxPage] = useState(page);
  const inboxPageRef = useRef(page);
  const [readCacheGeneration, setReadCacheGeneration] = useState(0);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxDenied, setInboxDenied] = useState(false);
  const accessDenied = forbidden || inboxDenied;
  const [inboxReadError, setInboxReadError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState({ page, meta, forbidden, loadFailed, noCompany });
  if (routeResult.page !== page || routeResult.meta !== meta || routeResult.forbidden !== forbidden
    || routeResult.loadFailed !== loadFailed || routeResult.noCompany !== noCompany) {
    // Route hydration supersedes the previous client refresh before children render.
    setRouteResult({ page, meta, forbidden, loadFailed, noCompany });
    setInboxDenied(false);
    setInboxReadError(null);
  }
  const [threads, setThreads] = useState<Record<string, ThreadView>>({});
  const threadsRef = useRef<Record<string, ThreadView>>({});
  const [threadBusyId, setThreadBusyId] = useState<string | null>(null);
  const threadInFlightRef = useRef<string | null>(null);
  const pendingThreadRefreshRef = useRef<string | null>(null);
  const [readyThreadId, setReadyThreadId] = useState<string | null>(null);
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  const [connection, setConnection] = useState<WhatsappConnectionStatus | null>(null);
  const [audits, setAudits] = useState<Record<string, WhatsappControlAuditPage>>({});
  const auditGenRef = useRef(0);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const seenRequestsRef = useRef(new Set<string>());
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<UnifiedInboxFilter>(() => {
    const requested = searchParams.get("filter");
    return requested === "unread" || requested === "noura" || requested === "staff" || requested === "resolved" ? requested : "all";
  });
  const [worklist, setWorklist] = useState<LeadWorklist>("all");
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const draftKey = `${meta?.companyId}:${meta?.conversationScope}:${selectedParam}`;
  const draft = drafts[draftKey] ?? "";
  const setDraft = (value:string) => setDrafts(old=>({...old,[draftKey]:value}));
  const draftStorageKey = draftActorId && selectedParam ? `velora-inbox-draft:${draftActorId}:${selectedParam}` : null;
  const loadedDraftKey = useRef<string | null>(null);
  useEffect(() => {
    if (!draftStorageKey || loadedDraftKey.current === draftStorageKey) return;
    loadedDraftKey.current = draftStorageKey;
    const key = draftStorageKey;
    const conversationKey = draftKey;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = window.localStorage.getItem(key);
        if (saved) setDrafts(old => old[conversationKey] ? old : { ...old, [conversationKey]: saved.slice(0, 4096) });
      } catch { /* A browser draft is not the record of a sent message. */ }
    });
    return () => { cancelled = true; };
  }, [draftStorageKey, draftKey]);
  useEffect(() => {
    if (!draftStorageKey || loadedDraftKey.current !== draftStorageKey) return;
    const handle = window.setTimeout(() => {
      try {
        if (draft) window.localStorage.setItem(draftStorageKey, draft);
        else window.localStorage.removeItem(draftStorageKey);
      } catch { /* Keep the draft in memory when storage is unavailable. */ }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draftStorageKey, draft]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const pendingActionRef = useRef(false);
  // React transitions elsewhere in the workspace must not delay a send result.
  async function runPendingAction(action: () => Promise<void>) {
    if (pendingActionRef.current) return;
    pendingActionRef.current = true;
    setPending(true);
    try { await action(); }
    finally { pendingActionRef.current = false; setPending(false); }
  }

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
  const selectedId = selectedParam ?? null;
  const [activeSelectionId, setActiveSelectionId] = useState(selectedId);
  if (activeSelectionId !== selectedId) {
    setActiveSelectionId(selectedId);
    if (mobileDetailsOpen) {
      setMobileDetailsOpen(false);
    }
  }
  if (!selectedId && mobileDetailsOpen) {
    setMobileDetailsOpen(false);
  }
  const detailsRef=useRef<HTMLElement>(null);
  const scrollPositions=useRef<Record<string,TranscriptPosition>>({});
  useEffect(()=>{
    if(!mobileDetailsOpen || !selectedId)return;
    const previous=document.activeElement as HTMLElement|null,oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    detailsRef.current?.querySelector<HTMLElement>('button')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setMobileDetailsOpen(false);return;}
      if(event.key!=='Tab')return;
      const elements=[...detailsRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')??[]].filter(el=>el.getClientRects().length>0);
      const first=elements[0],last=elements.at(-1);if(!first||!last)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    const resize=()=>{if(window.innerWidth >= 1280)setMobileDetailsOpen(false);};
    document.addEventListener('keydown',key);window.addEventListener('resize',resize);
    return()=>{
      document.body.style.overflow=oldOverflow;
      document.removeEventListener('keydown',key);
      window.removeEventListener('resize',resize);
      if(previous && previous.isConnected && !previous.closest('[inert], [hidden], [aria-hidden="true"]')){
        previous.focus();
      } else {
        const candidates = document.querySelectorAll<HTMLElement>(
          'main button:not([disabled]):not([tabindex="-1"]), [data-inbox-desktop-v2] button:not([disabled]):not([tabindex="-1"]), [data-conversation-thread="true"] button:not([disabled]):not([tabindex="-1"]), input[type="search"]:not([disabled])'
        );
        for (const candidate of candidates) {
          if (candidate.isConnected && !candidate.closest('[inert], [hidden], [aria-hidden="true"]') && candidate.style.display !== 'none' && candidate.style.visibility !== 'hidden') {
            candidate.focus();
            break;
          }
        }
      }
    };
  },[mobileDetailsOpen,embedded,selectedId]);
  const [phoneCopyResult,setPhoneCopyResult]=useState<{key:string;copied:boolean}|null>(null);
  const phoneCopied=phoneCopyResult?.key===draftKey&&phoneCopyResult.copied;
  const phoneCopyFailed=phoneCopyResult?.key===draftKey&&!phoneCopyResult.copied;
  const [composerModes,setComposerModes]=useState<Record<string,ComposerMode>>({});
  const requestedComposerMode=composerModes[draftKey]??'message';
  const setComposerMode=(mode:ComposerMode)=>setComposerModes(old=>({...old,[draftKey]:mode}));
  const [notesHost,setNotesHost]=useState<HTMLDivElement|null>(null);

  const epochStoreRef = useRef<InboxAsyncEpochStore>({
    current: createInboxAsyncEpoch(meta?.companyId ? inboxScopeKey(meta.companyId, meta.conversationScope) : null),
  });

  const inboxScope = inboxMeta?.companyId ? inboxScopeKey(inboxMeta.companyId, inboxMeta.conversationScope) : null;
  const snapshotRef = useRef<{
    base: WhatsappInboxItem[];
    overrides: Record<string, WhatsappInboxItem>;
    scopeKey: string | null;
  }>({
    base: page?.conversations ?? [],
    overrides: {},
    scopeKey: inboxScope,
  });

  const readGenById = useRef<Record<string, number>>({});
  const sendOpByConversation = useRef<Record<string, { clientOpId: string; body: string; attachmentId?: string }>>({});
  const inboxRefreshGen = useRef(0);

  const canReply = !readSuspended && !writesPaused && inboxMeta?.canReply === true;
  const testReview=!!reviewCompanyId&&inboxMeta?.companyId===reviewCompanyId;
  const canAssign = inboxMeta?.canAssign === true;
  const assignees = inboxMeta?.assignees ?? [];
  const timezone = inboxMeta?.timezone ?? null;

  const liveIds = useMemo(() => new Set(serverInbox.map((c) => c.id)), [serverInbox]);
  const selectedIdRef = useRef(selectedId);
  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const selectionKey = `${inboxScope ?? ""}:${selectedId ?? ""}:${readCacheGeneration}`;
  const [renderedSelection, setRenderedSelection] = useState(selectionKey);
  if (renderedSelection !== selectionKey) {
    setRenderedSelection(selectionKey);
    setReadyThreadId(null);
    setNotice(null); setError(null); setWarn(null);
    setAuditBusy(false); setAuditError(null);
  }

  function isSelected(id: string) {
    return id === selectedIdRef.current;
  }

  function commitSnapshot(
    next: { base: WhatsappInboxItem[]; overrides: Record<string, WhatsappInboxItem>; scopeKey: string | null },
  ) {
    snapshotRef.current = next;
    setServerInbox(next.base);
    setLocalInbox(next.overrides);
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
    setDrafts({});
    pendingThreadRefreshRef.current = null;
    threadsRef.current = {};
    setThreads({});
    setThreadErrors({});
    setThreadBusyId(null);
    setReadyThreadId(null);
    setInboxBusy(false);
    setInboxReadError(null);
    setInboxDenied(false);
    setConnection(null);
    setAudits({});
    auditGenRef.current += 1;
    setAuditBusy(false);
    setAuditError(null);
    seenRequestsRef.current.clear();
    inboxPageRef.current = undefined;
  }

  function invalidateAllInboxOps(nextScopeKey: string | null) {
    inboxRefreshGen.current += 1;
    invalidateInboxOpsOnScopeChange(epochStoreRef.current, nextScopeKey);
    for (const id of Object.keys(readGenById.current)) {
      readGenById.current[id] = (readGenById.current[id] ?? 0) + 1;
    }
  }

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const intervalId = window.setInterval(tick, 30_000);
    const onVisibility = () => {
      setVisible(document.visibilityState === "visible");
      if (document.visibilityState === "visible") tick();
    };
    onVisibility();
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
      commitSnapshot({ base: [], overrides: {}, scopeKey: null });
      setInboxPage(undefined);
      setInboxMeta(meta);
      return;
    }
    const key = inboxScopeKey(meta.companyId, meta.conversationScope);
    if (snapshotRef.current.scopeKey === key) {
      setInboxMeta(meta);
      if (page) applyPage(page);
      return;
    }
    invalidateAllInboxOps(key);
    clearCompanyEphemeralState();
    commitSnapshot({ base: page?.conversations ?? [], overrides: {}, scopeKey: key });
    inboxPageRef.current = page;
    setInboxPage(page);
    setInboxMeta(meta);
    // New route props own hydration; applyPage reads the current snapshot ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, meta, forbidden, loadFailed, noCompany]);

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

  const filterCounts = { all: inboxPage?.total, unread: inboxPage?.unreadTotal, staff: inboxPage?.interventionTotal };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!matchesUnifiedInboxFilter(c, activeFilter)) return false;

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

  const selectedThread = selectedId ? threads[selectedId] : undefined;
  const selectedRow = conversations.find((c) => c.id === selectedId) ?? (selectedId && selectedThread?.conversation.id === selectedId ? selectedThread.conversation : null);
  const selected = selectedRow ? { ...selectedRow, messages: selectedThread?.messages ?? [] } : null;
  const contactPhone=selected?.phone.replace(/[ ()-]/g,'')??'';
  const hasContactPhone=/^\+?[1-9]\d{6,14}$/.test(contactPhone);
  const selectedReady = Boolean(selectedThread && readyThreadId === selectedId && selectedId && !threadErrors[selectedId]);
  const handledByStaff = selected ? staffHandlesConversation(selected) : false;

  const select = (id: string | null) =>
    embedded ? onSelectConversation?.(id) : router.replace(id ? `/app/conversations?c=${id}` : "/app/conversations");

  const patch = (id: string, fn: (c: WhatsappInboxItem) => Partial<WhatsappInboxItem>) => {
    const current = snapshotRef.current;
    const base = current.overrides[id] ?? current.base.find((item) => item.id === id);
    if (base) commitSnapshot({ ...current, overrides: { ...current.overrides, [id]: { ...base, ...fn(base) } } });
  };

  function applyPage(nextPage: WhatsappInboxPage, older = false) {
    const current = snapshotRef.current;
    const key = inboxScopeKey(nextPage.companyId, nextPage.conversationScope);
    if (current.scopeKey !== key) return;
    const cache = updateInboxPageCache({ page: inboxPageRef.current,
      rows: selectLiveConversations(current.base, current.overrides), threads: threadsRef.current, audits,
      sendOperations: sendOpByConversation.current, unknownSends: unresolvedSends }, nextPage, older);
    if (cache.membershipChanged) {
      invalidateAllInboxOps(key);
      threadsRef.current = cache.threads;
      setThreads(cache.threads);
      setAudits(cache.audits);
      auditGenRef.current += 1;
      setAuditBusy(false); setAuditError(null);
      setInboxBusy(false);
      setThreadErrors({}); setThreadBusyId(null); setReadyThreadId(null);
      setUnresolvedSends(currentLocks => ({ ...currentLocks, ...cache.unknownSends }));
      if (controlBusyIdRef.current) markUnresolved(controlBusyIdRef.current);
      controlBusyIdRef.current = null;
      setControlBusy(false); setControlBusyId(null);
      seenRequestsRef.current.clear();
      setReadCacheGeneration(generation => generation + 1);
    }
    commitSnapshot({ base: cache.rows, overrides: {}, scopeKey: key });
    inboxPageRef.current = cache.page;
    setInboxPage(cache.page);
  }

  async function refreshInboxView(before?: string | null): Promise<boolean> {
    const companyId = inboxMeta?.companyId;
    if (!companyId) return false;
    const requestGen = inboxRefreshGen.current + 1;
    inboxRefreshGen.current = requestGen;
    const requestEpoch = captureInboxEpoch(epochStoreRef.current);
    const requestScopeKey = requestEpoch.scopeKey;
    setInboxBusy(true);
    setInboxReadError(null);
    try {
      const loaded = before
        ? await refreshWhatsappInboxPage({ companyId, before })
        : await refreshWhatsappInboxInitialPage();
      if (!isInboxEpochCurrent(requestEpoch, epochStoreRef.current.current)) return false;
      if (requestGen !== inboxRefreshGen.current) return false;
      if (!loaded.ok) {
        setReadyThreadId(null);
        if (loaded.code === "NO_COMPANY" || loaded.code === "SCOPE_CHANGED" || loaded.code === "FORBIDDEN") {
          invalidateAllInboxOps(null);
          clearCompanyEphemeralState();
          commitSnapshot({ base: [], overrides: {}, scopeKey: null });
          setInboxPage(undefined);
          setInboxMeta(undefined);
          router.refresh();
        }
        setInboxDenied(loaded.code === "FORBIDDEN");
        setInboxReadError(loaded.code === "FORBIDDEN" ? copy.app.inboxAccessDeniedBody : copy.app.inboxLoadFailedBody);
        return false;
      }
      const nextPage = "page" in loaded ? loaded.page : loaded.data;
      const responseScopeKey = inboxScopeKey(
        nextPage.companyId,
        nextPage.conversationScope,
      );
      if (responseScopeKey !== requestScopeKey) {
        invalidateAllInboxOps(null);
        clearCompanyEphemeralState();
        commitSnapshot({ base: [], overrides: {}, scopeKey: null });
        setInboxPage(undefined);
        setInboxMeta(undefined);
        setInboxReadError(copy.app.inboxLoadFailedBody);
        router.refresh();
        return false;
      }
      if (before && inboxPageRef.current?.membershipFingerprint !== nextPage.membershipFingerprint) return refreshInboxView();
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
      setInboxDenied(false);
      applyPage(nextPage, Boolean(before));
      if ("meta" in loaded) setInboxMeta(loaded.meta);
      return true;
    } catch {
      if (isInboxEpochCurrent(requestEpoch, epochStoreRef.current.current) && requestGen === inboxRefreshGen.current)
        setInboxReadError(copy.app.inboxLoadFailedBody);
      return false;
    } finally {
      if (isInboxEpochCurrent(requestEpoch, epochStoreRef.current.current) && requestGen === inboxRefreshGen.current) setInboxBusy(false);
    }
  }

  function removeInaccessibleThread(id: string) {
    const current = snapshotRef.current;
    const overrides = { ...current.overrides };
    delete overrides[id];
    commitSnapshot({ ...current, base: current.base.filter(row => row.id !== id), overrides });
    delete threadsRef.current[id];
    setThreads({ ...threadsRef.current });
    // Saved send IDs/unknown-outcome locks survive lost access; a read is never a resend authorization.
  }

  async function loadThread(conversationId: string, before?: string | null, selectedOnly = true, background = false): Promise<boolean> {
    const companyId = inboxMeta?.companyId;
    if (!companyId || !snapshotRef.current.scopeKey) return false;
    const request = captureInboxEpoch(epochStoreRef.current);
    const generation = bumpReadGeneration(conversationId);
    const stillCurrent = () => currentThreadRequest({ request, current: epochStoreRef.current.current,
      generation, currentGeneration: readGenById.current[conversationId], conversationId,
      ...(selectedOnly ? { selectedId: selectedIdRef.current } : {}) });
    threadInFlightRef.current = conversationId;
    setThreadBusyId(conversationId);
    // Keep an already verified draft usable during polling. Initial/explicit reads
    // still block; failed reads lock via threadErrors, and every send reauthorizes server-side.
    if (!background && selectedIdRef.current === conversationId && !(readyThreadId===conversationId && threadsRef.current[conversationId] && !threadErrors[conversationId])) setReadyThreadId(null);
    setThreadErrors(current => { const next = { ...current }; delete next[conversationId]; return next; });
    try {
      const result = await threadReader({ companyId, conversationId, before });
      if (!stillCurrent()) return false;
      if(!result.ok&&'transportUnavailable' in result&&result.transportUnavailable===true){setThreadTransportPaused(true);onConnectionUnavailable?.();return false;}
      if (!result.ok) {
        if (selectedIdRef.current === conversationId) setReadyThreadId(null);
        if (result.code === "NOT_FOUND" || result.code === "FORBIDDEN" || result.code === "SCOPE_CHANGED") removeInaccessibleThread(conversationId);
        setThreadErrors(current => ({ ...current, [conversationId]: copy.app.controlRefreshFailed }));
        return false;
      }
      const view = mergeThreadPage(threadsRef.current[conversationId], result.data, before);
      threadsRef.current = { ...threadsRef.current, [conversationId]: view };
      setThreadTransportPaused(false);
      setThreads(threadsRef.current);
      if (selectedIdRef.current === conversationId) setReadyThreadId(conversationId);
      if (!before) {
        const current = snapshotRef.current;
        commitSnapshot({ base: mergeInboxPageRows(selectLiveConversations(current.base, current.overrides), [result.data.conversation]),
          overrides: {}, scopeKey: current.scopeKey });
      }
      return true;
    } catch {
      if (stillCurrent()) {
        if (selectedIdRef.current === conversationId) setReadyThreadId(null);
        setThreadErrors(current => ({ ...current, [conversationId]: copy.app.controlRefreshFailed }));
      }
      return false;
    } finally {
      if (stillCurrent()) {
        threadInFlightRef.current = null;
        setThreadBusyId(current => current === conversationId ? null : current);
        if(pendingThreadRefreshRef.current===conversationId && selectedIdRef.current===conversationId && !suspendedRef.current){
          pendingThreadRefreshRef.current=null;
          void loadThread(conversationId,undefined,true,true);
        }
      }
    }
  }

  async function loadAudit(conversationId: string, before?: string | null) {
    const companyId = inboxMeta?.companyId;
    if (!companyId) return;
    const request = captureInboxEpoch(epochStoreRef.current);
    const generation = ++auditGenRef.current;
    const stillCurrent = () => isInboxEpochCurrent(request, epochStoreRef.current.current)
      && generation === auditGenRef.current && selectedIdRef.current === conversationId;
    setAuditBusy(true);
    setAuditError(null);
    try {
      const result = await refreshWhatsappControlAuditPage({ companyId, conversationId, limit: 10, before });
      if (!stillCurrent()) return;
      if (!result.ok) { setAuditError(locale === "ar" ? "تعذر تحديث سجل التحكم." : "Control history could not be refreshed."); return; }
      setAudits(current => {
        const events = new Map((before ? current[conversationId]?.events ?? [] : []).map(event => [event.id, event]));
        for (const event of result.data.events) events.set(event.id, event);
        return { ...current, [conversationId]: { ...result.data, events: [...events.values()].sort((a, b) =>
          BigInt(a.eventSequence) > BigInt(b.eventSequence) ? -1 : BigInt(a.eventSequence) < BigInt(b.eventSequence) ? 1 : 0) } };
      });
    } catch { if (stillCurrent()) setAuditError(locale === "ar" ? "تعذر تحديث سجل التحكم." : "Control history could not be refreshed."); }
    finally { if (stillCurrent()) setAuditBusy(false); }
  }

  useEffect(() => {
    if (!selectedId || !inboxMeta?.companyId) return;
    // Reads own thread/audit busy states; they must not hold the send transition.
    void (async () => {
      const loaded = await loadThread(selectedId);
      if (loaded && selectedIdRef.current === selectedId) await loadAudit(selectedId);
    })();
    return () => { bumpReadGeneration(selectedId); auditGenRef.current += 1; };
    // Identity changes own the request; render-only page updates must not refetch the same thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, inboxScope, readCacheGeneration]);

  useEffect(() => {
    if (!refreshVersion || !selectedId || !inboxMeta?.companyId) return;
    if(threadInFlightRef.current === selectedId){pendingThreadRefreshRef.current=selectedId;return;}
    // A periodic refresh must not invalidate a slower in-flight read forever.
    void (async () => {
      const loaded = await loadThread(selectedId, undefined, true, true);
      if (loaded && selectedIdRef.current === selectedId) await loadAudit(selectedId);
    })();
    // Identity changes are fenced by the effect above; this effect owns refresh ticks only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshVersion]);

  async function refreshConnection() {
    const companyId = inboxMeta?.companyId;
    if (!companyId) return;
    const request = captureInboxEpoch(epochStoreRef.current);
    try {
      const result = await refreshWhatsappConnectionStatus({ companyId });
      if (isInboxEpochCurrent(request, epochStoreRef.current.current)) setConnection(result.ok ? result.data : null);
    } catch { if (isInboxEpochCurrent(request, epochStoreRef.current.current)) setConnection(null); }
  }
  useEffect(() => {
    void Promise.resolve().then(refreshConnection);
    // Workspace identity owns this read; status is also refreshed deliberately from the header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxMeta?.companyId, inboxScope]);

  useEffect(() => {
    const boundary = threadReadBoundary(selectedThread, selectedId, visible);
    if (readSuspended || writesPaused || !boundary || !selectedThread || !selectedReady) return;
    const request = captureInboxEpoch(epochStoreRef.current);
    const generation = readGenById.current[selectedThread.conversationId];
    const acknowledgementKey = `${request.opGen}:${selectedThread.conversationId}:${boundary}`;
    if (seenRequestsRef.current.has(acknowledgementKey)) return;
    // Two animation frames ensure the committed latest page can be painted before acknowledgement.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (document.visibilityState !== "visible" || !currentThreadRequest({ request, current: epochStoreRef.current.current,
          generation, currentGeneration: readGenById.current[selectedThread.conversationId], conversationId: selectedThread.conversationId,
          selectedId: selectedIdRef.current })) return;
        seenRequestsRef.current.add(acknowledgementKey);
        void (async () => {
          let result;
          try { result = await markWhatsappThreadSeen({ companyId: selectedThread.companyId,
            conversationId: selectedThread.conversationId, displayedInboundMessageId: boundary }); }
          catch { result = { ok: false as const, code: "UNAVAILABLE" as const }; }
          if (!result.ok) seenRequestsRef.current.delete(acknowledgementKey);
          if (!currentThreadRequest({ request, current: epochStoreRef.current.current, generation,
            currentGeneration: readGenById.current[selectedThread.conversationId], conversationId: selectedThread.conversationId,
            selectedId: selectedIdRef.current })) return;
          if (!result.ok) {
            if (result.code === "CONFLICT") await loadThread(selectedThread.conversationId);
            else setWarn(locale === "ar" ? "تعذر حفظ حالة القراءة. حدّث المحادثة للمحاولة مجدداً." : "Read status could not be saved. Refresh the thread to retry.");
            return;
          }
          patch(selectedThread.conversationId, () => ({ unreadCount: result.data.unreadCount } as Partial<WhatsappInboxItem>));
          if(!embedded)await refreshInboxView();
        })();
      });
    });
    return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
    // A new latest page owns a new acknowledgement; loading history never creates one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedThread?.readVersion, selectedReady, visible, inboxScope, readSuspended, writesPaused]);

  function send(c: Conversation, attachmentId?: string, onAccepted?: () => void) {
    if(suspendedRef.current)return;
    const draftText = draft.trim();
    const locked = inboxSendLocked(snapshotRef.current.base.find(row => row.id === c.id), Boolean(unresolvedSends[c.id]));
    if ((!draftText && !attachmentId) || !canReply || !staffHandlesConversation(c) || !selectedReady || pending || controlBusy || locked) return;
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
    const boundAttachment=existing?.attachmentId??attachmentId;
    sendOpByConversation.current[c.id] = { clientOpId, body, attachmentId:boundAttachment };

    runPendingAction(async () => {
      await runSendReplyPath({
        store: epochStoreRef.current,
        conversationId: c.id,
        send: () => replyWhatsappConversation({ conversationId: c.id, body, clientOpId, ...(boundAttachment?{attachmentId:boundAttachment}:{}) }),
        onThrow: () => {
          setUnresolvedSends((prev) => ({ ...prev, [c.id]: true }));
          if (isSelected(c.id)) setError(copy.app.sendUnknownOutcome);
        },
        onResult: async (result) => {
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
              result.code === "SUBSCRIPTION_INACTIVE" || (result.code === "REJECTED" && result.notAttempted && result.message === "paid_entitlement_unconfirmed")
                ? locale === "ar"
                  ? "يتطلب الإرسال اشتراكًا مدفوعًا ساريًا ومؤكدًا. تحقق من حالة الاشتراك في الإعدادات."
                  : "Sending requires a current verified paid subscription. Check the subscription state in Settings."
                : result.code === "SEND_DISABLED"
                ? copy.app.sendDisabled
                : result.code === "NOT_CONFIGURED"
                  ? copy.app.sendNotConfigured
                  : result.code === "PHONE_MISMATCH"
                    ? copy.app.sendPhoneMismatch
                    : result.code === "COMPANY_SUSPENDED"
                      ? copy.app.sendCompanySuspended
                      : result.code === "REJECTED"
                        ? copy.app.sendRejected
                        : result.code === "FORBIDDEN" && result.message === "human_control_required"
                          ? (locale === "ar" ? "استلم المحادثة أولًا قبل إرسال رد يدوي." : "Take over the conversation before sending a manual reply.")
                        : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
                          ? copy.app.sendForbidden
                          : copy.app.sendFailed;
            if (isSelected(c.id)) setError(message);
            return;
          }
          delete sendOpByConversation.current[c.id];
          if(boundAttachment)onAccepted?.();
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
          setDrafts(old=>old[draftKey]===body?{...old,[draftKey]:''}:old);
          if (isSelected(c.id)) setNotice(copy.app.sentNote);
          await syncControlView(c.id);
        },
      });
    });
  }

  async function syncControlView(conversationId: string): Promise<boolean> {
    const loaded = await loadThread(conversationId, null, false);
    if (loaded && selectedIdRef.current === conversationId) await loadAudit(conversationId);
    return loaded;
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

  function runControl(c: Conversation, action: ControlAction, assigneeUserId?: string | null) {
    if (suspendedRef.current || !canUseInboxControl(inboxMeta, action) || !selectedReady || !liveIds.has(c.id) || controlBusy || pending) return;
    if (unresolvedOutcomes[c.id]) return;
    if (action === "assign" && assigneeUserId === undefined) return;

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
          ...(action === "assign" ? { assigneeUserId: assigneeUserId ?? null } : {}),
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
          if (result.code === "REVIEW_BLOCKED") {
            clearUnresolved(c.id);
            if (isSelected(c.id)) setError(locale === "ar" ? "لا يمكن إعادة المحادثة إلى فيلورا بينما توجد نتيجة إرسال غير مؤكدة." : "Velora cannot resume while an earlier send result is unconfirmed.");
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
        patch(c.id, (cur) => {
          const next = applyControlState(cur, result.state);
          if (action === "assign") return { ...next, assignedTo: assigneeUserId ?? null };
          if (action === "take_over" && result.state.status !== "resolved" && result.state.assistantPaused) {
            return { ...next, intervention: { reasons: cur.intervention.reasons.includes("human_control") ? cur.intervention.reasons : [...cur.intervention.reasons, "human_control"] } };
          }
          if (action === "resume") {
            return { ...next, intervention: { reasons: cur.intervention.reasons.filter(reason => reason !== "human_control") } };
          }
          return next;
        });
        if (isSelected(c.id)) {
          if (action === "assign") setNotice(copy.app.leadAssignSaved);
          else if (action === "take_over") setNotice(locale === "ar" ? "تم استلام المحادثة وإيقاف فيلورا مؤقتاً." : "Taken over. Velora auto-reply paused.");
          else if (action === "resume") setNotice(locale === "ar" ? "تم السماح بالأتمتة لهذه المحادثة. يخضع الإرسال لجاهزية التشغيل." : "Automation enabled for this conversation. Sending remains subject to runtime readiness.");
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
  const selectedSendLocked = selected ? inboxSendLocked(selected, Boolean(unresolvedSends[selected.id])) : false;
  const composerMode:ComposerMode=!canReply||(requestedComposerMode==='ai'&&(testReview||!inboxMeta?.companyId||!selected||!liveIds.has(selected.id)))?'message':requestedComposerMode;
  const controlDisabled = (action: ControlAction) => writesPaused || !selectedReady || !canUseInboxControl(inboxMeta, action) || controlBusy || pending || selectedUnresolved;
  const interventionLabels = locale === "ar" ? {
    human_control: "تحكم بشري", worker_review: "مراجعة الأتمتة", worker_failed: "تعذر عمل الأتمتة",
    send_unknown: "نتيجة إرسال غير معروفة — تحتاج مراجعة", send_rejected: "إرسال مرفوض", delivery_failed: "فشل التسليم",
  } : {
    human_control: "Human control", worker_review: "Automation review", worker_failed: "Automation failed",
    send_unknown: "Unknown send outcome — review required", send_rejected: "Send rejected", delivery_failed: "Delivery failed",
  };

  const copyCustomerPhone = useCallback(async(phone:string,key:string) => {
    setPhoneCopyResult(null);
    try {
      if(typeof navigator==='undefined'||!navigator.clipboard)throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(phone);
      setPhoneCopyResult({key,copied:true});
    }catch{setPhoneCopyResult({key,copied:false});}
  }, []);

  // Empty / Load Failed status checks
  const emptyTitle = accessDenied
    ? copy.app.inboxAccessDeniedTitle
    : loadFailed
    ? copy.app.inboxLoadFailed
    : noCompany
      ? copy.app.inboxNoCompany
      : conversations.length === 0
        ? (locale === "ar" ? "لا توجد محادثات واتساب بعد" : "No WhatsApp conversations yet")
        : copy.app.noResults;

  const emptyBody = accessDenied
    ? copy.app.inboxAccessDeniedBody
    : loadFailed
    ? copy.app.inboxLoadFailedBody
    : noCompany
      ? copy.app.inboxNoCompanyBody
      : conversations.length === 0
        ? (locale === "ar"
            ? "تظهر المحادثات هنا عند استقبال رسائل العملاء على رقم WhatsApp Business المرتبط بشركتك."
            : "Conversations appear here when your linked WhatsApp Business number receives customer messages.")
        : undefined;

  const leadPanel=selected?(<LeadFollowUpPanel
                reference={Boolean(desktopView)}
                timezone={timezone}
                notesHost={notesHost}
                key={selected.id}
                conversation={selected}
                copy={copy.app}
                locale={locale}
                canReply={canReply}
                canAssign={canAssign}
                assignees={assignees}
                timezoneAnnouncedUtc={inboxMeta?.timezoneAnnouncedUtc}
                live={!readSuspended && !writesPaused && selectedReady && liveIds.has(selected.id)}
                busyControl={controlBusy && controlBusyId === selected.id}
                pending={pending}
                selectedUnresolved={selectedUnresolved}
                onPatchLead={(state) => patch(selected.id, (cur) => applyLeadState(cur, state))}
                onPatchControl={(state) => patch(selected.id, (cur) => applyControlState(cur, state))}
                onSync={() => syncControlView(selected.id)}
                onNotice={(message) => {
                  if (!isSelected(selected.id)) return;
                  setError(null);
                  setWarn(null);
                  setNotice(message);
                }}
                onError={(message) => {
                  if (!isSelected(selected.id)) return;
                  setNotice(null);
                  setError(message);
                }}
                onWarn={(message) => { if (isSelected(selected.id)) setWarn(message); }}
                onBusyControl={(busy, busyId) => {
                  controlBusyIdRef.current = busy ? busyId : null;
                  setControlBusy(busy);
                  setControlBusyId(busyId);
                }}
                onAfterLeadSaved={() => refreshInboxView()}
                getEpochStore={() => epochStoreRef.current}
                getControlBusyId={() => controlBusyIdRef.current}
              />):null;
  const activityPanel=selected?(<DetailSection title={locale==='ar'?'النشاط':'Activity'}>
              {auditError&&<p role="status" className="conversation-intervention">{auditError}</p>}
              <ol className="conversation-activity">{audits[selected.id]?.events.map(event=><li key={event.id}><span className="conversation-activity-dot" aria-hidden="true"/><div><p>{({worker_escalation:locale==='ar'?'تحويل المحادثة للمتابعة البشرية':'Escalated for human follow-up',take_over:locale==='ar'?'استلام المحادثة':'Conversation taken over',resume:locale==='ar'?'استئناف الأتمتة':'Automation resumed',close:locale==='ar'?'إغلاق المحادثة':'Conversation closed',assign:locale==='ar'?'تحديث التعيين':'Assignment updated'} as Record<string,string>)[event.action]??event.action}</p><p className="conversation-secondary" dir="auto">{event.actorUserId?(assignees.find(person=>person.userId===event.actorUserId)?.name??event.actorUserId):(locale==='ar'?'الفاعل غير متاح':'Actor unavailable')}</p><time dateTime={event.at}>{new Date(event.at).toLocaleString(locale==='ar'?'ar-OM':'en-GB')}</time></div></li>)}</ol>
              {!auditBusy&&audits[selected.id]?.events.length===0&&<p className="conversation-secondary">{locale==='ar'?'لا توجد أحداث تحكم محفوظة.':'No saved control events.'}</p>}
              {auditBusy&&<p className="conversation-secondary" role="status">{locale==='ar'?'جارٍ تحميل النشاط…':'Loading activity…'}</p>}
              {(!audits[selected.id]||auditError)&&<Button variant="ghost" disabled={auditBusy||pending} onClick={()=>runPendingAction(async()=>{await loadAudit(selected.id);})}>{locale==='ar'?'تحديث السجل':'Refresh history'}</Button>}
              {audits[selected.id]?.hasMore&&<Button variant="ghost" disabled={auditBusy||pending} onClick={()=>runPendingAction(async()=>{await loadAudit(selected.id,audits[selected.id].nextCursor);})}>{locale==='ar'?'أحداث أقدم':'Older events'}</Button>}
            </DetailSection>):null;
  const connectionDetails=(!testReview&&connection&&<details className="conversation-connection" open={connectionDetailsOpen} onToggle={event=>setConnectionDetailsOpen(event.currentTarget.open)}><summary>{locale==='ar'?'تفاصيل الربط والتحقق':'Connection & verification details'}</summary><dl>
                {connection.displayNumber&&<DetailRow label={locale==='ar'?'رقم النشاط':'Business number'}><bdi dir="ltr">{connection.displayNumber}</bdi></DetailRow>}
                <DetailRow label={locale==='ar'?'الربط':'Connection'}>{connection.status.replaceAll('_',' ')}</DetailRow>
                <DetailRow label={locale==='ar'?'التفويض':'Authorization'}>{connection.authorizationStatus.replaceAll('_',' ')}</DetailRow>
                <DetailRow label={locale==='ar'?'جاهزية الاستقبال':'Receive binding'}>{connection.receiveReady?(locale==='ar'?'جاهز':'Ready'):(locale==='ar'?'غير جاهز':'Not ready')}</DetailRow>
                <DetailRow label={locale==='ar'?'جاهزية الإرسال':'Send binding'}>{connection.sendReady?(locale==='ar'?'جاهز':'Ready'):(locale==='ar'?'غير جاهز':'Not ready')}</DetailRow>
                <DetailRow label={locale==='ar'?'آخر اختبار استقبال':'Last inbound test'}>{connection.inboundTestedAt?new Date(connection.inboundTestedAt).toLocaleString(locale==='ar'?'ar-OM':'en-GB'):(locale==='ar'?'لم يتم التحقق':'Not verified')}</DetailRow>
                <DetailRow label={locale==='ar'?'آخر اختبار إرسال':'Last outbound test'}>{connection.outboundTestedAt?new Date(connection.outboundTestedAt).toLocaleString(locale==='ar'?'ar-OM':'en-GB'):(locale==='ar'?'لم يتم التحقق':'Not verified')}</DetailRow>
              </dl></details>);
  if(desktopView&&embedded){
    const ar=locale==='ar';
    const denied=accessDenied||readSuspended;
    if(denied)return <InboxDesktop locale={locale} view={{...desktopView,state:'denied',message:copy.app.inboxAccessDeniedBody,customer:undefined,messages:[]}}/>;
    if(!selected||!selectedReady)return <InboxDesktop locale={locale} view={{...desktopView,customer:undefined,messages:[],notice:<>{desktopView.notice}<p>{threadErrors[selectedId??'']??inboxReadError??(ar?'جارٍ تحميل المحادثة…':'Loading conversation…')}</p></>,onRetry:()=>void refreshInboxView(),listFooter:<>{desktopView.listFooter}<button type="button" className="vdi-small-button" onClick={()=>void refreshInboxView()}>{ar?'إعادة المحاولة':'Retry'}</button></>}}/>;
    const assignee=assignees.find(person=>person.userId===selected.assignedTo);
    const automation=handledByStaff?'paused':selected.automationAllowed&&selected.status!=='resolved'?'allowed':'blocked';
    const control=selected.status==='resolved'||handledByStaff?'resume':'take_over';
    const canAI=canReply&&!testReview&&!!inboxMeta?.companyId&&liveIds.has(selected.id);
    const action=(id:'resume'|'take_over'|'close')=>({id,label:id==='resume'?(ar?'إعادة إلى فيلورا':'Resume Velora'):id==='take_over'?(ar?'استلام المحادثة':'Take over conversation'):copy.app.markResolved,icon:id==='close'?'check' as const:id==='resume'?'play' as const:'user' as const,emphasis:id==='close'?undefined:'primary',reason:id==='resume'&&selectedSendLocked?(ar?'لا يمكن الاستئناف بينما نتيجة إرسال غير مؤكدة.':'Resume is unavailable while a send result is unconfirmed.'):(ar?'الإجراء غير متاح في الحالة الحالية.':'This action is unavailable in the current state.'),disabled:controlDisabled(id)||(id==='resume'&&selectedSendLocked),onClick:()=>void runControl(selected,id)});
    return <InboxDesktop locale={locale} view={{...desktopView,
      extension:inboxMeta?.companyId&&liveIds.has(selected.id)?{companyId:inboxMeta.companyId,conversationId:selected.id,channel:'whatsapp',canEdit:canReply,paused:writesPaused||readSuspended,revision:refreshVersion}:undefined,
      customer:{name:selected.customer,initials:selected.customer.slice(0,1).toUpperCase(),channel:'whatsapp',phone:selected.phone,status:`${copy.app.statuses[selected.status]} · WhatsApp`,
        quickActions:[{id:'copy',label:phoneCopied?(ar?'تم النسخ':'Copied'):(ar?'نسخ الرقم':'Copy phone'),icon:'copy',onClick:()=>void copyCustomerPhone(selected.phone,draftKey)},...(hasContactPhone&&canReply?[{id:'call',label:ar?'اتصال':'Call',icon:'phone' as const,onClick:()=>{window.location.href=`tel:${contactPhone}`;}},{id:'whatsapp',label:'WhatsApp',icon:'whatsapp' as const,onClick:()=>{window.open(`https://wa.me/${contactPhone.replace(/^\+/,'')}`,'_blank','noopener,noreferrer');}}]:[])],
        note:selected.internalNote?{text:selected.internalNote}:undefined,
        assignee:selected.assignedTo?{name:assignee?.name??(ar?'الاسم غير متاح':'Name unavailable'),initials:assignee?.name.slice(0,1)??'؟'}:undefined},
      profileTab:detailsTab,onProfileTabChange:setDetailsTab,
      assign:canAssign?{id:'assign',label:ar?'تعيين':'Assign',icon:'user',onClick:()=>{setDetailsTab('details');window.requestAnimationFrame(()=>document.querySelector<HTMLSelectElement>('[data-feature="assigned-team"] select')?.focus());}}:undefined,
      team:canAssign?{value:selected.assignedTo??'',options:assignees.map(person=>({id:person.userId,label:person.name})).concat(selected.assignedTo&&!assignees.some(person=>person.userId===selected.assignedTo)?[{id:selected.assignedTo,label:ar?'الاسم غير متاح':'Name unavailable'}]:[]),disabled:controlDisabled('assign'),pending:controlBusy,onAssign:userId=>{if((selected.assignedTo??null)!==userId)runControl(selected,'assign',userId);}}:undefined,
      addNote:canReply?{id:'note',label:ar?'تحرير الملاحظة':'Edit note',icon:'plus',onClick:()=>setComposerMode('note')}:undefined,
      followUp:{nativePanel:leadPanel,scheduledAt:selected.followUpAt??undefined,timezone:resolveCompanyTimezone(timezone).zone,values:{stage:selected.leadStage??'new',reason:selected.leadStageReason??'',status:selected.followUpStatus??'none',at:toDatetimeLocalValue(selected.followUpAt)},stages:[]},
      activity:{events:(audits[selected.id]?.events??[]).map(event=>({id:event.id,label:({worker_escalation:ar?'تحويل المحادثة للمتابعة البشرية':'Escalated for human follow-up',take_over:ar?'استلام المحادثة':'Conversation taken over',resume:ar?'استئناف الأتمتة':'Automation resumed',close:ar?'إغلاق المحادثة':'Conversation closed',assign:ar?'تحديث التعيين':'Assignment updated'} as Record<string,string>)[event.action]??event.action,actor:event.actorUserId?(assignees.find(person=>person.userId===event.actorUserId)?.name??(ar?'الاسم غير متاح':'Name unavailable')):(ar?'لا يوجد':'Not available'),at:new Date(event.at).toLocaleString(ar?'ar-OM':'en-GB',{timeZone:resolveCompanyTimezone(timezone).zone,dateStyle:'short',timeStyle:'short'})})),notice:auditError?<p role="status">{auditError}</p>:undefined,emptyLabel:auditBusy?(ar?'جارٍ تحميل النشاط…':'Loading activity…'):(ar?'لا توجد أحداث تحكم محفوظة.':'No saved control events.'),loadMore:!audits[selected.id]||auditError||audits[selected.id]?.hasMore?{id:'audit-more',label:audits[selected.id]?.hasMore?(ar?'تحميل نشاط أقدم':'Load older activity'):(ar?'تحديث السجل':'Refresh history'),icon:'clock',disabled:auditBusy||pending,onClick:()=>runPendingAction(async()=>{await loadAudit(selected.id,auditError?undefined:audits[selected.id]?.hasMore?audits[selected.id].nextCursor:undefined);})}:undefined},
      customerExtra:<>{selected.topic&&<p>{selected.topic}</p>}{selected.summary&&<p>{selected.summary}</p>}{selected.lastTouchAt&&<p>{new Date(selected.lastTouchAt).toLocaleString(ar?'ar-OM':'en-GB')}</p>}{phoneCopyFailed&&<p role="status">{ar?'تعذّر النسخ. يمكنك تحديد الرقم ونسخه.':'Copy failed. Select and copy the phone number.'}</p>}{connectionDetails}<Link href="/app/knowledge">{ar?'إدارة المعرفة':'Manage knowledge'}</Link>{testReview&&inboxMeta?.companyId?<ChannelReviewStatus companyId={inboxMeta.companyId} channel="whatsapp"/>:<Link href="/app/settings?tab=plan">{ar?'الاشتراك والربط':'Subscription & connection'}</Link>}</>,
      connection:{channel:'whatsapp',label:'WhatsApp',statusLabel:writesPaused?(ar?'تعذّر التحقق':'Unverified'):connection?.status==='verified'&&connection.authorizationStatus==='active'?(ar?'متصل':'Connected'):connection?(ar?'غير جاهز':'Not ready'):(ar?'غير متحقق':'Unverified'),receiveReady:writesPaused?null:connection?.receiveReady??null,sendReady:writesPaused?null:connection?.sendReady??null,details:!testReview&&connection?{id:'connection',label:ar?'تفاصيل الربط':'Connection details',icon:'more',onClick:()=>{setDetailsTab('details');setConnectionDetailsOpen(true);}}:undefined},
      headerActions:[...(desktopView.headerActions??[]),...(canAssign?[{id:'assign',label:ar?'تعيين':'Assign',icon:'user' as const,onClick:()=>{setDetailsTab('details');window.requestAnimationFrame(()=>document.querySelector<HTMLSelectElement>('[data-feature="assigned-team"] select')?.focus());}}]:[])],
      workflow:{statusLabel:copy.app.statuses[selected.status],automation,automationLabel:automation==='paused'?(ar?'الأتمتة متوقفة':'Automation paused'):automation==='allowed'?(ar?'الأتمتة مسموحة':'Automation allowed'):(ar?'الأتمتة غير مسموحة':'Automation not allowed'),interventions:selected.intervention.reasons.map(reason=>interventionLabels[reason]),primary:liveIds.has(selected.id)?action(control):undefined,close:selected.status!=='resolved'&&liveIds.has(selected.id)?action('close'):undefined},
      messages:desktopWhatsappMessages(selected.messages,ar),
      onTranscriptMount:node=>{if(node)restoreTranscriptPosition(node,scrollPositions.current[draftKey]);},onTranscriptScroll:event=>{scrollPositions.current[draftKey]=captureTranscriptPosition(event.currentTarget);},
      loadEarlier:selectedThread?.hasMore?{id:'older',label:ar?'تحميل الرسائل الأقدم':'Load older messages',icon:'clock',disabled:pending||threadBusyId===selected.id,onClick:()=>runPendingAction(async()=>{await loadThread(selected.id,selectedThread.nextCursor);})}:undefined,
      messageExtras:<>{selectedSendLocked&&<Notice tone="error">{copy.app.sendUnknownOutcome}</Notice>}{notice&&!selectedUnresolved&&<Notice>{notice}</Notice>}{warn&&!selectedUnresolved&&<Notice tone="warn">{warn}<button type="button" disabled={controlBusy} onClick={()=>void retryRefresh(selected.id)}>{copy.app.controlRetryRefresh}</button></Notice>}{(selectedUnresolved||error)&&<Notice tone="error">{selectedUnresolved?copy.app.controlOutcomeLocked:error}<button type="button" disabled={controlBusy} onClick={()=>void retryRefresh(selected.id)}>{copy.app.controlRetryRefresh}</button></Notice>}</>,
      composer:{mode:composerMode,ownershipNotice:(writesPaused?(ar?'آخر حالة مؤكدة: ':'Last verified state: '):'')+(selected.status==='resolved'?(ar?'المحادثة محلولة':'Conversation resolved'):handledByStaff?(ar?'الموظف يدير المحادثة':'Staff is handling the conversation'):selected.automationAllowed?(ar?'الذكاء الاصطناعي يدير المحادثة':'AI is handling the conversation'):(ar?'توقفت الأتمتة دون استلام بشري':'Automation stopped without a human takeover')),enabledModes:['message',...(!testReview&&!!inboxMeta?.companyId&&liveIds.has(selected.id)?['ai' as const]:[]),'note'],disabledModes:canReply&&handledByStaff?[]:['ai','note'],onModeChange:setComposerMode,value:draft,onChange:setDraft,onSubmit:()=>send(selected),onSubmitAttachment:!testReview?(id,onAccepted)=>send(selected,id,onAccepted):undefined,pending:pending||controlBusy,canSend:selectedReady&&handledByStaff&&canReply&&!selectedSendLocked&&liveIds.has(selected.id),disabledReason:manualReplyBlock({status:selected.status,automationAllowed:selected.automationAllowed,canReply,sendLocked:selectedSendLocked,writesPaused,intervention:selected.intervention},ar),
       modePanels:{note:<div ref={setNotesHost}/>,ai:canAI&&<ChannelAIDraft key={`${inboxScope}:${selected.id}:${selected.messages.at(-1)?.id}:${selected.revision}`} companyId={inboxMeta!.companyId} channel="whatsapp" conversationId={selected.id} ar={ar} disabled={writesPaused||!selectedReady||pending||controlBusy||selectedSendLocked} onUse={text=>{setDraft(text);setComposerMode('message');}}/>}},
    }}/>;
  }
  return (
    <WorkspaceShell
      embedded={embedded}
      title={locale === "ar" ? "صندوق المحادثات الموحد" : "Unified Inbox"}
      actions={
        <div className="flex items-center gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
          <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 py-1 text-xs text-[var(--color-on-dark)] shadow-sm">
            <span className={`h-2 w-2 rounded-full ${connection?.receiveReady && connection.sendReady ? "bg-[var(--service-accent)]" : "bg-[var(--color-muted-soft)]"}`} />
            <span className="font-medium text-[var(--service-accent)]">Meta WhatsApp</span>
            <span className="text-[var(--color-muted-soft)]">·</span>
            <span>{testReview?(locale==='ar'?'اختبار ميتا · ردود يدوية':'Meta test · manual replies'):connection ? (connection.receiveReady && connection.sendReady
              ? (locale === "ar" ? "الرقم مرتبط" : "Number linked")
              : (locale === "ar" ? "الإعداد يحتاج مراجعة" : "Setup needs review"))
              : (locale === "ar" ? "حالة الربط غير متاحة" : "Connection status unavailable")}</span>
          </div>
          <Button
            variant="ghost"
            onClick={() => runPendingAction(async () => { await refreshInboxView(); if (selectedId) { await loadThread(selectedId); await loadAudit(selectedId); } await refreshConnection(); })}
            disabled={inboxBusy || pending || !inboxMeta?.companyId}
            className="text-xs min-h-9 px-3 gap-1.5"
            title={locale === "ar" ? "تحديث المحادثات" : "Refresh inbox"}
          >
            <IconMenu width={16} height={16} aria-hidden="true"/>
            <span className="hidden sm:inline">{locale === "ar" ? "تحديث" : "Refresh"}</span>
          </Button>
        </div>
      }
    >
      {inboxReadError ? <Notice tone="error">{inboxReadError}</Notice> : null}
      {selectedId && threadErrors[selectedId] ? <Notice tone="error">
        {threadErrors[selectedId]} <button type="button" className="underline" disabled={pending}
          onClick={() => runPendingAction(async () => { await loadThread(selectedId); })}>{locale === "ar" ? "إعادة المحاولة" : "Retry"}</button>
      </Notice> : null}
      {/* Top Banner Notice for Unconnected or Setup States */}
      {accessDenied ? (
        <Notice tone="warn">{copy.app.inboxAccessDeniedBody}</Notice>
      ) : noCompany ? (
        <Notice tone="warn">{copy.app.inboxNoCompanyBody}</Notice>
      ) : loadFailed ? (
        <Notice tone="error">{copy.app.inboxLoadFailedBody}</Notice>
      ) : conversations.length === 0 ? (
        <div className="mb-4 rounded-2xl border border-[var(--service-accent)]/30 bg-gradient-to-r from-[var(--service-accent)]/10 via-[#0d1a14]/60 to-[#d9a467]/10 p-4 text-xs font-[family-name:Tajawal,var(--font-ar),sans-serif] text-[var(--color-on-dark)] flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📱</span>
            <div>
              <p className="font-bold text-sm text-[var(--color-success-fg)]">
                {locale === "ar" ? "مراجعة إعداد WhatsApp Business" : "Review WhatsApp Business setup"}
              </p>
              <p className="text-[var(--color-muted-on-dark)] mt-0.5">
                {locale === "ar"
                  ? "راجع حالة الربط والمعرفة المعتمدة في الإعدادات. تشغيل ردود العملاء يخضع لجاهزية التشغيل."
                  : "Review connection status and approved knowledge in settings. Customer replies depend on runtime readiness."}
              </p>
            </div>
          </div>
          <Link
            href="/app/settings"
            className="inline-flex min-h-8 items-center rounded-xl bg-[var(--service-accent)] px-3.5 text-xs font-semibold text-[#072317] hover:bg-[#4fe79a] transition"
          >
            {locale === "ar" ? "إعدادات الربط ⚙️" : "Connection Settings ⚙️"}
          </Link>
        </div>
      ) : null}

      {/* Main 3-Column Unified Inbox Container */}
      <div data-channel-inbox="whatsapp" data-conversation-redesign="true" data-embedded={embedded} className="grid h-[calc(100svh-11rem)] min-h-[620px] max-h-[920px] w-full grid-cols-1 overflow-hidden rounded-2xl border border-[color:var(--color-line)] bg-[var(--color-panel)] shadow-[0_12px_36px_rgba(16,27,22,0.08)] lg:grid-cols-[330px_1fr] xl:grid-cols-[340px_1fr_320px]">
        {/* ============================================================== */}
        {/* COLUMN 1: CONVERSATIONS LIST & FILTERS                         */}
        {/* ============================================================== */}
        <section
          className={`flex h-full flex-col border-e border-[color:var(--color-line)] bg-[var(--color-panel-deep)]/70 ${
            selected ? "hidden lg:flex" : "flex"
          }`}
          data-inbox-list="true"
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
                className="w-full min-h-10 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] ps-9 pe-8 text-xs text-[var(--color-on-dark)] placeholder:text-[var(--color-muted-soft)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none transition"
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

            {/* Quick Filter Tabs: الكل، غير المقروءة، فيلورا ترد، تدخل بشري، مغلقة */}
            <div className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[11px] font-medium font-[family-name:Tajawal,var(--font-ar),sans-serif]">
              {(
                [
                  { id: "all", labelAr: "الكل", labelEn: "All", count: filterCounts.all, title: locale === "ar" ? "كل المحادثات المتاحة" : "All authorized conversations" },
                  { id: "unread", labelAr: "غير مقروءة", labelEn: "Unread", count: filterCounts.unread, title: locale === "ar" ? "الرسائل غير المقروءة في مساحة العمل" : "Unread messages across the workspace" },
                  { id: "noura", labelAr: "فيلورا", labelEn: "Velora", count: undefined, badge: "✨", title: locale === "ar" ? "الأتمتة المسموحة في المحادثات المحملة" : "Automation enabled in loaded conversations" },
                  { id: "staff", labelAr: "تدخل بشري", labelEn: "Staff", count: filterCounts.staff, badge: "👤", title: locale === "ar" ? "محادثات تحتاج تدخلاً في مساحة العمل" : "Conversations requiring intervention across the workspace" },
                  { id: "resolved", labelAr: "مغلقة", labelEn: "Closed", count: undefined, title: locale === "ar" ? "المحادثات المغلقة المحملة" : "Closed loaded conversations" },
                ] as const
              ).map((tab) => {
                const active = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    aria-pressed={active}
                    title={tab.title}
                    className={`inline-flex items-center gap-1 shrink-0 rounded-xl px-2.5 py-1.5 transition ${
                      active
                        ? "bg-[var(--service-accent)] text-[#072317] font-bold shadow-sm"
                        : "bg-[var(--color-hover-wash)] text-[var(--color-muted-on-dark)] hover:text-[var(--color-on-dark)] border border-transparent"
                    }`}
                  >
                    {"badge" in tab ? <span>{tab.badge}</span> : null}
                    <span>{locale === "ar" ? tab.labelAr : tab.labelEn}</span>
                    {tab.count !== undefined ? <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                        active ? "bg-[#072317]/20 text-[#072317]" : "bg-[var(--color-panel)] text-[var(--color-muted-soft)]"
                      }`}
                    >
                      {tab.count}
                    </span> : null}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-muted-soft)] mt-1">
              {locale === "ar" ? "البحث والفلاتر للمحادثات المحملة، مرتبة من الأحدث إنشاءً. عداد القراءة للرسائل في مساحة العمل." : "Search and filters cover loaded conversations, newest created first. Unread counts workspace messages."}
            </p>

            {/* Secondary Worklist Chips */}
            {worklist !== "all" || WORKLISTS.some(key => key !== "all" && counts[key] > 0) ? (
              <div className="flex gap-1 overflow-x-auto pt-1 text-[10px] [scrollbar-width:none]">
                {WORKLISTS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setWorklist(f)}
                    aria-pressed={worklist === f}
                    title={locale === "ar" ? "عدد المحادثات المحملة" : "Count in loaded conversations"}
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
              const isVeloraActive = !c.assistantPaused && Boolean(c.automationAllowed) && c.status !== "resolved";
              const isAwaitingStaff = staffHandlesConversation(c);
              const automationStopped = !isVeloraActive && !isAwaitingStaff && c.status !== "resolved";
              const isCustomerWaiting = c.unreadCount > 0;

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  aria-current={isCurrent ? "true" : undefined}
                  className={`group relative grid w-full gap-1.5 rounded-xl p-3 text-start transition duration-150 border ${
                    isCurrent
                      ? "border-[var(--service-accent)]/60 bg-[var(--service-accent)]/10 shadow-[0_2px_12px_rgba(56,220,137,0.12)]"
                      : "border-transparent hover:border-[color:var(--color-border-soft)] hover:bg-[var(--color-hover-wash)]"
                  }`}
                >
                  {/* Top line: Customer name + Time */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[var(--service-accent)]/25 to-[#1d7d4c]/30 flex items-center justify-center text-xs font-bold text-[var(--service-accent)] shrink-0 border border-[var(--service-accent)]/30">
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
                              ? (locale === "ar" ? "فيلورا: " : "Velora: ")
                              : (locale === "ar" ? "الموظف: " : "Staff: ")}
                        </span>
                        {lastMessage.text}
                      </>
                    ) : (
                      c.summary
                    )}
                  </p>

                  {/* Badges footer: Velora status + conversation status */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                    {isVeloraActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium bg-[var(--service-accent)]/15 text-[var(--service-accent)] border border-[var(--service-accent)]/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--service-accent)] animate-pulse" />
                        ✨ {locale === "ar" ? "الأتمتة مسموحة" : "Automation enabled"}
                      </span>
                    ) : isAwaitingStaff ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium bg-[#d9a467]/15 text-[#f0cf9d] border border-[#d9a467]/30">
                        👤 {locale === "ar" ? "تدخل بشري" : "Staff Takeover"}
                      </span>
                    ) : automationStopped ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium bg-[#d9a467]/15 text-[#f0cf9d] border border-[#d9a467]/30">
                        {locale === "ar" ? "الأتمتة متوقفة" : "Automation stopped"}
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
                      <span className="ms-auto rounded-full px-1.5 bg-[var(--service-accent)]/20 text-[var(--service-accent)]"
                        title={locale === "ar" ? "رسائل غير مقروءة" : "Unread messages"}>{c.unreadCount}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
            <div className="px-2 py-3 space-y-2 text-[11px] text-[var(--color-muted-soft)]">
              <p>{locale === "ar" ? `تم تحميل ${conversations.length} من ${inboxPage?.total ?? "—"} محادثة` : `${conversations.length} of ${inboxPage?.total ?? "—"} conversations loaded`}</p>
              {inboxPage?.hasMore ? <Button variant="ghost" className="w-full min-h-8 text-xs" disabled={inboxBusy || pending}
                onClick={() => runPendingAction(async () => { await refreshInboxView(inboxPage.nextCursor); })}>
                {locale === "ar" ? "تحميل المزيد من المحادثات" : "Load more conversations"}
              </Button> : null}
            </div>
          </div>
        </section>

        {/* ============================================================== */}
        {/* COLUMN 2: ACTIVE CONVERSATION TRANSCRIPT & COMPOSER             */}
        {/* ============================================================== */}
        <section
          inert={mobileDetailsOpen} data-conversation-thread="true" className={`flex h-full flex-col bg-[var(--color-panel)] ${
            selected ? "flex" : "hidden lg:flex"
          }`}
          aria-label={selected ? selected.customer : (locale === "ar" ? "المحادثة النشطة" : "Active Conversation")}
        >
          {selected ? (
            <>
              {/* Top Header of Chat */}
              <header data-conversation-header="true" className="z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Mobile Back Button */}
                  <button
                    type="button"
                    onClick={() => select(null)}
                    data-native-back={embedded||undefined}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--color-border-soft)] text-sm lg:hidden hover:bg-[var(--color-hover-wash)]"
                    aria-label={copy.app.backToList}
                  >
                    {locale === "ar" ? "→" : "←"}
                  </button>

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--service-line)] bg-[var(--service-accent-soft)] text-sm font-bold text-[var(--service-accent)]">
                    {selected.customer.slice(0, 1).toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-sm text-[var(--color-on-dark)] truncate font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                        {selected.customer}
                      </h2>
                      <span className="rounded-full border border-[var(--service-line)] bg-[var(--service-accent-soft)] px-2 py-0.5 text-[13px] font-medium text-[var(--service-accent)]">
                        WhatsApp
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs mt-0.5">
                      <span dir="ltr" className="font-mono text-[13px] text-[var(--color-muted-soft)]">
                        {selected.phone}
                      </span>
                      <span className="text-[var(--color-muted-soft)]">·</span>
                      {handledByStaff ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[#f0cf9d] text-[11px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#d9a467]" />
                          {locale === "ar" ? "تحكم بشري" : "Human control"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-[var(--service-accent)] text-[11px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--service-accent)] animate-pulse" />
                          {selected.status === "resolved" ? copy.app.statuses.resolved : selected.automationAllowed ? (locale === "ar" ? "الأتمتة مسموحة" : "Automation allowed") : (locale === "ar" ? "الأتمتة غير مسموحة" : "Automation not allowed")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Chat Top Controls */}
                <div className="flex items-center gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                  {liveIds.has(selected.id) ? (
                    <>
                      {handledByStaff || selected.status === "resolved" ? (
                        canUseInboxControl(inboxMeta,"resume") && <button
                          type="button"
                          disabled={controlDisabled("resume") || selectedSendLocked}
                          title={selectedSendLocked ? (locale === "ar" ? "لا يمكن الاستئناف بينما نتيجة إرسال غير مؤكدة." : "Resume is unavailable while a send result is unconfirmed.") : (locale === "ar" ? "السماح لفيلورا بالرد التلقائي مجدداً" : "Resume Velora")}
                          onClick={() => runControl(selected, "resume")}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[var(--service-accent)]/40 bg-[var(--service-accent)]/15 px-3 text-xs font-bold text-[var(--service-accent)] transition hover:bg-[var(--service-accent)]/25 disabled:opacity-50"
                        >
                          <IconRocket width={16} height={16} aria-hidden="true"/>
                          <span>{locale === "ar" ? "إعادة إلى فيلورا" : "Resume Velora"}</span>
                        </button>
                      ) : (
                        canUseInboxControl(inboxMeta,"take_over") && <button
                          type="button"
                          disabled={controlDisabled("take_over")}
                          onClick={() => runControl(selected, "take_over")}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[#d9a467]/40 bg-[#d9a467]/15 px-3 text-xs font-bold text-[#f0cf9d] transition hover:bg-[#d9a467]/25 disabled:opacity-50"
                          title={locale === "ar" ? "إيقاف فيلورا وتولي المحادثة كبشري" : "Take over from Velora"}
                        >
                          <IconUsers width={16} height={16} aria-hidden="true"/>
                          <span>{locale === "ar" ? "استلام المحادثة" : "Take over conversation"}</span>
                        </button>
                      )}

                      {selected.status !== "resolved" && canUseInboxControl(inboxMeta,"close") ? (
                        <Button
                          variant="ghost"
                          busy={controlBusy && controlBusyId === selected.id}
                          disabled={controlDisabled("close")}
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
                    data-details-toggle="true"
                    aria-expanded={mobileDetailsOpen}
                    aria-controls="conversation-details"
                    className="inline-flex min-h-8 items-center gap-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-2.5 text-xs text-[var(--color-on-dark)] xl:hidden hover:bg-[var(--color-hover-wash)]"
                    aria-label={locale === "ar" ? "تفاصيل العميل" : "Customer Details"}
                  >
                    <IconShield width={16} height={16} aria-hidden="true"/>
                    <span className="hidden sm:inline">{locale === "ar" ? "التفاصيل" : "Details"}</span>
                  </button>
                </div>
              </header>

              {/* Status Notice Banners */}
              {handledByStaff || (!selected.automationAllowed && selected.status !== "resolved") ? (
                <div className="border-b border-[#d9a467]/30 bg-[#d9a467]/10 px-4 py-2 text-xs text-[#f0cf9d] flex items-center justify-between font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                  <div className="flex items-center gap-2">
                    <IconShield width={16} height={16} aria-hidden="true"/>
                    <span>{handledByStaff ? (locale === "ar" ? "الموظف يدير المحادثة. الرد اليدوي متاح لمن لديه صلاحية الرد." : "Staff is handling this conversation. Manual reply is available to people who can reply.") : (locale === "ar" ? "توقفت الأتمتة دون استلام بشري. استلم المحادثة قبل الرد اليدوي." : "Automation stopped without a human takeover. Take over before replying.")}</span>
                  </div>

                </div>
              ) : (
                <div className="border-b border-[var(--service-accent)]/20 bg-[var(--service-accent)]/5 px-4 py-2 text-xs text-[var(--service-accent)] flex items-center gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                  <IconSparkles width={16} height={16} aria-hidden="true"/>
                  <span>{selected.status === "resolved" ? copy.app.statuses.resolved : selected.automationAllowed ? (locale === "ar" ? "الأتمتة مسموحة. الإرسال يعتمد على جاهزية التشغيل والمعرفة المعتمدة." : "Automation is allowed. Sending depends on runtime readiness and approved knowledge.") : (locale === "ar" ? "الأتمتة غير مسموحة لهذه المحادثة." : "Automation is not allowed for this conversation.")}</span>
                </div>
              )}

              {/* Messages Transcript Scroll Area */}
              <div
                data-transcript="true"
                ref={node=>{if(node)restoreTranscriptPosition(node,scrollPositions.current[draftKey]);}}
                onScroll={event=>{scrollPositions.current[draftKey]=captureTranscriptPosition(event.currentTarget);}}
                className="flex-1 overflow-y-auto p-4 space-y-4"
                dir={locale === "ar" ? "rtl" : "ltr"}
              >
                {!selectedReady && !threadErrors[selected.id] ? <p className="text-xs text-[var(--color-muted-soft)]">{locale === "ar" ? "جارٍ تحديث المحادثة…" : "Refreshing thread…"}</p> : null}
                {selectedReady && selectedThread?.hasMore ? <Button variant="ghost" className="w-full min-h-8 text-xs" disabled={pending || threadBusyId === selected.id}
                  onClick={() => runPendingAction(async () => { await loadThread(selected.id, selectedThread.nextCursor); })}>
                  {locale === "ar" ? "تحميل الرسائل الأقدم" : "Load older messages"}
                </Button> : null}
                {selectedReady && selectedThread ? <p className="text-[13px] text-[var(--color-muted-soft)]">{locale === "ar" ? `${selected.messages.length} رسالة محملة` : `${selected.messages.length} messages loaded`}</p> : null}
                {selectedReady && selected.messages.length === 0 ? (
                  <div className="py-16 text-center text-xs text-[var(--color-muted-soft)]">
                    {locale === "ar" ? "لا توجد رسائل سابقة في هذه المحادثة." : "No messages in this conversation yet."}
                  </div>
                ) : null}

                {selectedReady && selected.messages.map((m) => {
                  const isCustomer = m.from === "customer";
                  const isAssistant = m.from === "assistant";

                  return (
                    <div
                      key={m.id}
                      data-message-id={m.id}
                      data-direction={isCustomer?"inbound":"outbound"}
                      data-sender={m.from}
                      className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${
                        isCustomer ? "me-auto items-start" : "ms-auto items-end"
                      }`}
                    >
                      {/* Sender Tag Header */}
                      <div className="mb-1 flex items-center gap-1.5 px-1 text-[13px] font-medium font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                        {isCustomer ? (
                          <span className="text-[var(--color-muted-soft)]">{selected.customer}</span>
                        ) : isAssistant ? (
                          <span className="inline-flex items-center gap-1 text-[var(--service-accent)] font-bold">
                            <IconSparkles width={16} height={16} aria-hidden="true"/>
                            <span>{locale === "ar" ? "فيلورا · رد آلي" : "Velora · Automated reply"}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#f0cf9d] font-bold">
                            <IconUsers width={16} height={16} aria-hidden="true"/>
                            <span>{copy.app.staff}</span>
                          </span>
                        )}
                        <span className="text-[var(--color-muted-soft)]">·</span>
                        <span dir="ltr" className="text-[var(--color-muted-soft)]">
                          {new Date(m.at).toLocaleTimeString(locale === "ar" ? "ar-OM" : "en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      {/* Bubble Container */}
                      <div
                        className={`rounded-xl border px-4 py-2.5 text-[15px] leading-6 ${
                          isCustomer
                            ? "rounded-ss-sm border-[var(--service-line)] bg-[var(--service-surface)] text-[var(--service-ink)]"
                            : isAssistant
                              ? "rounded-se-sm border-[var(--service-line)] bg-[var(--service-accent-soft)] text-[var(--service-ink)]"
                              : "rounded-se-sm border-[var(--service-line)] bg-[var(--service-subtle)] text-[var(--service-ink)]"
                        }`}
                      >
                        <p dir="auto" className="whitespace-pre-wrap break-words">{m.text}</p>
                      </div>

                      {/* Message Delivery State & Source Tag */}
                      <div className="mt-1 flex items-center gap-2 px-1 text-[13px] text-[var(--color-muted-soft)]">
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
                          className="min-h-8 text-[var(--service-accent)] underline font-bold"
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
                        className="min-h-8 text-[var(--service-accent)] underline font-bold"
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
                          className="min-h-8 text-[var(--service-accent)] underline font-bold"
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
              <div className="conversation-composer">
                <ComposerTabs id="whatsapp-composer" ar={locale==='ar'} mode={composerMode} onChange={setComposerMode} notes={canReply} ai={canReply&&!testReview&&!!inboxMeta?.companyId&&liveIds.has(selected.id)}/>
                <div role="tabpanel" id="whatsapp-composer-panel-note" aria-labelledby="whatsapp-composer-tab-note" hidden={composerMode!=='note'||!canReply} ref={setNotesHost}/>
                <div role="tabpanel" id="whatsapp-composer-panel-ai" aria-labelledby="whatsapp-composer-tab-ai" hidden={composerMode!=='ai'}>
                {canReply && !testReview && inboxMeta?.companyId && liveIds.has(selected.id) && <ChannelAIDraft key={`${inboxScope}:${selected.id}:${selected.messages.at(-1)?.id}:${selected.revision}`} companyId={inboxMeta.companyId} channel="whatsapp" conversationId={selected.id} ar={locale==='ar'} disabled={writesPaused||!selectedReady||pending||controlBusy||selectedSendLocked} onUse={text=>{setDraft(text);setComposerMode('message');}}/>}
                </div>
                <div role="tabpanel" id="whatsapp-composer-panel-message" aria-labelledby="whatsapp-composer-tab-message" hidden={composerMode!=='message'}>
                {canReply ? (
                  <form
                    className="flex flex-col gap-2 font-[family-name:Tajawal,var(--font-ar),sans-serif]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send(selected);
                    }}
                  >
                    {!handledByStaff ? (
                      <p className="text-[11px] text-[#f0cf9d] flex items-center gap-1.5">
                        <IconShield width={16} height={16} aria-hidden="true"/>
                        <span>
                          {locale === "ar"
                            ? "ملاحظة: استلم المحادثة أولًا لإيقاف الرد الآلي وكتابة ردك."
                            : "Take over this conversation before writing a human reply."}
                        </span>
                      </p>
                    ) : null}

                    <div className="flex gap-2 items-end">
                      <textarea
                        rows={2}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (selectedReady && canReply && draft.trim() && !pending && !controlBusy && !selectedSendLocked) {
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
                        disabled={!selectedReady || !handledByStaff || pending || controlBusy || selectedSendLocked}
                        className="min-w-0 flex-1 resize-none rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-2.5 text-base text-[var(--color-on-dark)] placeholder:text-[var(--color-muted-soft)] focus:ring-2 focus:ring-[var(--service-accent)] outline-none disabled:opacity-60"
                      />
                      <Button
                        type="submit"
                        disabled={!selectedReady || !handledByStaff || !canReply || !draft.trim() || pending || controlBusy || selectedSendLocked || !liveIds.has(selected.id)}
                        className="shrink-0 min-h-10 px-4 text-xs font-bold gap-1.5"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 10 18-7-7 18-3-8-8-3z M11 13 21 3" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
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
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[var(--service-accent)]/20 to-[#1d7d4c]/10 border border-[var(--service-accent)]/30 flex items-center justify-center text-3xl mb-4 shadow-sm">
                💬
              </div>
              <h3 className="font-bold text-base text-[var(--color-on-dark)] mb-1 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                {copy.app.selectConversation}
              </h3>
              <p className="text-xs text-[var(--color-muted-on-dark)] max-w-sm mb-4 leading-5 font-[family-name:Tajawal,var(--font-ar),sans-serif]">
                {locale === "ar"
                  ? "اختر أي محادثة من القائمة لمراجعة ردود فيلورا أو الرد يدويًا ومتابعة حالة العميل."
                  : "Select a conversation from the list to review Velora's responses or take over manually."}
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
        {selected && mobileDetailsOpen && <button type="button" className="conversation-details-backdrop" tabIndex={-1} aria-label={locale==='ar'?'إغلاق تفاصيل العميل':'Close customer details'} onClick={()=>setMobileDetailsOpen(false)}/>}
        {selected ? (
          <aside
            id="conversation-details"
            ref={detailsRef}
            data-details-open={mobileDetailsOpen}
            role={mobileDetailsOpen?'dialog':undefined}
            aria-modal={mobileDetailsOpen?true:undefined}
            className={`flex flex-col border-s border-[color:var(--color-line)] bg-[var(--color-panel-deep)]/90 overflow-y-auto p-4 space-y-4 font-[family-name:Tajawal,var(--font-ar),sans-serif] ${
              mobileDetailsOpen
                ? "fixed inset-y-0 end-0 z-50 w-full max-w-sm bg-[var(--color-panel)] shadow-2xl xl:static xl:w-auto xl:shadow-none"
                : "hidden xl:flex"
            }`}
            aria-label={locale === "ar" ? "معلومات العميل" : "Customer & Automation Details"}
          >
            {/* Header with Close Button for Mobile Drawer */}
            <div className="flex items-center justify-between pb-2 border-b border-[color:var(--color-line)]">
              <h3 className="font-bold text-sm text-[var(--color-on-dark)] flex items-center gap-1.5">
                <IconUsers width={16} height={16} aria-hidden="true"/>
                {locale === "ar" ? "معلومات العميل" : "Customer information"}
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

            <div className="conversation-customer-summary">
              <span className="conversation-customer-avatar" aria-hidden="true">{selected.customer.slice(0,1).toUpperCase()}</span>
              <h2 dir="auto">{selected.customer}</h2><span className="conversation-status">{copy.app.statuses[selected.status]}</span>
              <div className="conversation-contact-actions">
               <button type="button" className="conversation-copy-phone" onClick={()=>void copyCustomerPhone(selected.phone,draftKey)} aria-label={locale==='ar'?'نسخ الرقم':'Copy phone'}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M16 8V3H3v13h5" stroke="currentColor" strokeWidth="1.6"/></svg>{phoneCopied?(locale==='ar'?'تم النسخ':'Copied'):(locale==='ar'?'نسخ الرقم':'Copy phone')}</button>
               {hasContactPhone&&canReply&&<><a className="conversation-contact-link" href={`tel:${contactPhone}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 3 3 5-2 3c2 3 3 4 6 5l3-2 4 3c-1 4-3 5-6 4C8 19 3 14 3 7c0-3 1-4 4-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>{locale==='ar'?'اتصال':'Call'}</a><a className="conversation-contact-link" href={`https://wa.me/${contactPhone.replace(/^\+/,'')}`} target="_blank" rel="noopener noreferrer" title={locale==='ar'?'فتح واتساب خارج Velora':'Open WhatsApp outside Velora'}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 11.5a9 9 0 0 1-13.5 7.8L3 21l1.7-4.5A9 9 0 1 1 21 11.5Z M8 7c0 4 2 6 6 7l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>{locale==='ar'?'واتساب':'WhatsApp'}</a></>}
              </div>
              <span className="sr-only" role="status">{phoneCopied?(locale==='ar'?'تم نسخ رقم العميل':'Customer phone copied'):''}</span>
              {phoneCopyFailed&&<p role="status" className="conversation-secondary">{locale==='ar'?'تعذّر النسخ. يمكنك تحديد الرقم أدناه ونسخه.':'Copy failed. Select and copy the phone number below.'}</p>}
            </div>
            {embedded&&<InboxDetailsTabs ar={locale==='ar'} value={detailsTab} onChange={setDetailsTab}/>}
            <div role={embedded?'tabpanel':undefined} id={embedded?'wa-details-panel-details':undefined} aria-labelledby={embedded?'wa-details-tab-details':undefined} hidden={embedded&&detailsTab!=='details'}>
            <DetailSection title={locale==='ar'?'معلومات الاتصال':'Contact information'}><dl>
              <DetailRow label={locale==='ar'?'الهاتف':'Phone'}><bdi dir="ltr">{selected.phone}</bdi></DetailRow>
              <DetailRow label={locale==='ar'?'القناة':'Channel'}><ChannelBadge channel="whatsapp" ar={locale==='ar'}/></DetailRow>
              <DetailRow label={locale==='ar'?'المسؤول':'Assigned to'}>{selected.assignedTo?(assignees.find(person=>person.userId===selected.assignedTo)?.name??selected.assignedTo):(locale==='ar'?'غير معيّن':'Unassigned')}</DetailRow>
            </dl></DetailSection>
            <DetailSection title={locale==='ar'?'تفاصيل المحادثة':'Conversation details'}><dl>
              <DetailRow label={locale==='ar'?'الحالة':'Status'}>{copy.app.statuses[selected.status]}</DetailRow>
              <DetailRow label={locale==='ar'?'الموضوع':'Topic'}>{selected.topic||'—'}</DetailRow>
              {selected.lastTouchAt&&<DetailRow label={locale==='ar'?'آخر متابعة':'Last follow-up'}>{new Date(selected.lastTouchAt).toLocaleString(locale==='ar'?'ar-OM':'en-GB')}</DetailRow>}
            </dl>{selected.summary&&<p className="conversation-summary" dir="auto">{selected.summary}</p>}
            {selected.intervention.reasons.length>0&&<div className="conversation-intervention">{selected.intervention.reasons.map(reason=><p key={reason}>{interventionLabels[reason]}</p>)}</div>}</DetailSection>
            <DetailSection title={locale==='ar'?'ملاحظات داخلية':'Internal notes'} action={canReply?<button type="button" className="conversation-text-action" onClick={()=>{setComposerMode('note');setMobileDetailsOpen(false);window.requestAnimationFrame(()=>notesHost?.querySelector('textarea')?.focus());}}>{locale==='ar'?'تحرير':'Edit'}</button>:undefined}>
              <p className="conversation-note-preview" dir="auto">{selected.internalNote||(locale==='ar'?'لا توجد ملاحظة محفوظة.':'No saved note.')}</p><p className="conversation-secondary">{locale==='ar'?'داخلية · لا تُرسل للعميل':'Internal · never sent to the customer'}</p>
            </DetailSection>
            </div>
            <div role={embedded?'tabpanel':undefined} id={embedded?'wa-details-panel-followup':undefined} aria-labelledby={embedded?'wa-details-tab-followup':undefined} hidden={embedded&&detailsTab!=='followup'}>
            <DetailSection title={locale==='ar'?'المتابعة والتعيين':'Follow-up & assignment'}>
              {leadPanel}
            </DetailSection>
            </div>
            <div role={embedded?'tabpanel':undefined} id={embedded?'wa-details-panel-activity':undefined} aria-labelledby={embedded?'wa-details-tab-activity':undefined} hidden={embedded&&detailsTab!=='activity'}>
            {activityPanel}
            </div>
            <div hidden={embedded&&detailsTab!=='details'}>
            <DetailSection title={locale==='ar'?'حالة الأتمتة والربط':'Automation & connection'}>
              <dl><DetailRow label={locale==='ar'?'الأتمتة':'Automation'}>{selected.assistantPaused?(locale==='ar'?'متوقفة مؤقتًا':'Paused'):selected.status==='resolved'?copy.app.statuses.resolved:selected.automationAllowed?(locale==='ar'?'مسموحة':'Allowed'):(locale==='ar'?'غير مسموحة':'Not allowed')}</DetailRow></dl>
              <Link href="/app/knowledge" className="conversation-text-action">{locale==='ar'?'إدارة المعرفة':'Manage knowledge'}</Link>
              {connectionDetails}
              {testReview&&inboxMeta?.companyId?<ChannelReviewStatus companyId={inboxMeta.companyId} channel="whatsapp"/>:<Link href="/app/settings?tab=plan" className="conversation-text-action">{locale==='ar'?'الاشتراك والربط':'Subscription & connection'}</Link>}
            </DetailSection>
            </div>
          </aside>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
