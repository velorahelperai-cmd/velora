"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import {SubscriptionLifecycleNotice} from './subscription-lifecycle-notice';
import type { SubscriptionCycle, SubscriptionView } from "./subscription-model";
import { SubscriptionBrandGuide } from "./subscription-brand-guide";
import { SubscriptionCompareTable, SubscriptionOfferCards } from "./subscription-offer-cards";
import type { SubscriptionOffersView, SubscriptionChoice } from "./subscription-offers-view";
import { currentSubscriptionChoice, isPurchasableOffer, formatOmrBaisa } from "./subscription-offers-view";
import { commercialAmount, commercialPlan, matchesCommercialOffer } from "./subscription-commercial-catalog";
import { choiceFromSubscriptionIntent, subscriptionIntentFromChoice, subscriptionIntentFromParams, subscriptionIntentHref, type SubscriptionIntent } from "./subscription-navigation";
import { startLiveCheckoutAction } from "@/lib/billing/wiring/live-checkout-actions";
import {readCheckoutTermsAction} from '@/lib/billing/wiring/checkout-terms-actions';
import { startTestCheckoutAction } from "@/lib/billing/wiring/test-checkout-actions";
import styles from "./subscription-panel.module.css";
import { useOptionalAccountSession } from "./account-chrome";
import { catalogStateCopy } from "./subscription-catalog-state";
const errors={
 ar:{settings:"الدفع التجريبي يحتاج استكمال إعدادات Paymob Test. تواصل مع إدارة المنصة لتجهيزه.",pending:"طلب الدفع قيد التحقق. افتح حالة الطلب قبل محاولة الدفع مرة أخرى.",phone:"أضف رقم هاتف الشركة في إعدادات النشاط قبل الدفع.",denied:"إدارة الاشتراك متاحة لمالك شركة غير معلّقة فقط.",active:"لشركتك اشتراك قائم بالفعل. التجديد المبكر وتغيير الباقة يحتاجان مراجعة منفصلة.",failed:"تعذّر بدء الدفع التجريبي. حدّث الصفحة وأعد المحاولة؛ إذا استمر الخطأ تواصل مع الدعم."},
 en:{settings:"Paymob Test setup is incomplete. Contact your platform administrator to finish payment setup.",pending:"Payment is being verified. Check the order status before trying again.",phone:"Add your company phone number in business settings before paying.",denied:"Only the owner of an unsuspended company can manage billing.",active:"Your company already has a subscription. Early renewal and plan changes require a separate review.",failed:"Test checkout could not start. Refresh and try again; contact support if the issue continues."}
};
function paymentMessage(code:string,locale:"ar"|"en") {const c=errors[locale];if(code==="billing_phone_missing")return c.phone;if(code==="not_owner"||code==="FORBIDDEN")return c.denied;if(code==="ALREADY_SUBSCRIBED"||code==="UPGRADE_NOT_CONFIGURED")return c.active;if(["payment_pending","checkout_persist_failed","PENDING_COLLECTION_RECONCILE","OPEN_COLLECTION_UNRESOLVED"].includes(code))return c.pending;if(["test_not_configured","test_keys_missing","test_config_invalid","omr_conversion_not_configured","checkout_schema_unavailable","callback_not_configured","create_disabled","admin_not_configured","plan_lookup_failed","order_not_ready","schema_unavailable","PUBLIC_OFFER_UNSUPPORTED"].includes(code))return c.settings;return c.failed;}
function livePaymentMessage(code:string,locale:"ar"|"en") {
 if(["payment_pending","LIVE_COLLECTION_REQUIRES_RECONCILIATION","PENDING_COLLECTION_RECONCILE","OPEN_COLLECTION_UNRESOLVED"].includes(code))return errors[locale].pending;
 if(["not_owner","FORBIDDEN","billing_phone_missing","ALREADY_SUBSCRIBED","UPGRADE_NOT_CONFIGURED"].includes(code))return paymentMessage(code,locale);
 if(code==="CATALOG_REVISION_CONFLICT")return locale==="ar"?"تغير الكتالوج. حدّث الصفحة وراجع الباقة قبل الدفع.":"The catalog changed. Refresh and review the plan before paying.";
 return locale==="ar"?"الدفع غير متاح حاليًا. حدّث الصفحة؛ تواصل مع الدعم إذا استمر الخطأ.":"Checkout is currently unavailable. Refresh the page; contact support if the issue continues.";
}
export function SubscriptionPanel({locale,view,offersView,companyId,preview=false,onRetry,masterJourneyEnabled=false}:{companyId?:string;locale:"ar"|"en";view:SubscriptionView;offersView?:SubscriptionOffersView;preview?:boolean;onRetry?:()=>void;masterJourneyEnabled?:boolean}){
 const c=subscriptionCopy[locale],ar=locale==="ar";
 const params=useSearchParams(),intent=subscriptionIntentFromParams(params),cycle:SubscriptionCycle=intent?.term??(view.cycle==="yearly"?"yearly":"monthly");
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[orderId,setOrderId]=useState<string|null>(null);
 const [reviewed,setReviewed]=useState<string|null>(null),reviewRef=useRef<HTMLElement>(null);
 const [terms,setTerms]=useState<{key:string;result:Awaited<ReturnType<typeof readCheckoutTermsAction>>}|null>(null);
 const [consentKey,setConsentKey]=useState<string|null>(null);
 const inFlight=useRef(false),operations=useRef(new Map<string,string>());
 const session=useOptionalAccountSession(),sessionRef=useRef(session),companyRef=useRef(companyId),mounted=useRef(false),requestGeneration=useRef(0);
 // Keep delayed financial responses bound to the latest rendered account and workspace.
 // eslint-disable-next-line react-hooks/refs
 sessionRef.current=session;companyRef.current=companyId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requestGeneration.current+=1;};},[]);
 const requestedChoice=choiceFromSubscriptionIntent(intent,offersView);
 const boundChoice=currentSubscriptionChoice(requestedChoice,cycle,offersView);
 const boundOffer=boundChoice?offersView?.offers.find(offer=>offer.versionId===boundChoice.versionId):undefined;
 const validChoice=boundChoice&&boundOffer&&matchesCommercialOffer(boundOffer)?boundChoice:null,selected=validChoice?.persona??intent?.persona??null;
 const selectedPackage=validChoice?.package??intent?.package;
 const selectedPlanSpec=selected&&selectedPackage?commercialPlan(selected,selectedPackage):null;
 const selectedOffer=validChoice?offersView?.offers.find(offer=>offer.versionId===validChoice.versionId):null,chosen=subscriptionTiers.find(tier=>tier.id===selected),current=subscriptionTiers.find(tier=>tier.id===view.currentTier);
 const text=catalogStateCopy[locale];
 const isPurchasable=validChoice?isPurchasableOffer(validChoice.persona,validChoice.package,validChoice.term,selectedOffer??undefined,offersView?.status):false;
 const visibleOrderId=orderId??view.pendingOrderId;
 const upgrading=masterJourneyEnabled&&view.state==='active'&&view.currentPackage==='basic'&&view.currentTier===validChoice?.persona&&validChoice?.package==='premium'&&validChoice.term==='monthly'&&selectedOffer?.liveCheckoutReady===true;
 const blockedState=["loading","error","suspended","pending"].includes(view.state)||view.state==='active'&&!upgrading;
 const reviewKey=validChoice?JSON.stringify([session?.identity?.userId??null,companyId,validChoice.versionId,validChoice.offerSignature]):null;
 const confirmedTerms=terms?.key===reviewKey&&terms.result.ok?terms.result:null;
 const termsConsentKey=confirmedTerms?`${reviewKey}:${confirmedTerms.termsVersion}`:null;
 useEffect(()=>{
  if(!masterJourneyEnabled||!reviewKey||reviewed!==reviewKey||!companyId||!validChoice?.versionId||!selectedOffer?.liveCheckoutReady)return;
  let active=true;const key=reviewKey,expectedCompany=companyId,actor=sessionRef.current?.identity?.userId;
  void readCheckoutTermsAction({planVersionId:validChoice.versionId,expectedCompanyId:companyId}).then(result=>{
   if(active&&companyRef.current===expectedCompany&&(!sessionRef.current||(!!actor&&sessionRef.current.isCurrentUser(actor))))setTerms({key,result});
  });return()=>{active=false;};
 },[reviewKey,reviewed,companyId,validChoice?.versionId,selectedOffer?.liveCheckoutReady,masterJourneyEnabled]);
 useEffect(()=>{if(reviewed&&reviewed===reviewKey)reviewRef.current?.focus();},[reviewed,reviewKey]);
 const canPay=!!validChoice&&isPurchasable&&!!companyId&&!preview&&!busy&&!blockedState&&(!masterJourneyEnabled||reviewed!==reviewKey||!selectedOffer?.liveCheckoutReady||!!confirmedTerms&&consentKey===termsConsentKey);
 function replaceIntent(value:SubscriptionIntent){const href=subscriptionIntentHref({href:window.location.pathname+window.location.search+window.location.hash,kind:"manage",note:null},value);window.history.replaceState(null,"",href);}
 function select(value:SubscriptionChoice|null){setError(null);setOrderId(null);setReviewed(null);setConsentKey(null);replaceIntent(subscriptionIntentFromChoice(value,offersView)??{term:cycle});}
 function inspect(value:SubscriptionIntent){setError(null);setOrderId(null);setReviewed(null);setConsentKey(null);replaceIntent(value);}
 function changeCycle(term:SubscriptionCycle){setError(null);setOrderId(null);setReviewed(null);setConsentKey(null);replaceIntent({term,...(intent?.persona&&intent.package?{persona:intent.persona,package:intent.package}:{})});}
 async function checkout(){
  if(!canPay||!validChoice||inFlight.current||reviewed!==reviewKey)return;
  const actor=sessionRef.current?.identity?.userId,requestCompany=companyId,generation=++requestGeneration.current;
  const current=()=>mounted.current&&requestGeneration.current===generation&&companyRef.current===requestCompany
   &&(!sessionRef.current||(!!actor&&sessionRef.current.isCurrentUser(actor)&&sessionRef.current.identity?.companyId===requestCompany));
  if(!current())return;
  inFlight.current=true;setBusy(true);setError(null);
  let op=operations.current.get(validChoice.versionId);if(!op){op=crypto.randomUUID();operations.current.set(validChoice.versionId,op);}
  try{const result=selectedOffer?.liveCheckoutReady===true?await startLiveCheckoutAction({expectedCompanyId:companyId!,planVersionId:validChoice.versionId,clientOpId:op,expectedCatalogRevision:selectedOffer.catalogRevision!,purchasePurpose:upgrading?'upgrade':'initial',termsVersion:confirmedTerms?.termsVersion,consentAccepted:!!termsConsentKey&&consentKey===termsConsentKey}):await startTestCheckoutAction({expectedCompanyId:companyId!,planVersionId:validChoice.versionId,clientOpId:op});if(!current())return;if(result.orderId)setOrderId(result.orderId);if(result.ok){window.location.assign(result.url);return;}setError(selectedOffer?.liveCheckoutReady ? livePaymentMessage(result.code,locale) : paymentMessage(result.code,locale));}catch{if(current())setError(errors[locale].pending);}finally{inFlight.current=false;if(current())setBusy(false);}
 }
 return <div className={styles.root} data-surface="account" data-design-only={preview?"true":undefined} lang={locale} dir={ar?"rtl":"ltr"}>
  <header className={styles.heading}><div><h1>{c.title}</h1><p>{ar?"اختر شخصية فيلورا التي تناسب احتياج شركتك.":"Choose the Velora persona that fits your business."}</p></div><span className={styles.concept}>{c.concept}</span></header>
  <SubscriptionBrandGuide locale={locale}/>
  <section className={styles.summary} aria-labelledby="subscription-current"><div className={styles.summaryTitle}><h2 id="subscription-current">{c.current}</h2><span className={styles.status} data-state={view.state}>{c.states[view.state]}</span></div><p role={view.state==="error"?"alert":"status"}>{masterJourneyEnabled&&view.state==='active'&&view.operationalReady===false?(ar?'تم إثبات الدفع، والخدمة تنتظر جاهزية القناة أو بداية الدورة المحددة.':'Payment is proven; service is waiting for channel readiness or its scheduled cycle start.'):c[`${view.state}Note`]}</p>{view.state==="loading"?<div className={styles.skeleton} aria-busy="true"/>:<dl className={styles.facts}><div><dt>{c.currentPlan}</dt><dd>{current?current[locale]:c.noPlan}</dd></div><div><dt>{c.cycle}</dt><dd>{view.cycle?c[view.cycle]:c.unknown}</dd></div><div><dt>{c.renewal}</dt><dd>{view.paidThrough?<bdi>{new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(view.paidThrough))}</bdi>:c.unknown}</dd></div></dl>}{view.state==="error"&&onRetry?<button className={styles.secondary} type="button" onClick={onRetry}>{c.retry}</button>:null}</section>
  <SubscriptionLifecycleNotice paidThrough={view.paidThrough} ar={ar}/>
  <section aria-labelledby="subscription-plans">
   <div className={styles.planHeading}><div><h2 id="subscription-plans">{ar?"من تناسب نشاطك؟":"Who fits your business?"}</h2><p>{ar?"اختر الموظفة، ثم حدد Standard أو Premium.":"Choose your staff member, then Standard or Premium."}</p></div>
    <div className={styles.cycles} role="group" aria-label={c.cycle}>{(["monthly","yearly"] as const).map(term=><button type="button" key={term} disabled={busy} aria-pressed={cycle===term} onClick={()=>changeCycle(term)}>{c[term]}{term==="yearly"?" −20%":""}</button>)}</div>
   </div>
   {cycle==="yearly"?(
    <div className={styles.annualDraftBanner} role="status">
     <div className={styles.annualBannerHeader}><span aria-hidden="true">ℹ️</span><strong>{c.annualBannerTitle}</strong></div>
     <p>{c.annualBannerNote}</p>
    </div>
   ):null}
   <SubscriptionOfferCards locale={locale} term={cycle} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={selected} selectedPackage={selectedPackage} currentPersona={view.currentTier} disabled={busy||["loading","error","suspended"].includes(view.state)} onSelectionInvalidated={()=>select(null)} onSelect={select} onInspect={inspect}/>
   {offersView?.status!=="ready"?<p className={styles.catalogNote} role={offersView?.status==="error"?"alert":"status"}>{offersView?.status==="error"?c.catalogError:offersView?.status==="empty"?c.catalogEmpty:c.catalogReasons.schema_unavailable}</p>:null}
  </section>
  <SubscriptionCompareTable locale={locale} term={cycle} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={selected}/>

  {reviewed===reviewKey&&reviewKey&&selectedOffer?<section ref={reviewRef} className={styles.review} aria-labelledby="checkout-review" tabIndex={-1}>
   <h2 id="checkout-review">{ar?"\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643":"Review your subscription"}</h2>
   <p>{chosen?.[locale]} / {c[validChoice!.package]} / {c[cycle]}</p>
   {upgrading&&<p role="status">{ar?'ترقية إلى Premium مقابل 45 ر.ع، مع الحفاظ على نهاية الدورة الحالية.':'Upgrade to Premium for OMR 45, keeping the current cycle end.'}</p>}
   {masterJourneyEnabled&&selectedOffer.liveCheckoutReady ? confirmedTerms ? <div>
    <p className="whitespace-pre-line">{confirmedTerms.termsText}</p>
    <ul>{confirmedTerms.features.map((feature,index)=><li key={index}>{feature}</li>)}</ul>
    <p>{ar?'الرسوم المعلنة:':'Disclosed charges:'}</p>
    {confirmedTerms.disclosedCharges.length ? <ul>{confirmedTerms.disclosedCharges.map((charge,index)=><li key={index}>{charge.label}: <bdi>{formatOmrBaisa(charge.amountBaisa,locale)}</bdi></li>)}</ul> : <p>{ar?'لا توجد رسوم إضافية في هذا العرض.':'This quote has no additional charges.'}</p>}
    <label className="mt-3 flex gap-3"><input type="checkbox" checked={!!termsConsentKey&&consentKey===termsConsentKey} disabled={busy} onChange={event=>setConsentKey(event.target.checked?termsConsentKey:null)}/>{ar?'قرأت شروط هذا العرض ومزاياه ورسومه وأوافق عليها.':'I have read and agree to this quote’s terms, features and charges.'}</label>
   </div> : <p role="status">{terms?.key===reviewKey ? (ar?'شروط الدفع المعتمدة غير متاحة حاليًا. لا يمكن بدء الدفع حتى تجهّزها الإدارة.':'Approved checkout terms are currently unavailable. Checkout is blocked until they are configured.') : (ar?'جارٍ تحميل شروط الدفع المعتمدة…':'Loading approved checkout terms…')}</p> : null}
   <dl><div><dt>{ar?"\u0627\u0644\u0645\u0628\u0644\u063a":"Amount"}</dt><dd><bdi>{formatOmrBaisa(upgrading?45000:selectedOffer.amountBaisa,locale)}</bdi></dd></div>
   <div><dt>{ar?"\u0627\u0644\u0633\u0639\u0629 \u0627\u0644\u0645\u0636\u0628\u0648\u0637\u0629":"Configured allowance"}</dt><dd>{selectedOffer.automatedOutboundPerMonth===null?c.unknown:selectedOffer.automatedOutboundPerMonth.toLocaleString(locale)}</dd></div></dl>
   <p>{ar?"\u0627\u0644\u0633\u0639\u0629 \u0644\u0627 \u062a\u0641\u0639\u0651\u0644 \u0627\u0644\u062e\u062f\u0645\u0629. \u064a\u062a\u0645 \u062a\u062d\u0642\u0642 \u0623\u0647\u0644\u064a\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u0628\u0634\u0643\u0644 \u0645\u0646\u0641\u0635\u0644.":"Configured capacity does not activate the service. Sending eligibility is checked separately."}</p>
   <details><summary>{ar?"\u0627\u0644\u0645\u0632\u0627\u064a\u0627":"Features"}</summary><ul>{selectedOffer.features.map(f=><li key={f.id}>{f.label[locale]}: {f.availability==="ready"?(ar?"\u062c\u0627\u0647\u0632":"Ready"):f.availability==="planned"?(ar?"\u0645\u062e\u0637\u0637":"Planned"):(ar?"\u063a\u064a\u0631 \u0645\u062a\u062d\u0642\u0642":"Not verified")}</li>)}</ul></details>
   <button type="button" className={styles.secondary} disabled={busy} onClick={()=>setReviewed(null)}>{ar?"\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0627\u062e\u062a\u064a\u0627\u0631":"Back to selection"}</button>
  </section>:null}
  <section className={styles.next} aria-labelledby="subscription-next" aria-busy={busy}>
   <div>
    <h2 id="subscription-next">{ar?"ملخص اختيارك":"Your selection"}</h2>
    <p className={styles.selectionTitle}>{chosen&&validChoice?`${chosen[locale]} · ${c[validChoice.package]}`:intent?.persona&&intent.package?`${subscriptionTiers.find(tier=>tier.id===intent.persona)?.[locale]} · ${c[intent.package]} / ${c[cycle]}`:c.selectionEmpty}</p>
    {selectedPlanSpec?<div className={styles.checkoutAmount}><bdi>{formatOmrBaisa(upgrading?45000:commercialAmount(selectedPlanSpec,cycle),locale)}</bdi><span>/ {c[cycle]}</span></div>:null}
    <p id="subscription-payment-note" className={styles.paymentNote}>{view.state==="suspended"?c.suspendedBlocked:view.state==="pending"?c.pendingBlocked:view.state==="active"?errors[locale].active:preview?(ar?"معاينة التصميم؛ الدفع غير متاح هنا.":"Design preview; checkout is unavailable here."):!validChoice?(selectedPlanSpec?text.blockedNote:c.selectionEmpty):!isPurchasable?text.blockedNote:selectedOffer?.liveCheckoutReady?text.liveNote:text.testNote}</p>
    {error?<p className={styles.paymentError} role="alert">{error}</p>:null}
    {visibleOrderId?<Link className={styles.heroLink} href={`/app/subscription/orders/${visibleOrderId}`}>{ar?"عرض حالة الطلب":"View order status"}</Link>:null}
   </div>
   <button type="button" className={styles.pay} disabled={!canPay} aria-describedby="subscription-payment-note" onClick={()=>{if(reviewed!==reviewKey){setReviewed(reviewKey);setError(null);}else void checkout();}}>{busy?(ar?"جارٍ تجهيز الدفع…":"Preparing checkout…"):validChoice&&!isPurchasable?text.unavailable:reviewed!==reviewKey?(ar?"\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0627\u062e\u062a\u064a\u0627\u0631":"Review selection"):selectedOffer?.liveCheckoutReady?(ar?"متابعة للدفع":"Continue to checkout"):(ar?"متابعة للدفع التجريبي":"Continue to test checkout")}<span aria-hidden="true">↗</span></button>
  </section>
 </div>;
}
