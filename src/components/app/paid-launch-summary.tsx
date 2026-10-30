"use client";
import {useId,useLayoutEffect,useRef,useState} from "react";
import type {PaidBranchSetupRead,PaidSetupChannel,PaidSetupStepStatus} from "@/lib/tenancy/paid-setup-contracts";
import type {ChecklistStepId} from "./paid-assistant-checklist";
import styles from "./paid-launch-summary.module.css";

export type LaunchScope={expectedAccountId:string;companyId:string;branchId:string};
type SummaryItem={detail:string;status:PaidSetupStepStatus};

export type LaunchSummarySnapshot={
 scope:LaunchScope;version:number;branchLabel:string;
 setup:Pick<PaidBranchSetupRead,"companyId"|"selectedBranchId"|"sourceStatus"|"selectedChannels"|"entitlement"|"launch">;
 readiness:{status:"ready"|"blocked"|"unknown";revision:string|null;blockers:string[]};
 summary:{channels:{channel:PaidSetupChannel;detail:string;status:PaidSetupStepStatus}[];hours:SummaryItem;knowledge:SummaryItem;persona:SummaryItem;team:SummaryItem;languages?:SummaryItem};
 operationId:string|null;activation:{status:"not_started"|"launched"|"unknown";receiptId:string|null;operationId:string|null};
};

export type PaidLaunchSummaryProps={
 locale:"ar"|"en";scope:LaunchScope;boundaryFingerprint:string;snapshot:LaunchSummarySnapshot|null;
 state:{scope:LaunchScope;version:number|null;phase:"loading"|"ready"|"pending"|"error"|"unknown"|"unavailable"};
 isCurrent:()=>boolean;
 onSelectStep?:(stepId:ChecklistStepId)=>void;
 onLaunch?:(input:LaunchScope & {expectedVersion:number;readinessRevision:string;operationId:string;confirmed:true})=>void|Promise<void>;
 onRefresh?:(input:LaunchScope & {expectedVersion:number;operationId:string|null})=>void|Promise<void>;
};

const same=(a:LaunchScope,b:LaunchScope)=>!!a.expectedAccountId&&!!a.companyId&&!!a.branchId&&a.expectedAccountId===b.expectedAccountId&&a.companyId===b.companyId&&a.branchId===b.branchId;
const operationId=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const launchViewKey=(p:PaidLaunchSummaryProps)=>JSON.stringify([p.scope.expectedAccountId,p.scope.companyId,p.scope.branchId,p.boundaryFingerprint,p.snapshot?.version,p.snapshot?.readiness.revision,p.snapshot?.operationId,p.state.phase]);

export function hostAllowsLaunch(s:LaunchSummarySnapshot):boolean{
 const channels=s.setup.selectedChannels;
 return s.setup.sourceStatus==="ready"&&!!s.setup.entitlement&&!!channels?.length&&new Set(channels).size===channels.length&&channels.every(c=>c==="whatsapp"||c==="instagram")
  &&s.setup.launch.canRequest===true&&s.setup.launch.confirmationRequired===true&&s.setup.launch.confirmed===false&&s.setup.launch.blockedReasons.length===0
  &&s.readiness.status==="ready"&&!!s.readiness.revision?.trim()&&s.readiness.blockers.length===0&&s.activation.status==="not_started"&&s.activation.receiptId===null&&s.activation.operationId===null&&operationId(s.operationId);
}

