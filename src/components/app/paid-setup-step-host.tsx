"use client";

import {SetupReadError,type SetupReader} from "@/lib/tenancy/setup-read-client";
import {awaitSetupRequest,observeSetupRead} from "./paid-setup-request";
import { useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import type { ChecklistStepId } from "./paid-assistant-checklist";
import type { PaidBranchSetupRead } from "@/lib/tenancy/paid-setup-contracts";
import type { AnswerFailure, AnswerFailureCode } from "@/lib/answers/types";
import { PaidBranchHours } from "./paid-branch-hours";
import type { BranchHoursCopyTarget, BranchHoursSnapshot } from "@/lib/tenancy/branch-hours-contracts";
import {
  copyOwnedBranchHoursAction,
  readOwnedBranchHoursAction,
  saveOwnedBranchHoursAction,
} from "@/lib/tenancy/branch-hours-actions";
import { PaidBranchKnowledge, type BranchKnowledgeViewSnapshot } from "./paid-branch-knowledge";
import {
  mutateOwnedBranchKnowledgeSourceAction,
  removeOwnedBranchKnowledgePageAction,
  addOwnedBranchWebsiteAction,
  pageActionOwnedBranchKnowledgeAction,
  readOwnedBranchKnowledgeAction,
  saveOwnedBranchKnowledgeTextAction,
  uploadOwnedBranchKnowledgeFilesAction,
  approveOwnedBranchKnowledgeSourceAction,
  reprocessOwnedBranchKnowledgeFileAction,
} from "@/lib/tenancy/paid-branch-knowledge-actions";
import type { ReplyLanguageSnapshot } from "@/lib/tenancy/reply-language-contract";
import {
  confirmOwnedBranchReplyLanguageAction,
  readOwnedBranchReplyLanguageAction,
} from "@/lib/tenancy/paid-reply-language-actions";
import { PaidAssistantTrial, type TrialSnapshot } from "./paid-assistant-trial";
import {
  askOwnedBranchAssistantTrialAction,
  recoverOwnedBranchAssistantTrialAction,
  releaseOwnedBranchAssistantTrialAction,
  readOwnedBranchAssistantTrialAction,
} from "@/lib/tenancy/paid-assistant-trial-actions";
import { PaidTeamInvitations, type BranchTeamSnapshot } from "./paid-team-invitations";
import {
  readOwnedBranchTeamAction,
  inviteOwnedBranchTeamAction,
  revokeOwnedBranchTeamAction,
} from "@/lib/tenancy/paid-team-actions";
import { PaidLaunchSummary, type LaunchSummarySnapshot } from "./paid-launch-summary";
import {
  confirmOwnedBranchLaunchAction,
  readOwnedBranchLaunchSummaryAction,
} from "@/lib/tenancy/paid-launch-actions";

const canceledRead=(error:unknown)=>error instanceof Error&&(error.name==='AbortError'||error.message==='SCOPE_CHANGED');

const KNOWN_FAILURE_CODES = new Set<AnswerFailureCode>([
  "NEEDS_SETUP",
  "NO_KNOWLEDGE",
  "APPROVAL_INCOMPLETE",
  "APPROVAL_FOUNDATION_UNAVAILABLE",
  "CONTEXT_OVERFLOW",
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "UNVERIFIED",
  "FORBIDDEN",
  "UNAVAILABLE",
]);

function normalizeTrialFailureCode(code: string): AnswerFailureCode {
  return KNOWN_FAILURE_CODES.has(code as AnswerFailureCode) ? (code as AnswerFailureCode) : "UNAVAILABLE";
}

export type PaidSetupStepHostProps = {
  reader?:SetupReader;
  locale: "ar" | "en";
  scope: { expectedAccountId: string; companyId: string; branchId: string; boundaryFingerprint: string };
  step: Exclude<ChecklistStepId, "whatsapp" | "instagram">;
  isCurrent: () => boolean;
  onRefresh?: () => void;
  onReadFailure?: (error:unknown) => void;
  read: PaidBranchSetupRead | null;
  onSelectStep?: (stepId: ChecklistStepId) => void;
};

export function PaidSetupStepHost(props: PaidSetupStepHostProps) {
 return <StepHost key={JSON.stringify([props.scope,props.step])} {...props}/>;
}
function StepHost(props: PaidSetupStepHostProps) {
  const { locale, scope, step, onRefresh,reader } = props;
  const runMutation=<T,>(request:Promise<T>,timeoutMs:number)=>{reader?.invalidate();return awaitSetupRequest(request,timeoutMs);};
  const readFailure=useRef(props.onReadFailure);
  useLayoutEffect(()=>{readFailure.current=props.onReadFailure;},[props.onReadFailure]);
  const mounted=useRef(true);
  const authority=useRef(props.isCurrent);
  useLayoutEffect(()=>{authority.current=props.isCurrent;},[props.isCurrent]);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const isCurrent=useCallback(()=>mounted.current&&authority.current(),[]);
  const { expectedAccountId, companyId, branchId } = scope;
  const isCurrentRef = useRef(isCurrent);
  useLayoutEffect(()=>{isCurrentRef.current=isCurrent;},[isCurrent]);
  const hoursInFlightKeyRef = useRef<string | null>(null);

  const [readVersion,setReadVersion]=useState(0);
  const retryRead=()=>{
    if(!isCurrentRef.current())return;
    if(step==="hours")setHoursPhase("loading");
    if(step==="knowledge"){setKnowledgePhase("loading");setLangPhase("loading");}
    if(step==="test"){setTrialPhase("loading");setTrialFailure(null);setTrialRequestId(null);}
    if(step==="team"){setTeamPhase("loading");setInviteUrl(null);}
    if(step==="launch")setLaunchPhase("loading");
    // A read refresh is not a branch mutation. Cancel only this step's reads:
    // aborting workspace enrichment here leaves the parent stuck on its shell.
    if(step==="hours")reader?.invalidate(["hours"]);
    if(step==="knowledge")reader?.invalidate(["knowledge","language"]);
    if(step==="test")reader?.invalidate(["trial"]);
    if(step==="team")reader?.invalidate(["team"]);
    if(step==="launch")reader?.invalidate(["launch"]);
    setReadVersion(v=>v+1);
  };
  const targetScope = useMemo(
    () => ({ expectedAccountId, companyId, branchId }),
    [expectedAccountId, companyId, branchId],
  );

  // 1. Hours step
  // Cached hours are presentation only: phase stays loading until a fresh read.
  const [hoursSnap, setHoursSnap] = useState<BranchHoursSnapshot | null>(()=>{const preview=reader?.peekHours();return preview?.ok?preview.snapshot:null;});
  const [hoursCopyTargets, setHoursCopyTargets] = useState<BranchHoursCopyTarget[]>(()=>{const preview=reader?.peekHours();return preview?.ok?preview.copyTargets:[];});
  const [hoursPhase, setHoursPhase] = useState<"loading" | "ready" | "saving" | "saved" | "conflict" | "unavailable">("loading");

  const hoursConfirmed = useRef(false);
  useEffect(() => {
    if (step !== "hours" || !isCurrentRef.current()) return;
    const scopeKey = `${expectedAccountId}:${companyId}:${branchId}:${readVersion}`;
    if (hoursInFlightKeyRef.current === scopeKey) return;
    hoursInFlightKeyRef.current = scopeKey;

    let active = true;
    // Slow reads must not flip to "unavailable" — that showed a false error banner while
    // the request could still succeed. Keep loading; apply late verified results when they arrive.
    void observeSetupRead(
      (reader?reader.read("hours"):readOwnedBranchHoursAction(targetScope)),
      () => {},
      10_000,
    ).then((res) => {
      if (!active || !isCurrentRef.current()) return;
      if (hoursInFlightKeyRef.current !== scopeKey) return;
      hoursInFlightKeyRef.current = null;
      if (res.ok && res.snapshot) {
        hoursConfirmed.current = true;
        setHoursSnap(res.snapshot);
        setHoursCopyTargets(res.copyTargets);
        setHoursPhase("ready");
      } else if (active && isCurrentRef.current()) {
        // Soft-fail: keep the last confirmed hours snapshot for this branch mount.
        setHoursPhase(hoursConfirmed.current ? "ready" : "unavailable");
      }
    }).catch((error) => {
      if (canceledRead(error)) return;
      if (active && isCurrentRef.current() && hoursInFlightKeyRef.current === scopeKey) {
        readFailure.current?.(error);
        hoursInFlightKeyRef.current = null;
        if (error instanceof SetupReadError && (error.kind === "auth" || error.kind === "scope")) {
          hoursConfirmed.current = false;
          setHoursSnap(null);
          setHoursCopyTargets([]);
        }
        setHoursPhase(hoursConfirmed.current ? "ready" : "unavailable");
      }
    });

    return () => {
      active = false;
      if (hoursInFlightKeyRef.current === scopeKey) {
        hoursInFlightKeyRef.current = null;
      }
    };
  }, [step, expectedAccountId, companyId, branchId, readVersion, targetScope,reader]);

  // 2. Knowledge + reply languages (same setup step)
  const [knowledgeSnap, setKnowledgeSnap] = useState<BranchKnowledgeViewSnapshot | null>(()=>reader?.peek?.('knowledge')??null);
  const [knowledgePhase, setKnowledgePhase] = useState<"loading" | "ready" | "busy" | "saved" | "conflict" | "unavailable">("loading");
  const [langSnap, setLangSnap] = useState<ReplyLanguageSnapshot | null>(()=>reader?.peek?.('language')??null);
  const [langPhase, setLangPhase] = useState<"loading" | "ready" | "saving" | "saved" | "error" | "conflict" | "unavailable">("loading");

  const knowledgeConfirmed = useRef(false);
  const languageConfirmed = useRef(false);
  useEffect(() => {
    if (step !== "knowledge" || !isCurrent()) return;
    let active = true;
    // Same soft-read policy as hours: slow/empty reads must not flip to "unavailable"
    // or the upload button locks while a file is already waiting.
    void observeSetupRead((reader?reader.read("knowledge"):readOwnedBranchKnowledgeAction(targetScope)),()=>{},10_000).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        knowledgeConfirmed.current = true;
        setKnowledgeSnap(snap);
        setKnowledgePhase("ready");
      } else {
        setKnowledgePhase(knowledgeConfirmed.current ? "ready" : "unavailable");
      }
    }).catch(error=>{if(!canceledRead(error)&&active&&isCurrent()){readFailure.current?.(error);if(error instanceof SetupReadError&&(error.kind==='auth'||error.kind==='scope')){knowledgeConfirmed.current=false;setKnowledgeSnap(null);}setKnowledgePhase(knowledgeConfirmed.current?"ready":"unavailable");}});
    void observeSetupRead((reader?reader.read("language"):readOwnedBranchReplyLanguageAction(targetScope)),()=>{},10_000).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        languageConfirmed.current = true;
        setLangSnap(snap);
        setLangPhase("ready");
      } else {
        setLangPhase(languageConfirmed.current ? "ready" : "unavailable");
      }
    }).catch(error=>{if(!canceledRead(error)&&active&&isCurrent()){readFailure.current?.(error);if(error instanceof SetupReadError&&(error.kind==='auth'||error.kind==='scope')){languageConfirmed.current=false;setLangSnap(null);}setLangPhase(languageConfirmed.current?"ready":"unavailable");}});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion,reader]);

  // 3. Test step
  const [trialSnap, setTrialSnap] = useState<TrialSnapshot | null>(()=>reader?.peek?.('trial')??null);
  const [trialPhase, setTrialPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");
  const [trialFailure, setTrialFailure] = useState<AnswerFailure | null>(null);
  const [trialRequestId, setTrialRequestId] = useState<string | null>(null);
  const lastTrialQuestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (step !== "test" || !isCurrent()) return;
    let active = true;
    void observeSetupRead((reader?reader.read("trial"):readOwnedBranchAssistantTrialAction(targetScope)),()=>{}).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setTrialSnap(snap);
        // Refresh confirms server authority only. A generic reload must not clear an
        // unresolved client failure into a free Send unless the snapshot allows ask
        // and has no pending hold.
        if (snap.pendingOperation) {
          setTrialFailure(null);
          setTrialRequestId(null);
          setTrialPhase("ready");
        } else if (snap.canAsk === true) {
          setTrialFailure(null);
          setTrialRequestId(null);
          setTrialPhase("ready");
        } else {
          setTrialPhase((phase) => (phase === "error" || phase === "unknown" ? "unknown" : "ready"));
        }
      } else {
        setTrialPhase("unavailable");
      }
    }).catch(error=>{if(!canceledRead(error)&&active&&isCurrent()){readFailure.current?.(error);if(error instanceof SetupReadError&&(error.kind==='auth'||error.kind==='scope'))setTrialSnap(null);setTrialPhase('unavailable');}});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion,reader]);

  // 4. Team step
  const [teamSnap, setTeamSnap] = useState<BranchTeamSnapshot | null>(()=>reader?.peek?.('team')??null);
  const [teamPhase, setTeamPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (step !== "team" || !isCurrent()) return;
    let active = true;
    void observeSetupRead(
      (reader ? reader.read("team") : readOwnedBranchTeamAction(targetScope)),
      () => {}
    ).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setTeamSnap(snap);
        setTeamPhase("ready");
      } else {
        setTeamPhase("unavailable");
      }
    }).catch(error=>{if(!canceledRead(error)&&active&&isCurrent()){readFailure.current?.(error);if(error instanceof SetupReadError&&(error.kind==='auth'||error.kind==='scope'))setTeamSnap(null);setTeamPhase('unavailable');}});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent, readVersion, reader]);

  // 5. Launch step
  const [launchSnap, setLaunchSnap] = useState<LaunchSummarySnapshot | null>(()=>reader?.peek?.('launch')??null);
  const [launchPhase, setLaunchPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "launch" || !isCurrent()) return;
    let active = true;
    void observeSetupRead((reader?reader.read("launch"):readOwnedBranchLaunchSummaryAction(targetScope)),()=>{}).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setLaunchSnap(snap);
        setLaunchPhase("ready");
      } else {
        setLaunchPhase("unavailable");
      }
    }).catch(error=>{if(!canceledRead(error)&&active&&isCurrent()){readFailure.current?.(error);if(error instanceof SetupReadError&&(error.kind==='auth'||error.kind==='scope'))setLaunchSnap(null);setLaunchPhase('unavailable');}});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion,reader]);

  const executeTrialAsk = async (input: { expectedAccountId: string; companyId: string; branchId: string; expectedVersion: number; knowledgeRevision: string; question: string; operationId?: string }) => {
    lastTrialQuestionRef.current = input.question;
    setTrialPhase("pending");
    setTrialFailure(null);
    setTrialRequestId(null);
    // Covers input counting (30s), generation (60s), and receipt settlement.
    const res = await runMutation(askOwnedBranchAssistantTrialAction(input), 150_000).catch(() => null);
    if (!isCurrent()) return;
    if (res?.ok) {
      setTrialSnap(res.snapshot);
      setTrialPhase("ready");
      onRefresh?.();
    } else if (!res || res.code === "TRIAL_PENDING" || res.code === "TRIAL_OUTCOME_UNKNOWN") {
      setTrialPhase("unknown");
      setTrialFailure(null);
      setTrialRequestId(null);
    } else {
      // Never invent a request id. Retry authority requires the server's retrySafe
      // plus a requestId the server actually returned (or the reserved operation id).
      const reqId = res.retrySafe === true ? (res.requestId ?? input.operationId ?? null) : (res.requestId ?? null);
      const retrySafe = res.retrySafe === true && !!reqId;
      setTrialRequestId(reqId);
      setTrialFailure({
        ok: false,
        code: normalizeTrialFailureCode(res.code),
        message: res.code,
        requestId: reqId ?? undefined,
        retrySafe,
      });
      setTrialPhase("error");
    }
  };

  switch (step) {
    case "hours":
      return (
        <PaidBranchHours
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
          snapshot={hoursSnap}
          state={{ scope: targetScope, version: hoursSnap?.version ?? null, phase: hoursPhase }}
          copyTargets={hoursCopyTargets}
          isCurrent={isCurrent}
          onSave={async (draft) => {
            setHoursPhase("saving");
            const res = await runMutation(saveOwnedBranchHoursAction(draft),60_000).catch(()=>null);
            if (!isCurrentRef.current()) return;
            if (res?.ok) {
              setHoursSnap(res.snapshot);
              setHoursPhase("saved");
              onRefresh?.();
            } else {
              setHoursPhase(res?.code === "conflict" ? "conflict" : "unavailable");
            }
          }}
          onCopy={async (draft) => {
            setHoursPhase("saving");
            const res = await runMutation(copyOwnedBranchHoursAction(draft),60_000).catch(()=>null);
            if (!isCurrentRef.current()) return;
            if (res?.ok) {
              setHoursCopyTargets(res.targets);
              setHoursPhase("ready");
              onRefresh?.();
            } else {
              setHoursPhase("unavailable");
            }
          }}
          onReload={retryRead}
        />
      );

    case "knowledge":
      return (
        <PaidBranchKnowledge
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
          snapshot={knowledgeSnap}
          languageSnapshot={langSnap}
          languageState={{ version: langSnap?.version ?? null, phase: langPhase }}
          onReload={retryRead}
          state={{ scope: targetScope, version: knowledgeSnap?.version ?? null, phase: knowledgePhase }}
          isCurrent={isCurrent}
          onAddWebsite={async (input) => {
            setKnowledgePhase("busy");
            const res = await runMutation(addOwnedBranchWebsiteAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setKnowledgeSnap(res);
              setKnowledgePhase("saved");
              onRefresh?.();
            } else {
              setKnowledgePhase("ready");
              throw new Error("knowledge_add_failed");
            }
          }}
          onPageAction={async (input) => {
            setKnowledgePhase("busy");
            const res = await runMutation(pageActionOwnedBranchKnowledgeAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setKnowledgeSnap(res);
              setKnowledgePhase("ready");
              onRefresh?.();
            } else {
              setKnowledgePhase("ready");
              throw new Error("knowledge_page_action_failed");
            }
          }}
          onSaveText={async input=>{
            setKnowledgePhase('busy');const result=await runMutation(saveOwnedBranchKnowledgeTextAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else{setKnowledgePhase('ready');throw new Error('knowledge_save_text_failed');}
          }}
          onUploadFiles={async input=>{
            setKnowledgePhase('busy');const result=await runMutation(uploadOwnedBranchKnowledgeFilesAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else{setKnowledgePhase('ready');throw new Error('knowledge_upload_failed');}
          }}
          onSourceMutation={async input=>{
            if(!isCurrent())return;
            setKnowledgePhase('busy');const result=await runMutation(mutateOwnedBranchKnowledgeSourceAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
          onRemovePage={async input=>{
            if(!isCurrent())return;
            setKnowledgePhase('busy');const result=await runMutation(removeOwnedBranchKnowledgePageAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
          onSourceApproval={async input=>{
            setKnowledgePhase('busy');const result=await runMutation(approveOwnedBranchKnowledgeSourceAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('ready');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
          onReprocessFile={async input=>{
            setKnowledgePhase('busy');const result=await runMutation(reprocessOwnedBranchKnowledgeFileAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('ready');onRefresh?.();}else setKnowledgePhase('ready');
          }}
          onConfirmLanguages={async (input) => {
            setLangPhase("saving");
            const res = await runMutation(confirmOwnedBranchReplyLanguageAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setLangSnap(res);
              setLangPhase("saved");
              onRefresh?.();
            } else {
              setLangPhase("conflict");
            }
          }}
        />
      );

    case "test":
      return (
        <PaidAssistantTrial
          onRefresh={retryRead}
          onRecover={async operationId => {
            if(!isCurrent())return;
            setTrialPhase("pending");
            const result=await runMutation(recoverOwnedBranchAssistantTrialAction({...targetScope,operationId}),60_000).catch(()=>null);
            if(!isCurrent())return;
            if(result?.ok){setTrialSnap(result.snapshot);setTrialFailure(null);setTrialRequestId(null);setTrialPhase("ready");onRefresh?.();}
            else setTrialPhase("unknown");
          }}
          onRelease={async operationId => {
            if(!isCurrent())return;
            setTrialPhase("pending");
            const result=await runMutation(releaseOwnedBranchAssistantTrialAction({...targetScope,operationId}),60_000).catch(()=>null);
            if(!isCurrent())return;
            if(result?.ok){setTrialSnap(result.snapshot);setTrialFailure(null);setTrialRequestId(null);setTrialPhase("ready");onRefresh?.();}
            else setTrialPhase("unknown");
          }}
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
          persona={props.read?.entitlement?.persona ?? null}
          snapshot={trialSnap}
          state={{
            scope: targetScope,
            version: trialSnap?.version ?? null,
            phase: trialPhase,
            requestId: trialRequestId,
            failure: trialFailure,
            canRetry: trialFailure?.retrySafe === true && !!trialRequestId,
          }}
          isCurrent={isCurrent}
          onAsk={executeTrialAsk}
          onRetry={async (input) => {
            const question = lastTrialQuestionRef.current;
            if (!question) return;
            await executeTrialAsk({ ...input, question, operationId: crypto.randomUUID() });
          }}
        />
      );

    case "team":
      return (
        <section>
          <PaidTeamInvitations
            locale={locale}
            scope={targetScope}
            boundaryFingerprint={scope.boundaryFingerprint}
            snapshot={teamSnap}
            inviteUrl={inviteUrl}
            onRevoke={async input => {
              if (!isCurrent()) return;
              setTeamPhase('pending'); setInviteUrl(null);
              const result = await runMutation(revokeOwnedBranchTeamAction(input), 60_000).catch(() => null);
              if (!isCurrent()) return;
              if (result?.ok) { setTeamSnap(result.snapshot); setTeamPhase('ready'); onRefresh?.(); }
              else setTeamPhase(result && !result.ok && result.code !== 'UNKNOWN' ? 'error' : 'unknown');
            }}
            onInvite={async input => {
              if (!isCurrent()) return;
              setTeamPhase('pending'); setInviteUrl(null);
              const result = await runMutation(inviteOwnedBranchTeamAction(input), 60_000).catch(() => null);
              if (!isCurrent()) return;
              if (result?.ok) { setTeamSnap(result.data.snapshot); setInviteUrl(result.data.inviteUrl); setTeamPhase('ready'); onRefresh?.(); }
              else setTeamPhase('unknown');
            }}
            state={{
              scope: targetScope,
              version: teamSnap?.version ?? null,
              phase: teamPhase,
              operationId: null,
              operation: null,
              canRetry: false,
              retrySafe: false,
            }}
            isCurrent={isCurrent}
          />
          {['unknown', 'error', 'unavailable'].includes(teamPhase) && (
            <button type="button" onClick={retryRead}>
              {locale === 'ar' ? 'تحديث حالة الدعوات' : 'Refresh invitations'}
            </button>
          )}
        </section>
      );

    case "launch":
      return (
        <PaidLaunchSummary
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
          snapshot={launchSnap}
          state={{ scope: targetScope, version: launchSnap?.version ?? null, phase: launchPhase }}
          isCurrent={isCurrent}
          onSelectStep={props.onSelectStep}
          onLaunch={async (input) => {
            setLaunchPhase("pending");
            const res = await runMutation(confirmOwnedBranchLaunchAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setLaunchSnap(res);
              setLaunchPhase("ready");
              onRefresh?.();
            } else {
              setLaunchPhase("unknown");
            }
          }}
          onRefresh={async()=>{
            if(!isCurrent())return;
            setLaunchPhase('loading');
            const result=await awaitSetupRequest((reader?reader.read("launch"):readOwnedBranchLaunchSummaryAction(targetScope)),60_000).catch(()=>null);
            if(!isCurrent())return;
            setLaunchSnap(result);setLaunchPhase(result?'ready':'unavailable');
          }}
        />
      );
  }
}
