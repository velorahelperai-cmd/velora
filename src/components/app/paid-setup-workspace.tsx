"use client";

import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {flushSync} from "react-dom";
import type {PaidBranchSetupRead} from "@/lib/tenancy/paid-setup-contracts";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {checklistSteps,paidChecklistFromRead,type ChecklistStepId,type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {PaidChannelView} from "./paid-channel-view";
import styles from "./paid-setup-workspace.module.css";
import "./setup-step-transitions.css";
import type {PaidSetupWorkspaceRead} from "@/lib/tenancy/paid-setup-workspace-actions";
import {paidSetupActivation,type PaidSetupActivation} from '@/lib/tenancy/paid-setup-activation';
import {confirmSetupLeave,flushSetupDrafts} from './paid-setup-unsaved';

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { finished?: Promise<void> };
};

export function navigateSetupStep(dir: "forward" | "back", apply: () => void) {
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const doc = typeof document !== "undefined" ? (document as ViewTransitionDoc) : null;
  if (reduce || !doc || typeof doc.startViewTransition !== "function") {
    apply();
    return;
  }
  const root = doc.documentElement;
  root.dataset.setupSlide = dir;
  let applied = false;
  const runApply = () => {
    if (applied) return;
    applied = true;
    apply();
  };
  try {
    const transition = doc.startViewTransition.call(doc, () => {
      try {
        flushSync(runApply);
      } catch {
        runApply();
      }
    });
    if (transition && typeof transition.finished?.then === "function") {
      void transition.finished
        .catch(() => {})
        .finally(() => {
          if (root.dataset.setupSlide === dir) delete root.dataset.setupSlide;
        });
    } else {
      if (root.dataset.setupSlide === dir) delete root.dataset.setupSlide;
    }
  } catch {
    if (root.dataset.setupSlide === dir) delete root.dataset.setupSlide;
    runApply();
  }
}

export function nextWorkspaceSelection(snapshot:PaidSetupWorkspaceRead,previous:ChecklistStepId|null,provisional=false):ChecklistStepId|null {
  const model=paidChecklistFromRead(snapshot.read,snapshot.scope);
  const steps=model?checklistSteps(model):[];
  if(!steps.length)return null;
  // Shell readiness is incomplete; retain a valid selection until enrichment settles.
  if(provisional&&previous&&steps.some(step=>step.id===previous))return previous;
  const isConfirmedChannel=(channel:"whatsapp"|"instagram")=>{
    const proof=snapshot.connectionReads[channel],step=steps.find(item=>item.id===channel);
    return !!step&&snapshot.confirmedChannels.includes(channel)&&step.status==="verified"&&step.reasonCodes.length===0&&
      !!proof&&proof.sourceStatus==="ready"&&proof.expectedAccountId===snapshot.scope.expectedAccountId&&
      proof.companyId===snapshot.scope.companyId&&proof.branchId===snapshot.scope.branchId&&proof.channel===channel&&
      proof.connection.state==="connected"&&proof.connection.verified&&proof.connection.reasonCodes.length===0&&
      !!proof.connection.link&&Number.isSafeInteger(proof.connection.link.generation)&&proof.connection.link.generation>=1;
  };
  const stepOpen=(id:ChecklistStepId)=>{
    const step=steps.find(item=>item.id===id);
    if(!step)return false;
    if(id==="team"||id==="launch")return true;
    if((id==='hours'||id==='knowledge')&&step.actionId!==null)return true;
    const dependencies=step.dependencyIds.every(dep=>steps.some(item=>item.id===dep&&item.status==="verified"));
    return step.actionId!==null&&(step.status==="verified"||step.status==="skipped_optional"||(step.status==="pending"&&dependencies));
  };
  const nonChannelSteps=steps.filter(item=>item.id!=="whatsapp"&&item.id!=="instagram");
  const businessSetupStarted=nonChannelSteps.some(item=>item.status==="verified");
  const nextIncompleteOpen=(fromIndex=0)=>steps.slice(fromIndex).find(item=>item.status!=="verified"&&item.status!=="skipped_optional"&&stepOpen(item.id))?.id??null;
  const nextBusinessIncomplete=nonChannelSteps.find(item=>item.status!=="verified"&&item.status!=="skipped_optional"&&stepOpen(item.id))?.id??null;
  if(!previous||!steps.some(step=>step.id===previous)){
    if(businessSetupStarted&&nextBusinessIncomplete)return nextBusinessIncomplete;
    const first=steps[0]!.id;
    if((first==="whatsapp"||first==="instagram")&&isConfirmedChannel(first)){
      return nextIncompleteOpen(1)??first;
    }
    return first;
  }
  const selected=previous;
  if(selected==="whatsapp"||selected==="instagram"){
    if(!isConfirmedChannel(selected))return selected;
    return nextIncompleteOpen(steps.findIndex(item=>item.id===selected)+1)??selected;
  }
  const currentStep=steps.find(item=>item.id===selected);
  if(currentStep&&currentStep.status==="verified"){
    return nextIncompleteOpen(steps.findIndex(item=>item.id===selected)+1)??selected;
  }
  // sessionStorage / prior selection can stick on test while shell or
  // uncomposed readiness still marks assistant_test unavailable — do not
  // keep a closed step selected (empty "choose available step" pane).
  if(!stepOpen(selected)){
    return nextBusinessIncomplete??nextIncompleteOpen()??null;
  }
  return selected;
}

