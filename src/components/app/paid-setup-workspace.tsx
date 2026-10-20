"use client";

import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import type {PaidBranchSetupRead} from "@/lib/tenancy/paid-setup-contracts";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {checklistSteps,paidChecklistFromRead,type ChecklistStepId,type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {PaidChannelView} from "./paid-channel-view";
import styles from "./paid-setup-workspace.module.css";
import type {PaidSetupWorkspaceRead} from "@/lib/tenancy/paid-setup-workspace-actions";

export function nextWorkspaceSelection(snapshot:PaidSetupWorkspaceRead,previous:ChecklistStepId|null):ChecklistStepId|null {
  const model=paidChecklistFromRead(snapshot.read,snapshot.scope);
  const steps=model?checklistSteps(model):[];
  if(!steps.length)return null;
  const selected=previous&&steps.some(step=>step.id===previous)?previous:steps[0]!.id;
  if(selected!=="whatsapp"&&selected!=="instagram")return selected;
  const proof=snapshot.connectionReads[selected],step=steps.find(item=>item.id===selected)!;
  if(!snapshot.confirmedChannels.includes(selected)||step.status!=="verified"||step.reasonCodes.length||
    !proof||proof.sourceStatus!=="ready"||proof.expectedAccountId!==snapshot.scope.expectedAccountId||
    proof.companyId!==snapshot.scope.companyId||proof.branchId!==snapshot.scope.branchId||proof.channel!==selected||
    proof.connection.state!=="connected"||!proof.connection.verified||proof.connection.reasonCodes.length||
    !proof.connection.link||!Number.isSafeInteger(proof.connection.link.generation)||proof.connection.link.generation<1)return selected;
  // Choosing the next screen never grants its controls readiness.
  return steps.slice(steps.findIndex(item=>item.id===selected)+1).find(item=>item.status!=="verified"&&item.status!=="skipped_optional")?.id??selected;
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
function Workspace(p:PaidSetupWorkspaceProps) {
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e;
  const titleId=useId(),navId=useId(),panelId=useId();
  const [expanded,setExpanded]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const previous=useRef(p.activeStepId);
  const isCurrent=p.isCurrent;
  const current=isCurrent();
  const model=p.read?paidChecklistFromRead(p.read,p.scope):null;
  const steps=model?checklistSteps(model):[];
  const valid=current&&!!model&&model.branches.some(branch=>branch.id===p.scope.branchId)&&steps.length>0;
  const active=p.activeStepId;
  const allowed=!!active&&workspaceStepAllowed(p.read,p.scope,active,p.availableStepIds);
  useEffect(()=>{
    if(previous.current!==active&&isCurrent())heading.current?.focus();
    previous.current=active;
  },[active,isCurrent]);
  const select=(step:ChecklistStepId)=>{
    if(!p.isCurrent()||!workspaceStepAllowed(p.read,p.scope,step,p.availableStepIds))return;
    setExpanded(false);
    if(step===active)heading.current?.focus();
    else p.onSelectStep(step);
  };
  const position=steps.findIndex(step=>step.id===active);
  const previousStep=steps.slice(0,Math.max(position,0)).reverse().find(step=>workspaceStepAllowed(p.read,p.scope,step.id,p.availableStepIds));
  return <section className={styles.workspace} dir={ar?"rtl":"ltr"} aria-labelledby={titleId}>
    <header className={styles.header}><h1 id={titleId}>{t("جهّز مساعدك","Set up your assistant")}</h1>
      <p>{t("أكمل إعداد الفرع لبدء استقبال عملائك.","Complete branch setup to start serving your customers.")}</p>
    </header>
    {!valid?<div className={styles.empty} role={p.loading?"status":"alert"}>
      <p>{p.loading?t("جارٍ تحميل إعدادات الفرع…","Loading branch setup…"):t("إعدادات الفرع غير متاحة حاليًا. تحقّق من الجلسة والاستحقاق ثم أعد المحاولة.","Branch setup is unavailable. Check your session and entitlement, then retry.")}</p>
      {p.onRefresh&&!p.loading&&<button type="button" onClick={()=>{if(p.isCurrent())p.onRefresh?.();}}>{t("إعادة المحاولة","Retry")}</button>}
    </div>:<div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.progress}>
          <p><bdi dir="ltr">{model.progress.verified} / {model.progress.denominator}</bdi> {t("مكتملة","complete")}</p>
          <progress value={model.progress.verified} max={model.progress.denominator??undefined} aria-label={t("تقدم إعداد الفرع","Branch setup progress")}/>
          {model.progress.skippedOptional>0&&<small>{t("دعوة الفريق متخطاة؛ لا تُحسب خطوة مكتملة.","Team invitation skipped; not counted as completed.")}</small>}
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
        <p className={styles.notice}>{t("لن يرد المساعد على العملاء قبل تأكيد التشغيل.","The assistant will not reply to customers before launch confirmation.")}</p>
      </aside>
      <section id={panelId} className={styles.content} aria-labelledby={panelId+"-heading"}>
        <header className={styles.contentHeader}>
          <h2 id={panelId+"-heading"} ref={heading} tabIndex={-1}>{active?titles[active][ar?0:1]:t("اختر خطوة للمتابعة","Choose a step to continue")}</h2>
          <div className={styles.controls}>
            {previousStep&&<button type="button" onClick={()=>select(previousStep.id)}>{t("الخطوة السابقة","Previous step")}</button>}
            {p.onRefresh&&<button type="button" onClick={()=>{if(p.isCurrent())p.onRefresh?.();}}>{t("تحديث الحالة","Refresh status")}</button>}
          </div>
        </header>
        <div className={styles.body} key={active}>
          {!active||!allowed?<p role="status">{t("اختر خطوة متاحة. تُفتح الخطوات بعد تحقق متطلباتها.","Choose an available step. Steps open after their prerequisites are verified.")}</p>:
            active==="whatsapp"||active==="instagram"?<PaidChannelView locale={p.locale} scope={p.scope} read={p.read} channel={active} connectionRead={p.connectionReads?.[active]}/>:
              p.renderStep?.(active)??<p role="status">{t("هذه الشاشة غير متاحة بعد. لم تتغير حالة الخطوة.","This screen is not available yet. The step status has not changed.")}</p>}
        </div>
      </section>
      {p.persona&&<aside className={styles.persona} aria-label={t("مساعد الفرع","Branch assistant")}>{p.persona}</aside>}
    </div>}
  </section>;
}
