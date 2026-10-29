"use client";
import {useId,useLayoutEffect,useRef,useState} from "react";
import type {PaidBranchSetupRead,PaidSetupChannel,PaidSetupStepStatus} from "@/lib/tenancy/paid-setup-contracts";
import styles from "./paid-launch-summary.module.css";
export type LaunchScope={expectedAccountId:string;companyId:string;branchId:string};
type SummaryItem={detail:string;status:PaidSetupStepStatus};
export type LaunchSummarySnapshot={
 scope:LaunchScope;version:number;branchLabel:string;
 setup:Pick<PaidBranchSetupRead,"companyId"|"selectedBranchId"|"sourceStatus"|"selectedChannels"|"entitlement"|"launch">;
 readiness:{status:"ready"|"blocked"|"unknown";revision:string|null;blockers:string[]};
 summary:{channels:{channel:PaidSetupChannel;detail:string;status:PaidSetupStepStatus}[];hours:SummaryItem;knowledge:SummaryItem;persona:SummaryItem;team:SummaryItem};
 operationId:string|null;activation:{status:"not_started"|"launched"|"unknown";receiptId:string|null;operationId:string|null};
};
export type PaidLaunchSummaryProps={
 locale:"ar"|"en";scope:LaunchScope;boundaryFingerprint:string;snapshot:LaunchSummarySnapshot|null;
 state:{scope:LaunchScope;version:number|null;phase:"loading"|"ready"|"pending"|"error"|"unknown"|"unavailable"};
 isCurrent:()=>boolean;
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
 const channels=(s.setup.selectedChannels??[]).filter((v,i,a)=>["whatsapp","instagram"].includes(v)&&a.indexOf(v)===i);
 const rows=[...channels.map(channel=>({label:channel==="whatsapp"?"WhatsApp":"Instagram",item:s.summary.channels.find(row=>row.channel===channel)??{detail:t("لم تتوفر حالة القناة.","Channel status is unavailable."),status:"unavailable" as const}})),
  {label:t("ساعات الفرع","Branch hours"),item:s.summary.hours},{label:t("المعرفة","Knowledge"),item:s.summary.knowledge},{label:t("المساعد المختار","Selected assistant"),item:s.summary.persona},{label:t("الفريق","Team"),item:s.summary.team}];
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
 return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={pending||refreshing||p.state.phase==="pending"}>
  {p.state.phase==="loading"&&<p role="status">{t("جارٍ تحميل ملخص الإطلاق.","Loading the launch summary.")}</p>}
  {p.state.phase==="unavailable"&&<p role="status">{t("تعذر التحقق من ملخص الإطلاق.","Launch summary could not be verified.")}</p>}
  <header><h2 id={id}>{t("راجع ثم أكّد الإطلاق","Review and confirm launch")}</h2><p>{t("الفرع: ","Branch: ")}<bdi>{s.branchLabel}</bdi></p></header>
  <p className={styles.note}>{t("راجع الإعدادات المؤكدة لهذا الفرع. التأكيد الصريح يطلب الإطلاق؛ ولا يبدأ الرد على العملاء إلا بعد أن يؤكد النظام نجاح العملية.","Review this branch's confirmed settings. Explicit confirmation requests launch; customer replies begin only after the system confirms the operation succeeded.")}</p>
  <dl className={styles.summary}>{rows.map(({label,item})=><div key={label}><dt>{label}</dt><dd><p dir="auto">{item.detail}</p><span>{status(item.status)}</span></dd></div>)}</dl>
  {!channels.length&&<p role="status">{t("لم تتوفر القنوات المدفوعة المختارة. الإطلاق معطّل.","Selected paid channels are unavailable. Launch is disabled.")}</p>}
  {launched&&p.state.phase==="ready"?<p role="status" className={styles.success}>{t("أكد النظام نجاح إطلاق هذا الفرع.","The system confirmed this branch was launched.")}</p>:<p role="status">{s.readiness.status==="ready"?t("وردت جاهزية الفرع من النظام. يلزم تأكيدك الصريح لإرسال طلب الإطلاق.","The system supplied branch readiness. Your explicit confirmation is required to request launch."):t("جاهزية الفرع لم تُؤكد بعد. راجع المتطلبات أدناه.","Branch readiness has not been confirmed. Review the requirements below.")}</p>}
  {(s.readiness.blockers.length>0||s.setup.launch.blockedReasons.length>0)&&<aside className={styles.blockers} aria-label={t("موانع الإطلاق","Launch blockers")}><ul>{[...s.readiness.blockers,...s.setup.launch.blockedReasons].map((reason,i)=><li key={`${i}:${reason}`} dir="auto">{reason}</li>)}</ul></aside>}
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
