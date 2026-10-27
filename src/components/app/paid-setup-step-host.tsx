"use client";

import { useEffect, useMemo, useState } from "react";
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
  addOwnedBranchWebsiteAction,
  pageActionOwnedBranchKnowledgeAction,
  readOwnedBranchKnowledgeAction,
  saveOwnedBranchKnowledgeTextAction,
  uploadOwnedBranchKnowledgeFilesAction,
  approveOwnedBranchKnowledgeSourceAction,
} from "@/lib/tenancy/paid-branch-knowledge-actions";
import { PaidReplyLanguage, type ReplyLanguageSnapshot } from "./paid-reply-language";
import {
  confirmOwnedBranchReplyLanguageAction,
  readOwnedBranchReplyLanguageAction,
} from "@/lib/tenancy/paid-reply-language-actions";
import { PaidAssistantTrial, type TrialSnapshot } from "./paid-assistant-trial";
import {
  askOwnedBranchAssistantTrialAction,
  readOwnedBranchAssistantTrialAction,
} from "@/lib/tenancy/paid-assistant-trial-actions";
import { PaidTeamInvitations } from "./paid-team-invitations";
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
  const { locale, scope, step, isCurrent, onRefresh } = props;
  const { expectedAccountId, companyId, branchId } = scope;
  const [readVersion,setReadVersion]=useState(0);
  const retryRead=()=>{if(isCurrent())setReadVersion(v=>v+1);};
  const targetScope = useMemo(
    () => ({ expectedAccountId, companyId, branchId }),
    [expectedAccountId, companyId, branchId],
  );

  // 1. Hours step
  const [hoursSnap, setHoursSnap] = useState<BranchHoursSnapshot | null>(null);
  const [hoursCopyTargets, setHoursCopyTargets] = useState<BranchHoursCopyTarget[]>([]);
  const [hoursPhase, setHoursPhase] = useState<"loading" | "ready" | "saving" | "saved" | "conflict" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "hours" || !isCurrent()) return;
    let active = true;
    void readOwnedBranchHoursAction(targetScope).then((res) => {
      if (!active || !isCurrent()) return;
      if (res.ok && res.snapshot) {
        setHoursSnap(res.snapshot);
        setHoursCopyTargets(res.copyTargets);
        setHoursPhase("ready");
      } else {
        setHoursPhase("unavailable");
      }
    }).catch(()=>{if(active&&isCurrent())setHoursPhase('unavailable');});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion]);

  // 2. Knowledge step
  const [knowledgeSnap, setKnowledgeSnap] = useState<BranchKnowledgeViewSnapshot | null>(null);
  const [knowledgePhase, setKnowledgePhase] = useState<"loading" | "ready" | "busy" | "saved" | "conflict" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "knowledge" || !isCurrent()) return;
    let active = true;
    void readOwnedBranchKnowledgeAction(targetScope).then((snap) => {
      if (!active || !isCurrent()) return;
      if (snap) {
        setKnowledgeSnap(snap);
        setKnowledgePhase("ready");
      } else {
        setKnowledgePhase("unavailable");
      }
    }).catch(()=>{if(active&&isCurrent())setKnowledgePhase('unavailable');});
    return () => {
      active = false;
    };
  }, [step, targetScope, isCurrent,readVersion]);

  // 3. Language step
  const [langSnap, setLangSnap] = useState<ReplyLanguageSnapshot | null>(null);
  const [langPhase, setLangPhase] = useState<"loading" | "ready" | "saving" | "error" | "conflict" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "language" || !isCurrent()) return;
    let active = true;
    void readOwnedBranchReplyLanguageAction(targetScope).then((snap) => {
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

  // 4. Test step
  const [trialSnap, setTrialSnap] = useState<TrialSnapshot | null>(null);
  const [trialPhase, setTrialPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "test" || !isCurrent()) return;
    let active = true;
    void readOwnedBranchAssistantTrialAction(targetScope).then((snap) => {
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

  // 5. Team step: authoritative invitation feature is pending integration; marked unavailable honestly
  // to avoid misleading success or synthetic data.

  // 6. Launch step
  const [launchSnap, setLaunchSnap] = useState<LaunchSummarySnapshot | null>(null);
  const [launchPhase, setLaunchPhase] = useState<"loading" | "ready" | "pending" | "error" | "unknown" | "unavailable">("loading");

  useEffect(() => {
    if (step !== "launch" || !isCurrent()) return;
    let active = true;
    void readOwnedBranchLaunchSummaryAction(targetScope).then((snap) => {
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

  const unavailableRead=(step==='hours'&&hoursPhase==='unavailable'&&!hoursSnap)||(step==='knowledge'&&knowledgePhase==='unavailable'&&!knowledgeSnap)||(step==='language'&&langPhase==='unavailable'&&!langSnap)||(step==='test'&&trialPhase==='unavailable'&&!trialSnap)||(step==='launch'&&launchPhase==='unavailable'&&!launchSnap);
  if(unavailableRead)return <section dir={locale==='ar'?'rtl':'ltr'}><p role="alert">{locale==='ar'?'تعذّر تحميل بيانات هذه الخطوة. لم تتغير حالة التجهيز.':'Unable to load this step. Setup status has not changed.'}</p><button type="button" onClick={retryRead}>{locale==='ar'?'إعادة المحاولة':'Retry'}</button></section>;
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
            const res = await saveOwnedBranchHoursAction(draft).catch(()=>null);
            if (!isCurrent()) return;
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
            const res = await copyOwnedBranchHoursAction(draft).catch(()=>null);
            if (!isCurrent()) return;
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
          onReload={retryRead}
          state={{ scope: targetScope, version: knowledgeSnap?.version ?? null, phase: knowledgePhase }}
          isCurrent={isCurrent}
          onAddWebsite={async (input) => {
            setKnowledgePhase("busy");
            const res = await addOwnedBranchWebsiteAction(input).catch(()=>null);
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
            const res = await pageActionOwnedBranchKnowledgeAction(input).catch(()=>null);
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
            setKnowledgePhase('busy');const result=await saveOwnedBranchKnowledgeTextAction(input).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('unavailable');
          }}
          onUploadFiles={async input=>{
            setKnowledgePhase('busy');const result=await uploadOwnedBranchKnowledgeFilesAction(input).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('saved');onRefresh?.();}else setKnowledgePhase('unavailable');
          }}
          onSourceApproval={async input=>{
            setKnowledgePhase('busy');const result=await approveOwnedBranchKnowledgeSourceAction(input).catch(()=>null);if(!isCurrent())return;
            if(result){setKnowledgeSnap(result);setKnowledgePhase('ready');onRefresh?.();}else setKnowledgePhase('conflict');
          }}
        />
      );

    case "language":
      return (
        <PaidReplyLanguage
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
          snapshot={langSnap}
          onReload={retryRead}
          state={{ scope: targetScope, version: langSnap?.version ?? null, phase: langPhase }}
          isCurrent={isCurrent}
          onConfirm={async (input) => {
            setLangPhase("saving");
            const res = await confirmOwnedBranchReplyLanguageAction(input).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setLangSnap(res);
              setLangPhase("ready");
              onRefresh?.();
            } else {
              setLangPhase("error");
            }
          }}
        />
      );

    case "test":
      return (
        <PaidAssistantTrial
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
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
            const res = await askOwnedBranchAssistantTrialAction(input).catch(()=>null);
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

    case "team":
      return (
        <PaidTeamInvitations
          locale={locale}
          scope={targetScope}
          boundaryFingerprint={scope.boundaryFingerprint}
          snapshot={null}
          state={{
            scope: targetScope,
            version: null,
            phase: "unavailable",
            operationId: null,
            operation: null,
            canRetry: false,
            retrySafe: false,
          }}
          isCurrent={isCurrent}
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
            const res = await confirmOwnedBranchLaunchAction(input).catch(()=>null);
            if (!isCurrent()) return;
            if (res) {
              setLaunchSnap(res);
              setLaunchPhase("ready");
              onRefresh?.();
            } else {
              setLaunchPhase("unknown");
            }
          }}
          onRefresh={retryRead}
        />
      );
  }
}
