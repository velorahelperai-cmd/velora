"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "./paid-assistant-checklist.module.css";
import type { PaidBranchSetupRead, PaidBranchSetupEntryRead, PaidSetupStepId } from "@/lib/tenancy/paid-setup-contracts";
import {createMotionBudget,createMotionController,PERSONA_POSTERS,PERSONA_VIDEOS,TIER_NAMES} from "./setup-order-review-model";
import {setupBranchFromReturn,setupBranchPath} from "@/lib/auth/setup-return";
import {PaidSetupWorkspace,nextWorkspaceSelection} from "./paid-setup-workspace";
import {readOwnedPaidSetupWorkspaceAction,type PaidSetupWorkspaceRead} from "@/lib/tenancy/paid-setup-workspace-actions";

function subscribeSetupLocation(notify:()=>void) {
 const restore=(event:PageTransitionEvent)=>{if(event.persisted)window.location.reload();};
 window.addEventListener("popstate",notify);
 window.addEventListener("pageshow",restore);
 return ()=>{window.removeEventListener("popstate",notify);window.removeEventListener("pageshow",restore);};
}
const setupLocation=()=>window.location.pathname+window.location.search;

export type PaidSetupFlowProps={
 locale:"ar"|"en";
 scope:{expectedAccountId:string;companyId:string;boundaryFingerprint:string};
 /** Live session check, including the captured identity and boundary, after every await. */
 isCurrent:()=>boolean;
 readEntry:(input:{expectedAccountId:string;companyId:string})=>Promise<PaidBranchSetupEntryRead>;
 readBranch:(input:{expectedAccountId:string;companyId:string;branchId:string})=>Promise<PaidBranchSetupRead>;
 readWorkspace?:(input:{expectedAccountId:string;companyId:string;branchId:string})=>Promise<PaidSetupWorkspaceRead|null>;
};
export function PaidSetupFlow(p:PaidSetupFlowProps) {
 return <div className={styles.surface} dir={p.locale==="ar"?"rtl":"ltr"}><PaidSetupScope key={JSON.stringify(p.scope)} {...p}/></div>;
}
function PaidSetupScope(p:PaidSetupFlowProps) {
 const [attempt,setAttempt]=useState(0);
 return <PaidSetupEntry key={attempt} {...p} retry={()=>setAttempt(n=>n+1)}/>;
}
function PaidSetupEntry(p:PaidSetupFlowProps&{retry:()=>void}) {
 const [entry,setEntry]=useState<PaidBranchSetupEntryRead|null|undefined>(undefined);
 const location=useSyncExternalStore(subscribeSetupLocation,setupLocation,()=>"/setup");
 const [choice,setChoice]=useState<{location:string;id:string}|null>(null);
 const branchId=choice?.location===location?choice.id:setupBranchFromReturn(location);
 const generation=useRef(0);
 const {scope,isCurrent,readEntry}=p;
 useEffect(()=>{
  const request=++generation.current;let active=true;
  if(!isCurrent())return;
  void readEntry({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId}).then(result=>{
   if(active&&generation.current===request&&isCurrent())setEntry(result.companyId===scope.companyId?result:null);
  }).catch(()=>{if(active&&generation.current===request&&isCurrent())setEntry(null);});
  return()=>{active=false;};
 },[scope.expectedAccountId,scope.companyId,isCurrent,readEntry]);
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e;
 if(entry===undefined)return <PaidAssistantChecklist locale={p.locale} model={null} loading/>;
 if(!entry||entry.sourceStatus==="unavailable"||new Set(entry.branches.map(b=>b.id)).size!==entry.branches.length)return <PaidAssistantChecklist locale={p.locale} model={null} onRetry={p.retry}/>;
 return <div dir={ar?"rtl":"ltr"}>
  <section className={styles.page}><label className={styles.selector}>{t("اختر الفرع لإعداد مساعده","Choose a branch to set up its assistant")}<select aria-label={t("الفرع","Branch")} value={entry.branches.some(b=>b.id===branchId)?branchId:""} onChange={e=>{
   const id=e.target.value;
   if(!isCurrent()||!entry.branches.some(b=>b.id===id))return;
   const href=setupBranchPath(id);
   if(href!=="/setup"){window.history.replaceState(window.history.state,"",href);window.dispatchEvent(new PopStateEvent("popstate"));}
   setChoice({location:setupLocation(),id});
  }}><option value="" disabled>{t("اختر الفرع","Choose branch")}</option>{entry.branches.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
  {!entry.branches.length&&<p role="status">{t("لا توجد فروع مدفوعة متاحة للإعداد.","No paid branches are available for setup.")}</p>}
  {!branchId&&entry.branches.length>0&&<p role="status">{t("اختر فرعًا لعرض إعداداته.","Choose a branch to view its setup.")}</p>}</section>
  {branchId&&entry.branches.some(b=>b.id===branchId)&&<PaidSetupBranch key={branchId} {...p} branchId={branchId}/>}
 </div>;
}
function PaidSetupBranch(p:PaidSetupFlowProps&{branchId:string}) {
 const [attempt,setAttempt]=useState(0);
 return <PaidSetupBranchRead {...p} refreshVersion={attempt} retry={()=>setAttempt(n=>n+1)}/>;
}
function PaidSetupBranchRead(p:PaidSetupFlowProps&{branchId:string;refreshVersion:number;retry:()=>void}) {
 const [snapshot,setSnapshot]=useState<PaidSetupWorkspaceRead|null|undefined>(undefined);
 const [selected,setSelected]=useState<ChecklistStepId|null>(null);
 const generation=useRef(0);
 const {scope,isCurrent,branchId,refreshVersion}=p;
 const readWorkspace=p.readWorkspace??readOwnedPaidSetupWorkspaceAction;
 useEffect(()=>{
  const request=++generation.current;let active=true;
  if(!isCurrent())return;
  const input={expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId};
  void readWorkspace(input).then(result=>{
   if(!active||request!==generation.current||!isCurrent())return;
   if(!result||result.scope.expectedAccountId!==input.expectedAccountId||result.scope.companyId!==input.companyId||result.scope.branchId!==branchId||!paidChecklistFromRead(result.read,input)){setSnapshot(null);return;}
   setSnapshot(result);
   setSelected(previous=>nextWorkspaceSelection(result,previous));
  }).catch(()=>{if(active&&request===generation.current&&isCurrent())setSnapshot(null);});
  return()=>{active=false;};
 },[scope.expectedAccountId,scope.companyId,branchId,isCurrent,readWorkspace,refreshVersion]);
 const ar=p.locale==="ar",persona=snapshot?.read.entitlement?.persona;
 const knownPersona=persona==="level_1"||persona==="level_2"||persona==="level_3"?persona:null;
 const personaName=knownPersona?({level_1:ar?"نورا":"Noura",level_2:ar?"لينا":"Lina",level_3:ar?"دانا":"Dana"})[knownPersona]:undefined;
 return <PaidSetupWorkspace locale={p.locale} scope={{...scope,branchId}} read={snapshot?.read??null} loading={snapshot===undefined} activeStepId={selected} isCurrent={isCurrent} onSelectStep={setSelected} onRefresh={p.retry} availableStepIds={["whatsapp","instagram"]} connectionReads={snapshot?.connectionReads} persona={knownPersona?<><div className={styles.workspaceFigure}><PaidChecklistPersonaVisual persona={knownPersona} alt={personaName??""}/></div><p className={styles.workspacePersonaName}>{personaName}</p></>:undefined}/>;
}

const personaMotionBudget=createMotionBudget(1);
/** Preserve the approved asset identities. Noura's existing original plate remains
 * pending a full-body alpha source; never substitute Lina/Dana for that identity. */
export function PaidChecklistPersonaVisual({persona,alt}:{persona:keyof typeof PERSONA_POSTERS;alt:string}) {
 return <PersonaVisual key={persona} persona={persona} alt={alt}/>;
}
function PersonaVisual({persona,alt}:{persona:keyof typeof PERSONA_POSTERS;alt:string}) {
 const box=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);
 const controller=useRef<ReturnType<typeof createMotionController>|null>(null);
 const [play,setPlay]=useState(false);
 useEffect(()=>{
  if(!box.current)return;
  const motion=createMotionController({budget:personaMotionBudget,
   reducedQuery:typeof matchMedia==="function"?matchMedia("(prefers-reduced-motion: reduce)"):null,
   createObserver:typeof IntersectionObserver==="function"?cb=>{const observer=new IntersectionObserver(entries=>cb(entries[entries.length-1]?.isIntersecting??false),{threshold:0.25});return {observe:el=>observer.observe(el as Element),disconnect:()=>observer.disconnect()};}:null,
   isPageVisible:()=>document.visibilityState!=="hidden",
   subscribeVisibility:cb=>{document.addEventListener("visibilitychange",cb);return()=>document.removeEventListener("visibilitychange",cb);},
  },true,setPlay);
  controller.current=motion;motion.observe(box.current);
  return()=>{controller.current=null;motion.dispose();};
 },[]);
 useEffect(()=>{
  if(!play||!video.current)return;
  const element=video.current;let cancelled=false;
  element.muted=true;element.src=PERSONA_VIDEOS[persona];element.load();
  void element.play().catch(()=>{if(!cancelled)controller.current?.reportError();});
  return()=>{cancelled=true;element.pause();element.removeAttribute("src");element.load();};
 },[play,persona]);
 return <div ref={box} className={styles.personaVisual} data-persona={persona} data-motion={play?"playing":"poster"}>
  {/* eslint-disable-next-line @next/next/no-img-element -- original approved local poster, uncropped */}
  <img src={PERSONA_POSTERS[persona]} alt={alt} decoding="async"/>
  {play&&<video ref={video} muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} disablePictureInPicture disableRemotePlayback onPlaying={event=>{event.currentTarget.dataset.playing="true";}} onError={()=>controller.current?.reportError()}/>}
 </div>;
}
export type ChecklistStepId = "whatsapp"|"instagram"|"hours"|"knowledge"|"language"|"test"|"team"|"launch";
type Channel = "whatsapp"|"instagram";
type StepStatus = "blocked"|"pending"|"verified"|"skipped_optional"|"unavailable";
/** Local presentation boundary matching proposed B1; not a shared backend contract.
 * Counts, statuses and launch eligibility must originate from the server. */