export function stepBlockedReason(
  stepId: ChecklistStepId,
  steps: readonly {id:ChecklistStepId;status:string;dependencyIds:readonly ChecklistStepId[]}[],
  model: ReturnType<typeof paidChecklistFromRead>,
  locale: "ar" | "en"
): string {
  const ar = locale === "ar", t = (a: string, e: string) => ar ? a : e;
  if (stepId === "launch" && model?.launch.blockedReasons?.length) {
    const first = model.launch.blockedReasons[0];
    if (first.startsWith("channel_unverified:whatsapp")) return t("بانتظار التحقق من ربط واتساب", "Awaiting WhatsApp connection verification");
    if (first.startsWith("channel_unverified:instagram")) return t("بانتظار التحقق من ربط إنستجرام", "Awaiting Instagram connection verification");
    if (first === "hours_incomplete") return t("بانتظار حفظ مواعيد العمل", "Awaiting business hours");
    if (first === "knowledge_incomplete") return t("بانتظار إضافة المعرفة", "Awaiting knowledge setup");
    if (first === "language_unconfirmed") return t("بانتظار تأكيد لغات الرد داخل المعرفة", "Awaiting reply languages in knowledge");
    if (first === "trial_incomplete") return t("بانتظار تجربة المساعد", "Awaiting assistant trial");
    return t("بانتظار متطلبات التشغيل", "Awaiting launch requirements");
  }
  const current = steps.find(item => item.id === stepId);
  const unmet = current?.dependencyIds.find(dep => {
    const s = steps.find(item => item.id === dep);
    return !s || s.status !== "verified";
  });
  if (unmet && titles[unmet]) {
    return t(`بانتظار: ${titles[unmet][0]}`, `Waiting for: ${titles[unmet][1]}`);
  }
  return t("بانتظار المتطلبات", "Prerequisites required");
}

