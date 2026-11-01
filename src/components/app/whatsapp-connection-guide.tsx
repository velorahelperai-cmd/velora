"use client";
import { useState, type KeyboardEvent } from "react";
import styles from "./whatsapp-connection-guide.module.css";

type Route = "new-number" | "coexistence";
type Step = { source: string; image?: string; title: [string,string]; bullets: [string[],string[]]; copy: [string,string] };
type Text = { title: [string,string]; bullets: [string[],string[]]; tip: [string,string] };
const step = (source: string, x: Text, safe = true): Step => ({
  source, title: x.title, bullets: x.bullets, copy: x.tip, ...(safe ? {image: "/media/setup/connection-guide/" + source + ".png"} : {}),
});
const login: Text = {title:["سجّل الدخول إلى Facebook","Sign in to Facebook"],
  bullets:[["أدخل بريدك الإلكتروني أو رقم هاتفك وكلمة المرور.","اضغط تسجيل الدخول للمتابعة."],["Enter your email address or mobile number and password.","Select Log in to continue."]],
  tip:["استخدم حساب Facebook الذي تدير به نشاطك التجاري.","Use the Facebook account you use to manage your business."]};
const review: Text = {title:["راجع طلب الربط","Review the connection"],
  bullets:[["تأكد أن اسم التطبيق هو Velora.","اقرأ الشروط ثم اضغط متابعة."],["Make sure the app name is Velora.","Read the terms, then select Continue."]],
  tip:["لن يتم تفعيل أي شيء قبل إكمال كل الخطوات.","Nothing is activated until you finish every step."]};
const assets: Text = {title:["اختر أصول النشاط","Choose business assets"],
  bullets:[["اختر حساب النشاط التجاري الصحيح.","أنشئ حسابًا جديدًا إذا لم يكن موجودًا."],["Select the correct business portfolio.","Create a new one if you don't have it."]],
  tip:["اختر النشاط الذي سيظهر اسمه لعملائك.","Pick the business your customers will see."]};
const details: Text = {title:["راجع بيانات النشاط","Review business details"],
  bullets:[["تحقق من اسم النشاط والموقع الإلكتروني والدولة.","عدّل أي بيانات غير صحيحة ثم اضغط التالي."],["Check the business name, website, and country.","Fix anything incorrect, then select Next."]],
  tip:["البيانات الدقيقة تسرّع موافقة Meta.","Accurate details speed up Meta's approval."]};
const permissions: Text = {title:["راجع الصلاحيات","Review permissions"],
  bullets:[["راجع الصلاحيات المطلوبة.","اضغط تأكيد للمتابعة."],["Review the requested permissions.","Select Confirm to continue."]],
  tip:["هذه الصلاحيات تسمح لـ Velora بإدارة محادثات واتساب فقط.","These permissions only let Velora manage WhatsApp conversations."]};
const finish: Text = {title:["ارجع إلى Velora","Return to Velora"],
  bullets:[["أغلق نافذة Meta بعد الانتهاء.","ارجع هنا للتحقق من الربط.","إنهاء هذا الدليل لا يؤكد الربط ولا يفعّل الردود."],["Close the Meta window when you're done.","Come back here to verify the connection.","Finishing this guide does not confirm connection or enable replies."]],
  tip:["الربط لا يشغّل ردود المساعد تلقائيًا.","Connecting doesn't turn on assistant replies."]};
/** Filenames preserve the user's observed entry order. These are reference panels,
 * not a promise of Meta's current flow. Source 13 contains a QR and is deliberately not exported. */
