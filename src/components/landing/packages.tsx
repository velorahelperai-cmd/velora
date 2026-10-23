"use client";
import { subscriptionIntentFromChoice, subscriptionIntentHref, type SubscriptionDestination, type SubscriptionIntent } from "@/components/app/subscription-navigation";
import Link from "next/link";
import { useState } from "react";
import type { LandingCopy, PlanId } from "@/lib/landing-copy";
import { SubscriptionBrandGuide } from "@/components/app/subscription-brand-guide";
import { SubscriptionCompareTable, SubscriptionOfferCards } from "@/components/app/subscription-offer-cards";
import { subscriptionCopy, subscriptionTiers } from "@/components/app/subscription-copy";
import type { SubscriptionOffersView, SubscriptionPersona, SubscriptionTerm, SubscriptionChoice } from "@/components/app/subscription-offers-view";
import { currentSubscriptionChoice, formatOmrBaisa } from "@/components/app/subscription-offers-view";
import { commercialAmount, commercialPlan, matchesCommercialOffer } from "@/components/app/subscription-commercial-catalog";
import styles from "@/components/app/subscription-panel.module.css";
import { catalogOfferState, catalogStateCopy } from "@/components/app/subscription-catalog-state";
const planByPersona: Record<SubscriptionPersona, PlanId> = { level_1:"support", level_2:"expanded", level_3:"integrated" };
export function Packages({ copy, locale, destination, offersView, selectedPlan, onSelect }: { copy:LandingCopy; destination?:SubscriptionDestination; locale:"ar"|"en"; offersView?:SubscriptionOffersView; selectedPlan:PlanId|null; onSelect:(plan:PlanId)=>void }) {
 void copy; void selectedPlan;const c=subscriptionCopy[locale];
 const [term,setTerm]=useState<SubscriptionTerm>("monthly");
 const [choice,setChoice]=useState<SubscriptionChoice|null>(null);
 const [intent,setIntent]=useState<SubscriptionIntent>({term:"monthly"});
 function changeTerm(value:SubscriptionTerm){setTerm(value);setChoice(null);setIntent({term:value,...(intent.persona&&intent.package?{persona:intent.persona,package:intent.package}:{})});}
 const boundChoice=currentSubscriptionChoice(choice,term,offersView);
 const boundOffer=boundChoice?offersView?.offers.find(offer=>offer.versionId===boundChoice.versionId):undefined;
 const validChoice=boundChoice&&boundOffer&&matchesCommercialOffer(boundOffer)?boundChoice:null;
 const selectedOffer=validChoice&&offersView?.status==="ready"?offersView.offers.find(offer=>offer.versionId===validChoice.versionId&&offer.term===validChoice.term):null;
 const state=catalogOfferState(selectedOffer??undefined,term,offersView?.status), text=catalogStateCopy[locale];
 const selectedPlanSpec=intent.persona&&intent.package?commercialPlan(intent.persona,intent.package):null;
 const target=destination??{href:"/login?next=%2Fapp%2Fsettings%3Ftab%3Dplan",kind:"login" as const,note:null};
 const catalogNote=offersView?.status==="ready"?c.catalogReady:offersView?.status==="error"?c.catalogError:offersView?.status==="empty"?c.catalogEmpty:c.catalogReasons.schema_unavailable;
 return <section id="packages" data-scene="8" style={{background:"#F5F8F5",color:"#101B16"}} className="scene px-6 py-16 lg:px-12 lg:py-20">
  <div data-seq="veil" aria-hidden className="scene-veil" style={{background:"#F5F8F5"}} />
  <div data-seq="stage" className="relative z-10 mx-auto max-w-[1380px]">
   <h2 data-seq="packages-title" className="mx-auto max-w-[28ch] text-center text-[clamp(1.65rem,3.4vw,2.75rem)] font-bold leading-snug text-[#101B16] sm:max-w-none">{c.packagesTitle}</h2>
   <p data-seq="packages-lead" className="mx-auto mt-3 max-w-[48ch] text-center text-base leading-7 text-[#60736A] sm:text-lg sm:leading-8">{c.packagesLead}</p>
   <div className="mx-auto mt-4 h-0.5 w-28 rounded-full bg-[#38DC89]" data-seq="trace" aria-hidden />
   <div className={styles.root} data-surface="public" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} style={{marginTop:20}}>
    <SubscriptionBrandGuide
     locale={locale}
     selectedPersona={validChoice?.persona??intent.persona}
     onFocusPersona={(persona)=>{
      setIntent((previous)=>({term:previous.term,persona,package:previous.package??"basic"}));
      onSelect(planByPersona[persona]);
     }}
    />
    <div id="subscription-plans" className={styles.planHeading}><p>{c.chooseNote}</p><div className={styles.cycles} role="group" aria-label={c.cycle}>
     <button type="button" aria-pressed={term==="monthly"} onClick={()=>changeTerm("monthly")}>{c.monthly}</button>
     <button type="button" aria-pressed={term==="yearly"} onClick={()=>changeTerm("yearly")}>{c.yearly} −20%</button>
    </div></div>
    {term==="yearly"?(
     <div className={styles.annualDraftBanner} role="status">
      <div className={styles.annualBannerHeader}><span aria-hidden="true">ℹ️</span><strong>{c.annualBannerTitle}</strong></div>
      <p>{c.annualBannerNote}</p>
     </div>
    ):null}
    <SubscriptionOfferCards locale={locale} term={term} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={validChoice?.persona??intent.persona??null} selectedPackage={validChoice?.package??intent.package} onSelectionInvalidated={()=>{setChoice(null);setIntent({term});}} onInspect={value=>{setChoice(null);setIntent(value);if(value.persona)onSelect(planByPersona[value.persona]);}} onSelect={choice=>{setChoice(choice);setIntent(subscriptionIntentFromChoice(choice,offersView)??{term});onSelect(planByPersona[choice.persona]);}} />
    <p className={styles.catalogNote} role={offersView?.status==="error"?"alert":"status"}>{catalogNote}</p>
    <SubscriptionCompareTable locale={locale} term={term} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={validChoice?.persona??intent.persona??null} />
    <section className={styles.next} aria-labelledby="packages-next">
     <div>
      <h2 id="packages-next">{c.next}</h2>
      <p className={styles.selectionTitle}>{validChoice ? <>{subscriptionTiers.find(tier => tier.id === validChoice.persona)?.[locale]} · {c[validChoice.package]} / {c[term]}</> : intent.persona&&intent.package?`${subscriptionTiers.find(tier=>tier.id===intent.persona)?.[locale]} · ${c[intent.package]} / ${c[term]}`:c.selectionEmpty}</p>
      {selectedPlanSpec?<dl className={styles.facts}><div><dt>{c.orderAmount}</dt><dd><bdi>{formatOmrBaisa(commercialAmount(selectedPlanSpec,term),locale)}</bdi></dd></div><div><dt>{c.cycle}</dt><dd>{c[term]}</dd></div></dl>:null}
      {target.note ? <p role="status">{c.permissionNotes[target.note]}</p> : null}
      {validChoice ? <p className={styles.draftPlanNotice}>{state.purchase==="test_only"?text.testNote:text.blockedNote}</p> : null}
     </div>
     <Link href={subscriptionIntentHref(target,subscriptionIntentFromChoice(validChoice,offersView)??intent)} className={styles.payLink}>{c.navigationLabels[target.kind]}</Link>
    </section>
   </div>
  </div>
 </section>;
}
