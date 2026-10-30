"use client";

import {awaitSetupRequest,observeSetupRead} from "./paid-setup-request";
import { useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import type { ChecklistStepId } from "./paid-assistant-checklist";
import type { PaidBranchSetupRead } from "@/lib/tenancy/paid-setup-contracts";
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
  readOwnedBranchAssistantTrialAction,
} from "@/lib/tenancy/paid-assistant-trial-actions";
import { PaidLaunchSummary, type LaunchSummarySnapshot } from "./paid-launch-summary";
import {
  confirmOwnedBranchLaunchAction,
  readOwnedBranchLaunchSummaryAction,
} from "@/lib/tenancy/paid-launch-actions";

export type PaidSetupStepHostProps = {
  locale: "ar" | "en";
  scope: { expectedAccountId: string; companyId: string; branchId: string; boundaryFingerprint: string };
  step: Exclude<ChecklistStepId, "whatsapp" | "instagram">;
  isCurrent: () => boolean;
  onRefresh?: () => void;
  read: PaidBranchSetupRead | null;
};

export function PaidSetupStepHost(props: PaidSetupStepHostProps) {
 return <StepHost key={JSON.stringify([props.scope,props.step])} {...props}/>;
}
function StepHost(props: PaidSetupStepHostProps) {
  const { locale, scope, step, onRefresh } = props;
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
    if(step==="test")setTrialPhase("loading");
    if(step==="launch")setLaunchPhase("loading");
    setReadVersion(v=>v+1);
  };
  const targetScope = useMemo(
    () => ({ expectedAccountId, companyId, branchId }),
    [expectedAccountId, companyId, branchId],
  );

  // 1. Hours step
  const [hoursSnap, setHoursSnap] = useState<BranchHoursSnapshot | null>(null);
  const [hoursCopyTargets, setHoursCopyTargets] = useState<BranchHoursCopyTarget[]>([]);
  const [hoursPhase, setHoursPhase] = useState<"loading" | "ready" | "saving" | "saved" | "conflict" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "hours" || !isCurrentRef.current()) return;
    const scopeKey = `${expectedAccountId}:${companyId}:${branchId}:${readVersion}`;
    if (hoursInFlightKeyRef.current === scopeKey) return;
    hoursInFlightKeyRef.current = scopeKey;

    let active = true;
    void observeSetupRead(
      readOwnedBranchHoursAction(targetScope),
      () => {
        if (active && isCurrentRef.current() && hoursInFlightKeyRef.current === scopeKey) {
          setHoursPhase("unavailable");
        }
      },
      10_000,
    ).then((res) => {
      if (!active || !isCurrentRef.current()) return;
      if (hoursInFlightKeyRef.current !== scopeKey) return;
      hoursInFlightKeyRef.current = null;
      if (res.ok && res.snapshot) {
        setHoursSnap(res.snapshot);
        setHoursCopyTargets(res.copyTargets);
        setHoursPhase("ready");
      } else {
        setHoursPhase("unavailable");
      }
    }).catch(() => {
      if (active && isCurrentRef.current() && hoursInFlightKeyRef.current === scopeKey) {
        hoursInFlightKeyRef.current = null;
        setHoursPhase("unavailable");
      }
    });

    return () => {
      active = false;
      if (hoursInFlightKeyRef.current === scopeKey) {
        hoursInFlightKeyRef.current = null;
      }
    };
  }, [step, expectedAccountId, companyId, branchId, readVersion, targetScope]);

  // 2. Knowledge + reply languages (same setup step)
  const [knowledgeSnap, setKnowledgeSnap] = useState<BranchKnowledgeViewSnapshot | null>(null);
  const [knowledgePhase, setKnowledgePhase] = useState<"loading" | "ready" | "busy" | "saved" | "conflict" | "unavailable">("loading");
  const [langSnap, setLangSnap] = useState<ReplyLanguageSnapshot | null>(null);
  const [langPhase, setLangPhase] = useState<"loading" | "ready" | "saving" | "saved" | "error" | "conflict" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "knowledge" || !isCurrent()) return;
    let active = true;
    void observeSetupRead(readOwnedBranchKnowledgeAction(targetScope),()=>{if(active&&isCurrent())setKnowledgePhase("unavailable");}).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setKnowledgeSnap(snap);
        setKnowledgePhase("ready");
      } else {
        setKnowledgePhase("unavailable");
      }
    }).catch(()=>{if(active&&isCurrent())setKnowledgePhase('unavailable');});
    void observeSetupRead(readOwnedBranchReplyLanguageAction(targetScope),()=>{if(active&&isCurrent())setLangPhase("unavailable");}).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setLangSnap(snap);
        setLangPhase("ready");
      } else {
        setLangPhase("unavailable");
      }
    }).catch(()=>{if(active&&isCurrent())setLangPhase('unavailable');});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion]);

  // 3. Test step
  const [trialSnap, setTrialSnap] = useState<TrialSnapshot | null>(null);
  const [trialPhase, setTrialPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "test" || !isCurrent()) return;
    let active = true;
    void observeSetupRead(readOwnedBranchAssistantTrialAction(targetScope),()=>{if(active&&isCurrent())setTrialPhase("unavailable");}).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setTrialSnap(snap);
        setTrialPhase("ready");
      } else {
        setTrialPhase("unavailable");
      }
    }).catch(()=>{if(active&&isCurrent())setTrialPhase('unavailable');});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion]);

  // 5. Launch step
  const [launchSnap, setLaunchSnap] = useState<LaunchSummarySnapshot | null>(null);
  const [launchPhase, setLaunchPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "launch" || !isCurrent()) return;
    let active = true;
    void observeSetupRead(readOwnedBranchLaunchSummaryAction(targetScope),()=>{if(active&&isCurrent())setLaunchPhase("unavailable");}).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setLaunchSnap(snap);
        setLaunchPhase("ready");
      } else {
        setLaunchPhase("unavailable");
      }
    }).catch(()=>{if(active&&isCurrent())setLaunchPhase('unavailable');});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion]);

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
            const res = await awaitSetupRequest(saveOwnedBranchHoursAction(draft),60_000).catch(()=>null);
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
            const res = await awaitSetupRequest(copyOwnedBranchHoursAction(draft),60_000).catch(()=>null);
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
            const res = await awaitSetupRequest(addOwnedBranchWebsiteAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setKnowledgeSnap(res);
              setKnowledgePhase("saved");
              onRefresh?.();
            } else {
              setKnowledgePhase("unavailable");
            }
          }}
          onPageAction={async (input) => {
            setKnowledgePhase("busy");
            const res = await awaitSetupRequest(pageActionOwnedBranchKnowledgeAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setKnowledgeSnap(res);
              setKnowledgePhase("ready");
              onRefresh?.();
            } else {
              setKnowledgePhase("unavailable");
            }
          }}
          onSaveText={async input=>{
            setKnowledgePhase('busy');const result=await awaitSetupRequest(saveOwnedBranchKnowledgeTextAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('unavailable');
          }}
          onUploadFiles={async input=>{
            setKnowledgePhase('busy');const result=await awaitSetupRequest(uploadOwnedBranchKnowledgeFilesAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('unavailable');
          }}
          onSourceMutation={async input=>{
            if(!isCurrent())return;
            setKnowledgePhase('busy');const result=await awaitSetupRequest(mutateOwnedBranchKnowledgeSourceAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
          onRemovePage={async input=>{
            if(!isCurrent())return;
            setKnowledgePhase('busy');const result=await awaitSetupRequest(removeOwnedBranchKnowledgePageAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
          onSourceApproval={async input=>{
            setKnowledgePhase('busy');const result=await awaitSetupRequest(approveOwnedBranchKnowledgeSourceAction(input),60_000).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('ready');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
          onConfirmLanguages={async (input) => {
            setLangPhase("saving");
            const res = await awaitSetupRequest(confirmOwnedBranchReplyLanguageAction(input),60_000).catch(()=>null);
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
            const result=await awaitSetupRequest(recoverOwnedBranchAssistantTrialAction({...targetScope,operationId}),60_000).catch(()=>null);
            if(!isCurrent())return;
            if(result?.ok){setTrialSnap(result.snapshot);setTrialPhase("ready");onRefresh?.();}
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
            requestId: null,
            failure: null,
            canRetry: false,
          }}
          isCurrent={isCurrent}
          onAsk={async (input) => {
            setTrialPhase("pending");
            const res = await awaitSetupRequest(askOwnedBranchAssistantTrialAction(input),60_000).catch(()=>null);
            if (!isCurrent()) return;
            if (res?.ok && res.snapshot) {
              setTrialSnap(res.snapshot);
              setTrialPhase("ready");
              onRefresh?.();
            } else {
              setTrialPhase(!res || (!res.ok && (res.code === "TRIAL_PENDING" || res.code === "TRIAL_OUTCOME_UNKNOWN")) ? "unknown" : "error");
            }
          }}
        />
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
          onLaunch={async (input) => {
            setLaunchPhase("pending");
            const res = await awaitSetupRequest(confirmOwnedBranchLaunchAction(input),60_000).catch(()=>null);
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
            const result=await awaitSetupRequest(readOwnedBranchLaunchSummaryAction(targetScope),60_000).catch(()=>null);
            if(!isCurrent())return;
            setLaunchSnap(result);setLaunchPhase(result?'ready':'unavailable');
          }}
        />
      );
  }
}