export function blockerExplanation(reason:string,ar:boolean):{message:string;stepId?:ChecklistStepId}{
 if(reason==="trial_incomplete"){
  return {message:ar?"يلزم تجربة المساعد والتأكد من صحة إجاباته قبل التفعيل.":"Assistant trial must be completed and verified before activation.",stepId:"test"};
 }
 if(reason.startsWith("channel_unverified:")){
  const ch=reason.replace("channel_unverified:","");
  const chName=ch==="whatsapp"?(ar?"واتساب":"WhatsApp"):ch==="instagram"?(ar?"إنستغرام":"Instagram"):ch;
  return {message:ar?`يلزم ربط قناة ${chName} الخاصة بالفرع والتحقق من اتصالها.`:`Branch channel ${chName} must be connected and verified.`,stepId:ch==="whatsapp"||ch==="instagram"?ch:undefined};
 }
 if(reason==="hours_incomplete"){
  return {message:ar?"يلزم تحديد وحفظ مواعيد عمل الفرع.":"Branch business hours must be configured and saved.",stepId:"hours"};
 }
 if(reason==="knowledge_incomplete"){
  return {message:ar?"يلزم إضافة وتأكيد مصادر المعرفة للفرع.":"Branch knowledge sources must be added and verified.",stepId:"knowledge"};
 }
 if(reason==="language_unconfirmed"){
  return {message:ar?"يلزم تأكيد لغات الرد المعتمدة للفرع.":"Approved reply languages must be confirmed for the branch.",stepId:"knowledge"};
 }
 if(reason==="selection_required"){
  return {message:ar?"يلزم اختيار قنوات التفعيل المعتمدة للفرع.":"Branch channels must be selected.",stepId:"whatsapp"};
 }
 return {message:reason};
}

