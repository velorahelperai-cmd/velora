"use client";
import { useState } from "react";
import { SubscriptionCharacter } from "./subscription-character";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionChoice, SubscriptionOfferView, SubscriptionOffersView, SubscriptionTerm } from "./subscription-offers-view";
import { choiceFromOffer, formatOmrBaisa } from "./subscription-offers-view";
import type { SubscriptionIntent } from "./subscription-navigation";
import { commercialAmount, commercialCatalogRevision, commercialPlan, commercialPlans, matchingCommercialOffer } from "./subscription-commercial-catalog";
import styles from "./subscription-panel.module.css";
import { catalogOfferState, catalogStateCopy } from "./subscription-catalog-state";

export function SubscriptionOfferCards({ locale, term, offers, catalogStatus, selectedPersona, selectedPackage, currentPersona, disabled = false, onSelectionInvalidated, onSelect, onInspect }: {
  locale: "ar" | "en"; term: SubscriptionTerm; offers: readonly SubscriptionOfferView[];
  catalogStatus?: SubscriptionOffersView["status"];
  selectedPackage?: SubscriptionChoice["package"]; selectedPersona: SubscriptionChoice["persona"] | null; currentPersona?: SubscriptionChoice["persona"] | null;
  disabled?: boolean; onSelectionInvalidated?: () => void; onSelect: (choice: SubscriptionChoice) => void;
  onInspect?: (intent: SubscriptionIntent) => void;
}) {
  const c = subscriptionCopy[locale], text = catalogStateCopy[locale], ar = locale === "ar";
  const [packages, setPackages] = useState<Record<SubscriptionChoice["persona"], SubscriptionChoice["package"]>>({ level_1: "basic", level_2: "basic", level_3: "basic" });
  return <div className={styles.cards}>
    {subscriptionTiers.map(persona => {
      const pack = selectedPersona === persona.id && selectedPackage ? selectedPackage : packages[persona.id];
      const plan = commercialPlan(persona.id, pack);
      const offer = catalogStatus === "ready" ? matchingCommercialOffer(plan, term, offers) : undefined;
      const state = catalogOfferState(offer, term, catalogStatus), selectedHere = selectedPersona === persona.id && (!selectedPackage || selectedPackage === pack);
      const profile = c.personas[persona.id];
      return <article key={persona.id} aria-label={persona[locale]} data-persona={persona.id} data-seq="plan" className={styles.card} data-selected={selectedHere} data-commercial-revision={commercialCatalogRevision}>
        <div className={styles.portrait}><SubscriptionCharacter name={persona.id === "level_1" ? "noor" : persona.id === "level_2" ? "lina" : "dana"} label={persona[locale]} locale={locale} selected={selectedHere} size="staff" /></div>
        <div className={styles.cardTop}>
          <h3>{persona[locale]}<span lang={ar ? "en" : "ar"}>{persona[ar ? "en" : "ar"]}</span></h3>
          <span className={styles.approvedBadge}>{c[pack]}</span>
          {currentPersona === persona.id ? <span className={styles.currentBadge}>{c.currentBadge}</span> : null}
        </div>
        <p className={styles.role}><strong>{profile.title}</strong></p>
        <p className={styles.fits}>{profile.role}</p>
        <div className={styles.packageOptions} role="group" aria-label={c.packageLevel + " " + persona[locale]}>
          {(["basic", "premium"] as const).map(value => <button key={value} type="button" aria-pressed={pack === value} disabled={disabled} onClick={() => {
            if (value !== pack && selectedPersona === persona.id) onSelectionInvalidated?.();
            setPackages(previous => ({ ...previous, [persona.id]: value }));
          }}>{c[value]}</button>)}
        </div>
        <div className={styles.priceBlock}><p className={styles.price} data-catalog-version={offer?.versionId}><bdi>{formatOmrBaisa(commercialAmount(plan, term), locale)}</bdi></p><p className={styles.cycleLabel}>{text[term]}</p></div>
        {term === "yearly" ? <p className={styles.annualPriceNote}>{ar ? "خصم 20٪ على السنوي — يعادل " : "20% annual discount — equivalent to "}<bdi>{formatOmrBaisa(commercialAmount(plan, term) / 12, locale)}</bdi>{ar ? " شهريًا. تُدفع السنة مقدمًا." : " per month. Paid yearly upfront."}</p> : null}
        <p className={styles.quota}>{ar ? `${plan.replies.toLocaleString("en-US")} رد آلي شهريًا` : `${plan.replies.toLocaleString("en-US")} automated replies per month`}</p>
        <p className={styles.teamAllowance}>{ar ? `المالك + ${plan.employees} موظفين` : `Owner + ${plan.employees} employees`}<br />{ar ? (plan.channels === 1 ? "قناة واحدة: واتساب أو إنستغرام" : "واتساب وإنستغرام معًا") : (plan.channels === 1 ? "One channel: WhatsApp or Instagram" : "WhatsApp and Instagram")}</p>
        <p className={styles.featureHeading}>{c.featuresHeading}</p>
        <ul className={styles.features}>{plan.features.map(feature => {
          const availability = offer?.features.find(item => item.id === feature.id)?.availability;
          return <li key={feature.id} data-feature-id={feature.id}><span>{feature.label[locale]}</span>{availability ? <span className={styles.featureState} data-availability={availability}>{c.featureAvailability[availability]}</span> : null}</li>;
        })}</ul>
        {plan.addons.length ? <details className={styles.addonDetails}><summary>{ar ? "إضافات اختيارية بسعر إضافي" : "Optional paid add-ons"}</summary><ul>{plan.addons.map(addon => <li key={addon.id}>{addon.label[locale]}</li>)}</ul><p>{ar ? "تُحدد الحصص ورسوم التجهيز والتشغيل لكل إضافة قبل الشراء." : "Each add-on's allowances, setup and recurring charges are quoted before purchase."}</p></details> : null}
        <p className={styles.featureScope}>{ar ? "السعر لكل فرع. رسوم واتساب والإعلانات منفصلة، والمزايا تُفعّل حسب جاهزية الخدمة والربط." : "Price per branch. WhatsApp and advertising fees are separate; features activate when their service and integrations are ready."}</p>
        <div className={styles.catalogStates} aria-label={ar ? "حالة الاشتراك" : "Subscription availability"}>
          <p data-purchase-state={state.purchase}>{text[state.purchase]}</p>
          <p data-service-state={persona.id === "level_1" ? "not_verified" : "planned"}>{persona.id === "level_1" ? text.not_verified : text.planned}</p>
          {offer ? <small>{text.published}</small> : catalogStatus === "error" ? <small>{text.errorNote}</small> : null}
        </div>
        <button type="button" className={styles.select} aria-label={(selectedHere ? text.selected : c.select) + " " + persona[locale] + " / " + c[pack]} aria-pressed={selectedHere} disabled={disabled}
          onClick={() => { if (disabled) return; if (offer && state.inspectable) onSelect(choiceFromOffer(offer)); else onInspect?.({ persona: persona.id, package: pack, term }); }}>
          {selectedHere ? text.selected : c.select}
        </button>
        <p className={styles.draftPlanNotice}>{state.purchase === "live" ? text.liveNote : state.purchase === "test_only" ? text.testNote : text.blockedNote}</p>
      </article>;
    })}
  </div>;
}

