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
 if(scoped&&p.state.phase==="loading")return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-busy="true"><p role="status">{t("جارٍ تحميل فريق الفرع.","Loading the branch team.")}</p></section>;
 if(!scoped||!p.snapshot||!same(p.scope,p.snapshot.scope)||!Number.isSafeInteger(p.snapshot.version)||p.snapshot.version<1||p.state.version!==p.snapshot.version||p.state.phase==="unavailable")
 return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("بيانات فريق الفرع غير متاحة. أعد تحميل الحساب والفرع.","Branch team data is unavailable. Reload the account and branch.")}</p></section>;
 return <TeamForm key={teamViewKey(p)} {...p} snapshot={p.snapshot}/>;
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
 const canSkip=!locked&&p.snapshot.canSkip===true&&p.snapshot.skip==="not_skipped"&&operationId(p.snapshot.skipOperationId)&&!!p.onSkip;
 const canRetry=!pending&&!unknown&&p.state.phase==="error"&&p.state.canRetry===true&&p.state.retrySafe===true&&operationId(p.state.operationId)&&(p.state.operation==="invite"||p.state.operation==="skip")&&!!p.onRetry;
 const context=(id:string):Context=>({...p.scope,expectedVersion:p.snapshot.version,operationId:id});
 async function dispatch(run:()=>void|Promise<void>){
  if(reserved.current||!p.isCurrent())return;reserved.current=true;setPending(true);
  try{await run();/* Wait for authoritative host refresh/new operation before accepting another submission. */}
  catch{if(mounted.current&&p.isCurrent()){setUnknown(true);setPending(false);}}
 }
 return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={pending||p.state.phase==="pending"}>
  <header><span className={styles.badge}>{t("اختياري","Optional")}</span><h2 id={id}>{t("ادعُ فريقك","Invite your team")}</h2><p>{t("الفرع: ","Branch: ")}<bdi>{p.snapshot.branchLabel}</bdi></p></header>
  <p className={styles.note}>{t("يمكنك متابعة الإعداد دون دعوة موظفين الآن. التخطي لا ينشئ دعوات ولا يرسل رسائل.","You can continue setup without inviting staff now. Skipping does not create invitations or send messages.")}</p>
  <div className={styles.seats}><strong>{t("مقاعد الموظفين المتاحة","Available staff seats")}</strong><bdi dir="ltr">{seatsKnown?`${p.snapshot.seats.available} / ${p.snapshot.seats.limit}`:"—"}</bdi><p>{t("هذه سعة الفرع التي يؤكدها الخادم. المالك غير محسوب ضمن مقاعد الموظفين.","This is the branch capacity confirmed by the server. The owner is excluded from staff seats.")}</p></div>
  {!seatsKnown&&<p role="status">{t("تعذّر التحقق من المقاعد. إنشاء الدعوات معطّل.","Seat availability could not be verified. Invitation creation is disabled.")}</p>}
  {seatsKnown&&p.snapshot.seats.available===0&&<p role="status">{t("لا توجد مقاعد موظفين متاحة حاليًا لهذا الفرع.","No staff seats are currently available for this branch.")}</p>}
  {p.snapshot.skip==="skipped"&&p.state.phase==="ready"&&<p role="status">{t("أكد الخادم تخطي هذه الخطوة الاختيارية.","The server confirmed that this optional step was skipped.")}</p>}
  {(unknown||p.state.phase==="unknown")&&<p role="alert" className={styles.error}>{t("نتيجة العملية غير معروفة. حدّث حالتها قبل المحاولة مجددًا لتجنب تكرار الدعوة.","The operation outcome is unknown. Refresh its status before trying again to avoid a duplicate invitation.")}</p>}
  {p.state.phase==="error"&&<div role="alert" className={styles.error}><p>{t("تعذّر إتمام العملية. راجع صلاحياتك والمقاعد وحالة الدعوة.","The operation could not be completed. Review permissions, seats and invitation status.")}</p><button type="button" disabled={!canRetry} onClick={()=>{if(canRetry)void dispatch(()=>p.onRetry?.({...context(p.state.operationId!),operation:p.state.operation!}));}}>{t("إعادة المحاولة نفسها","Retry the same operation")}</button></div>}
  {(pending||p.state.phase==="pending")&&<p role="status">{t("بانتظار تأكيد حالة العملية من الخادم…","Waiting for the server to confirm the operation state…")}</p>}
  {replacement&&<p role="status">{t("إعادة إنشاء رابط الدعوة لهذا الموظف فقط. اختر الصلاحيات ثم أكّد؛ سيُلغى الرابط السابق دون إرسال بريد أو حجز مقعد إضافي.","Regenerate the link for this staff member only. Select permissions, then confirm; the old link is invalidated without sending email or reserving another seat.")}<button type="button" disabled={locked} onClick={()=>{if(p.isCurrent()){setReplacementId(null);setName("");setEmail("");setCapabilities([]);}}}>{t("إلغاء إعادة الإنشاء","Cancel regeneration")}</button></p>}
  <form noValidate onSubmit={e=>{e.preventDefault();if(canInvite)void dispatch(()=>p.onInvite?.({...context(p.snapshot.createOperationId!),name:name.trim(),email:email.trim().toLowerCase(),role:"staff",capabilities}));}}>
   <label>{t("اسم الموظف","Staff name")}<input dir="auto" autoComplete="name" maxLength={120} value={name} readOnly={!!replacement} disabled={!inviteAllowed} onChange={e=>{if(p.isCurrent())setName(e.target.value);}}/></label>
   <label>{t("البريد الإلكتروني","Email address")}<input type="email" dir="ltr" autoComplete="email" maxLength={254} value={email} readOnly={!!replacement} disabled={!inviteAllowed} onChange={e=>{if(p.isCurrent())setEmail(e.target.value);}}/></label>
   <label>{t("الدور","Role")}<select value="staff" disabled aria-describedby={`${id}-role`}><option value="staff">{t("موظف","Staff")}</option></select></label>
   <p id={`${id}-role`} className={styles.note}>{t("الدور المتاح في عقد الدعوات الحالي هو موظف. يتحقق الخادم من صلاحية الدعوة والوصول إلى الفرع.","The existing invitation contract supports Staff. The server verifies invitation permission and branch access.")}</p>
   <fieldset disabled={!inviteAllowed}><legend>{t("صلاحيات هذا الفرع فقط", "Permissions for this branch only")}</legend>{[
    ["wa.conversations.read","قراءة محادثات واتساب","Read WhatsApp conversations"],
    ["ig.conversations.read","قراءة محادثات إنستغرام","Read Instagram conversations"],
   ].map(([value,arabic,english])=><label key={value}><input type="checkbox" checked={capabilities.includes(value)} onChange={e=>{if(p.isCurrent())setCapabilities(e.target.checked?[...capabilities,value]:capabilities.filter(c=>c!==value));}}/>{t(arabic,english)}</label>)}</fieldset>
   <p className={styles.note}>{t("قبول الدعوة يمنح الصلاحيات المحددة لهذا الفرع فقط؛ الوصول للمحادثات يتطلب اتصالًا صالحًا للقناة.","Accepting the invitation grants the selected permissions for this branch only; conversation access requires a valid channel connection.")}</p>
   <button type="submit" disabled={!canInvite}>{replacement?t("تأكيد إنشاء رابط جديد","Confirm new invitation link"):t("إنشاء دعوة","Create invitation")}</button>
  </form>
  <p className={styles.note}>{t("إنشاء دعوة محفوظة لا يعني إرسال بريد إلكتروني. طريقة مشاركة الدعوة تتبع النتيجة المؤكدة من الخادم.","Creating a saved invitation does not mean an email was sent. Sharing follows the confirmed server result.")}</p>
  {p.inviteUrl&&<label>{t("رابط الدعوة — لم يُرسل بريد", "Invitation link — no email sent")}<input readOnly dir="ltr" value={p.inviteUrl} onFocus={e=>e.target.select()}/></label>}
  <ul className={styles.invitations}>{p.snapshot.invitations.filter(row=>same(row.scope,p.scope)).map(({invitation:i})=><li key={i.id}><strong dir="auto">{i.name}</strong><bdi>{i.email}</bdi><span>{labels[i.status]?.[ar?0:1]??t("حالة غير معروفة","Unknown status")}</span>{i.status==="invited"&&<button type="button" data-regenerate-invitation={i.id} disabled={!replaceAllowed} onClick={()=>{if(replaceAllowed&&p.isCurrent()){setReplacementId(i.id);setName(i.name);setEmail(i.email);setCapabilities([]);}}}>{t("إنشاء رابط بديل","Regenerate invitation link")}</button>}{(i.status==="invited"||i.status==="accepted")&&<button type="button" data-revoke-invitation={i.id} disabled={!revokeAllowed} onClick={()=>{if(revokeAllowed)void dispatch(()=>p.onRevoke?.({...p.scope,invitationId:i.id,expectedRevision:i.revision}));}}>{i.status==="accepted"?t("إلغاء وصول الفرع","Revoke branch access"):t("إلغاء الدعوة","Cancel invitation")}</button>}</li>)}</ul>
  <footer><button type="button" disabled={!canSkip} onClick={()=>{if(canSkip)void dispatch(()=>p.onSkip?.(context(p.snapshot.skipOperationId!)));}}>{t("تخطي الآن","Skip for now")}</button></footer>
 </section>;
}
