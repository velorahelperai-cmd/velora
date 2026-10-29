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

export function nextWorkspaceSelection(snapshot:PaidSetupWorkspaceRead,previous:ChecklistStepId|null):ChecklistStepId|null {
  const model=paidChecklistFromRead(snapshot.read,snapshot.scope);
  const steps=model?checklistSteps(model):[];
  if(!steps.length)return null;
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
    const dependencies=step.dependencyIds.every(dep=>steps.some(item=>item.id===dep&&(item.status==="verified"||(item.id==="team"&&item.status==="skipped_optional"))));
    if(id==="launch")return model!.launch.canRequest&&dependencies;
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
    return nextIncompleteOpen(steps.findIndex(item=>item.id===selected)+1)??nextIncompleteOpen(0)??selected;
  }
  return selected;
}

const titles:Record<ChecklistStepId,readonly [string,string]>={
  whatsapp:["ربط واتساب","Connect WhatsApp"],instagram:["ربط إنستغرام","Connect Instagram"],
  hours:["مواعيد العمل","Business hours"],knowledge:["المعرفة","Knowledge"],
  language:["لغة الرد","Reply language"],test:["تجربة المساعد","Test assistant"],
  team:["دعوة الفريق","Invite team"],launch:["التشغيل","Launch"],
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
  const dependencies=step.dependencyIds.every(dep=>steps.some(item=>item.id===dep&&(item.status==="verified"||(item.id==="team"&&item.status==="skipped_optional"))));
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
   <aside className={styles.sidebar} aria-label={t('رحلة التجهيز','Setup journey')}><div className={styles.progressHeading}><strong>{t('رحلة التجهيز','Setup journey')}</strong></div><p className={loading?styles.srOnly:styles.pendingNote}>{loading?t('جارٍ جلب الحالة…','Fetching status…'):t('الحالة غير متاحة','Status unavailable')}</p>
     <div className={styles.skeletonRail} aria-hidden="true">{[0,1,2,3,4].map(key=><div key={key}><span/><span/></div>)}</div>
   </aside>
   <section className={styles.content} aria-label={t('محتوى المرحلة','Stage content')}><header className={styles.contentHeader}><h2>{t('إعداد الفرع','Branch setup')}</h2></header><div className={styles.empty} role={loading?'status':'alert'}><p className={loading?styles.srOnly:undefined}>{loading?t('جارٍ تحميل إعدادات الفرع…','Loading branch setup…'):t('إعدادات الفرع غير متاحة حاليًا. تحقّق من الجلسة والاستحقاق ثم أعد المحاولة.','Branch setup is unavailable. Check your session and entitlement, then retry.')}</p>{loading&&<div className={styles.skeletonContent} aria-hidden="true"><span/><span/><span/><div/></div>}{!loading&&onRetry&&<button type="button" onClick={onRetry}>{t('إعادة المحاولة','Retry')}</button>}</div></section>
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
  const valid=current&&!!model&&model.branches.some(branch=>branch.id===p.scope.branchId)&&steps.length>0;
  const active=p.activeStepId;
  const allowed=!!active&&workspaceStepAllowed(p.read,p.scope,active,p.availableStepIds);
  const nextStep=steps.find(step=>step.status!=='verified'&&step.status!=='skipped_optional'&&workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds));
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
  const position=steps.findIndex(step=>step.id===active);
  const previousStep=steps.slice(0,Math.max(position,0)).reverse().find(step=>workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds));
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
          {active?titles[active][ar?0:1]:t("خطوات الإعداد","Setup steps")} <span aria-hidden="true">{expanded?"−":"+"}</span>
        </button>
        <nav id={navId} className={styles.navigation} data-expanded={expanded} aria-label={t("خطوات إعداد المساعد","Assistant setup steps")}>
          <ol>{steps.map((step,index)=>{
            const enabled=workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds);
            const verified=step.status==="verified",skipped=step.status==="skipped_optional";
            const status=verified?t("مكتملة","Complete"):skipped?t("تم التخطي","Skipped"):step.status==="unavailable"?t("غير متاح","Unavailable"):!enabled?t("بانتظار المتطلبات","Waiting for prerequisites"):t("متاحة","Available");
            return <li key={step.id} data-step-id={step.id} data-state={step.status}>
              <button type="button" disabled={!enabled} aria-current={active===step.id?"step":undefined} aria-controls={panelId} onClick={()=>select(step.id)}>
                <span className={styles.number} aria-hidden="true">{verified?"✓":index+1}</span>
                <span className={styles.stepText}><strong>{titles[step.id][ar?0:1]}</strong><small>{status}{step.id==="team"?" · "+t("اختياري","Optional"):""}</small></span>
              </button>
            </li>;
          })}</ol>
        </nav>
        {nextStep&&<button type="button" className={styles.nextAction} onClick={()=>select(nextStep.id)}><span>{t('الخطوة التالية','Next step')}</span><strong>{titles[nextStep.id][ar?0:1]}</strong><span aria-hidden="true">{ar?'←':'→'}</span></button>}
      </aside>
      <section id={panelId} className={styles.content} aria-labelledby={panelId+"-heading"}>
        <header className={styles.contentHeader}>
          <h2 id={panelId+"-heading"} ref={heading} tabIndex={-1} className={styles.srOnly}>{active?titles[active][ar?0:1]:t("اختر خطوة للمتابعة","Choose a step to continue")}</h2>
          <div className={styles.controls}>
            {previousStep&&<button type="button" onClick={()=>select(previousStep.id)}>{t("الخطوة السابقة","Previous step")}</button>}
          </div>
        </header>
        <div className={styles.body} key={active}>
          {!active||!allowed?<p role="status">{t("اختر خطوة متاحة. تُفتح الخطوات بعد تحقق متطلباتها.","Choose an available step. Steps open after their prerequisites are verified.")}</p>:
            active==="whatsapp"||active==="instagram"?<PaidChannelView locale={p.locale} scope={p.scope} read={p.read} channel={active} connectionRead={p.connectionReads?.[active]} isCurrent={p.isCurrent} onRefresh={refresh} onContinueSetup={active==="whatsapp"&&workspaceStepAllowed(p.read,p.scope,"hours",p.availableStepIds)?()=>select("hours"):undefined} hideStatusBadge={p.statusInHeader}/>:
              p.renderStep?.(active)??<p role="status">{t("هذه الشاشة غير متاحة بعد. لم تتغير حالة الخطوة.","This screen is not available yet. The step status has not changed.")}</p>}
        </div>
      </section>
    </div>}
  </section>;
}