export function SubscriptionCompareTable({ locale, term, offers, catalogStatus, selectedPersona, homepage = false }: {
  locale: "ar" | "en"; term: SubscriptionTerm; offers: readonly SubscriptionOfferView[];
  catalogStatus?: SubscriptionOffersView["status"]; selectedPersona: SubscriptionChoice["persona"] | null; homepage?: boolean;
}) {
  const c = subscriptionCopy[locale], ar = locale === "ar";
  const [activeTab, setActiveTab] = useState<SubscriptionChoice["persona"] | "all">(selectedPersona ?? "all");
  const compared = commercialPlans.filter(plan => activeTab === "all" || plan.persona === activeTab);
  const features = [...new Map(compared.flatMap(plan => plan.features).map(feature => [feature.id, feature])).values()];
  return <section className={styles.comparison} aria-labelledby="subscription-compare">
    <h2 id="subscription-compare">{c.compare}</h2><p>{c.comparePublishedNote}</p>
    <div className={styles.comparisonScroll}><table className={styles.comparisonTable} aria-label={c.compare + " / " + c[term]}>
      <thead><tr><th scope="col">{c.personaLabel}</th><th scope="col">{c.basic}</th><th scope="col">{c.premium}</th></tr></thead>
      <tbody>{subscriptionTiers.map(persona => <tr key={persona.id} data-selected={selectedPersona === persona.id}><th scope="row">{persona[locale]}</th>{(["basic", "premium"] as const).map(pack => {
        const plan = commercialPlan(persona.id, pack);
        return <td key={pack}><bdi>{formatOmrBaisa(commercialAmount(plan, term), locale)}</bdi><small>{ar ? `${plan.replies.toLocaleString("en-US")} رد شهريًا` : `${plan.replies.toLocaleString("en-US")} replies per month`}</small></td>;
      })}</tr>)}</tbody>
    </table></div>
    <details className={styles.fullComparison}><summary>{c.allFeaturesHeading}{homepage ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg> : null}</summary><p>{c.allFeaturesNote}</p>
      <div className={styles.comparisonTabs} role="group" aria-label={c.comparePersona}>
        {(["all", "level_1", "level_2", "level_3"] as const).map(value => <button key={value} type="button" aria-pressed={activeTab === value} className={styles.comparisonTab} onClick={() => setActiveTab(value)}>{value === "all" ? c.filterAll : subscriptionTiers.find(persona => persona.id === value)![locale]}</button>)}
      </div>
      <div className={styles.comparisonScroll + (homepage ? " feature-comparison-scroll" : "")} data-lenis-prevent={homepage ? "" : undefined} role={homepage ? "region" : undefined} aria-label={homepage ? c.allFeaturesHeading : undefined} tabIndex={homepage ? 0 : undefined}><table className={styles.comparisonTable} aria-label={c.allFeaturesHeading}>
        <thead><tr><th scope="col">{c.featuresHeading}</th>{compared.map(plan => <th key={plan.persona + plan.package} scope="col">{subscriptionTiers.find(persona => persona.id === plan.persona)![locale]} · {c[plan.package]}</th>)}</tr></thead>
        <tbody>{features.map(feature => <tr key={feature.id}><th scope="row">{feature.label[locale]}</th>{compared.map(plan => {
          const included = plan.features.some(item => item.id === feature.id);
          const offer = catalogStatus === "ready" ? matchingCommercialOffer(plan, term, offers) : undefined;
          const available = offer?.features.find(item => item.id === feature.id)?.availability;
          return <td key={plan.persona + plan.package}>{included ? (homepage ? <><span className="feature-inclusion" role="img" aria-label={ar ? "ضمن الباقة" : "Included in plan"}>✓</span><small>{available ? c.featureAvailability[available] : ar ? "قيد التجهيز" : "Being prepared"}</small></> : available ? c.featureAvailability[available] : ar ? "ضمن الباقة — قيد التجهيز" : "Included — being prepared") : "—"}</td>;
        })}</tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}