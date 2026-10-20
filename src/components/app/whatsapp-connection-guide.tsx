"use client";
import { useId, useState } from "react";
import styles from "./whatsapp-connection-guide.module.css";

type Route = "new-number" | "coexistence";
type Step = { source: string; image?: string; title: [string,string]; copy: [string,string] };
const step = (source: string, title: [string,string], copy: [string,string], safe = true): Step => ({
  source, title, copy, ...(safe ? {image: "/media/setup/connection-guide/" + source + ".png"} : {}),
});
const login: Step["copy"] = ["سجّل الدخول بالحساب الذي تدير به نشاطك. أدخل بيانات الدخول داخل نافذة Meta فقط.","Sign in with the account you use to manage your business. Enter credentials only in the Meta window."];
const review: Step["copy"] = ["راجع اسم التطبيق والشروط قبل المتابعة.","Review the app name and terms before continuing."];
const assets: Step["copy"] = ["اختر أصول النشاط الصحيحة، أو أنشئها إذا احتجت.","Select the correct business assets, or create them if needed."];
const details: Step["copy"] = ["راجع بيانات نشاطك قبل المتابعة.","Check your business details before continuing."];
const permissions: Step["copy"] = ["راجع الحساب والصلاحيات المطلوبة قبل التأكيد.","Review the account and requested permissions before confirming."];
const finish: Step["copy"] = ["أنه الخطوات ثم ارجع إلى فيلورا للتحقق من الاتصال. إنهاء الدليل لا يؤكد الاتصال ولا يشغّل الردود.","Finish these steps, then return to Velora to verify the connection. Finishing this guide does not confirm connection or enable replies."];
/** Filenames preserve the user's observed entry order. These are reference panels,
 * not a promise of Meta's current flow. Coexistence displayed labels skip 4.
 * Source 13 contains a QR and is deliberately not exported. */
