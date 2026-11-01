"use client";
import {setupPlanLabel} from "./setup-plan-label";
import {useId,useLayoutEffect,useRef,useState} from "react";
import type {PaidBranchSetupRead,PaidSetupChannel,PaidSetupStepStatus} from "@/lib/tenancy/paid-setup-contracts";
import type {ChecklistStepId} from "./paid-assistant-checklist";
import styles from "./paid-launch-summary.module.css";

export type LaunchScope={expectedAccountId:string;companyId:string;branchId:string};
type SummaryItem={detail:string;status:PaidSetupStepStatus|"optional"};

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
 const unknown={message:ar?"تعذّر تأكيد أحد متطلبات الإطلاق. حدّث الحالة وحاول مجددًا.":"A launch requirement could not be confirmed. Refresh the status and try again."};
 if(reason==="trial_incomplete"){
  return {message:ar?"التجربة السابقة لم تعد مطابقة لإعدادات الفرع الحالية (مثل المواعيد أو المعرفة أو اللغة). اسأل سؤالًا واحدًا من جديد في تجربة المساعد ثم ارجع هنا.":"A previous assistant trial no longer matches the current branch settings (such as hours, knowledge, or language). Ask one new question in the assistant trial, then return here.",stepId:"test"};
 }
 if(reason.startsWith("channel_unverified:")){
  const ch=reason.replace("channel_unverified:","");
  if(ch!=="whatsapp"&&ch!=="instagram")return unknown;
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
 return unknown;
}

export function PaidLaunchSummary(p:PaidLaunchSummaryProps){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,scoped=!!p.boundaryFingerprint&&same(p.scope,p.state.scope);
 if(!scoped||(!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable")||(p.snapshot&&(!same(p.scope,p.snapshot.scope)||p.snapshot.setup.companyId!==p.scope.companyId||p.snapshot.setup.selectedBranchId!==p.scope.branchId||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||p.state.version!==p.snapshot.version)))
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("ملخص الإطلاق غير متاح لهذا الحساب والفرع. أعد تحميل البيانات.","The launch summary is unavailable for this account and branch. Reload the data.")}</p></section>;
 if(!p.snapshot&&p.state.phase==="loading")return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-busy="true" aria-label={t("ملخص الإطلاق","Launch summary")}><h2>{t("راجع ثم أكّد الإطلاق","Review and confirm launch")}</h2><p role="status" className={styles.note}>{t("جارٍ تحميل ملخص الفرع…","Loading branch summary…")}</p><div className={styles.loadingRows} aria-hidden="true">{Array.from({length:5},(_,i)=><div key={i}/>)}</div></section>;
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
 const canRefresh=!pending&&!refreshing&&p.state.phase!=="pending"&&p.state.phase!=="loading"&&!!p.onRefresh;
 const launched=s.activation.status==="launched"&&!!s.activation.receiptId?.trim()&&operationId(s.activation.operationId)&&s.activation.operationId===s.operationId&&s.setup.launch.confirmed===true;
 const status=(v:SummaryItem["status"])=>({optional:t("اختياري","Optional"),verified:t("مؤكد","Verified"),pending:t("قيد الإعداد","Pending"),blocked:t("يتطلب إجراء","Action needed"),skipped_optional:t("تم التخطي اختياريًا","Skipped optionally"),unavailable:t("غير متاح","Unavailable")}[v]??t("غير معروف","Unknown"));

 const pkg=s.setup.entitlement?.package;
 const personaKey=s.setup.entitlement?.persona;
 const personaName=s.summary.persona?.detail||(personaKey?({level_1:ar?"نورا":"Noura",level_2:ar?"لينا":"Lina",level_3:ar?"دانا":"Dana"})[personaKey]:"");
 const pkgLabel=setupPlanLabel(p.locale,pkg);
 const pkgDetail=personaName?`${t("الباقة الحالية: ","Current plan: ")}${pkgLabel} (${personaName})`:`${t("الباقة الحالية: ","Current plan: ")}${pkgLabel}`;

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
  {key:"knowledge",label:t("المعرفة واللغات","Knowledge & languages"),item:(()=>{
   const base=s.summary.knowledge;
   const lang=s.summary.languages;
   if(s.readiness.blockers.includes("language_unconfirmed")||lang?.status==="pending"){
    return {detail:lang?.detail?.trim()||t("يلزم تأكيد لغات الرد ضمن خطوة المعرفة.","Confirm reply languages inside the knowledge step."),status:"pending" as const};
   }
   if(lang?.status==="verified"&&lang.detail?.trim()){
    return {detail:`${base.detail}\n${lang.detail}`,status:base.status};
   }
   return base;
  })(),stepId:"knowledge"},
  {key:"test",label:t("تجربة المساعد","Assistant trial"),item:(()=>{
   const incomplete=s.readiness.blockers.includes("trial_incomplete");
   if(incomplete)return {detail:t("يلزم تجربة مطابقة للإعدادات الحالية.","A matching assistant trial is required for the current settings."),status:"pending" as const};
   if(s.readiness.status==="unknown")return {detail:t("تعذّر التحقق من تجربة المساعد.","Assistant trial could not be verified."),status:"unavailable" as const};
   return {detail:t("تم التحقق من تجربة المساعد.","Assistant trial verified."),status:"verified" as const};
  })(),stepId:"test"},
  {key:"team",label:t("فريق العمل","Staff team"),item:s.summary.team.status==="optional"?{...s.summary.team,detail:t("دعوة الفريق اختيارية ولا تمنع الإطلاق.","Inviting your team is optional and does not prevent launch.")}:s.summary.team,stepId:"team"},
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
  <header><h2 id={id}>{t("راجع ثم أكّد الإطلاق","Review and confirm launch")}</h2></header>
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
  {launched&&p.state.phase==="ready"&&<a className={styles.dashboardLink} href="/app">{t("فتح لوحة التحكم","Open dashboard")}</a>}
  <form onSubmit={e=>{e.preventDefault();void launch();}}>
   <label className={styles.check}><input type="checkbox" checked={ack} disabled={!canLaunch} onChange={e=>{if(p.isCurrent())setAck(e.target.checked);}}/>{t("راجعت إعدادات هذا الفرع وأؤكد طلب إطلاق المساعد على قنواته المختارة.","I reviewed this branch's settings and confirm requesting assistant launch on its selected channels.")}</label>
   <div className={styles.actions}><button type="submit" disabled={!canLaunch||!ack}>{t("تأكيد إطلاق الفرع","Confirm branch launch")}</button><button type="button" disabled={!canRefresh} onClick={()=>void refresh()}>{refreshing?t("جارٍ تحديث الحالة…","Refreshing status…"):t("تحديث حالة العملية","Refresh operation status")}</button></div>
  </form>
  {!p.onLaunch&&<p className={styles.note}>{t("طلب الإطلاق غير متصل بالتفعيل الفعلي بعد.","The launch request is not connected to actual activation yet.")}</p>}
 </section>;
}
