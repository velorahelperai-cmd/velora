"use client";
import { useState } from "react";
import { FEATURE_KEYS } from "@/lib/billing/catalog-backend/contract";
import { SubscriptionCharacter } from "./subscription-character";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionChoice, SubscriptionOfferView, SubscriptionOffersView, SubscriptionTerm } from "./subscription-offers-view";
import { choiceFromOffer, featureLabels, findOffer, formatOmrBaisa, isPurchasableOffer } from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";
import { catalogOfferState, catalogStateCopy } from "./subscription-catalog-state";

function getFeatureState(
  personaId: SubscriptionChoice["persona"],
  packageLevel: SubscriptionChoice["package"],
  featureKey: string,
  offers: readonly SubscriptionOfferView[],
  term: SubscriptionTerm
): "ready" | "planned" | "configuration_required" | "not_verified" | "omit" {
  const offer = offers.find(o => o.persona === personaId && o.package === packageLevel && o.term === term);
  const foundFeature = offer?.features.find(f => f.id === featureKey);
  if (foundFeature) return foundFeature.availability;
  return "omit";
}

function catalogPriceNote(
  locale: "ar" | "en",
  persona: SubscriptionChoice["persona"],
  packageLevel: SubscriptionChoice["package"],
  term: SubscriptionTerm,
  offer: SubscriptionOfferView | undefined,
  status: SubscriptionOffersView["status"] | undefined
) {
  const state = catalogOfferState(offer, term, status);
  const text = catalogStateCopy[locale];
  // Every edition uses a validated published row, never a UI price seed.
  return state.publication === "published" && offer ? formatOmrBaisa(offer.amountBaisa, locale) : text[state.publication];
}

export function SubscriptionOfferCards({ locale, term, offers, catalogStatus, selectedPersona, selectedPackage, currentPersona, disabled = false, onSelectionInvalidated, onSelect }: {
  locale: "ar" | "en"; term: SubscriptionTerm; offers: readonly SubscriptionOfferView[];
  catalogStatus?: SubscriptionOffersView["status"];
  selectedPackage?: SubscriptionChoice["package"]; selectedPersona: SubscriptionChoice["persona"] | null; currentPersona?: SubscriptionChoice["persona"] | null;
  disabled?: boolean; onSelectionInvalidated?: () => void; onSelect: (choice: SubscriptionChoice) => void;
}) {
  const c = subscriptionCopy[locale], text = catalogStateCopy[locale];
  const [packages, setPackages] = useState<Record<SubscriptionChoice["persona"], SubscriptionChoice["package"]>>({
    level_1: "basic", level_2: "basic", level_3: "basic",
  });
  const cardsDisabled = disabled || catalogStatus === "error";

  return <div className={styles.cards}>
    {subscriptionTiers.map((persona) => {
      const packageLevel = selectedPersona === persona.id && selectedPackage ? selectedPackage : packages[persona.id];
      const offer = findOffer(offers, persona.id, packageLevel, term);
      const state = catalogOfferState(offer, term, catalogStatus);
      const counterpart = findOffer(offers, persona.id, packageLevel === "basic" ? "premium" : "basic", term);
      const selectedHere = selectedPersona === persona.id && (!selectedPackage || selectedPackage === packageLevel);
      const price = catalogPriceNote(locale, persona.id, packageLevel, term, offer, catalogStatus);
      const profile = c.personas[persona.id];

      return <article
        key={persona.id}
        aria-label={persona[locale]}
        data-persona={persona.id}
        data-seq="plan"
        className={styles.card}
        data-selected={selectedHere}

      >
        <div className={styles.portrait}>
          <SubscriptionCharacter name={persona.id === "level_1" ? "noor" : persona.id === "level_2" ? "lina" : "dana"} label={persona[locale]} locale={locale} selected={selectedHere} size="staff"/>
        </div>
        <div className={styles.cardTop}>
          <h3>{persona[locale]}<span lang={locale === "ar" ? "en" : "ar"}>{persona[locale === "ar" ? "en" : "ar"]}</span></h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
            <span className={state.publication === "published" ? styles.approvedBadge : styles.draftBadge}>{text[state.publication]}</span>
            {currentPersona === persona.id ? <span className={styles.currentBadge}>{c.currentBadge}</span> : null}
          </div>
        </div>
        <p className={styles.role}><strong>{c.roleLabel}</strong> {profile.role}</p>
        <p className={styles.fits}><strong>{c.fitsLabel}</strong> {profile.fits}</p>
        <div className={styles.packageOptions} role="group" aria-label={c.packageLevel + " " + persona[locale]}>
          {(["basic", "premium"] as const).map((value) => <button key={value} type="button" aria-pressed={packageLevel === value} disabled={cardsDisabled}
            onClick={() => { if (value !== packageLevel && selectedPersona === persona.id) onSelectionInvalidated?.(); setPackages((previous) => ({ ...previous, [persona.id]: value })); }}>{c[value]}</button>)}
        </div>
        <p className={styles.editionNote}>{c.basicPremiumNote}</p>
        <div className={styles.priceBlock}><p className={styles.price} data-unavailable={state.publication !== "published"} data-catalog-version={offer?.versionId}><bdi>{price}</bdi></p>
        <p className={styles.cycleLabel}>{text[term]}</p></div>
        <div className={styles.catalogStates} aria-label={locale === "ar" ? "حالة الباقة" : "Plan availability"}>
          <p data-purchase-state={state.purchase}>{text[state.purchase]}</p>
          <p data-service-state={persona.id === "level_1" ? "not_verified" : "planned"}>{persona.id === "level_1" ? text.not_verified : text.planned}</p>
        </div>
        {offer?.catalogVersion ? <p className={styles.editionNote}>{text.version} {offer.catalogVersion}</p> : null}
        {offer?.automatedOutboundPerMonth != null ? <p className={styles.quota}>{c.quotaLabel.replace("{n}", new Intl.NumberFormat(locale).format(offer.automatedOutboundPerMonth))}
          {offer.quotaEnforcement !== "ready" ? <small>{c.quotaNotVerified}</small> : null}</p> : null}
        {offer?.features.length ? <p className={styles.featureHeading}>{c.featuresHeading}</p> : null}
        {offer?.features.length ? <ul className={styles.features}>
          {offer.features.map((feature) => <li key={feature.id} data-feature-id={feature.id}><span>{feature.label[locale]}</span><span className={styles.featureState} data-availability={feature.availability}>{c.featureAvailability[feature.availability]}</span></li>)}
        </ul> : <p className={styles.featureEmpty}>{catalogStatus === "ready" ? c.featuresUnavailable : catalogPriceNote(locale, persona.id, packageLevel, term, offer, catalogStatus)}</p>}
        {selectedHere && counterpart && offer ? <dl className={styles.contrast}>
          <dt>{c.editionContrast}</dt>
          <dd>{c.basic}: {catalogPriceNote(locale, persona.id, "basic", term, packageLevel === "basic" ? offer : counterpart, catalogStatus)} · {c.premium}: {catalogPriceNote(locale, persona.id, "premium", term, packageLevel === "premium" ? offer : counterpart, catalogStatus)}</dd>
        </dl> : null}
        <p className={styles.featureScope}>{text.scope}</p>

        {state.inspectable && offer ? (
          <button type="button" className={styles.select} aria-label={(selectedHere ? text.selected : text.review) + " " + persona[locale] + " / " + c[packageLevel]} aria-pressed={selectedHere} disabled={cardsDisabled}
            onClick={() => { if (!cardsDisabled) onSelect(choiceFromOffer(offer)); }}>
            {selectedHere ? text.selected : text.review}
          </button>
        ) : <p className={styles.draftPlanNotice} role="status">{state.publication === "error" ? text.errorNote : persona.id !== "level_1" ? text.serviceNote : text.missingNote}</p>}
        {state.inspectable ? <p className={styles.draftPlanNotice}>{state.purchase === "live" ? text.liveNote : state.purchase === "test_only" ? text.testNote : text.blockedNote}</p> : null}
      </article>;
    })}
  </div>;
}