const titles:Record<ChecklistStepId,readonly [string,string]>={
  whatsapp:["ربط واتساب","Connect WhatsApp"],instagram:["ربط إنستغرام","Connect Instagram"],
  hours:["مواعيد العمل","Business hours"],knowledge:["المعرفة واللغات","Knowledge & languages"],
  test:["تجربة المساعد","Test assistant"],team:["دعوة الفريق","Invite team"],launch:["التشغيل","Launch"],
};
export type PaidSetupWorkspaceProps={
  locale:"ar"|"en";
  scope:PaidSetupFlowProps["scope"]&{branchId:string};
  read:PaidBranchSetupRead|null;
  loading?:boolean;
  provisional?:boolean;
  /** Presentation selection only. The host changes this after fresh authoritative
   * reads; completing a guide or resolving a callback never advances this shell. */
  activeStepId:ChecklistStepId|null;
  availableStepIds:readonly ChecklistStepId[];
  isCurrent:()=>boolean;
  onSelectStep:(step:ChecklistStepId)=>void;
  onPrefetchStep?:(step:ChecklistStepId)=>void;
  onRefresh?:()=>void;
  connectionReads?:Partial<Record<"whatsapp"|"instagram",PaidBranchConnectionRead|null>>;
  /** Existing scoped leaves are supplied by the integration owner once released. */
  renderStep?:(step:Exclude<ChecklistStepId,"whatsapp"|"instagram">)=>ReactNode;
  persona?:ReactNode;
  activation?:PaidSetupActivation|null;
  statusInHeader?:boolean;
};

export function workspaceStepAllowed(read:PaidBranchSetupRead|null,scope:PaidSetupWorkspaceProps["scope"],id:ChecklistStepId,available:readonly ChecklistStepId[]):boolean {
  if(!read||!scope.expectedAccountId||!scope.boundaryFingerprint)return false;
  const model=paidChecklistFromRead(read,scope);
  if(!model||!model.branches.some(branch=>branch.id===scope.branchId))return false;
  const steps=checklistSteps(model),step=steps.find(item=>item.id===id);
  if(!step||!available.includes(id))return false;
  // Inspecting seats or launch blockers never grants mutation/activation authority.
  if(id==="team"||id==="launch")return true;
  // Editing these independent sections is not a readiness assertion. Their
  // own reads/writes verify native authority; trial dispatch keeps prerequisites.
  if((id==='hours'||id==='knowledge')&&step.actionId!==null)return true;
  const dependencies=step.dependencyIds.every(dep=>!available.includes(dep)||steps.some(item=>item.id===dep&&item.status==="verified"));
  return step.actionId!==null&&(step.status==="verified"||step.status==="skipped_optional"||(step.status==="pending"&&dependencies));
}