export type PaidChecklistModel = {
 schemaVersion:1; sourceStatus:"ready"|"selection_required"|"unavailable";
 companyId:string; selectedBranchId:string|null; branches:readonly {id:string;label:string}[];
 entitlement:{slotIndex:number;persona:string;package:string;maxChannels:number;employeesExcludingOwner:number}|null;
 selectedChannels:readonly Channel[]|null;
 steps:readonly {id:ChecklistStepId;required:boolean;dependencyIds:readonly ChecklistStepId[];status:StepStatus;reasonCodes:readonly string[];actionId:string|null}[];
 progress:{denominator:number|null;verified:number;skippedOptional:number};
 launch:{confirmationRequired:true;confirmed:boolean;canRequest:boolean;blockedReasons:readonly string[]}; asOf:string;
};
const serverStepIds:Record<PaidSetupStepId,ChecklistStepId>={connect_whatsapp:"whatsapp",connect_instagram:"instagram",hours:"hours",knowledge:"knowledge",language:"language",assistant_test:"test",invitations:"team",launch:"launch"};
/** Translate IDs only. Never derive channel identity, counts or readiness from UI choices. */
export function paidChecklistFromRead(read:PaidBranchSetupRead,expected:{companyId:string;branchId:string}):PaidChecklistModel|null {
 if(read.companyId!==expected.companyId||read.selectedBranchId!==expected.branchId) return null;
 if(read.steps.some(step=>!serverStepIds[step.id]||step.dependencyIds.some(id=>!serverStepIds[id]))) return null;
 return {...read,steps:read.steps.map(step=>({...step,id:serverStepIds[step.id],dependencyIds:step.dependencyIds.map(id=>serverStepIds[id])}))};
}
const order:readonly ChecklistStepId[]=["whatsapp","instagram","hours","knowledge","language","test","team","launch"];
const subscribeHost = () => () => {};
const localHostSnapshot = () => ["localhost","127.0.0.1","[::1]"].includes(window.location.hostname);
const serverHostSnapshot = () => false;
export function checklistSteps(model:PaidChecklistModel) {
 const channels=model.selectedChannels;
 if(model.sourceStatus!=="ready"||!model.entitlement||!channels?.length||new Set(channels).size!==channels.length||channels.length>model.entitlement.maxChannels) return [];
 const ids=order.filter(id=>id!=="whatsapp"&&id!=="instagram"||channels.includes(id as Channel));
 if(model.steps.length!==ids.length||new Set(model.steps.map(s=>s.id)).size!==ids.length||!ids.every(id=>model.steps.some(s=>s.id===id))) return [];
 if(model.steps.some(s=>s.status==="skipped_optional"&&(s.id!=="team"||s.required))) return [];
 if(model.progress.denominator!==ids.length||model.progress.verified<0||model.progress.verified>ids.length) return [];
 return ids.map(id=>model.steps.find(s=>s.id===id)!);
}
const labels:Record<ChecklistStepId,[string,string,string,string]>={
 whatsapp:["ربط واتساب","Connect WhatsApp","اربط رقم نشاطك التجاري.","Connect your business number."],
 instagram:["ربط إنستجرام","Connect Instagram","اربط حساب نشاطك التجاري.","Connect your business account."],
 hours:["مواعيد العمل","Business hours","حدد مواعيد عمل الفرع.","Set this branch's business hours."],
 knowledge:["المعرفة","Knowledge","أضف معلومات نشاطك وخدماتك.","Add your business and service information."],
 language:["لغة الرد","Reply language","راجع الرد التلقائي بلغة العميل.","Review automatic replies in the customer's language."],
 test:["تجربة المساعد","Test assistant","اختبر المساعد قبل تشغيله.","Test your assistant before launch."],
 team:["دعوة الفريق","Invite team","أضف أعضاء فريقك لإدارة المحادثات.","Invite your team to manage conversations."],
 launch:["التشغيل","Launch","راجع الإعداد وأكد بدء التشغيل.","Review setup and explicitly confirm launch."],
};
export type PaidAssistantChecklistProps={
 locale:"ar"|"en"; model:PaidChecklistModel|null; loading?:boolean;
 personaName?:string; planName?:string;
 /** Reuse an approved original character component; never generate a replacement. */
 personaVisual?:ReactNode;
 onBranchChange?:(id:string)=>void;
 onOpenStep?:(branchId:string,stepId:ChecklistStepId,actionId:string)=>void;
 availableStepIds?:readonly ChecklistStepId[];
 /** No launch mutation callback: this only opens the separately authorized confirmation screen. */
 onReviewLaunch?:(branchId:string)=>void;
 onRetry?:()=>void;
 /** Explicit fixture-only presentation. Ignored in production; never reads URL/storage. */
 localFixtureInspection?:boolean;
 /** Only a local fixture may supply inert screen content here; never mount provider actions. */
 renderFixtureStep?:(stepId:ChecklistStepId)=>ReactNode;
};
export function PaidAssistantChecklist(p:PaidAssistantChecklistProps) {
 return <Checklist key={p.model?.companyId+":" + p.model?.selectedBranchId} {...p}/>;
}
function Checklist({locale,model,loading=false,personaName,planName,personaVisual,onBranchChange,onOpenStep,availableStepIds,onReviewLaunch,onRetry,localFixtureInspection=false,renderFixtureStep}:PaidAssistantChecklistProps) {
 const id=useId(),ar=locale==="ar",t=(a:string,e:string)=>ar?a:e;
 const [inspected,setInspected]=useState<ChecklistStepId|null>(null);
 const localHost=useSyncExternalStore(subscribeHost,localHostSnapshot,serverHostSnapshot);
 const fixture=process.env.NODE_ENV!=="production"&&localFixtureInspection&&localHost;
 const steps=model?checklistSteps(model):[];
 const pack=model?.entitlement?.package;
 const tierName=pack==="basic"||pack==="premium"?TIER_NAMES[pack][locale]:undefined;
 const shell=(content:ReactNode)=><section className={styles.page} dir={ar?"rtl":"ltr"} aria-labelledby={id}><h1 id={id}>{t("جهّز مساعدك","Set up your assistant")}</h1>{content}</section>;
 if(loading) return shell(<p role="status">{t("جارٍ تحميل إعداد الفرع…","Loading branch setup…")}</p>);
 if(!model||model.sourceStatus==="unavailable") return shell(<div role="alert"><p>{t("تعذر تحميل الإعداد. حاول مرة أخرى.","Setup could not be loaded. Try again.")}</p>{onRetry&&<button type="button" onClick={onRetry}>{t("إعادة المحاولة","Retry")}</button>}</div>);
 if(!model.branches.length) return shell(<p>{t("لا توجد فروع متاحة للإعداد.","No branches are available for setup.")}</p>);
 const selector=model.branches.length>1?<label className={styles.selector}>{t("الفرع","Branch")}<select value={model.selectedBranchId??""} disabled={!onBranchChange} onChange={e=>onBranchChange?.(e.target.value)}><option value="" disabled>{t("اختر الفرع","Choose branch")}</option>{model.branches.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}</select></label>:null;
 if(model.sourceStatus==="selection_required") return shell(<>{selector}<p role="status">{t("اختر قنوات هذا الفرع لإكمال الإعداد. لم يتم تأكيد اختيار القنوات بعد.","Select this branch's channels to continue. Channel selection has not yet been confirmed.")}</p></>);
 const branchId=model.selectedBranchId;
 if(!branchId||!model.branches.some(b=>b.id===branchId)||!steps.length||!model.entitlement||model.progress.denominator===null) return shell(<>{selector}<p role="alert">{t("إعداد الفرع غير متاح حاليًا. حدّث البيانات قبل المتابعة.","Branch setup is currently unavailable. Refresh the data before continuing.")}</p></>);
 const percent=Math.round(model.progress.verified/model.progress.denominator*100);
 return <section className={styles.page} dir={ar?"rtl":"ltr"} aria-labelledby={id}>
  <div className={styles.layout}><main className={styles.main}>
   <h1 id={id}>{t("جهّز مساعدك","Set up your assistant")}</h1><p className={styles.subtitle}>{t("أكمل إعداد الفرع لبدء استقبال عملائك.","Complete branch setup to start serving your customers.")}</p>{selector}
   <div className={styles.progress}><span><bdi dir="ltr">{model.progress.verified} / {model.progress.denominator}</bdi> {t("مكتملة","complete")}</span><progress value={model.progress.verified} max={model.progress.denominator} aria-label={t("تقدم إعداد الفرع","Branch setup progress")}/><span>{percent}%</span></div>
   {fixture&&<p className={styles.notice}>{t("معاينة محلية: يمكن استعراض الخطوات ٢–٦ دون تغيير اكتمال الإعداد أو تشغيل المساعد.","Local preview: inspect steps 2–6 without changing completion or launching the assistant.")}</p>}
   <ol className={styles.steps}>{steps.map((step,index)=>{
    const verified=step.status==="verified",skipped=step.status==="skipped_optional";
    const dependenciesReady=step.dependencyIds.every(dep=>steps.some(s=>s.id===dep&&(s.status==="verified"||(s.id==="team"&&s.status==="skipped_optional"))));
    const allowed=(verified||skipped||(step.status==="pending"&&dependenciesReady))&&step.actionId!==null;
    const launch=step.id==="launch";
    const canOpen=!fixture&&(launch?model.launch.canRequest&&dependenciesReady&&!!onReviewLaunch:allowed&&!!onOpenStep&&(!availableStepIds||availableStepIds.includes(step.id)));
    const preview=fixture&&index+1>=2&&index+1<=6&&!launch;
    return <li key={step.id} className={styles.row} data-step-id={step.id} data-state={step.status}>
     <span className={styles.number} aria-hidden="true">{verified?"✓":index+1}</span>
     <div className={styles.rowCopy}><h2>{labels[step.id][ar?0:1]}{step.id==="team"&&<small>{t("اختياري","Optional")}</small>}</h2><p>{labels[step.id][ar?2:3]}</p></div>
     <div className={styles.action}>{verified||skipped?<span>{verified?t("مكتملة","Complete"):t("تم التخطي","Skipped")}</span>:step.status==="unavailable"?<span>{t("غير متاح","Unavailable")}</span>:!canOpen&&!preview?<span>{t("بانتظار اكتمال المتطلبات","Waiting for prerequisites")}</span>:null}
      {preview?<button type="button" data-fixture-step={index+1} onClick={()=>setInspected(step.id)}>{t("استعراض","Inspect")}</button>:canOpen?<button type="button" onClick={()=>{if(launch)onReviewLaunch?.(branchId);else if(step.actionId)onOpenStep?.(branchId,step.id,step.actionId);}}>{verified||skipped?t("مراجعة","Review"):launch?t("مراجعة التشغيل","Review launch"):t("متابعة","Continue")}</button>:null}
     </div>
    </li>;
   })}</ol>
   {fixture&&inspected&&<section className={styles.notice} aria-label={t("استعراض محلي","Local inspection")}><p role="status">{t("استعراض محلي فقط: ","Local inspection only: ")}{labels[inspected][ar?0:1]}</p>{renderFixtureStep?.(inspected)??<p>{t("عرض الخطوة لا يثبت اكتمالها. محتوى الشاشة ينتظر ربط المكوّن المعتمد.","Viewing a step does not complete it. Screen content awaits the approved component integration.")}</p>}</section>}
   <p className={styles.notice}>{t("لن يرد المساعد على العملاء قبل تأكيد التشغيل.","The assistant will not reply to customers before launch confirmation.")}</p>
  </main><aside className={styles.persona} aria-label={t("مساعد الفرع","Branch assistant")}>
   {personaVisual&&<div className={styles.figure}>{personaVisual}</div>}<div><h2>{personaName??t("مساعدك","Your assistant")}</h2><p>{planName??tierName}</p><p className={styles.channels}>{model.selectedChannels?.map(c=>c==="whatsapp"?"WhatsApp":"Instagram").join(" + ")}</p><p>{t("مساعد فرعك للرد على العملاء وإدارة المحادثات.","Your branch assistant for customer replies and conversations.")}</p></div>
  </aside></div>
 </section>;
}