export function PaidLaunchSummary(p:PaidLaunchSummaryProps){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,scoped=!!p.boundaryFingerprint&&same(p.scope,p.state.scope);
 if(!scoped||(!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable")||(p.snapshot&&(!same(p.scope,p.snapshot.scope)||p.snapshot.setup.companyId!==p.scope.companyId||p.snapshot.setup.selectedBranchId!==p.scope.branchId||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||p.state.version!==p.snapshot.version)))
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("ملخص الإطلاق غير متاح لهذا الحساب والفرع. أعد تحميل البيانات.","The launch summary is unavailable for this account and branch. Reload the data.")}</p></section>;
 const item={detail:"—",status:"unavailable" as const};
 const presentation:LaunchSummarySnapshot=p.snapshot??{scope:p.scope,version:0,branchLabel:"—",setup:{companyId:p.scope.companyId,selectedBranchId:p.scope.branchId,sourceStatus:"unavailable",selectedChannels:null,entitlement:null,launch:{canRequest:false,confirmationRequired:true,confirmed:false,blockedReasons:[]}},readiness:{status:"unknown",revision:null,blockers:[]},summary:{channels:[],hours:item,knowledge:item,persona:item,team:item},operationId:null,activation:{status:"unknown",receiptId:null,operationId:null}};
 return <LaunchForm key={JSON.stringify([p.scope,p.boundaryFingerprint,p.snapshot?.version,p.snapshot?.readiness.revision,p.snapshot?.operationId])} {...p} snapshot={presentation}/>;
}

function LaunchForm(p:PaidLaunchSummaryProps & {snapshot:LaunchSummarySnapshot}){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId(),s=p.snapshot;
 const [ack,setAck]=useState(false),[pending,setPending]=useState(false),[unknown,setUnknown]=useState(false),[refreshing,setRefreshing]=useState(false),[refreshFailed,setRefreshFailed]=useState(false);
 const mounted=useRef(false),reserved=useRef(false),readReserved=useRef(false);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const canLaunch=p.state.phase==="ready"&&!pending&&!unknown&&!refreshing&&hostAllowsLaunch(s)&&!!p.onLaunch;
 const canRefresh=!pending&&!refreshing&&p.state.phase!=="pending"&&!!p.onRefresh;
 const launched=s.activation.status==="launched"&&!!s.activation.receiptId?.trim()&&operationId(s.activation.operationId)&&s.activation.operationId===s.operationId&&s.setup.launch.confirmed===true;
 const status=(v:PaidSetupStepStatus)=>({verified:t("مؤكد","Verified"),pending:t("قيد الإعداد","Pending"),blocked:t("يتطلب إجراء","Action needed"),skipped_optional:t("تم التخطي اختياريًا","Skipped optionally"),unavailable:t("غير متاح","Unavailable")}[v]??t("غير معروف","Unknown"));

 const pkg=s.setup.entitlement?.package;
 const personaKey=s.setup.entitlement?.persona;
 const personaName=s.summary.persona?.detail||(personaKey?({level_1:ar?"نورا":"Noura",level_2:ar?"لينا":"Lina",level_3:ar?"دانا":"Dana"})[personaKey]:"");
 const pkgLabel=pkg==="premium"?t("الباقة المتقدمة","Premium Plan"):t("الباقة الأساسية","Basic Plan");
 const currentPlanText=personaName?`${t("الباقة الحالية: ","Current plan: ")}${pkgLabel} (${personaName})`:`${t("الباقة الحالية: ","Current plan: ")}${pkgLabel}`;
 const renewalPolicyText=t("سياسة التغيير: يسري تعديل الباقة مع بداية دورة التجديد القادمة من إعدادات الحساب.","Change policy: Plan changes take effect at the start of the next renewal cycle via account settings.");
 const pkgDetail=`${currentPlanText}\n${renewalPolicyText}`;

 const channels=(s.setup.selectedChannels??[]).filter((v,i,a)=>["whatsapp","instagram"].includes(v)&&a.indexOf(v)===i);
 const rows:{key:string;label:string;item:SummaryItem;stepId?:ChecklistStepId}[]=[
  {key:"package",label:t("الباقة","Plan"),item:{detail:pkgDetail,status:s.setup.entitlement?"verified" as const:"unavailable" as const}},
  ...channels.map(channel=>({
   key:channel,
   label:channel==="whatsapp"?(ar?"واتساب":"WhatsApp"):(ar?"إنستغرام":"Instagram"),
   item:s.summary.channels.find(row=>row.channel===channel)??{detail:t("لم تتوفر حالة القناة.","Channel status is unavailable."),status:"unavailable" as const},
   stepId:channel as ChecklistStepId,
  })),
  {key:"hours",label:t("مواعيد العمل","Business hours"),item:s.summary.hours,stepId:"hours"},
  {key:"knowledge",label:t("المعرفة والبيانات","Knowledge base"),item:s.summary.knowledge,stepId:"knowledge"},
  {
   key:"languages",
   label:t("لغات الرد","Reply languages"),
   item:s.summary.languages??{
    detail:s.readiness.blockers.includes("language_unconfirmed")?t("بانتظار تأكيد لغات الرد","Pending language confirmation"):t("العربية والإنجليزية","Arabic & English"),
    status:(s.readiness.blockers.includes("language_unconfirmed")?"pending":"verified") as PaidSetupStepStatus,
   },
   stepId:"knowledge",
  },
  {key:"team",label:t("فريق العمل","Staff team"),item:s.summary.team,stepId:"team"},
 ];

 async function launch(){
  if(!canLaunch||!ack||reserved.current||!p.isCurrent())return;
  reserved.current=true;setPending(true);
  try{await p.onLaunch?.({...p.scope,expectedVersion:s.version,readinessRevision:s.readiness.revision!,operationId:s.operationId!,confirmed:true});}
  catch{if(mounted.current&&p.isCurrent())setUnknown(true);}
  finally{if(mounted.current&&p.isCurrent())setPending(false);}
 }
 async function refresh(){
  if(!canRefresh||readReserved.current||!p.isCurrent())return;readReserved.current=true;setAck(false);setRefreshing(true);setRefreshFailed(false);
  try{await p.onRefresh?.({...p.scope,expectedVersion:s.version,operationId:s.operationId});}
  catch{if(mounted.current&&p.isCurrent())setRefreshFailed(true);}
  finally{readReserved.current=false;if(mounted.current&&p.isCurrent())setRefreshing(false);}
 }

 return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={pending||refreshing||p.state.phase==="pending"||p.state.phase==="loading"}>
  {p.state.phase==="unavailable"&&<p role="status">{t("تعذر التحقق من ملخص الإطلاق.","Launch summary could not be verified.")}</p>}
  <header><h2 id={id}>{t("راجع ثم أكّد الإطلاق","Review and confirm launch")}</h2><p>{t("الفرع: ","Branch: ")}<bdi>{s.branchLabel}</bdi></p></header>
  <p className={styles.note}>{t("راجع الإعدادات المؤكدة لهذا الفرع. التأكيد الصريح يطلب الإطلاق؛ ولا يبدأ الرد على العملاء إلا بعد أن يؤكد النظام نجاح العملية.","Review this branch's confirmed settings. Explicit confirmation requests launch; customer replies begin only after the system confirms the operation succeeded.")}</p>
  <dl className={styles.summary}>{rows.map(({key,label,item,stepId})=><div key={key}><dt>{label}</dt><dd><div className={styles.itemBody}><p dir="auto">{item.detail}</p><span>{status(item.status)}</span></div>{stepId?(p.onSelectStep?<button type="button" className={styles.editBtn} onClick={()=>p.onSelectStep?.(stepId)}>{t("تعديل","Edit")}</button>:<a href={`/setup?step=${stepId}`} className={styles.editBtn}>{t("تعديل","Edit")}</a>):null}</dd></div>)}</dl>
  {!channels.length&&<p role="status">{t("لم تتوفر القنوات المدفوعة المختارة. الإطلاق معطّل.","Selected paid channels are unavailable. Launch is disabled.")}</p>}
  {launched&&p.state.phase==="ready"?<p role="status" className={styles.success}>{t("أكد النظام نجاح إطلاق هذا الفرع.","The system confirmed this branch was launched.")}</p>:<p role="status">{s.readiness.status==="ready"?t("وردت جاهزية الفرع من النظام. يلزم تأكيدك الصريح لإرسال طلب الإطلاق.","The system supplied branch readiness. Your explicit confirmation is required to request launch."):t("جاهزية الفرع لم تُؤكد بعد. راجع المتطلبات أدناه.","Branch readiness has not been confirmed. Review the requirements below.")}</p>}
  {(s.readiness.blockers.length>0||s.setup.launch.blockedReasons.length>0)&&(
   <aside className={styles.blockers} aria-label={t("موانع الإطلاق","Launch blockers")}>
    <p className={styles.blockersTitle}><strong>{t("متطلبات متبقية لتفعيل الفرع:","Remaining requirements before activation:")}</strong></p>
    <ul>{Array.from(new Set([...s.readiness.blockers,...s.setup.launch.blockedReasons])).map((reason,i)=>{
     const info=blockerExplanation(reason,ar);
     return <li key={`${i}:${reason}`} dir="auto" className={styles.blockerItem}>
      <span>{info.message}</span>
      {info.stepId&&(p.onSelectStep?<button type="button" className={styles.blockerAction} onClick={()=>p.onSelectStep?.(info.stepId!)}>{t("إكمال الإجراء","Take action")}</button>:<a href={`/setup?step=${info.stepId}`} className={styles.blockerAction}>{t("إكمال الإجراء","Take action")}</a>)}
     </li>;
    })}</ul>
   </aside>
  )}
  {(unknown||p.state.phase==="unknown"||(s.version>0&&s.activation.status==="unknown"))&&<p role="alert" className={styles.error}>{t("نتيجة الإطلاق غير معروفة. راجع حالة العملية؛ لا ترسل طلب إطلاق جديدًا.","The launch outcome is unknown. Check the operation status; do not submit a new launch request.")}</p>}
  {(p.state.phase==="error"||refreshFailed)&&<p role="alert" className={styles.error}>{t("تعذّر تأكيد الحالة الحالية. حدّث حالة العملية قبل المتابعة.","The current state could not be confirmed. Refresh the operation status before continuing.")}</p>}
  {(pending||p.state.phase==="pending")&&<p role="status">{t("بانتظار نتيجة الإطلاق المؤكدة…","Waiting for the confirmed launch result…")}</p>}
  <form onSubmit={e=>{e.preventDefault();void launch();}}>
   <label className={styles.check}><input type="checkbox" checked={ack} disabled={!canLaunch} onChange={e=>{if(p.isCurrent())setAck(e.target.checked);}}/>{t("راجعت إعدادات هذا الفرع وأؤكد طلب إطلاق المساعد على قنواته المختارة.","I reviewed this branch's settings and confirm requesting assistant launch on its selected channels.")}</label>
   <div className={styles.actions}><button type="submit" disabled={!canLaunch||!ack}>{t("تأكيد إطلاق الفرع","Confirm branch launch")}</button><button type="button" disabled={!canRefresh} onClick={()=>void refresh()}>{refreshing?t("جارٍ تحديث الحالة…","Refreshing status…"):t("تحديث حالة العملية","Refresh operation status")}</button></div>
  </form>
  {!p.onLaunch&&<p className={styles.note}>{t("طلب الإطلاق غير متصل بالتفعيل الفعلي بعد.","The launch request is not connected to actual activation yet.")}</p>}
 </section>;
}