export function SubscriptionCompareTable({ locale, term, offers, catalogStatus, selectedPersona }: {
  locale: "ar" | "en"; term: SubscriptionTerm; offers: readonly SubscriptionOfferView[];
  catalogStatus?: SubscriptionOffersView["status"]; selectedPersona: SubscriptionChoice["persona"] | null;
}) {
  const c = subscriptionCopy[locale];
  const [activeTab, setActiveTab] = useState<SubscriptionChoice["persona"] | "all">(selectedPersona ?? "all");

  return <section className={styles.comparison} aria-labelledby="subscription-compare">
    <h2 id="subscription-compare">{c.compare}</h2>
    <p>{catalogStatus === "ready" ? c.comparePublishedNote : c.compareNote}</p>

    {/* Section 1: Overview Summary Table */}
    <div className={styles.comparisonScroll}>
      <table className={styles.comparisonTable} aria-label={c.compare + " / " + c[term]}>
        <thead>
          <tr>
            <th scope="col">{c.personaLabel}</th>
            <th scope="col">{c.basic}</th>
            <th scope="col">{c.premium}</th>
          </tr>
        </thead>
        <tbody>{subscriptionTiers.map(tier => {
          const basic = findOffer(offers, tier.id, "basic", term);
          const premium = findOffer(offers, tier.id, "premium", term);
          const isBasicPurchasable = isPurchasableOffer(tier.id, "basic", term, basic, catalogStatus);

          return <tr key={tier.id} data-selected={selectedPersona === tier.id}>
            <th scope="row">
              {tier[locale]}
              {isBasicPurchasable ? <span className={styles.approvedBadge} style={{ marginInlineStart: 8, fontSize: 10 }}>{findOffer(offers,tier.id,"basic",term)?.liveCheckoutReady ? catalogStateCopy[locale].live : catalogStateCopy[locale].test_only}</span> : null}
            </th>
            <td>
              <bdi>{catalogPriceNote(locale, tier.id, "basic", term, basic, catalogStatus)}</bdi>
              {basic?.automatedOutboundPerMonth != null ? (
                <small>{c.quotaLabel.replace("{n}", new Intl.NumberFormat(locale).format(basic.automatedOutboundPerMonth))}</small>
              ) : (
                <small>{locale === "ar" ? "حد الرسائل غير متوفر" : "Message limit unavailable"}</small>
              )}
            </td>
            <td>
              <bdi>{catalogPriceNote(locale, tier.id, "premium", term, premium, catalogStatus)}</bdi>
              {premium?.automatedOutboundPerMonth != null ? (
                <small>{c.quotaLabel.replace("{n}", new Intl.NumberFormat(locale).format(premium.automatedOutboundPerMonth))}</small>
              ) : (
                <small>{locale === "ar" ? "حد الرسائل غير متوفر" : "Message limit unavailable"}</small>
              )}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    {/* Section 2: Comprehensive Feature Matrix */}
    <div style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{c.allFeaturesHeading}</h3>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 16px" }}>{c.allFeaturesNote}</p>

      {/* Tabs */}
      <div className={styles.comparisonTabs} role="tablist" aria-label={c.comparePersona}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "all"}
          className={styles.comparisonTab}
          onClick={() => setActiveTab("all")}
        >
          {c.filterAll}
        </button>
        {subscriptionTiers.map(tier => (
          <button
            key={tier.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tier.id}
            className={styles.comparisonTab}
            onClick={() => setActiveTab(tier.id)}
          >
            {tier[locale]}
          </button>
        ))}
      </div>

      {activeTab === "all" ? (
        <div className={styles.comparisonScroll}>
          <table className={styles.comparisonTable} aria-label={c.allFeaturesHeading}>
            <thead>
              <tr>
                <th scope="col">{c.featuresHeading}</th>
                <th scope="col">{subscriptionTiers[0][locale]} · Basic</th>
                <th scope="col">{subscriptionTiers[0][locale]} · Premium</th>
                <th scope="col">{subscriptionTiers[1][locale]} · Basic</th>
                <th scope="col">{subscriptionTiers[1][locale]} · Premium</th>
                <th scope="col">{subscriptionTiers[2][locale]} · Basic</th>
                <th scope="col">{subscriptionTiers[2][locale]} · Premium</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_KEYS.map((key) => {
                const nBasic = getFeatureState("level_1", "basic", key, offers, term);
                const nPrem = getFeatureState("level_1", "premium", key, offers, term);
                const lBasic = getFeatureState("level_2", "basic", key, offers, term);
                const lPrem = getFeatureState("level_2", "premium", key, offers, term);
                const dBasic = getFeatureState("level_3", "basic", key, offers, term);
                const dPrem = getFeatureState("level_3", "premium", key, offers, term);

                return <tr key={key}>
                  <th scope="row">{featureLabels[key]?.[locale] ?? key}</th>
                  <td>{nBasic === "omit" ? "—" : <span className={styles.featureState} data-availability={nBasic}>{c.featureStatusLabels[nBasic] ?? nBasic}</span>}</td>
                  <td>{nPrem === "omit" ? "—" : <span className={styles.featureState} data-availability={nPrem}>{c.featureStatusLabels[nPrem] ?? nPrem}</span>}</td>
                  <td>{lBasic === "omit" ? "—" : <span className={styles.featureState} data-availability={lBasic}>{c.featureStatusLabels[lBasic] ?? lBasic}</span>}</td>
                  <td>{lPrem === "omit" ? "—" : <span className={styles.featureState} data-availability={lPrem}>{c.featureStatusLabels[lPrem] ?? lPrem}</span>}</td>
                  <td>{dBasic === "omit" ? "—" : <span className={styles.featureState} data-availability={dBasic}>{c.featureStatusLabels[dBasic] ?? dBasic}</span>}</td>
                  <td>{dPrem === "omit" ? "—" : <span className={styles.featureState} data-availability={dPrem}>{c.featureStatusLabels[dPrem] ?? dPrem}</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.comparisonScroll}>
          <table className={styles.comparisonTable} aria-label={`${c.featuresHeading} · ${subscriptionTiers.find(t => t.id === activeTab)?.[locale]}`}>
            <thead>
              <tr>
                <th scope="col">{c.featuresHeading}</th>
                <th scope="col">{c.basic}</th>
                <th scope="col">{c.premium}</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_KEYS.map((key) => {
                const basicState = getFeatureState(activeTab, "basic", key, offers, term);
                const premiumState = getFeatureState(activeTab, "premium", key, offers, term);

                return <tr key={key}>
                  <th scope="row">{featureLabels[key]?.[locale] ?? key}</th>
                  <td>{basicState === "omit" ? "—" : <span className={styles.featureState} data-availability={basicState}>{c.featureStatusLabels[basicState] ?? basicState}</span>}</td>
                  <td>{premiumState === "omit" ? "—" : <span className={styles.featureState} data-availability={premiumState}>{c.featureStatusLabels[premiumState] ?? premiumState}</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <p className={styles.featureScope} style={{ marginTop: 20 }}>{c.featureScope}</p>
  </section>;
}
