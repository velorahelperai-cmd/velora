"use client";

import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import type {PaidBranchSetupRead} from "@/lib/tenancy/paid-setup-contracts";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {checklistSteps,paidChecklistFromRead,type ChecklistStepId,type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {PaidChannelView} from "./paid-channel-view";
import styles from "./paid-setup-workspace.module.css";
import type {PaidSetupWorkspaceRead} from "@/lib/tenancy/paid-setup-workspace-actions";
import {paidSetupActivation,type PaidSetupActivation} from '@/lib/tenancy/paid-setup-activation';
import {confirmSetupLeave} from './paid-setup-unsaved';

/** Hidden from /setup for now; PaidBranchHours stays mounted elsewhere later. */
const SETUP_HIDDEN_STEPS = new Set<ChecklistStepId>(["hours"]);

export function nextWorkspaceSelection(snapshot:PaidSetupWorkspaceRead,previous:ChecklistStepId|null):ChecklistStepId|null {
  const model=paidChecklistFromRead(snapshot.read,snapshot.scope);
  const steps=model?checklistSteps(model):[];
  if(!steps.length)return null;
  if(previous&&SETUP_HIDDEN_STEPS.has(previous))previous=null;
  const isConfirmedChannel=(channel:"whatsapp"|"instagram")=>{
    const proof=snapshot.connectionReads[channel],step=steps.find(item=>item.id===channel);
    return !!step&&snapshot.confirmedChannels.includes(channel)&&step.status==="verified"&&step.reasonCodes.length===0&&
      !!proof&&proof.sourceStatus==="ready"&&proof.expectedAccountId===snapshot.scope.expectedAccountId&&
      proof.companyId===snapshot.scope.companyId&&proof.branchId===snapshot.scope.branchId&&proof.channel===channel&&
      proof.connection.state==="connected"&&proof.connection.verified&&proof.connection.reasonCodes.length===0&&
      !!proof.connection.link&&Number.isSafeInteger(proof.connection.link.generation)&&proof.connection.link.generation>=1;
  };
  const stepOpen=(id:ChecklistStepId)=>{
    if(SETUP_HIDDEN_STEPS.has(id))return false;
    const step=steps.find(item=>item.id===id);
    if(!step)return false;
    if((id==='hours'||id==='knowledge'||id==='team')&&step.actionId!==null)return true;
    const dependencies=step.dependencyIds.every(dep=>SETUP_HIDDEN_STEPS.has(dep)||steps.some(item=>item.id===dep&&item.status==="verified"));
    if(id==="launch")return model!.launch.canRequest&&dependencies;
    return step.actionId!==null&&(step.status==="verified"||step.status==="skipped_optional"||(step.status==="pending"&&dependencies));
  };
  const nonChannelSteps=steps.filter(item=>item.id!=="whatsapp"&&item.id!=="instagram");
  // Count verified hidden steps (e.g. hours) so resume still advances past them.
  const businessSetupStarted=nonChannelSteps.some(item=>item.status==="verified");
  const nextIncompleteOpen=(fromIndex=0)=>steps.slice(fromIndex).find(item=>!SETUP_HIDDEN_STEPS.has(item.id)&&item.status!=="verified"&&item.status!=="skipped_optional"&&stepOpen(item.id))?.id??null;
  const nextBusinessIncomplete=nonChannelSteps.find(item=>!SETUP_HIDDEN_STEPS.has(item.id)&&item.status!=="verified"&&item.status!=="skipped_optional"&&stepOpen(item.id))?.id??null;
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
  // Editing these independent sections is not a readiness assertion. Their
  // own reads/writes verify native authority; trial and launch keep prerequisites.
  if((id==='hours'||id==='knowledge')&&step.actionId!==null)return true;
  const dependencies=step.dependencyIds.every(dep=>!available.includes(dep)||steps.some(item=>item.id===dep&&item.status==="verified"));
  if(id==="launch")return model.launch.canRequest&&dependencies;
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
  const titleId=useId(),navId=useId(),panelId=useId();
  const [expanded,setExpanded]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const shell=useRef<HTMLElement>(null);
  const previous=useRef(p.activeStepId);
  const isCurrent=p.isCurrent;
  const current=isCurrent();
  const model=p.read?paidChecklistFromRead(p.read,p.scope):null;
  const steps=model?checklistSteps(model):[];
  const visibleSteps=steps.filter(step=>p.availableStepIds.includes(step.id));
  const valid=current&&!!model&&model.branches.some(branch=>branch.id===p.scope.branchId)&&visibleSteps.length>0;
  const active=p.activeStepId;
  const allowed=!!active&&workspaceStepAllowed(p.read,p.scope,active,p.availableStepIds);
  const position=visibleSteps.findIndex(step=>step.id===active);
  const nextCandidate=position>=0&&position+1<visibleSteps.length?visibleSteps[position+1]:null;
  const nextAllowed=!!nextCandidate&&workspaceStepAllowed(p.read,p.scope,nextCandidate.id,p.availableStepIds);
  const nextBlockedReason=nextCandidate&&!nextAllowed?stepBlockedReason(nextCandidate.id,steps,model,p.locale):null;
  const activation=valid?paidSetupActivation(p.activation,p.scope.companyId,p.read?.entitlement?.orderGroupId):null;
  const entitlement=valid?p.read?.entitlement:null;
  const personaName=entitlement?({level_1:t('نورا','Noura'),level_2:t('لينا','Lina'),level_3:t('دانا','Dana')})[entitlement.persona]:'';
  useEffect(()=>{
    if(previous.current!==active&&isCurrent())heading.current?.focus();
    previous.current=active;
  },[active,isCurrent]);
  const select=(step:ChecklistStepId)=>{
    if(!p.isCurrent()||!workspaceStepAllowed(p.read,p.scope,step,p.availableStepIds))return;
    if(step!==active&&!confirmSetupLeave(shell.current,p.locale))return;
    setExpanded(false);
    if(step===active)heading.current?.focus();
    else p.onSelectStep(step);
  };
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
          <div className={styles.progressHeading}><strong>{t('رحلة التجهيز','Setup journey')}</strong><p><bdi dir="ltr">{model.progress.verified} / {model.progress.denominator}</bdi> {t("مكتملة","complete")}</p></div>
          <progress value={model.progress.verified} max={model.progress.denominator??undefined} aria-label={t("تقدم إعداد الفرع","Branch setup progress")}/>
        </div>
        <button className={styles.toggle} type="button" aria-expanded={expanded} aria-controls={navId} onClick={()=>setExpanded(value=>!value)}>
          {active&&p.availableStepIds.includes(active)?titles[active][ar?0:1]:t("خطوات الإعداد","Setup steps")} <span aria-hidden="true">{expanded?"−":"+"}</span>
        </button>
        <nav id={navId} className={styles.navigation} data-expanded={expanded} aria-label={t("خطوات إعداد المساعد","Assistant setup steps")}>
          <ol>{visibleSteps.map((step,index)=>{
            const enabled=workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds);
            const verified=step.status==="verified",skipped=step.status==="skipped_optional";
            const status=verified?t("مكتملة","Complete"):skipped?t("تم التخطي","Skipped"):step.status==="unavailable"&&!enabled?t("غير متاح","Unavailable"):!enabled?t("بانتظار المتطلبات","Waiting for prerequisites"):t("متاحة","Available");
            return <li key={step.id} data-step-id={step.id} data-state={step.status}>
              <button type="button" disabled={!enabled} aria-current={active===step.id?"step":undefined} aria-controls={panelId} onMouseEnter={()=>enabled&&p.isCurrent()&&p.onPrefetchStep?.(step.id)} onFocus={()=>enabled&&p.isCurrent()&&p.onPrefetchStep?.(step.id)} onClick={()=>select(step.id)}>
                <span className={styles.number} aria-hidden="true">{verified?"✓":index+1}</span>
                <span className={styles.stepText}><strong>{titles[step.id][ar?0:1]}</strong><small>{status}</small></span>
              </button>
            </li>;
          })}</ol>
        </nav>
        {nextCandidate&&(
          nextAllowed ? (
            <button type="button" className={styles.nextAction} onClick={()=>select(nextCandidate.id)}>
              <span>{t('الخطوة التالية','Next step')}</span>
              <strong>{titles[nextCandidate.id][ar?0:1]}</strong>
              <span aria-hidden="true">{ar?'←':'→'}</span>
            </button>
          ) : (
            <button type="button" className={styles.nextAction} disabled aria-disabled="true" title={nextBlockedReason??undefined}>
              <span>{t('الخطوة التالية','Next step')}</span>
              <strong>{titles[nextCandidate.id][ar?0:1]}</strong>
              {nextBlockedReason&&<small className={styles.nextActionBlocked}>{nextBlockedReason}</small>}
            </button>
          )
        )}
      </aside>
      <section id={panelId} className={styles.content} aria-labelledby={panelId+"-heading"}>
        <header className={styles.contentHeader}>
          <h2 id={panelId+"-heading"} ref={heading} tabIndex={-1} className={styles.srOnly}>{active?titles[active][ar?0:1]:t("اختر خطوة للمتابعة","Choose a step to continue")}</h2>
          <div className={styles.controls}>
            {previousStep&&<button type="button" onClick={()=>select(previousStep.id)}>{t("الخطوة السابقة","Previous step")}</button>}
            {nextCandidate&&(
              <button
                type="button"
                disabled={!nextAllowed}
                title={nextBlockedReason??undefined}
                onClick={()=>nextAllowed&&select(nextCandidate.id)}
              >
                {t("الخطوة التالية: ","Next step: ")}{titles[nextCandidate.id][ar?0:1]}
              </button>
            )}
          </div>
        </header>
        <div className={styles.body} key={active}>
          {!active||!allowed?<p role="status">{t("اختر خطوة متاحة. تُفتح الخطوات بعد تحقق متطلباتها.","Choose an available step. Steps open after their prerequisites are verified.")}</p>:
            active==="whatsapp"||active==="instagram"?<PaidChannelView locale={p.locale} scope={p.scope} read={p.read} channel={active} connectionRead={p.connectionReads?.[active]} isCurrent={p.isCurrent} onRefresh={refresh} hideStatusBadge={p.statusInHeader}/>:
              p.renderStep?.(active)??<p role="status">{t("هذه الشاشة غير متاحة بعد. لم تتغير حالة الخطوة.","This screen is not available yet. The step status has not changed.")}</p>}
        </div>
      </section>
    </div>}
  </section>;
}
