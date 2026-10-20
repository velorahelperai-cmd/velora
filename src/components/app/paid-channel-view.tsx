"use client";

import {useId, useState} from "react";
import type {PaidBranchSetupRead, PaidSetupChannel} from "@/lib/tenancy/paid-setup-contracts";
import {checklistSteps, paidChecklistFromRead, type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {WhatsappConnectionGuide} from "./whatsapp-connection-guide";
import styles from "./paid-channel-view.module.css";
import type {PaidBranchConnectionRead} from "@/lib/tenancy/paid-branch-connection-contracts";
import {channelConnectionLabel, scopedChannelConnection} from "./paid-channel-connection-model";

/** Presentation only. No provider SDK, action, or authorization is started here.
 * The integration owner must supply the existing authoritative branch read. */
export type PaidChannelViewProps = {
  locale: "ar" | "en";
  scope: PaidSetupFlowProps["scope"] & {branchId: string};
  read: PaidBranchSetupRead | null;
  channel: PaidSetupChannel;
  /** Optional released B3 read; flat scope fields, never a start receipt. */
  connectionRead?: PaidBranchConnectionRead | null;
};

export function PaidChannelView(props: PaidChannelViewProps) {
  // A different actor, capture, company, branch, channel or entitlement starts
  // with no route selected. Locale changes preserve the owner's choice.
  const identity = JSON.stringify([props.scope, props.channel, props.read?.sourceStatus,
    props.read?.selectedChannels, props.read?.entitlement]);
  return <ChannelView key={identity} {...props}/>;
}

function ChannelView({locale, scope, read, channel, connectionRead}: PaidChannelViewProps) {
  const [route, setRoute] = useState<"new-number" | "coexistence" | null>(null);
  const [screen,setScreen] = useState<"choice"|"guide"|"requirements">("choice");
  const titleId = useId();
  const ar = locale === "ar";
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const model = read ? paidChecklistFromRead(read, scope) : null;
  const steps = model ? checklistSteps(model) : [];
  const channelStep = steps.find(step => step.id === channel);
  const branch = model?.branches.find(item => item.id === scope.branchId);
  const connection = scopedChannelConnection(connectionRead, {...scope, channel});
  const available = !!scope.expectedAccountId && !!scope.boundaryFingerprint && !!branch &&
    !!channelStep && (channelStep.status === "pending" || channelStep.status === "verified") &&
    channelStep.dependencyIds.every(id => steps.some(step => step.id === id && step.status === "verified"));

  return <section className={styles.view} dir={ar ? "rtl" : "ltr"} aria-labelledby={titleId}>
    <header className={styles.header}>
      <h2 id={titleId}>{t("ربط القناة", "Connect channel")}</h2>
      {available && <p>{t("الفرع: ", "Branch: ")}<bdi>{branch.label}</bdi></p>}
      {available && connectionRead !== undefined && <p role="status">{channelConnectionLabel(connection, locale)}</p>}
    </header>
    {!available ? <p role="status">{t("هذه القناة غير متاحة لهذا الفرع. ارجع إلى قائمة الإعداد للتحقق من اختيارك.", "This channel is unavailable for this branch. Return to setup to check your selection.")}</p> :
      channel === "whatsapp" ? <>
        {screen==="choice"&&<div className={styles.connectLayout} data-wa-screen="choice">
        <div className={styles.intro}>
          <div className={styles.brands} aria-hidden="true"><span>WhatsApp</span><span>↔</span><span>Meta</span></div>
          <h3>{t("اربط رقم واتساب الخاص بنشاطك","Connect your business WhatsApp number")}</h3>
          <p>{t("اختر طريقة الربط المناسبة لرقمك، ثم راجع دليل الخطوات والمتطلبات.","Choose the right connection route for your number, then review the guide and requirements.")}</p>
          <ul><li>{t("رقم نشاطك وهويته","Your business number and identity")}</li><li>{t("ربط القناة بالفرع المحدد","Connection scoped to the selected branch")}</li><li>{t("الردود تبدأ بعد تأكيد التشغيل","Replies start after launch confirmation")}</li></ul>
        </div><div className={styles.routeCard}><fieldset className={styles.routes}>
          <legend>{t("كيف تستخدم هذا الرقم؟", "How do you use this number?")}</legend>
          {(["new-number", "coexistence"] as const).map(value => <label key={value} className={styles.choice}>
            <input type="radio" name={titleId + "-route"} value={value} checked={route === value} onChange={() => setRoute(value)}/>
            <span>{value === "new-number" ? t("رقم جديد", "New number") : t("رقم على تطبيق WhatsApp Business", "WhatsApp Business App number")}</span>
            <small>{value==="new-number"?t("رقم غير مرتبط بحساب واتساب أو مزود آخر.","A number not linked to WhatsApp or another provider."):t("ربط متزامن مع تطبيق نشاطك الحالي، إذا كان حسابك مؤهلاً.","Coexistence with your existing Business App, if your account is eligible.")}</small>
          </label>)}
        </fieldset>
        <button className={styles.primary} type="button" disabled={!route} onClick={()=>setScreen("guide")}>{t("عرض خطوات الربط","View connection steps")}</button></div></div>}
        <p className={styles.note}>{t("إذا كان الرقم مرتبطًا بمزود آخر، يلزم تقييم نقل منفصل قبل المتابعة. لا تفصل الرقم ولا تحذفه.", "A number linked to another provider needs a separate migration assessment before continuing. Do not disconnect or delete it.")}</p>
        <p className={styles.note}>{t("تحدد Meta أهلية الحساب والبلد. اختيار المسار أو إنهاء الدليل لا يؤكد الربط ولا يفعّل الردود.", "Meta determines account and country eligibility. Choosing a route or finishing the guide does not confirm connection or enable replies.")}</p>
        {screen==="guide"&&route&&<div data-wa-screen="guide"><button type="button" className={styles.back} onClick={()=>setScreen("choice")}>{t("رجوع","Go back")}</button><WhatsappConnectionGuide route={route} locale={locale} connectionStatus={connectionRead === undefined ? t("دليل الربط", "Connection guide") : channelConnectionLabel(connection, locale)} onReviewRequirements={()=>setScreen("requirements")}/></div>}
        {screen==="requirements"&&route&&<div className={styles.requirements} data-wa-screen="requirements">
          <div className={styles.brands} aria-hidden="true"><span>WhatsApp</span><span>↔</span><span>Meta</span></div>
          <h3>{t("تفاصيل مهمة قبل الربط","Key details to check before you connect")}</h3>
          <ul><li>{route==="coexistence"?t("تستخدم تطبيق WhatsApp Business بالفعل على هذا الرقم.","You already use WhatsApp Business App with this number."):t("تملك الرقم ويمكنك استلام رمز التحقق عليه.","You own the number and can receive its verification code.")}</li><li>{t("تحقق من أهلية بلد الرقم وحساب النشاط أثناء خطوات Meta؛ الأهلية غير مضمونة.","Check number-country and business-account eligibility in Meta; eligibility is not guaranteed.")}</li><li>{route==="coexistence"?t("حدّث تطبيق WhatsApp Business إلى أحدث إصدار متاح.","Update WhatsApp Business App to the latest available version."):t("جهّز حساب Meta الذي تملك صلاحية إدارة النشاط من خلاله.","Have the Meta account authorized to manage this business ready.")}</li></ul>
          <div className={styles.requirementActions}><button type="button" className={styles.back} onClick={()=>setScreen("guide")}>{t("رجوع","Go back")}</button><button type="button" className={styles.primary} data-connect-action="true" disabled>{t("المتابعة مع Facebook","Continue with Facebook")}</button></div>
          <p role="status">{t("بدء الربط غير متاح بعد. مراجعة المتطلبات لا تثبت الصلاحيات أو اكتمال الربط.","Connection start is not available yet. Reviewing requirements does not prove permissions or completion.")}</p>
        </div>}
      </> : <div className={styles.instagram}>
        <h3>{t("حساب Instagram الاحترافي", "Instagram professional account")}</h3>
        <p>{t("استخدم حسابًا احترافيًا تملك صلاحية إدارته. تُراجع الصلاحيات خلال التفويض الفعلي؛ قراءة التعليمات لا تمنحها.", "Use a professional account you have permission to manage. Permissions are checked during authorization; reading these instructions does not grant them.")}</p>
        <p role="status">{t("الربط غير متاح بعد. ستبقى الخطوة دون تغيير حتى يتم التحقق من الربط لهذا الفرع.", "Connection is not available yet. This step stays unchanged until connection is verified for this branch.")}</p>
        <button type="button" disabled>{t("ربط Instagram", "Connect Instagram")}</button>
      </div>}
  </section>;
}
