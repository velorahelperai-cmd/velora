"use client";
import {useLayoutEffect,useRef,useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {useOptionalAccountSession} from "@/components/app/account-chrome";
import {Button,Field,Notice} from "@/components/app/ui";
import {adminDecideIdentityRecoveryAction,adminOpenIdentityRecoveryReviewAction,readIdentityRecoveryReviewsAction} from "@/lib/tenancy/identity-recovery-actions";
import type {IdentityRecoveryResult,IdentityRecoveryView} from "@/lib/tenancy/identity-recovery";
type View=IdentityRecoveryView;
export function IdentityRecoveryAdminPanel({initialResult}:{initialResult:IdentityRecoveryResult<View>}){
 const {locale}=useDemo(),ar=locale==="ar",session=useOptionalAccountSession(),sessionRef=useRef(session);useLayoutEffect(()=>{sessionRef.current=session;},[session]);
 const [result,setResult]=useState(initialResult),[uid,setUid]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);const busyRef=useRef(false);
 const actor=initialResult.ok?initialResult.data.actorUserId:null,t=(en:string,arabic:string)=>ar?arabic:en;
 const active=Boolean(actor&&(!session||session.status==="ready"&&session.identity?.userId===actor&&session.identity.platformIdentity.role==="owner"&&session.identity.platformIdentity.status==="active"));
 const current=()=>{const s=sessionRef.current;return Boolean(actor&&(!s||s.status==="ready"&&s.identity?.userId===actor&&s.identity.platformIdentity.role==="owner"&&s.identity.platformIdentity.status==="active"));};
 async function perform(op:()=>Promise<IdentityRecoveryResult>){if(!current()||busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{const r=await op();if(!current())return;if(!r.ok){setError(r.code);return;}const refreshed=await readIdentityRecoveryReviewsAction(actor??undefined,true);if(current())setResult(refreshed);}catch{if(current())setError("UNAVAILABLE");}finally{busyRef.current=false;if(current())setBusy(false);}}
 const data=result.ok&&active&&result.data.actorUserId===actor?result.data:null;
 return <main className="grid gap-5 p-5 md:p-8" dir={ar?"rtl":"ltr"}>
  <h1 className="text-2xl font-bold">{t("Identity recovery review","مراجعة استرداد الهوية")}</h1>
  <Notice tone="warn">{t("Recovery policy and independent evidence producers are unconfigured. Review decisions record evidence and authority; they do not change Auth identity or transfer company ownership. A new-phone OTP or a support conversation cannot approve recovery.","سياسة الاسترداد ومنتجو الأدلة المستقلة غير مهيّئين. تسجّل المراجعة الأدلة والصلاحيات؛ ولا تغيّر هوية Auth أو تنقل ملكية الأنشطة. رمز الهاتف الجديد أو محادثة الدعم لا يجيزان الاسترداد.")}</Notice>
  {!data?<Notice>{t("Only a current verified platform owner can access identity review cases.","يستطيع مالك المنصة الموثق ذو الجلسة الحالية فقط الوصول لحالات مراجعة الهوية.")}</Notice>:<>
   <form className="grid gap-3" onSubmit={e=>{e.preventDefault();const input={userId:uid,reason:"lost_email_and_phone" as const,requestKey:crypto.randomUUID()};void perform(()=>adminOpenIdentityRecoveryReviewAction(input));}}><Field label={t("Original native user ID","معرّف المستخدم الأصلي")} required>{p=><input {...p} dir="ltr" value={uid} maxLength={36} onChange={e=>setUid(e.target.value)} disabled={busy} required/>}</Field><Button type="submit" busy={busy} disabled={busy}>{t("Open full-loss review","فتح مراجعة فقد كامل")}</Button></form>
   {data.cases.map(c=><section key={c.id} className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"><p className="font-semibold" dir="ltr">{c.id}</p><p dir="ltr" className="text-sm">{c.userId}</p><p>{t("Independently verified evidence","الأدلة الموثقة المستقلة")}: {c.verifiedEvidence}</p><p>{c.state}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy||!["review","needs_evidence"].includes(c.state)} onClick={()=>void perform(()=>adminDecideIdentityRecoveryAction({caseId:c.id,decision:"request_evidence",requestKey:crypto.randomUUID()}))}>{t("Request independent evidence","طلب أدلة مستقلة")}</Button><Button variant="secondary" disabled={busy||!["review","needs_evidence"].includes(c.state)} onClick={()=>void perform(()=>adminDecideIdentityRecoveryAction({caseId:c.id,decision:"reject",requestKey:crypto.randomUUID()}))}>{t("Decline review","رفض المراجعة")}</Button><Button disabled={busy||data.configuration!=="CONFIGURED"||c.verifiedEvidence<2||!["review","needs_evidence"].includes(c.state)} onClick={()=>void perform(()=>adminDecideIdentityRecoveryAction({caseId:c.id,decision:"approve_review",requestKey:crypto.randomUUID()}))}>{t("Approve supervised review","إجازة المراجعة بإشراف")}</Button></div></section>)}
  </>}
  {error&&active?<Notice tone="error">{error==="UNCONFIGURED"?t("Approved recovery policy is not configured.","سياسة الاسترداد المعتمدة غير مهيّأة."):t("The current authority or evidence did not permit this decision.","لم تسمح الصلاحية الحالية أو الأدلة بهذا القرار.")}</Notice>:null}
 </main>;
}
