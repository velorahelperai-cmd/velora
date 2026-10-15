"use client";
import Link from "next/link";
import {useLayoutEffect,useRef,useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {useOptionalAccountSession} from "./account-chrome";
import {AuthShell} from "./auth-pages";
import {Button,Notice} from "./ui";
import {openIdentityRecoveryReviewAction,readIdentityRecoveryReviewsAction} from "@/lib/tenancy/identity-recovery-actions";
import type {IdentityRecoveryCase,IdentityRecoveryResult} from "@/lib/tenancy/identity-recovery";
type View={actorUserId:string;configuration:"CONFIGURED"|"UNCONFIGURED";cases:IdentityRecoveryCase[]};
export function IdentityRecoveryPage({initialResult}:{initialResult:IdentityRecoveryResult<View>}){
 const {locale}=useDemo(),ar=locale==="ar",session=useOptionalAccountSession(),sessionRef=useRef(session);useLayoutEffect(()=>{sessionRef.current=session;},[session]);
 const [result,setResult]=useState(initialResult),[reason,setReason]=useState<"lost_phone"|"lost_email_and_phone">("lost_phone"),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);const busyRef=useRef(false),request=useRef<string|null>(null);
 const uid=initialResult.ok?initialResult.data.actorUserId:null;
 const active=Boolean(uid&&(!session||session.status==="ready"&&session.identity?.userId===uid));
 const current=()=>{const s=sessionRef.current;return Boolean(uid&&(!s||s.status==="ready"&&s.identity?.userId===uid));};
 const t=(en:string,arabic:string)=>ar?arabic:en;
 async function open(){if(!uid||!current()||busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);request.current??=crypto.randomUUID();try{const r=await openIdentityRecoveryReviewAction({expectedUserId:uid,reason,requestKey:request.current});if(!current())return;if(!r.ok){setError(r.code);return;}request.current=null;const view=await readIdentityRecoveryReviewsAction(uid);if(current())setResult(view);}catch{if(current())setError("UNAVAILABLE");}finally{busyRef.current=false;if(current())setBusy(false);}}
 const cases=result.ok&&active&&result.data.actorUserId===uid?result.data.cases:[];
 return <AuthShell title={t("Secure recovery review","مراجعة الاسترداد الآمن")} body={t("A new phone code alone cannot recover an existing account. Recovery needs several independently verified sources and an authorized review.","رمز الهاتف الجديد وحده لا يسترد حسابًا قائمًا. الاسترداد يحتاج مصادر متعددة موثقة بصورة مستقلة ومراجعة مخوّلة.")} footer={<Link href="/account">{t("Back to account","العودة إلى الحساب")}</Link>}>
 <div className="grid gap-4" dir={ar?"rtl":"ltr"}>
  <Notice tone="warn">{t("Recovery criteria and evidence delivery are not configured yet. A review request saves the case and does not change your user ID, phone, email, business ownership or subscription.","معايير الاسترداد وتسليم الأدلة غير مهيّأة بعد. يحفظ طلب المراجعة الحالة ولا يغيّر معرّف المستخدم أو الهاتف أو البريد أو ملكية النشاط أو الاشتراك.")}</Notice>
  {!initialResult.ok?<Notice>{t("If you cannot sign in because both email and phone are lost, an authorized platform owner must open the case through secure review intake. That intake channel still requires configuration.","إذا تعذّر الدخول بسبب فقد البريد والهاتف معًا، يجب أن يفتح مالك المنصة المخوّل الحالة عبر استقبال مراجعة آمن. لا تزال قناة الاستقبال تحتاج تهيئة.")} <Link href="/login">{t("Sign in if available","سجّل الدخول إن أمكن")}</Link></Notice>:!active?<Notice>{t("Waiting for your current account.","جارٍ التحقق من حسابك الحالي.")}</Notice>:<>
   <label className="grid gap-2 text-sm">{t("Access lost","الوصول المفقود")}<select className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3" value={reason} onChange={e=>{setReason(e.target.value as typeof reason);request.current=null;}} disabled={busy}><option value="lost_phone">{t("Old personal phone","الهاتف الشخصي القديم")}</option><option value="lost_email_and_phone">{t("Email and personal phone","البريد والهاتف الشخصي")}</option></select></label>
   <Button busy={busy} disabled={busy} onClick={()=>void open()}>{t("Open recovery review","فتح مراجعة استرداد")}</Button>
   {cases.map(c=><Notice key={c.id}><p className="font-semibold">{c.state==="review"?t("Review requested","طُلبت المراجعة"):c.state==="needs_evidence"?t("Independent evidence is needed","تحتاج الحالة أدلة مستقلة"):c.state==="rejected"?t("Review declined","رُفضت المراجعة"):t("Review approved for supervised processing","أُجيزت المراجعة للمعالجة بإشراف")}</p><p className="text-xs" dir="ltr">{c.id}</p></Notice>)}
  </>}
  {error&&active?<Notice tone="error">{t("The review could not be saved or read. Check your current account before retrying.","تعذّر حفظ المراجعة أو قراءتها. تحقّق من حسابك الحالي قبل إعادة المحاولة.")}</Notice>:null}
 </div></AuthShell>;
}
