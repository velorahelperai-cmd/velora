"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionCycle, SubscriptionView } from "./subscription-model";
import { SubscriptionBrandGuide } from "./subscription-brand-guide";
import { SubscriptionCompareTable, SubscriptionOfferCards } from "./subscription-offer-cards";
import type { SubscriptionOffersView, SubscriptionChoice } from "./subscription-offers-view";
import { currentSubscriptionChoice, isApprovedOffer, formatOmrBaisa } from "./subscription-offers-view";
import { startTestCheckoutAction } from "@/lib/billing/wiring/test-checkout-actions";
import styles from "./subscription-panel.module.css";
const errors={
 ar:{settings:"الدفع التجريبي يحتاج استكمال إعدادات Paymob Test. تواصل مع إدارة المنصة لتجهيزه.",pending:"طلب الدفع قيد التحقق. افتح حالة الطلب قبل محاولة الدفع مرة أخرى.",phone:"أضف رقم هاتف الشركة في إعدادات النشاط قبل الدفع.",denied:"إدارة الاشتراك متاحة لمالك شركة غير معلّقة فقط.",active:"لشركتك اشتراك قائم بالفعل. التجديد المبكر وتغيير الباقة يحتاجان مراجعة منفصلة.",failed:"تعذّر بدء الدفع التجريبي. حدّث الصفحة وأعد المحاولة؛ إذا استمر الخطأ تواصل مع الدعم."},
 en:{settings:"Paymob Test setup is incomplete. Contact your platform administrator to finish payment setup.",pending:"Payment is being verified. Check the order status before trying again.",phone:"Add your company phone number in business settings before paying.",denied:"Only the owner of an unsuspended company can manage billing.",active:"Your company already has a subscription. Early renewal and plan changes require a separate review.",failed:"Test checkout could not start. Refresh and try again; contact support if the issue continues."}
};
function paymentMessage(code:string,locale:"ar"|"en") {const c=errors[locale];if(code==="billing_phone_missing")return c.phone;if(code==="not_owner")return c.denied;if(code==="ALREADY_SUBSCRIBED"||code==="UPGRADE_NOT_CONFIGURED")return c.active;if(["payment_pending","checkout_persist_failed","PENDING_COLLECTION_RECONCILE","OPEN_COLLECTION_UNRESOLVED"].includes(code))return c.pending;if(["test_not_configured","test_keys_missing","test_config_invalid","omr_conversion_not_configured","checkout_schema_unavailable","callback_not_configured","create_disabled","admin_not_configured","plan_lookup_failed","order_not_ready"].includes(code))return c.settings;return c.failed;}
export function SubscriptionPanel({locale,view,offersView,preview=false,onRetry}:{locale:"ar"|"en";view:SubscriptionView;offersView?:SubscriptionOffersView;preview?:boolean;onRetry?:()=>void}){
 const c=subscriptionCopy[locale],ar=locale==="ar";
 const [cycle,setCycle]=useState<SubscriptionCycle>(view.cycle==="yearly"?"yearly":"monthly"),[choice,setChoice]=useState<SubscriptionChoice|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[orderId,setOrderId]=useState<string|null>(null);
 const inFlight=useRef(false),operations=useRef(new Map<string,string>());
 const validChoice=currentSubscriptionChoice(choice,cycle,offersView),selected=validChoice?.persona??null;
 const isApproved=validChoice?isApprovedOffer(validChoice.persona,validChoice.package,validChoice.term):false;
 const selectedOffer=validChoice?offersView?.offers.find(offer=>offer.versionId===validChoice.versionId):null,chosen=subscriptionTiers.find(tier=>tier.id===selected),current=subscriptionTiers.find(tier=>tier.id===view.currentTier);
 const visibleOrderId=orderId??view.pendingOrderId;
 const blockedState=["loading","error","suspended","pending","active"].includes(view.state);
 const canPay=!!validChoice&&isApproved&&!preview&&!busy&&!blockedState;
 function select(value:SubscriptionChoice|null){setChoice(value);setError(null);setOrderId(null);}
 async function checkout(){
  if(!canPay||!validChoice||inFlight.current)return;
  inFlight.current=true;setBusy(true);setError(null);
  let op=operations.current.get(validChoice.versionId);if(!op){op=crypto.randomUUID();operations.current.set(validChoice.versionId,op);}
  try{const result=await startTestCheckoutAction({planVersionId:validChoice.versionId,clientOpId:op});if(result.orderId)setOrderId(result.orderId);if(result.ok){window.location.assign(result.url);return;}setError(paymentMessage(result.code,locale));}catch{setError(errors[locale].pending);}finally{inFlight.current=false;setBusy(false);}
 }
 return <div className={styles.root} data-surface="account" data-design-only={preview?"true":undefined} lang={locale} dir={ar?"rtl":"ltr"}>
  <header className={styles.heading}><div><h1>{c.title}</h1><p>{ar?"اختر شخصية فيلورا التي تناسب احتياج شركتك.":"Choose the Velora persona that fits your business."}</p></div><span className={styles.concept}>{c.concept}</span></header>
  <SubscriptionBrandGuide locale={locale}/>
  <section className={styles.summary} aria-labelledby="subscription-current"><div className={styles.summaryTitle}><h2 id="subscription-current">{c.current}</h2><span className={styles.status} data-state={view.state}>{c.states[view.state]}</span></div><p role={view.state==="error"?"alert":"status"}>{c[`${view.state}Note`]}</p>{view.state==="loading"?<div className={styles.skeleton} aria-busy="true"/>:<dl className={styles.facts}><div><dt>{c.currentPlan}</dt><dd>{current?current[locale]:c.noPlan}</dd></div><div><dt>{c.cycle}</dt><dd>{view.cycle?c[view.cycle]:c.unknown}</dd></div><div><dt>{c.renewal}</dt><dd>{view.paidThrough?<bdi>{new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(view.paidThrough))}</bdi>:c.unknown}</dd></div></dl>}{view.state==="error"&&onRetry?<button className={styles.secondary} type="button" onClick={onRetry}>{c.retry}</button>:null}</section>
  <section aria-labelledby="subscription-plans">
   <div className={styles.planHeading}><div><h2 id="subscription-plans">{ar?"مين تناسب شغلك؟":"Who fits your business?"}</h2><p>{ar?"اختر الشخصية، ثم حدد Basic أو Premium.":"Choose your persona, then pick Basic or Premium."}</p></div>
    <div className={styles.cycles} role="group" aria-label={c.cycle}>{(["monthly","yearly"] as const).map(term=><button type="button" key={term} disabled={busy} aria-pressed={cycle===term} onClick={()=>{setCycle(term);select(null);}}>{c[term]}</button>)}</div>
   </div>
   {cycle==="yearly"?(
    <div className={styles.annualDraftBanner} role="status">
     <div className={styles.annualBannerHeader}><span aria-hidden="true">ℹ️</span><strong>{c.annualBannerTitle}</strong></div>
     <p>{c.annualBannerNote}</p>
    </div>
   ):null}
   <SubscriptionOfferCards locale={locale} term={cycle} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={selected} selectedPackage={validChoice?.package} currentPersona={view.currentTier} disabled={busy||["loading","error","suspended"].includes(view.state)} onSelectionInvalidated={()=>select(null)} onSelect={select}/>
   {offersView?.status!=="ready"?<p className={styles.catalogNote} role={offersView?.status==="error"?"alert":"status"}>{offersView?.status==="error"?c.catalogError:offersView?.status==="empty"?c.catalogEmpty:c.catalogReasons.schema_unavailable}</p>:null}
  </section>
  <SubscriptionCompareTable locale={locale} term={cycle} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={selected}/>
  <section className={styles.next} aria-labelledby="subscription-next" aria-busy={busy}>
   <div>
    <h2 id="subscription-next">{ar?"ملخص اختيارك":"Your selection"}</h2>
    <p className={styles.selectionTitle}>{chosen&&validChoice?`${chosen[locale]} · ${c[validChoice.package]}`:c.selectionEmpty}</p>
    {selectedOffer?<div className={styles.checkoutAmount}><bdi>{formatOmrBaisa(selectedOffer.amountBaisa,locale)}</bdi><span>/ {c[cycle]}</span></div>:null}
    <p id="subscription-payment-note" className={styles.paymentNote}>{view.state==="suspended"?c.suspendedBlocked:view.state==="pending"?c.pendingBlocked:view.state==="active"?errors[locale].active:preview?(ar?"معاينة التصميم؛ الدفع غير متاح هنا.":"Design preview; checkout is unavailable here."):!isApproved&&validChoice?(cycle==="yearly"?c.annualBannerNote:c.draftPlanDisabledNote):(ar?"Paymob Test — تجربة دفع فقط. لا يتم خصم أموال حقيقية. رسوم التأسيس تُراجع منفصلة.":"Paymob Test — no real money is charged. Setup fees are reviewed separately.")}</p>
    {error?<p className={styles.paymentError} role="alert">{error}</p>:null}
    {visibleOrderId?<Link className={styles.heroLink} href={`/app/subscription/orders/${visibleOrderId}`}>{ar?"عرض حالة الطلب":"View order status"}</Link>:null}
   </div>
   <button type="button" className={styles.pay} disabled={!canPay} aria-describedby="subscription-payment-note" onClick={()=>void checkout()}>{busy?(ar?"جارٍ تجهيز الدفع…":"Preparing checkout…"):!isApproved&&validChoice?(cycle==="yearly"?c.annualNotPurchasable:c.notPurchasable):(ar?"متابعة للدفع التجريبي":"Continue to test checkout")}<span aria-hidden="true">↗</span></button>
  </section>
 </div>;
}
