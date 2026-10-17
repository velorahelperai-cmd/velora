"use client";

import Link from "next/link";
import {useLayoutEffect,useRef,useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {useOptionalAccountSession} from "./account-chrome";
import {AuthShell} from "./auth-pages";
import {Button,Notice} from "./ui";
import {openIdentityRecoveryReviewAction,readIdentityRecoveryReviewsAction} from "@/lib/tenancy/identity-recovery-actions";
import type {IdentityRecoveryResult,IdentityRecoveryView} from "@/lib/tenancy/identity-recovery";

type Capture={userId:string|null;boundaryFingerprint:string|null};

export function IdentityRecoveryPage({initialResult}:{initialResult:IdentityRecoveryResult<IdentityRecoveryView>}){
 const {locale}=useDemo(),ar=locale==="ar",session=useOptionalAccountSession(),sessionRef=useRef(session);
 useLayoutEffect(()=>{sessionRef.current=session;},[session]);
 const [result,setResult]=useState(initialResult);
 const [reason,setReason]=useState<"lost_phone"|"lost_email_and_phone">("lost_phone");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 // Render-safe bound tip — never read refs during render (react-hooks/refs).
 const [boundBoundary,setBoundBoundary]=useState<string|null>(
  initialResult.ok?initialResult.data.boundaryFingerprint||null:null,
 );
 const busyRef=useRef(false);
 const request=useRef<string|null>(null);
 const boundFp=useRef<string|null>(initialResult.ok?initialResult.data.boundaryFingerprint||null:null);
 const rebindGen=useRef(0);
 const openGen=useRef(0);

 const uid=initialResult.ok?initialResult.data.actorUserId:null;
 const t=(en:string,arabic:string)=>ar?arabic:en;

 const setBound=(fp:string|null)=>{
  boundFp.current=fp;
  setBoundBoundary(fp);
 };

 // Same user, newer tip: drop stale SSR/view and re-read under the live capture (WP01A fence).
 useLayoutEffect(()=>{
  if(!uid||!session)return;
  const live=session.liveSnapshot?.()??{
   status:session.status,
   userId:session.identity?.userId??null,
   boundaryFingerprint:session.boundaryFingerprint??null,
   ready:session.status==="ready"&&Boolean(session.identity?.userId),
  };
  if(!live.ready||live.userId!==uid||!live.boundaryFingerprint)return;
  if(boundFp.current===live.boundaryFingerprint)return;
  const capture={userId:live.userId,boundaryFingerprint:live.boundaryFingerprint};
  // Invalidate in-flight open ownership so stale finally cannot keep tip B busy.
  openGen.current+=1;
  busyRef.current=false;
  setBusy(false);
  setBound(null);
  setResult({ok:false,code:"UNAUTHENTICATED"});
  const gen=++rebindGen.current;
  void readIdentityRecoveryReviewsAction({
   expectedUserId:uid,
   expectedBoundaryFingerprint:capture.boundaryFingerprint,
  }).then((view)=>{
   if(rebindGen.current!==gen)return;
   const now=sessionRef.current?.liveSnapshot?.();
   if(!now?.ready||now.userId!==uid||now.boundaryFingerprint!==capture.boundaryFingerprint)return;
   if(!view.ok){setError(view.code);return;}
   if(view.data.boundaryFingerprint!==capture.boundaryFingerprint||view.data.actorUserId!==uid)return;
   setBound(view.data.boundaryFingerprint);
   setResult(view);
   setError(null);
  });
 },[session,uid]);

 const captureNow=():Capture=>{
  const s=sessionRef.current;
  if(s?.cleanupCapture)return s.cleanupCapture();
  if(s?.liveSnapshot){
   const live=s.liveSnapshot();
   return {userId:live.userId,boundaryFingerprint:live.boundaryFingerprint};
  }
  return {
   userId:s?.identity?.userId??null,
   boundaryFingerprint:s?.boundaryFingerprint??null,
  };
 };

 const tipMatches=(capture:Capture)=>{
  const s=sessionRef.current;
  if(!uid||!capture.userId||capture.userId!==uid||!capture.boundaryFingerprint)return false;
  if(!s){
   return result.ok&&result.data.actorUserId===uid;
  }
  const live=s.liveSnapshot?.()??{
   status:s.status,
   userId:s.identity?.userId??null,
   boundaryFingerprint:s.boundaryFingerprint??null,
   ready:s.status==="ready"&&Boolean(s.identity?.userId),
  };
  if(live.status==="locked"||live.status==="expired"||live.status==="guest")return false;
  if(!live.ready||live.userId!==uid)return false;
  if(live.boundaryFingerprint!==capture.boundaryFingerprint)return false;
  if(boundFp.current&&boundFp.current!==capture.boundaryFingerprint)return false;
  return true;
 };

 const sessionStatus=session?.status;
 const sessionUserId=session?.identity?.userId??null;
 const sessionBoundary=session?.boundaryFingerprint??null;
 const sessionReady=sessionStatus==="ready"&&Boolean(sessionUserId);
 const waitingReauth=Boolean(session&&(sessionStatus==="locked"||sessionStatus==="expired"));

 const active=(()=>{
  if(!uid)return false;
  if(!session)return true;
  if(sessionStatus==="locked"||sessionStatus==="expired")return false;
  if(!(sessionReady&&sessionUserId===uid&&sessionBoundary))return false;
  if(boundBoundary&&boundBoundary!==sessionBoundary)return false;
  if(result.ok&&result.data.boundaryFingerprint&&result.data.boundaryFingerprint!==sessionBoundary){
   return false;
  }
  return true;
 })();

 async function open(){
  if(!uid||busyRef.current)return;
  const capture=captureNow();
  if(!tipMatches(capture)||!capture.boundaryFingerprint)return;
  const gen=++openGen.current;
  busyRef.current=true;
  setBusy(true);
  setError(null);
  request.current??=crypto.randomUUID();
  const requestKey=request.current;
  try{
   const r=await openIdentityRecoveryReviewAction({
    reason,
    requestKey,
    expectedBoundaryFingerprint:capture.boundaryFingerprint,
    expectedUserId:uid,
   });
   if(openGen.current!==gen)return;
   if(!tipMatches(capture))return;
   if(!r.ok){
    // Keep requestKey for safe retry / RPC reconcile; never claim success.
    setError(r.code);
    return;
   }
   if(r.data.boundaryFingerprint!==capture.boundaryFingerprint)return;
   setBound(r.data.boundaryFingerprint);
   const view=await readIdentityRecoveryReviewsAction({
    expectedUserId:uid,
    expectedBoundaryFingerprint:capture.boundaryFingerprint,
   });
   if(openGen.current!==gen)return;
   if(!tipMatches(capture))return;
   if(!view.ok){
    setError(view.code==="UNCONFIRMED"?"UNCONFIRMED":view.code);
    const {boundaryFingerprint:_fp,...openedCase}=r.data;
    setResult({
     ok:true,
     data:{
      actorUserId:uid,
      configuration:result.ok?result.data.configuration:"UNCONFIGURED",
      cases:[openedCase],
      boundaryFingerprint:capture.boundaryFingerprint,
     },
    });
    return;
   }
   if(view.data.boundaryFingerprint!==capture.boundaryFingerprint||view.data.actorUserId!==uid)return;
   setBound(view.data.boundaryFingerprint);
   setResult(view);
   if(view.data.cases.some((c)=>c.id===r.data.id))request.current=null;
  }catch{
   if(openGen.current===gen&&tipMatches(capture))setError("UNCONFIRMED");
  }finally{
   // Only the owning generation clears busy — stale tip A must not leave tip B disabled,
   // and must not clear a newer open that already claimed busy.
   if(openGen.current===gen){
    busyRef.current=false;
    setBusy(false);
   }
  }
 }

 const cases=result.ok&&active&&result.data.actorUserId===uid
  &&(!result.data.boundaryFingerprint||!boundBoundary||result.data.boundaryFingerprint===boundBoundary)
  ?result.data.cases
  :[];

 const stateLabel=(state:typeof cases[number]["state"])=>{
  if(state==="review")return t("Review requested — not restored access","طُلبت المراجعة — وليست استعادة وصول");
  if(state==="needs_evidence")return t("Independent evidence is needed","تحتاج الحالة أدلة مستقلة");
  if(state==="rejected")return t("Review declined","رُفضت المراجعة");
  // approved_for_manual_recovery is supervised review only — never "identity applied".
  return t("Review approved for supervised processing — identity not changed","أُجيزت المراجعة للمعالجة بإشراف — الهوية لم تُغيَّر");
 };

 const errorText=(code:string)=>{
  if(code==="UNCONFIRMED")return t(
   "The save could not be confirmed. Refresh or retry — a duplicate click will not create a second review.",
   "تعذّر تأكيد الحفظ. حدّث الصفحة أو أعد المحاولة — النقر المكرر لن ينشئ مراجعة ثانية.",
  );
  if(code==="UNAUTHENTICATED"||code==="FORBIDDEN")return t(
   "Your current account authority no longer matches this request. Sign in again before retrying.",
   "صلاحية حسابك الحالي لم تعد تطابق هذا الطلب. سجّل الدخول مجددًا قبل إعادة المحاولة.",
  );
  if(code==="UNAVAILABLE")return t(
   "Recovery review is temporarily unavailable. This is not a saved or failed final write.",
   "مراجعة الاسترداد غير متاحة مؤقتًا. هذا ليس حفظًا ناجحًا ولا فشلًا نهائيًا للكتابة.",
  );
  if(code==="UNCONFIGURED")return t(
   "Recovery policy is not configured. A review request cannot change identity.",
   "سياسة الاسترداد غير مهيّأة. طلب المراجعة لا يغيّر الهوية.",
  );
  return t(
   "The review could not be saved or read. Check your current account before retrying.",
   "تعذّر حفظ المراجعة أو قراءتها. تحقّق من حسابك الحالي قبل إعادة المحاولة.",
  );
 };

 return <AuthShell
  title={t("Secure recovery review","مراجعة الاسترداد الآمن")}
  body={t(
   "A new phone code alone cannot recover an existing account. Recovery needs several independently verified sources and an authorized review.",
   "رمز الهاتف الجديد وحده لا يسترد حسابًا قائمًا. الاسترداد يحتاج مصادر متعددة موثقة بصورة مستقلة ومراجعة مخوّلة.",
  )}
  footer={<Link href="/account">{t("Back to account","العودة إلى الحساب")}</Link>}
 >
  <div className="grid gap-4" dir={ar?"rtl":"ltr"}>
   <Notice tone="warn">{t(
    "Recovery criteria and evidence delivery are not configured yet. A review request saves the case and does not change your user ID, phone, email, business ownership or subscription.",
    "معايير الاسترداد وتسليم الأدلة غير مهيّأة بعد. يحفظ طلب المراجعة الحالة ولا يغيّر معرّف المستخدم أو الهاتف أو البريد أو ملكية النشاط أو الاشتراك.",
   )}</Notice>
   {!initialResult.ok?<Notice>{t(
    "If you cannot sign in because both email and phone are lost, an authorized platform owner must open the case through secure review intake. That intake channel still requires configuration.",
    "إذا تعذّر الدخول بسبب فقد البريد والهاتف معًا، يجب أن يفتح مالك المنصة المخوّل الحالة عبر استقبال مراجعة آمن. لا تزال قناة الاستقبال تحتاج تهيئة.",
   )} <Link href="/login">{t("Sign in if available","سجّل الدخول إن أمكن")}</Link></Notice>
   :waitingReauth?<Notice role="status">{t(
    "Your current session ended or is locked. Sign in again before opening or reading a recovery review.",
    "انتهت جلستك الحالية أو أُغلقت. سجّل الدخول مجددًا قبل فتح مراجعة الاسترداد أو قراءتها.",
   )}</Notice>
   :!active?<Notice role="status">{t("Waiting for your current account.","جارٍ التحقق من حسابك الحالي.")}</Notice>
   :<>
    <label className="grid gap-2 text-sm" htmlFor="identity-recovery-reason">{t("Access lost","الوصول المفقود")}
     <select
      id="identity-recovery-reason"
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      value={reason}
      onChange={(e)=>{setReason(e.target.value as typeof reason);request.current=null;}}
      disabled={busy}
      aria-busy={busy}
     >
      <option value="lost_phone">{t("Old personal phone","الهاتف الشخصي القديم")}</option>
      <option value="lost_email_and_phone">{t("Email and personal phone","البريد والهاتف الشخصي")}</option>
     </select>
    </label>
    <Button
     busy={busy}
     disabled={busy}
     aria-describedby={error&&active?"identity-recovery-error":undefined}
     onClick={()=>void open()}
    >{t("Open recovery review","فتح مراجعة استرداد")}</Button>
    {cases.map((c)=>(
     <Notice key={c.id} role="status">
      <p className="font-semibold">{stateLabel(c.state)}</p>
      <p className="text-xs" dir="ltr">{c.id}</p>
     </Notice>
    ))}
   </>}
   {error&&active?<Notice tone="error" role="alert" id="identity-recovery-error">{errorText(error)}</Notice>:null}
  </div>
 </AuthShell>;
}
