"use client";
import {useId,useLayoutEffect,useRef,useState} from "react";
import type {CompanyStaffInvitation,StaffInvitationView} from "@/lib/tenancy/staff-invitations";
import styles from "./paid-team-invitations.module.css";
export type TeamScope={expectedAccountId:string;companyId:string;branchId:string};
type Context=TeamScope & {expectedVersion:number;operationId:string};
export type BranchTeamSnapshot={
 scope:TeamScope;version:number;branchLabel:string;
 seats:{limit:2|4|null;available:number|null};allowedRoles:StaffInvitationView["role"][];
 canReplace?:boolean;canRevoke?:boolean;canInvite:boolean|null;canSkip:boolean|null;skip:"not_skipped"|"skipped"|"unknown";
 createOperationId:string|null;skipOperationId:string|null;
 invitations:{scope:TeamScope;invitation:CompanyStaffInvitation}[];
};
export type PaidTeamInvitationsProps={
 locale:"ar"|"en";inviteUrl?:string|null;scope:TeamScope;boundaryFingerprint:string;snapshot:BranchTeamSnapshot|null;
 state:{scope:TeamScope;version:number|null;phase:"loading"|"ready"|"pending"|"error"|"unknown"|"unavailable";operationId:string|null;operation:"invite"|"skip"|null;canRetry:boolean|null;retrySafe:boolean|null};
 isCurrent:()=>boolean;onInvite?:(input:Context & {name:string;email:string;role:StaffInvitationView["role"];capabilities:string[]})=>void|Promise<void>;
 onRevoke?:(input:TeamScope & {invitationId:string;expectedRevision:number})=>void|Promise<void>;
 onSkip?:(input:Context)=>void|Promise<void>;onRetry?:(input:Context & {operation:"invite"|"skip"})=>void|Promise<void>;
};
const same=(a:TeamScope,b:TeamScope)=>!!a.expectedAccountId&&!!a.companyId&&!!a.branchId&&a.expectedAccountId===b.expectedAccountId&&a.companyId===b.companyId&&a.branchId===b.branchId;
const operationId=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const teamViewKey=(p:PaidTeamInvitationsProps)=>JSON.stringify([p.scope.expectedAccountId,p.scope.companyId,p.scope.branchId,p.boundaryFingerprint,p.snapshot?.version,p.snapshot?.createOperationId,p.snapshot?.skipOperationId,p.state.phase]);
export const knownTeamSeats=(s:BranchTeamSnapshot["seats"]) => (s.limit===2||s.limit===4)&&Number.isSafeInteger(s.available)&&s.available!==null&&s.available>=0&&s.available<=s.limit;
export const validTeamRecipient=(name:string,email:string)=>name.trim().length>=2&&name.trim().length<=120&&email.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
const labels:Record<CompanyStaffInvitation["status"],[string,string]>={invited:["دعوة محفوظة","Saved invitation"],expired:["منتهية","Expired"],accepted:["مقبولة","Accepted"],cancelled:["ملغاة","Cancelled"],conflicted:["دعوات متعارضة","Conflicting invitations"]};
export function PaidTeamInvitations(p:PaidTeamInvitationsProps){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,scoped=!!p.boundaryFingerprint&&same(p.scope,p.state.scope);
 if(!scoped||(!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable")||(p.snapshot&&(!same(p.scope,p.snapshot.scope)||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||p.state.version!==p.snapshot.version)))
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("بيانات فريق الفرع غير متاحة. أعد تحميل الحساب والفرع.","Branch team data is unavailable. Reload the account and branch.")}</p></section>;
 const presentation:BranchTeamSnapshot=p.snapshot??{scope:p.scope,version:0,branchLabel:"—",seats:{limit:null,available:null},allowedRoles:[],canInvite:null,canSkip:null,skip:"unknown",createOperationId:null,skipOperationId:null,invitations:[]};
 return <TeamForm key={JSON.stringify([p.scope,p.boundaryFingerprint,p.snapshot?.createOperationId,p.snapshot?.skipOperationId])} {...p} snapshot={presentation}/>;
}

function TeamForm(p:PaidTeamInvitationsProps & {snapshot:BranchTeamSnapshot}){
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
 const [capabilities,setCapabilities]=useState<string[]>([]);
 const [replacementId,setReplacementId]=useState<string|null>(null);
 const [name,setName]=useState(""),[email,setEmail]=useState(""),[pending,setPending]=useState(false),[unknown,setUnknown]=useState(false);
 const mounted=useRef(false),reserved=useRef(false);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const seatsKnown=knownTeamSeats(p.snapshot.seats),locked=pending||unknown||p.state.phase!=="ready";
 const replacement=p.snapshot.invitations.find(row=>row.invitation.id===replacementId&&row.invitation.status==="invited"&&same(row.scope,p.scope))?.invitation;
 const replaceAllowed=!locked&&seatsKnown&&p.snapshot.canReplace===true&&p.snapshot.allowedRoles.includes("staff")&&operationId(p.snapshot.createOperationId)&&!!p.onInvite;
 const inviteAllowed=!locked&&seatsKnown&&p.snapshot.allowedRoles.includes("staff")&&operationId(p.snapshot.createOperationId)&&!!p.onInvite&&(replacement?replaceAllowed:p.snapshot.seats.available!>0&&p.snapshot.canInvite===true);
 const revokeAllowed=!locked&&p.snapshot.canRevoke===true&&!!p.onRevoke;
 const canInvite=inviteAllowed&&capabilities.length>0&&validTeamRecipient(name,email);
 const supportsSkip=p.snapshot.canSkip===true&&p.snapshot.skip==="not_skipped"&&operationId(p.snapshot.skipOperationId)&&!!p.onSkip;
 const canSkip=!locked&&supportsSkip;
 const canRetry=!pending&&!unknown&&p.state.phase==="error"&&p.state.canRetry===true&&p.state.retrySafe===true&&operationId(p.state.operationId)&&(p.state.operation==="invite"||p.state.operation==="skip")&&!!p.onRetry;
 const context=(id:string):Context=>({...p.scope,expectedVersion:p.snapshot.version,operationId:id});
 async function dispatch(run:()=>void|Promise<void>){
  if(reserved.current||!p.isCurrent())return;reserved.current=true;setPending(true);
  try{await run();/* Authoritative operation IDs determine when another invitation is permitted. */}
  catch{if(mounted.current&&p.isCurrent())setUnknown(true);}
  finally{if(mounted.current&&p.isCurrent())setPending(false);}
 }
 return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={pending||p.state.phase==="pending"||p.state.phase==="loading"}>
  {p.state.phase==="unavailable"&&<p role="status">{t("تعذّر التحقق من البيانات. الحفظ غير مؤكد.","Data could not be verified. Saving is unconfirmed.")}</p>}
  <header className={styles.header}>
    <div className={styles.headerCopy}>
      <h2 id={id}>{t("ادعُ فريقك","Invite your team")}</h2>
    </div>
    <p
      className={styles.seatChip}
      title={t("المالك غير محسوب ضمن مقاعد الموظفين.","The owner is excluded from staff seats.")}
      aria-label={t(
        seatsKnown?`مقاعد متاحة ${p.snapshot.seats.available} من ${p.snapshot.seats.limit}`:`مقاعد الموظفين غير متاحة`,
        seatsKnown?`${p.snapshot.seats.available} of ${p.snapshot.seats.limit} staff seats open`:`Staff seats unavailable`,
      )}
    >
      <span className={styles.seatLabel}>{t("متاح","Open")}</span>
      <bdi dir="ltr">{seatsKnown?`${p.snapshot.seats.available} / ${p.snapshot.seats.limit}`:"—"}</bdi>
      <span className={styles.srOnly}>{t("المالك غير محسوب ضمن مقاعد الموظفين.","The owner is excluded from staff seats.")}</span>
    </p>
  </header>
  {!seatsKnown&&p.state.phase!=="loading"&&<p role="status">{t("تعذّر التحقق من المقاعد. إنشاء الدعوات معطّل.","Seat availability could not be verified. Invitation creation is disabled.")}</p>}
  {seatsKnown&&p.snapshot.seats.available===0&&<p role="status">{t("لا توجد مقاعد موظفين متاحة حاليًا لهذا الفرع.","No staff seats are currently available for this branch.")}</p>}
  {(unknown||p.state.phase==="unknown")&&<p role="alert" className={styles.error}>{t("نتيجة العملية غير معروفة. حدّث حالتها قبل المحاولة مجددًا لتجنب تكرار الدعوة.","The operation outcome is unknown. Refresh its status before trying again to avoid a duplicate invitation.")}</p>}
  {p.state.phase==="error"&&<div role="alert" className={styles.error}><p>{t("تعذّر إتمام العملية. راجع صلاحياتك والمقاعد وحالة الدعوة.","The operation could not be completed. Review permissions, seats and invitation status.")}</p><button type="button" disabled={!canRetry} onClick={()=>{if(canRetry)void dispatch(()=>p.onRetry?.({...context(p.state.operationId!),operation:p.state.operation!}));}}>{t("إعادة المحاولة نفسها","Retry the same operation")}</button></div>}
  {(pending||p.state.phase==="pending")&&<p role="status">{t("بانتظار تأكيد حالة العملية من الخادم…","Waiting for the server to confirm the operation state…")}</p>}
  {replacement&&<p role="status">{t("إعادة إنشاء رابط الدعوة لهذا الموظف فقط. اختر الصلاحيات ثم أكّد؛ سيُلغى الرابط السابق دون إرسال بريد أو حجز مقعد إضافي.","Regenerate the link for this staff member only. Select permissions, then confirm; the old link is invalidated without sending email or reserving another seat.")}<button type="button" disabled={locked} onClick={()=>{if(p.isCurrent()){setReplacementId(null);setName("");setEmail("");setCapabilities([]);}}}>{t("إلغاء إعادة الإنشاء","Cancel regeneration")}</button></p>}
  <form noValidate onSubmit={e=>{e.preventDefault();if(canInvite)void dispatch(()=>p.onInvite?.({...context(p.snapshot.createOperationId!),name:name.trim(),email:email.trim().toLowerCase(),role:"staff",capabilities}));}}>
   <div className={styles.fieldsRow}>
    <label>{t("اسم الموظف","Staff name")}<input dir="auto" autoComplete="name" maxLength={120} value={name} readOnly={!!replacement} disabled={!inviteAllowed} onChange={e=>{if(p.isCurrent())setName(e.target.value);}}/></label>
    <label>{t("البريد الإلكتروني","Email address")}<input type="email" dir="ltr" autoComplete="email" maxLength={254} value={email} readOnly={!!replacement} disabled={!inviteAllowed} onChange={e=>{if(p.isCurrent())setEmail(e.target.value);}}/></label>
   </div>
   <div className={styles.rolePermsRow}>
    <fieldset className={styles.roleField} disabled={!inviteAllowed||!p.snapshot.allowedRoles.includes("staff")}>
     <legend>{t("الدور","Role")}</legend>
     <select value="staff" onChange={()=>{}} aria-describedby={`${id}-role`} disabled={!inviteAllowed||!p.snapshot.allowedRoles.includes("staff")}>
      {p.snapshot.allowedRoles.includes("staff")?<option value="staff">{t("موظف","Staff")}</option>:null}
     </select>
    </fieldset>
    <fieldset className={styles.capsField} disabled={!inviteAllowed}>
     <legend id={`${id}-role`}>{t("صلاحيات هذا الفرع فقط", "Permissions for this branch only")}</legend>
     <div className={styles.capsRow}>{[
      ["wa.conversations.read","قراءة محادثات واتساب","Read WhatsApp conversations"],
      ["ig.conversations.read","قراءة محادثات إنستغرام","Read Instagram conversations"],
     ].map(([value,arabic,english])=><label key={value}><input type="checkbox" checked={capabilities.includes(value)} onChange={e=>{if(p.isCurrent())setCapabilities(e.target.checked?[...capabilities,value]:capabilities.filter(c=>c!==value));}}/>{t(arabic,english)}</label>)}</div>
    </fieldset>
   </div>
   <button type="submit" disabled={!canInvite}>{replacement?t("تأكيد إنشاء رابط جديد","Confirm new invitation link"):t("إنشاء دعوة","Create invitation")}</button>
  </form>
  {p.inviteUrl&&<label>{t("رابط الدعوة — لم يُرسل بريد", "Invitation link — no email sent")}<input readOnly dir="ltr" value={p.inviteUrl} onFocus={e=>e.target.select()}/></label>}
  <ul className={styles.invitations}>{p.snapshot.invitations.filter(row=>same(row.scope,p.scope)).map(({invitation:i})=>(
   <li key={i.id} className={styles.inviteRow} data-status={i.status}>
    <div className={styles.inviteWho}>
     <strong dir="auto">{i.name}</strong>
     <bdi>{i.email}</bdi>
    </div>
    <span className={styles.inviteStatus}>{labels[i.status]?.[ar?0:1]??t("حالة غير معروفة","Unknown status")}</span>
    <div className={styles.inviteActions}>
     {i.status==="invited"&&<button type="button" data-regenerate-invitation={i.id} disabled={!replaceAllowed} onClick={()=>{if(replaceAllowed&&p.isCurrent()){setReplacementId(i.id);setName(i.name);setEmail(i.email);setCapabilities([]);}}}>{t("رابط بديل","New link")}</button>}
     {(i.status==="invited"||i.status==="accepted")&&<button type="button" data-revoke-invitation={i.id} className={styles.inviteDanger} disabled={!revokeAllowed} onClick={()=>{if(revokeAllowed)void dispatch(()=>p.onRevoke?.({...p.scope,invitationId:i.id,expectedRevision:i.revision}));}}>{i.status==="accepted"?t("إلغاء الوصول","Revoke access"):t("إلغاء الدعوة","Cancel invitation")}</button>}
    </div>
   </li>
  ))}</ul>
  {supportsSkip&&<footer><button type="button" disabled={!canSkip} onClick={()=>{if(canSkip)void dispatch(()=>p.onSkip?.(context(p.snapshot.skipOperationId!)));}}>{t("تخطي الآن","Skip for now")}</button></footer>}
 </section>;
}
