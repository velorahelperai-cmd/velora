"use client";
import { subscriptionIntentFromChoice, subscriptionIntentHref, type SubscriptionDestination, type SubscriptionIntent } from "@/components/app/subscription-navigation";
import Link from "next/link";
import { useState } from "react";
import type { LandingCopy, PlanId } from "@/lib/landing-copy";
import { SubscriptionBrandGuide } from "@/components/app/subscription-brand-guide";
import { SubscriptionCompareTable, SubscriptionOfferCards } from "@/components/app/subscription-offer-cards";
import { subscriptionCopy, subscriptionTiers } from "@/components/app/subscription-copy";
import type { SubscriptionOffersView, SubscriptionPersona, SubscriptionTerm, SubscriptionChoice } from "@/components/app/subscription-offers-view";
import { currentSubscriptionChoice, isApprovedOffer, isPurchasableOffer, formatOmrBaisa } from "@/components/app/subscription-offers-view";
import styles from "@/components/app/subscription-panel.module.css";
const planByPersona: Record<SubscriptionPersona, PlanId> = { level_1:"support", level_2:"expanded", level_3:"integrated" };
export function Packages({ copy, locale, destination, offersView, selectedPlan, onSelect }: { copy:LandingCopy; destination?:SubscriptionDestination; locale:"ar"|"en"; offersView?:SubscriptionOffersView; selectedPlan:PlanId|null; onSelect:(plan:PlanId)=>void }) {
 void copy; void selectedPlan;const c=subscriptionCopy[locale];
 const [term,setTerm]=useState<SubscriptionTerm>("monthly");
 const [choice,setChoice]=useState<SubscriptionChoice|null>(null);
 const [intent,setIntent]=useState<SubscriptionIntent>({term:"monthly"});
 function changeTerm(value:SubscriptionTerm){setTerm(value);setChoice(null);setIntent({term:value,...(intent.persona&&intent.package?{persona:intent.persona,package:intent.package}:{})});}
 const validChoice=currentSubscriptionChoice(choice,term,offersView);
 const isApproved=validChoice?isApprovedOffer(validChoice.persona,validChoice.package,validChoice.term):false;
 const selectedOffer=validChoice&&offersView?.status==="ready"?offersView.offers.find(offer=>offer.versionId===validChoice.versionId&&offer.term===validChoice.term):null;
 const isPurchasable=validChoice?isPurchasableOffer(validChoice.persona,validChoice.package,validChoice.term,selectedOffer??undefined,offersView?.status):false;
 const target=destination??{href:"/login?next=%2Fapp%2Fsettings%3Ftab%3Dplan",kind:"login" as const,note:null};
 const catalogNote=offersView?.status==="ready"?c.catalogReady:offersView?.status==="error"?c.catalogError:offersView?.status==="empty"?c.catalogEmpty:c.catalogReasons.schema_unavailable;
 return <section id="packages" data-scene="8" className="scene scene-dark px-6 py-20 lg:px-12 lg:py-24">
  <div data-seq="veil" aria-hidden className="scene-veil" style={{background:"#050607"}} />
  <div data-seq="stage" className="relative z-10 mx-auto max-w-[1380px]">
   <h2 data-seq="packages-title" className="mx-auto max-w-[26ch] text-center text-[clamp(2rem,4vw,3.25rem)] font-bold leading-snug text-[#f4f7f5] sm:max-w-none">{c.packagesTitle}</h2>
   <p data-seq="packages-lead" className="mx-auto mt-4 max-w-[52ch] text-center text-lg leading-8 text-[#c5d4cc]">{c.intro}</p>
   <div className="mx-auto mt-8 h-0.5 w-44 rounded-full bg-[#3ee0a0]" data-seq="trace" aria-hidden />
   <div className={styles.root} data-surface="public" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} style={{marginTop:32}}>
    <SubscriptionBrandGuide locale={locale} selectedPersona={validChoice?.persona} />
    <div className={styles.planHeading}><p>{c.chooseNote}</p><div className={styles.cycles} role="group" aria-label={c.cycle}>
     <button type="button" aria-pressed={term==="monthly"} onClick={()=>changeTerm("monthly")}>{c.monthly}</button>
     <button type="button" aria-pressed={term==="yearly"} onClick={()=>changeTerm("yearly")}>{c.yearly}</button>
    </div></div>
    {term==="yearly"?(
     <div className={styles.annualDraftBanner} role="status">
      <div className={styles.annualBannerHeader}><span aria-hidden="true">ℹ️</span><strong>{c.annualBannerTitle}</strong></div>
      <p>{c.annualBannerNote}</p>
     </div>
    ):null}
    <SubscriptionOfferCards locale={locale} term={term} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={validChoice?.persona??null} selectedPackage={validChoice?.package} onSelectionInvalidated={()=>{setChoice(null);setIntent({term});}} onSelect={choice=>{setChoice(choice);setIntent(subscriptionIntentFromChoice(choice,offersView)??{term});onSelect(planByPersona[choice.persona]);}} />
    <p className={styles.catalogNote} role={offersView?.status==="error"?"alert":"status"}>{catalogNote}</p>
    <SubscriptionCompareTable locale={locale} term={term} offers={offersView?.status==="ready"?offersView.offers:[]} catalogStatus={offersView?.status} selectedPersona={validChoice?.persona??null} />
    <section className={styles.next} aria-labelledby="packages-next">
     <div>
      <h2 id="packages-next">{c.next}</h2>
      <p className={styles.selectionTitle}>{validChoice ? <>{subscriptionTiers.find(tier => tier.id === validChoice.persona)?.[locale]} · {c[validChoice.package]} / {c[term]}</> : intent.persona&&intent.package?`${subscriptionTiers.find(tier=>tier.id===intent.persona)?.[locale]} · ${c[intent.package]} / ${c[term]}`:c.selectionEmpty}</p>
      {selectedOffer?<dl className={styles.facts}><div><dt>{c.orderAmount}</dt><dd><bdi>{formatOmrBaisa(selectedOffer.amountBaisa,locale)}</bdi></dd></div><div><dt>{c.cycle}</dt><dd>{c[term]}</dd></div></dl>:null}
      {target.note ? <p role="status">{c.permissionNotes[target.note]}</p> : null}
      {validChoice && !isPurchasable ? <p className={styles.draftPlanNotice}>{term === "yearly" ? c.annualBannerNote : isApproved ? c.draftAwaitingPublicationNote : c.draftPlanDisabledNote}</p> : null}
     </div>
     {isPurchasable || !validChoice ? (
      <Link href={subscriptionIntentHref(target,subscriptionIntentFromChoice(validChoice,offersView)??intent)} className={styles.payLink}>{c.navigationLabels[target.kind]}</Link>
     ) : (
      <button type="button" className={styles.payLink} disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
       {term === "yearly" ? c.annualNotPurchasable : isApproved ? c.notPublishedNotPurchasable : c.notPurchasable}
      </button>
     )}
    </section>
   </div>
  </div>
 </section>;
}