export const guideSteps: Record<Route, readonly Step[]> = {
  coexistence: [
    step("coexistence/step-1",{title:["سجّل الدخول إلى فيسبوك","Sign in to Facebook"],bullets:[["أدخل البريد الإلكتروني أو رقم الجوال وكلمة المرور.","اضغط تسجيل الدخول."],["Enter your email or mobile number and password.","Select Log in."]],tip:["استخدم حساب فيسبوك الذي يدير نشاطك التجاري.","Use the Facebook account that manages your business."]}),
    step("coexistence/step-2",{title:["اربط حسابك بـ Velora","Connect your account to Velora"],bullets:[["راجع طريقة الربط والشروط.","اضغط متابعة."],["Review how it connects and the terms.","Select Continue."]],tip:["لن يتم شيء قبل موافقتك داخل نافذة Meta.","Nothing happens until you approve in the Meta window."]}),
    step("coexistence/step-3",{title:["أدخل رقم تطبيق WhatsApp Business","Enter your WhatsApp Business app number"],bullets:[["اختر رمز الدولة.","أدخل الرقم الذي تستخدمه حاليًا في تطبيق WhatsApp Business.","اضغط التالي."],["Choose the country code.","Enter the number you already use in the WhatsApp Business app.","Select Next."]],tip:["سنعرض لك الرقم الذي أعادته Meta للتأكيد بعد الربط.","We'll show the number Meta returns for confirmation after linking."]}),
    // Step 4 slot: insert c(4, ...) here when its image arrives (public/media/setup/connection-guide/coexistence/step-4.png).
    step("coexistence/step-5",{title:["اختر محفظة نشاطك التجاري","Choose your business portfolio"],bullets:[["اختر محفظة موجودة أو أنشئ محفظة جديدة.","اضغط متابعة."],["Select an existing portfolio or create a new one.","Select Continue."]],tip:["اختر المحفظة الخاصة بهذا النشاط.","Pick the portfolio for this business."]}),
    step("coexistence/step-6",{title:["أدخل بيانات المحفظة الجديدة","Enter information for your new portfolio"],bullets:[["اسم النشاط والبريد الإلكتروني والدولة والموقع الإلكتروني.","اضغط التالي."],["Business name, email, country and website.","Select Next."]],tip:["يؤثر هذا على الأصول الجديدة فقط.","This only affects new assets."]}),
    step("coexistence/step-7",{title:["استورد جهات الاتصال وسجل المحادثات","Import contacts and chat history"],bullets:[["افتح رسالة Facebook Business الرسمية في تطبيق WhatsApp Business واضغط ربط.","امسح رمز QR واتبع التعليمات.","لا توجد رسالة؟ القائمة (أندرويد) أو الإعدادات (آيفون) > منصة الأعمال.","اضغط متابعة عند الانتهاء."],["Open the official Facebook Business message in the WhatsApp Business app and tap Connect.","Scan the QR code and follow the prompts.","No message? Menu (Android) or Settings (iPhone) > Business platform.","Select Continue when done."]],tip:["رمز QR في الصورة مموّه للحماية.","The QR code in this image is blurred for safety."]}),
    step("coexistence/step-8",{title:["راجع ما ستشاركه مع Velora","Review what you'll share with Velora"],bullets:[["راجع الوصول والصلاحيات.","اضغط تأكيد."],["Review access and permissions.","Select Confirm."]],tip:["يمكنك مراجعة الصلاحيات لاحقًا من إعدادات Meta.","You can review permissions later in Meta settings."]}),
    step("coexistence/step-9",{title:["تم ربط حسابك","Your account is connected"],bullets:[["اضغط إنهاء لإكمال الإعداد.",...finish.bullets[0].slice(1)],["Select Finish to complete setup.",...finish.bullets[1].slice(1)]],tip:["قد يتبع ذلك توثيق النشاط التجاري عبر البريد الإلكتروني.","Business verification may follow by email."]}),
  ],
  "new-number": [
    step("17.1",login),
    step("17.2",review),
    step("17.3",{title:["أضف الرقم","Add your number"],bullets:[["اختر رمز الدولة.","أدخل الرقم الذي تريد ربطه."],["Select the country code.","Enter the number you want to connect."]],tip:["يجب ألا يكون الرقم مربوطًا بحساب واتساب آخر.","The number must not be linked to another WhatsApp account."]}),
    step("17.4",{title:["اختر الرقم","Choose the number"],bullets:[["اختر إضافة رقم جديد.","اضغط التالي."],["Select Add a new number.","Select Next."]],tip:["الخيارات تختلف حسب حسابك.","Options may vary by account."]}),
    step("17.5",{title:["تحقق من الرقم","Verify the number"],bullets:[["اختر الاستلام عبر رسالة نصية أو مكالمة.","أدخل رمز التحقق المرسل إليك."],["Choose to receive a text or a call.","Enter the verification code you receive."]],tip:["أدخل الرمز داخل نافذة Meta فقط.","Enter the code only in the Meta window."]}),
    step("17.6",assets),
    step("17.7",details),
    step("17.8",permissions),
    step("17.9",finish),
  ],
};
export function guideIndex(index: number, delta: number, length: number) {
  return Math.max(0, Math.min(length - 1, index + delta));
}
export type WhatsappConnectionGuideProps = {
  route: Route; locale: "ar" | "en";
  /** Backend-owned label, never derived from guide navigation. */
  connectionStatus?: string;
  connectEnabled?: boolean; connecting?: boolean; preparing?: boolean;
  onConnect?: () => void;
  /** Local navigation only; does not start Meta authorization. */
  onReviewRequirements?: () => void;
  feedback?: string | null;
};
export function WhatsappConnectionGuide(props: WhatsappConnectionGuideProps) {
  // A route change starts its own sequence, never retaining another route's index.
  return <Guide key={props.route} {...props} />;
}
function Guide({route,locale,connectionStatus,connectEnabled=false,connecting=false,onConnect,onReviewRequirements,feedback}: WhatsappConnectionGuideProps) {
  const [index,setIndex] = useState(0);
  const ar = locale === "ar";
  const t = (a:string,e:string) => ar?a:e;
  const steps = guideSteps[route], current = steps[index], language = ar?0:1;
  const go=(d:number)=>setIndex(i=>guideIndex(i,d,steps.length));
  // Arrow keys follow reading direction: in RTL, ArrowLeft moves forward.
  const onKey=(e:KeyboardEvent<HTMLElement>)=>{
    const forward=ar?"ArrowLeft":"ArrowRight", back=ar?"ArrowRight":"ArrowLeft";
    if(e.key===forward){e.preventDefault();go(1);} else if(e.key===back){e.preventDefault();go(-1);}
    else if(e.key==="Home"){e.preventDefault();setIndex(0);} else if(e.key==="End"){e.preventDefault();setIndex(steps.length-1);}
  };
  return <section className={styles.guide} dir={ar?"rtl":"ltr"} aria-label={route==="new-number"?t("ربط رقم واتساب جديد","Connect a new WhatsApp number"):t("ربط تطبيق واتساب للأعمال","Connect WhatsApp Business App")}>
    <div className={styles.reference} data-visible-connection-guide="true">
      <div className={styles.stage} data-guide-source={current.source}>
        <button type="button" className={styles.arrow} disabled={index===0} aria-label={t("الخطوة السابقة","Previous step")} onClick={()=>go(-1)}>{ar?"›":"‹"}</button>
        <div className={styles.picture} role="group" tabIndex={0} onKeyDown={onKey}
          aria-roledescription={t("عرض صور","carousel")} aria-label={t("صورة توضيحية للدليل","Guide illustration")}>
          {/* Reference pixels only; the QR-bearing source remains withheld. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {current.image?<img src={current.image} loading="lazy" alt={t("مثال مرجعي لنافذة Meta: ","Reference Meta panel: ")+current.title[language]} width={340} height={445}/>:<p>{t("اتبع نافذة Meta الحالية لهذه الخطوة.","Follow the current Meta window for this step.")}</p>}
        </div>
        <button type="button" className={styles.arrow} disabled={index===steps.length-1} aria-label={t("الخطوة التالية","Next step")} onClick={()=>go(1)}>{ar?"‹":"›"}</button>
      </div>
      <div className={styles.dots} role="group" aria-label={t("خطوات الدليل","Guide steps")} onKeyDown={onKey}>{steps.map((s,i)=><button type="button" key={s.source} data-guide-step={i} data-active={i===index||undefined}
        aria-current={i===index?"step":undefined} aria-label={t("الخطوة ","Step ")+(i+1)+": "+s.title[language]} onClick={()=>setIndex(i)}><span aria-hidden="true"/></button>)}</div>
      <div className={styles.explanation}>
        <p className={styles.counter} aria-live="polite" aria-atomic="true"><b>{t("الخطوة","Step")} {index+1}</b> {t("من","of")} {steps.length}</p>
        <h4>{current.title[language]}</h4>
        <ul className={styles.bullets}>{current.bullets[language].map(b=><li key={b}>{b}</li>)}</ul>
        <p className={styles.tip}>{current.copy[language]}</p>
      </div>
    </div>
    <div className={styles.connectArea} data-guide-connect-area="true">
      <button type="button" className={styles.connect} data-connect-action="true" disabled={!connectEnabled||connecting||!onConnect} onClick={onConnect}><svg className={styles.facebookIcon} aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="12" fill="#fff"/><path fill="#1877F2" d="M16.5 15.5l.5-3.5h-3.3V9.8c0-1 .5-1.9 2-1.9h1.5V4.9s-1.4-.2-2.7-.2c-2.8 0-4.6 1.7-4.6 4.7V12H6.8v3.5h3.1V24h3.8v-8.5z"/></svg>{connecting?t("جارٍ الاتصال…","Connecting…"):t("المتابعة باستخدام Facebook","Continue with Facebook")}</button>
      {connectionStatus&&<GuideStatusBadge label={connectionStatus}/>}
      {feedback&&<p className={styles.feedbackText} role="alert" data-connect-feedback="true">{feedback}</p>}
    </div>
    {onReviewRequirements&&<button type="button" className={styles.secondary} onClick={onReviewRequirements}>{t("مراجعة متطلبات الربط","Review connection requirements")}</button>}
  </section>;
}

export function GuideStatusBadge({label}:{label:string}){
  return <span className={styles.status}><i aria-hidden="true"/>{label}</span>;
}