export function PaidSetupWorkspace(props:PaidSetupWorkspaceProps) {
  // Never carry collapsed-menu or leaf-local state across an identity boundary.
  return <Workspace key={JSON.stringify(props.scope)} {...props}/>;
}
/** The presentation frame does not depend on a successful setup read. Unknowns remain non-actionable. */
export function PaidSetupLoadingFrame({locale}:{locale:'ar'|'en'}){return <section className={styles.workspace} dir={locale==='ar'?'rtl':'ltr'} aria-busy="true"><PendingWorkspace locale={locale} loading/></section>;}
function PendingWorkspace({locale,loading,onRetry}:{locale:'ar'|'en';loading:boolean;onRetry?:()=>void}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 return <div className={styles.layout} data-setup-frame="pending">
   <aside className={styles.sidebar} aria-label={t('رحلة التجهيز','Setup journey')}>
     <div className={styles.progressHeading}><strong>{t('رحلة التجهيز','Setup journey')}</strong></div>
     <div className={styles.skeletonRail} aria-hidden="true">{Array.from({length:5},(_,index)=><div key={index}><span/><span/></div>)}</div>
   </aside>
   <section className={styles.content} aria-label={t('محتوى المرحلة','Stage content')}>
     {loading?<><span className={styles.srOnly} role="status">{t('جارٍ تحميل إعدادات الفرع…','Loading branch setup…')}</span><div className={styles.skeletonContent} aria-hidden="true"><span/><span/><span/><div/></div></>:
       <div className={styles.empty} role="alert"><p>{t('تعذّر تحميل إعدادات الفرع. تحقق من الجلسة ثم أعد المحاولة.','Branch setup could not be loaded. Check your session, then retry.')}</p>{onRetry&&<button type="button" onClick={onRetry}>{t('إعادة المحاولة','Retry')}</button>}</div>}
   </section>
 </div>;
}
function Workspace(p:PaidSetupWorkspaceProps) {
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e;
  const titleId=useId(),panelId=useId();
  const heading=useRef<HTMLHeadingElement>(null);
  const shell=useRef<HTMLElement>(null);
  const [confirmedProgress,setConfirmedProgress]=useState<{key:string;verified:number;denominator:number;statuses:Record<string,string>}|null>(null);
  const previous=useRef(p.activeStepId);
  const [stepMotion,setStepMotion]=useState<{index:number;enter:"forward"|"back"}>({index:-1,enter:"forward"});
  const isCurrent=p.isCurrent;
  const current=isCurrent();
  const model=p.read?paidChecklistFromRead(p.read,p.scope):null;
  const steps=model?checklistSteps(model):[];
  const visibleSteps=steps.filter(step=>p.availableStepIds.includes(step.id));
  const valid=current&&!!model&&model.branches.some(branch=>branch.id===p.scope.branchId)&&visibleSteps.length>0;
  // Never a dead-end: with no selection, present the first incomplete allowed step
  // (or the last allowed one when all are done). Presentation only; no navigation.
  const autoStep=p.activeStepId?null:(visibleSteps.find(step=>step.status!=="verified"&&workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds))
    ??[...visibleSteps].reverse().find(step=>workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds)))?.id??null;
  const active=p.activeStepId??autoStep;
  const allowed=!!active&&workspaceStepAllowed(p.read,p.scope,active,p.availableStepIds);
  const position=visibleSteps.findIndex(step=>step.id===active);
  if(position>=0){
    if(stepMotion.index===-1)setStepMotion({index:position,enter:"forward"});
    else if(stepMotion.index!==position)setStepMotion({index:position,enter:position<stepMotion.index?"back":"forward"});
  }
  const stepEnter=stepMotion.enter;
  const nextCandidate=position>=0&&position+1<visibleSteps.length?visibleSteps[position+1]:null;
  const nextAllowed=!!nextCandidate&&workspaceStepAllowed(p.read,p.scope,nextCandidate.id,p.availableStepIds);
  const nextBlockedReason=nextCandidate&&!nextAllowed?stepBlockedReason(nextCandidate.id,steps,model,p.locale):null;
  const activation=valid?paidSetupActivation(p.activation,p.scope.companyId,p.read?.entitlement?.orderGroupId):null;
  const entitlement=valid?p.read?.entitlement:null;
  const personaName=entitlement?({level_1:t('نورا','Noura'),level_2:t('لينا','Lina'),level_3:t('دانا','Dana')})[entitlement.persona]:'';
  useEffect(()=>{
    const chosen=p.activeStepId;
    if(previous.current!==chosen&&isCurrent())heading.current?.focus();
    previous.current=chosen;
  },[p.activeStepId,isCurrent]);
  // Never auto-navigate on refresh / readiness churn. Keep the user's step and
  // explain a real block in the panel so drafts (trial question, etc.) stay mounted.
  const activeBlockedReason=active&&!allowed&&valid?stepBlockedReason(active,steps,model,p.locale):null;
  const select=(step:ChecklistStepId)=>{
    if(!p.isCurrent()||!workspaceStepAllowed(p.read,p.scope,step,p.availableStepIds))return;
    if(step===active){heading.current?.focus();return;}
    // Start persistence synchronously so the write begins before unmount; never await network.
    void flushSetupDrafts(shell.current);
    if(!confirmSetupLeave(shell.current,p.locale))return;
    if(!p.isCurrent())return;
    const to=visibleSteps.findIndex(item=>item.id===step);
    const dir=to>=0&&position>=0&&to<position?"back":"forward";
    navigateSetupStep(dir,()=>p.onSelectStep(step));
  };
  // Segmented progress: only server-confirmed (non-provisional) reads fill segments.
  // While a provisional read loads, keep the last confirmed state for this same branch.
  const progressKey=`${p.scope.companyId}:${p.scope.branchId}`;
  const nextProgress=valid&&!p.provisional&&model?{key:progressKey,verified:model.progress.verified,denominator:model.progress.denominator??visibleSteps.length,statuses:Object.fromEntries(steps.map(step=>[step.id,step.status]))}:null;
  if(nextProgress&&JSON.stringify(nextProgress)!==JSON.stringify(confirmedProgress))setConfirmedProgress(nextProgress);
  const shownProgress=confirmedProgress?.key===progressKey?confirmedProgress:null;
  const progressText=shownProgress?t(`${shownProgress.verified} من ${shownProgress.denominator} مكتملة`,`${shownProgress.verified} of ${shownProgress.denominator} complete`):t('جارٍ التحقق من التقدم','Checking setup progress');
  const activeComplete=!!active&&steps.find(step=>step.id===active)?.status==="verified";
  const previousStep=visibleSteps.slice(0,Math.max(position,0)).reverse().find(step=>workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds));
  const refresh=()=>{if(p.isCurrent()&&confirmSetupLeave(shell.current,p.locale))p.onRefresh?.();};
  return <section ref={shell} className={styles.workspace} dir={ar?"rtl":"ltr"} aria-labelledby={titleId} aria-busy={p.loading||undefined}>
    <header className={p.loading||p.statusInHeader?styles.srOnly:styles.header}><div className={styles.introduction}><h1 id={titleId} className={p.statusInHeader?styles.srOnly:undefined}>{personaName?t(`جهّز ${personaName} لعملائك`,`Prepare ${personaName} for your customers`):t("جهّز مساعدك","Set up your assistant")}</h1>
      </div>
      {entitlement&&!p.statusInHeader&&<aside className={styles.planSummary} aria-label={t('ملخص الباقة والتفعيل','Plan and activation summary')}><div className={styles.planTop}><span>{t('باقة فرعك','Your branch plan')}</span><span className={styles.activationBadge} data-clock={activation?.clockState??'unknown'}>{activation?.clockState==='waiting_readiness'?t('المدة لم تبدأ','Period not started'):activation?.clockState==='active'?t('المدة بدأت','Period started'):activation?.clockState==='ended'?t('المدة انتهت','Period ended'):t('حالة المدة غير متاحة','Period status unavailable')}</span></div>
        <h2>{personaName} <span>· {entitlement.package==='basic'?t('القياسية','Standard'):t('المميزة','Premium')}</span></h2>
        <p>{model?.branches.find(b=>b.id===p.scope.branchId)?.label}{activation?` · ${activation.termUnit==='month'?t('شهرية','Monthly'):t('سنوية','Yearly')}`:''}</p>
        <dl><div><dt>{t('القنوات','Channels')}</dt><dd>{entitlement.maxChannels}</dd></div><div><dt>{t('مقاعد الفريق','Team seats')}</dt><dd>{entitlement.employeesExcludingOwner}</dd></div><div><dt>{t('التشغيل','Launch')}</dt><dd>{model?.launch.confirmed?t('مؤكد','Confirmed'):model?.launch.canRequest?t('بانتظار تأكيدك','Awaiting confirmation'):t('قيد التجهيز','In preparation')}</dd></div></dl>
      </aside>}
    </header>
    {!valid?<PendingWorkspace locale={p.locale} loading={!!p.loading} onRetry={p.onRefresh?refresh:undefined}/>:<div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.progress}>
          <div className={styles.progressHeading}><strong>{t('رحلة التجهيز','Setup journey')}</strong><p role="status">{shownProgress?new Intl.NumberFormat(ar?'ar':'en').format(shownProgress.verified)+' '+t('من','of')+' '+new Intl.NumberFormat(ar?'ar':'en').format(shownProgress.denominator)+' '+t('مكتملة','complete'):progressText}</p></div>
          <nav className={styles.stepMap} aria-label={t('خطوات التجهيز','Setup steps')} aria-busy={p.provisional||undefined}>
            <ol>{visibleSteps.map((step,index)=>{
              const complete=shownProgress?.statuses[step.id]==='verified';
              const current=active===step.id;
              const enabled=workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds);
              const label=titles[step.id][ar?0:1];
              return <li key={step.id} data-current={current||undefined} data-complete={complete||undefined}>
                <button type="button" disabled={!enabled} aria-current={current?'step':undefined} aria-label={`${label} — ${complete?t('مكتملة','Complete'):current?t('الحالية','Current'):enabled?t('متاحة','Available'):t('غير متاحة بعد','Not available yet')}`} onClick={()=>select(step.id)}>
                  <span className={styles.stepCircle} aria-hidden="true">{complete?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4 10-10"/></svg>:new Intl.NumberFormat(ar?'ar':'en').format(index+1)}</span>
                  <span className={styles.stepName}>{label}</span>
                </button>
              </li>;
            })}</ol>
          </nav>
        </div>
      </aside>
      <section id={panelId} className={styles.content} aria-labelledby={panelId+"-heading"}>
        <header className={styles.contentHeader}>
          <h2 id={panelId+"-heading"} ref={heading} tabIndex={-1} className={styles.srOnly}>{active?titles[active][ar?0:1]:t("اختر خطوة للمتابعة","Choose a step to continue")}</h2>
          {position>=0&&<p className={styles.stepPosition}>{t(`الخطوة ${position+1} من ${visibleSteps.length}`,`Step ${position+1} of ${visibleSteps.length}`)}</p>}
        </header>
        <div className={styles.body} key={active} data-step={active??undefined} data-enter={stepEnter}>
          {!active?<p role="status">{t("اختر خطوة متاحة. تُفتح الخطوات بعد تحقق متطلباتها.","Choose an available step. Steps open after their prerequisites are verified.")}</p>:
            <>
              {activeBlockedReason&&<p role="status" data-setup-step-blocked="true">{activeBlockedReason}</p>}
              {active==="whatsapp"||active==="instagram"?<PaidChannelView locale={p.locale} scope={p.scope} read={p.read} channel={active} connectionRead={p.connectionReads?.[active]} isCurrent={p.isCurrent} onRefresh={refresh} hideStatusBadge={p.statusInHeader}/>:
                p.renderStep?.(active)??<p role="status">{t("هذه الشاشة غير متاحة بعد. لم تتغير حالة الخطوة.","This screen is not available yet. The step status has not changed.")}</p>}
            </>}
        </div>
        {(previousStep||nextCandidate)&&<footer className={styles.contentFooter}>
          <div className={styles.controls}>
            <div className={styles.controlSlot} data-slot="previous">
              {previousStep&&<button type="button" data-previous-step="" onClick={()=>select(previousStep.id)}>{t("الخطوة السابقة","Previous step")}</button>}
            </div>
            <div className={styles.controlSlot} data-slot="next">
              {nextCandidate&&(
                <button
                  type="button"
                  className={styles.nextAction}
                  data-next-step=""
                  data-step-complete={activeComplete||undefined}
                  disabled={!nextAllowed}
                  title={nextBlockedReason??undefined}
                  onClick={()=>nextAllowed&&select(nextCandidate.id)}
                >
                  {t("الخطوة التالية: ","Next step: ")}{titles[nextCandidate.id][ar?0:1]}
                </button>
              )}
            </div>
          </div>
          <p className={styles.nextActionBlocked} data-next-step="" data-step-complete={activeComplete||undefined} hidden={!nextBlockedReason}>{nextBlockedReason}</p>
        </footer>}
      </section>
    </div>}
  </section>;
}
