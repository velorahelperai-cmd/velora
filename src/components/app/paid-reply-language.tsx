"use client";
import {useId,useLayoutEffect,useRef,useState} from "react";
import type {CompanyRecord} from "@/lib/tenancy/types";
import styles from "./paid-reply-language.module.css";
import {useSetupUnsavedChanges} from './paid-setup-unsaved';

export type ReplyLanguageScope={expectedAccountId:string;companyId:string;branchId:string};
/** Presentation projection only. The host must validate the authoritative company and setup result. */
export type ReplyLanguageSnapshot={
  scope:ReplyLanguageScope;version:number;companyLabel:string;branchLabel:string;
  replyLanguage:CompanyRecord["reply_language"] | null;
  confirmation:"confirmed" | "unconfirmed" | "unknown";
  canConfirm:boolean | null;
};
export type PaidReplyLanguageProps={
  locale:"ar"|"en";scope:ReplyLanguageScope;boundaryFingerprint:string;
  snapshot:ReplyLanguageSnapshot|null;
  state:{scope:ReplyLanguageScope;version:number|null;phase:"loading"|"ready"|"saving"|"error"|"conflict"|"unavailable"};
  isCurrent:()=>boolean;
  onReload?:()=>void;
  onConfirm?:(input:ReplyLanguageScope & {expectedVersion:number;replyLanguage:CompanyRecord["reply_language"]})=>void|Promise<void>;
};
const sameScope=(a:ReplyLanguageScope,b:ReplyLanguageScope)=>!!a.expectedAccountId&&!!a.companyId&&!!a.branchId&&a.expectedAccountId===b.expectedAccountId&&a.companyId===b.companyId&&a.branchId===b.branchId;
const validVersion=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=1;
export const replyLanguageViewKey=(p:PaidReplyLanguageProps)=>JSON.stringify([p.scope.expectedAccountId,p.scope.companyId,p.scope.branchId,p.boundaryFingerprint,p.snapshot?.version]);
export function PaidReplyLanguage(p:PaidReplyLanguageProps){
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e;
  const scoped=!!p.boundaryFingerprint&&sameScope(p.scope,p.state.scope);
  if(scoped&&p.state.phase==="loading")return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-busy="true"><p role="status">{t("جارٍ تحميل إعداد لغة الرد.","Loading reply-language settings.")}</p></section>;
  if(!scoped||!p.snapshot||!sameScope(p.scope,p.snapshot.scope)||!validVersion(p.snapshot.version)||p.state.version!==p.snapshot.version)
    return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("إعداد لغة الرد غير متاح لهذا الحساب والفرع. أعد تحميل البيانات.","Reply-language settings are unavailable for this account and branch. Reload the data.")}</p></section>;
  return <LanguageForm key={replyLanguageViewKey(p)} {...p} snapshot={p.snapshot}/>;
}
function LanguageForm(p:PaidReplyLanguageProps & {snapshot:ReplyLanguageSnapshot}){
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
  const [ack,setAck]=useState(false),[pending,setPending]=useState(false),[failed,setFailed]=useState(false);
  const mounted=useRef(false),reserved=useRef(false);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const known=["ar","en","both"].includes(p.snapshot.replyLanguage??"");
  const confirmed=p.snapshot.confirmation==="confirmed"&&p.snapshot.replyLanguage==="both";
  useSetupUnsavedChanges(ack&&!confirmed,p.isCurrent,p.locale);
  if(p.state.phase==='unavailable')return <section className={styles.view} data-setup-unsaved={ack&&!confirmed?'true':undefined}><p role="status">{t('إعداد لغة الرد غير متاح. لم يتأكد الحفظ.','Reply-language settings are unavailable. Saving is unconfirmed.')}</p>{p.onReload&&<button onClick={()=>{if(p.isCurrent())p.onReload?.();}}>{t('إعادة المحاولة','Retry')}</button>}</section>;
  const locked=p.state.phase!=="ready"||pending||!known||p.snapshot.confirmation!=="unconfirmed"||p.snapshot.canConfirm!==true||!p.onConfirm;
  async function submit(){
    if(locked||!ack||reserved.current||!p.isCurrent())return;
    reserved.current=true;setPending(true);setFailed(false);
    try{await p.onConfirm?.({...p.scope,expectedVersion:p.snapshot.version,replyLanguage:"both"});}
    catch{if(mounted.current&&p.isCurrent())setFailed(true);}
    finally{reserved.current=false;if(mounted.current&&p.isCurrent())setPending(false);}
  }
  const current=p.snapshot.replyLanguage==="ar"?t("العربية","Arabic"):p.snapshot.replyLanguage==="en"?t("الإنجليزية","English"):p.snapshot.replyLanguage==="both"?t("العربية والإنجليزية حسب لغة العميل","Arabic and English, following the customer"):t("غير معروف","Unknown");
  return <section className={styles.view} data-setup-unsaved={ack&&!confirmed?'true':undefined} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={pending||p.state.phase==="saving"}>
    <header><p className={styles.eyebrow}>{t("إعداد المساعد","Assistant setup")}</p><h2 id={id}>{t("لغة الرد التلقائية","Automatic reply language")}</h2>
      <p>{t("الشركة: ","Company: ")}<bdi>{p.snapshot.companyLabel}</bdi> · {t("الفرع المحدد: ","Selected branch: ")}<bdi>{p.snapshot.branchLabel}</bdi></p></header>
    <div className={styles.explanation}><h3>{t("العربية والإنجليزية، حسب لغة العميل","Arabic and English, following the customer")}</h3>
      <p>{t("هذا هو الإعداد المقترح ليتبع المساعد لغة العميل بالعربية أو الإنجليزية. لغة واجهة حسابك منفصلة عن هذا الاختيار.","This setting requests replies in Arabic or English following the customer's language. Your account interface language is a separate choice.")}</p>
      <p>{t("إعداد اللغة الحالي يخص الشركة ويشمل فروعها، وليس إعدادًا مستقلًا لهذا الفرع.","The existing language setting belongs to the company and applies across its branches; it is not a separate setting for this branch.")}</p>
    </div>
    <dl className={styles.current}><dt>{t("الإعداد المحفوظ","Saved setting")}</dt><dd>{current}</dd></dl>
    <p className={styles.note}>{t("التأكيد لا يشغّل الردود للعملاء. تحقّق من السلوك في اختبار المساعد، ثم أكمل متطلبات الجاهزية وتأكيد الإطلاق.","Confirmation does not enable customer replies. Verify the behavior in the assistant test, then complete readiness requirements and explicit launch confirmation.")}</p>
    {confirmed&&p.state.phase==="ready"&&<p role="status" className={styles.confirmed}>{t("أكد الخادم حفظ الإعداد وتأكيد هذه الخطوة.","The server confirmed the saved setting and this step's confirmation.")}</p>}
    {(!known||p.snapshot.confirmation==="unknown"||(p.snapshot.confirmation==="confirmed"&&!confirmed))&&<p role="status">{t("حالة الإعداد أو التأكيد غير مكتملة. أعد تحميل البيانات قبل المتابعة.","The setting or confirmation state is incomplete. Reload before continuing.")}</p>}
    {(p.state.phase==="error"||failed)&&<p role="alert" className={styles.error}>{t("تعذّر تأكيد الإعداد. راجع الحالة الحالية وأعد المحاولة عند توفرها.","The setting could not be confirmed. Review the current state and retry when available.")}</p>}
    {p.state.phase==="conflict"&&<p role="alert" className={styles.error}>{t("تغيّرت بيانات الحساب أو الإعداد. أعد التحميل وراجع الاختيار مجددًا.","The account or setting changed. Reload and review the choice again.")}</p>}
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <label className={styles.check}><input type="checkbox" checked={ack} disabled={locked} onChange={event=>{if(p.isCurrent())setAck(event.target.checked);}}/>{t("أؤكد استخدام العربية والإنجليزية حسب لغة العميل للشركة وفروعها.","I confirm Arabic and English following the customer's language for the company and its branches.")}</label>
      <button type="submit" disabled={locked||!ack}>{pending||p.state.phase==="saving"?t("جارٍ التأكيد…","Confirming…"):t("تأكيد إعداد اللغة","Confirm language setting")}</button>
    </form>
    {!p.onConfirm&&<p className={styles.note}>{t("لم يُربط التأكيد بالحفظ بعد.","Confirmation is not connected to persistence yet.")}</p>}
  </section>;
}