export const guideSteps: Record<Route, readonly Step[]> = {
  coexistence: [
    step("8",["تسجيل الدخول","Sign in"],login),
    step("9",["مراجعة الربط","Review connection"],review),
    step("10",["رقم تطبيق واتساب للأعمال","Business App number"],["راجع رمز الدولة ورقم تطبيق WhatsApp Business الحالي. قد تختلف تسميات نافذة Meta عن المثال.","Check the country code and your existing WhatsApp Business App number. Meta's labels may differ from this reference."]),
    step("11",["أصول النشاط","Business assets"],assets),
    step("12",["بيانات النشاط","Business details"],details),
    step("13",["الربط من التطبيق","Connect from the app"],["اتبع تعليمات نافذة Meta الحالية داخل تطبيق WhatsApp Business وراجع خيارات مشاركة السجل. صورة هذه الخطوة غير معروضة لحماية رمز الربط.","Follow the current Meta instructions in WhatsApp Business and review history-sharing options. This reference image is withheld to protect its connection code."],false),
    step("14",["مراجعة الصلاحيات","Review permissions"],permissions),
    step("15",["العودة إلى فيلورا","Return to Velora"],finish),
  ],
  "new-number": [
    step("17.1",["تسجيل الدخول","Sign in"],login),
    step("17.2",["مراجعة الربط","Review connection"],review),
    step("17.3",["إضافة الرقم","Add the number"],["راجع رمز الدولة والرقم الذي تريد ربطه.","Check the country code and the number you want to connect."]),
    step("17.4",["اختيار الرقم","Choose the number"],["اختر إضافة رقم جديد من الخيارات المتاحة لحسابك.","Choose to add a new number from the options available to your account."]),
    step("17.5",["التحقق من الرقم","Verify the number"],["أدخل رمز التحقق داخل نافذة Meta فقط.","Enter the verification code only in the Meta window."]),
    step("17.6",["أصول النشاط","Business assets"],assets),
    step("17.7",["بيانات النشاط","Business details"],details),
    step("17.8",["مراجعة الصلاحيات","Review permissions"],permissions),
    step("17.9",["العودة إلى فيلورا","Return to Velora"],finish),
  ],
};
export function guideIndex(index: number, delta: number, length: number) {
  return Math.max(0, Math.min(length - 1, index + delta));
}
export type WhatsappConnectionGuideProps = {
  route: Route; locale: "ar" | "en";
  /** Backend-owned label, never derived from guide navigation. */
  connectionStatus?: string;
  connectEnabled?: boolean; connecting?: boolean;
  onConnect?: () => void;
  /** Local navigation only; does not start Meta authorization. */
  onReviewRequirements?: () => void;
};
export function WhatsappConnectionGuide(props: WhatsappConnectionGuideProps) {
  // A route change starts its own sequence, never retaining another route's index.
  return <Guide key={props.route} {...props} />;
}
function Guide({route,locale,connectionStatus,connectEnabled=false,connecting=false,onConnect,onReviewRequirements}: WhatsappConnectionGuideProps) {
  const [index,setIndex] = useState(0);
  const id = useId();
  const ar = locale === "ar";
  const t = (a:string,e:string) => ar?a:e;
  const steps = guideSteps[route], current = steps[index], language = ar?0:1;
  return <section className={styles.guide} data-sequence={!!onReviewRequirements} dir={ar?"rtl":"ltr"} aria-labelledby={id}>
    <header className={styles.header}><h2 id={id}>{t("ربط الحساب","Connect account")}</h2><span>{connectionStatus ?? t("لم يبدأ","Not started")}</span></header>
    <h3 className={styles.heading}>{t("أنت على وشك الانتهاء","You're almost there")}</h3>
    <p className={styles.subtitle}>{route==="coexistence"?t("دليل ربط تطبيق واتساب للأعمال الحالي.","Guide to connecting your existing WhatsApp Business App."):t("دليل ربط رقم واتساب جديد.","Guide to connecting a new WhatsApp number.")}</p>
<div className={styles.connectArea} data-guide-connect-area="true"><button type="button" className={styles.connect} data-connect-action="true" disabled={!connectEnabled||connecting||!onConnect} onClick={onConnect}>{connecting?t("جارٍ الاتصال…","Connecting…"):t("المتابعة باستخدام فيسبوك","Continue with Facebook")}</button></div>
    <div className={styles.panel} data-guide-source={current.source}>
      <div className={styles.picture}>
        {/* Exact reference pixels: no image optimizer/provider request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {current.image ? <img src={current.image} alt={t("مثال مرجعي لنافذة Meta: ","Reference Meta panel: ")+current.title[language]} width={340} height={445} /> : <p className={styles.withheld}>{t("اتبع نافذة Meta الحالية لهذه الخطوة.","Follow the current Meta window for this step.")}</p>}
      </div>
      <div className={styles.explanation}>
        <p aria-live="polite" aria-atomic="true">{t("الخطوة","Step")} {index+1} {t("من","of")} {steps.length}</p>
        <h4>{current.title[language]}</h4><p>{current.copy[language]}</p>
        <nav className={styles.navigation} aria-label={t("خطوات الدليل","Guide steps")}>
          <button type="button" disabled={index===0} aria-label={t("الخطوة السابقة","Previous step")} onClick={()=>setIndex(i=>guideIndex(i,-1,steps.length))}>{ar?"›":"‹"}</button>
          <div className={styles.dots}>{steps.map((s,i)=><button type="button" key={s.source} aria-label={t("الخطوة ","Step ")+(i+1)} aria-current={i===index?"step":undefined} onClick={()=>setIndex(i)}><span /></button>)}</div>
          <button type="button" disabled={index===steps.length-1} aria-label={t("الخطوة التالية","Next step")} onClick={()=>setIndex(i=>guideIndex(i,1,steps.length))}>{ar?"‹":"›"}</button>
        </nav>
      </div>
    </div>
    <p className={styles.reference}>{t("صور مرجعية من مزوّد آخر؛ قد تختلف نافذة Meta الحالية. الأسهم تغيّر الشرح فقط.","Reference images from another provider; the current Meta window may differ. Arrows change only the guide.")}</p>
    {route==="coexistence"&&<p className={styles.reference}>{t("التسلسل المرجعي المتاح ينتقل من تسمية الخطوة ٣ إلى ٥.","The available reference sequence jumps from displayed step 3 to 5.")}</p>}
    {onReviewRequirements&&<div className={styles.footer}><button type="button" className={styles.connect} onClick={onReviewRequirements}>{t("مراجعة متطلبات الربط","Review connection requirements")}</button></div>}
  </section>;
}

