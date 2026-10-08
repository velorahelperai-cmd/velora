"use client";
import { useState } from "react";
import { FEATURE_KEYS } from "@/lib/billing/catalog-backend/contract";
import { SubscriptionCharacter } from "./subscription-character";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionChoice, SubscriptionOfferView, SubscriptionOffersView, SubscriptionTerm } from "./subscription-offers-view";
import { choiceFromOffer, featureLabels, findOffer } from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";

function catalogPriceNote(locale: "ar" | "en", term: SubscriptionTerm, offer: SubscriptionOfferView | undefined, status: SubscriptionOffersView["status"] | undefined) {
  const c = subscriptionCopy[locale];
  if (status === "error") return c.catalogError;
  if (status === "empty") return c.catalogEmpty;
  if (status !== "ready") return c.catalogReasons.schema_unavailable;
  if (offer) return new Intl.NumberFormat(locale, { style: "currency", currency: offer.currency }).format(offer.amountBaisa / 1000);
  return term === "yearly" ? c.yearlyUnavailable : c.price;
}

export function SubscriptionOfferCards({ locale, term, offers, catalogStatus, selectedPersona, selectedPackage, currentPersona, disabled = false, onSelectionInvalidated, onSelect }: {
  locale: "ar" | "en"; term: SubscriptionTerm; offers: readonly SubscriptionOfferView[];
  catalogStatus?: SubscriptionOffersView["status"];
  selectedPackage?: SubscriptionChoice["package"]; selectedPersona: SubscriptionChoice["persona"] | null; currentPersona?: SubscriptionChoice["persona"] | null;
  disabled?: boolean; onSelectionInvalidated?: () => void; onSelect: (choice: SubscriptionChoice) => void;
}) {
  const c = subscriptionCopy[locale];
  const [packages, setPackages] = useState<Record<SubscriptionChoice["persona"], SubscriptionChoice["package"]>>({
    level_1: "basic", level_2: "basic", level_3: "basic",
  });
  const cardsDisabled = disabled || catalogStatus === "error";
  return <div className={styles.cards}>
    {subscriptionTiers.map((persona) => {
      const packageLevel = packages[persona.id];
      const offer = findOffer(offers, persona.id, packageLevel, term);
      const counterpart = findOffer(offers, persona.id, packageLevel === "basic" ? "premium" : "basic", term);
      const selectedHere = selectedPersona === persona.id && (!selectedPackage || selectedPackage === packageLevel);
      const price = catalogPriceNote(locale, term, offer, catalogStatus);
      const profile = c.personas[persona.id];
      return <article
        key={persona.id}
        aria-label={persona[locale]}
        data-persona={persona.id}
        data-seq="plan"
        className={styles.card}
        data-selected={selectedHere}
        onMouseMove={(e) => {
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          const dx = (x - 0.5) * 2;
          const dy = (y - 0.5) * 2;
          el.style.setProperty("--card-tilt-x", `${-dy * 4}deg`);
          el.style.setProperty("--card-tilt-y", `${dx * 4}deg`);
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.setProperty("--card-tilt-x", "0deg");
          el.style.setProperty("--card-tilt-y", "0deg");
        }}
      >
        <div className={styles.portrait}>
          <SubscriptionCharacter name={persona.id === "level_1" ? "noor" : persona.id === "level_2" ? "lina" : "dana"} label={persona[locale]} locale={locale} selected={selectedHere} size="staff"/>
        </div>
        <div className={styles.cardTop}>
          <h3>{persona[locale]}<span lang={locale === "ar" ? "en" : "ar"}>{persona[locale === "ar" ? "en" : "ar"]}</span></h3>
          {currentPersona === persona.id ? <span className={styles.currentBadge}>{c.currentBadge}</span> : null}
        </div>
        <p className={styles.role}><strong>{c.roleLabel}</strong> {profile.role}</p>
        <p className={styles.fits}><strong>{c.fitsLabel}</strong> {profile.fits}</p>
        <div className={styles.packageOptions} role="group" aria-label={c.packageLevel + " " + persona[locale]}>
          {(["basic", "premium"] as const).map((value) => <button key={value} type="button" aria-pressed={packageLevel === value} disabled={cardsDisabled}
            onClick={() => { if (value !== packageLevel && selectedPersona === persona.id) onSelectionInvalidated?.(); setPackages((previous) => ({ ...previous, [persona.id]: value })); }}>{c[value]}</button>)}
        </div>
        {c.tierHighlights?.[persona.id]?.[packageLevel] ? (
          <div className={styles.tierHighlightBox}>
            <div className={styles.tierQuotaPill}>
              <span>⚡</span> <strong>{c.tierHighlights[persona.id][packageLevel].quota}</strong> {locale === "ar" ? "رسالة آلية شهريًا" : "auto messages / mo"}
            </div>
            <p className={styles.tierSummary}>{c.tierHighlights[persona.id][packageLevel].summary}</p>
          </div>
        ) : null}
        <p className={styles.editionNote}>{c.basicPremiumNote}</p>
        <div className={styles.priceBlock}><p className={styles.price} data-unavailable={!offer} data-catalog-version={offer?.versionId}><bdi>{price}</bdi></p>
        <p className={styles.cycleLabel}>{c[term]}</p></div>
        {persona.id === "level_2" && c.setupFeeNote ? (
          <p className={styles.setupNote}>ℹ️ {c.setupFeeNote.website}</p>
        ) : persona.id === "level_3" && c.setupFeeNote ? (
          <p className={styles.setupNote}>ℹ️ {c.setupFeeNote.cashier}</p>
        ) : null}
        {offer?.automatedOutboundPerMonth != null ? <p className={styles.quota}>{c.quotaLabel.replace("{n}", new Intl.NumberFormat(locale).format(offer.automatedOutboundPerMonth))}
          {offer.quotaEnforcement !== "ready" ? <small>{c.quotaNotVerified}</small> : null}</p> : null}
        {offer?.features.length ? <p className={styles.featureHeading}>{c.featuresHeading}</p> : null}
        {offer?.features.length ? <ul className={styles.features}>
          {offer.features.map((feature) => <li key={feature.id}><span>{feature.label[locale]}</span><span className={styles.featureState} data-availability={feature.availability}>{c.featureAvailability[feature.availability]}</span></li>)}
        </ul> : <p className={styles.featureEmpty}>{catalogStatus === "ready" ? c.featuresUnavailable : catalogPriceNote(locale, term, offer, catalogStatus)}</p>}
        {selectedHere && counterpart && offer ? <dl className={styles.contrast}>
          <dt>{c.editionContrast}</dt>
          <dd>{c.basic}: {catalogPriceNote(locale, term, packageLevel === "basic" ? offer : counterpart, catalogStatus)} · {c.premium}: {catalogPriceNote(locale, term, packageLevel === "premium" ? offer : counterpart, catalogStatus)}</dd>
        </dl> : null}
        <p className={styles.featureScope}>{c.featureScope}</p>
        <button type="button" className={styles.select} aria-label={(selectedHere ? c.selected : c.select) + " " + persona[locale] + " / " + c[packageLevel]} aria-pressed={selectedHere} disabled={cardsDisabled || !offer}
          onClick={() => { if (offer && !cardsDisabled) onSelect(choiceFromOffer(offer)); }}>
          {selectedHere ? c.selected : c.select}
        </button>
      </article>;
    })}
  </div>;
}

export function SubscriptionCompareTable({ locale, term, offers, catalogStatus, selectedPersona }: {
  locale: "ar" | "en"; term: SubscriptionTerm; offers: readonly SubscriptionOfferView[];
  catalogStatus?: SubscriptionOffersView["status"]; selectedPersona: SubscriptionChoice["persona"] | null;
}) {
  const c = subscriptionCopy[locale];
  const selectedTier = subscriptionTiers.find(tier => tier.id === selectedPersona);
  const selectedBasic = selectedPersona ? findOffer(offers, selectedPersona, "basic", term) : undefined;
  const selectedPremium = selectedPersona ? findOffer(offers, selectedPersona, "premium", term) : undefined;
  return <section className={styles.comparison} aria-labelledby="subscription-compare">
    <h2 id="subscription-compare">{c.compare}</h2>
    <p>{catalogStatus === "ready" ? c.comparePublishedNote : c.compareNote}</p>
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
          return <tr key={tier.id} data-selected={selectedPersona === tier.id}>
            <th scope="row">{tier[locale]}</th>
            <td><bdi>{catalogPriceNote(locale, term, basic, catalogStatus)}</bdi>{basic?.automatedOutboundPerMonth != null ? <small>{c.quotaLabel.replace("{n}", new Intl.NumberFormat(locale).format(basic.automatedOutboundPerMonth))}</small> : <small>{c[term]}</small>}</td>
            <td><bdi>{catalogPriceNote(locale, term, premium, catalogStatus)}</bdi>{premium?.automatedOutboundPerMonth != null ? <small>{c.quotaLabel.replace("{n}", new Intl.NumberFormat(locale).format(premium.automatedOutboundPerMonth))}</small> : <small>{c[term]}</small>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {selectedTier && (selectedBasic || selectedPremium) ? (
      <div className={styles.comparisonScroll}>
        <table className={styles.comparisonTable} aria-label={c.featuresHeading + " / " + selectedTier[locale]}>
          <thead><tr><th scope="col">{c.featuresHeading}</th><th scope="col">{c.basic}</th><th scope="col">{c.premium}</th></tr></thead>
          <tbody>
            {FEATURE_KEYS.map((key) => {
              const basicF = selectedBasic?.features.find(item => item.id === key);
              const premiumF = selectedPremium?.features.find(item => item.id === key);
              if (!basicF && !premiumF) return null;
              return <tr key={key}>
                <th scope="row">{featureLabels[key]?.[locale] ?? key}</th>
                <td>{basicF ? <span className={styles.featureState} data-availability={basicF.availability}>{c.featureAvailability[basicF.availability]}</span> : c.unavailable}</td>
                <td>{premiumF ? <span className={styles.featureState} data-availability={premiumF.availability}>{c.featureAvailability[premiumF.availability]}</span> : c.unavailable}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    ) : null}
    <p className={styles.featureScope}>{c.featureScope}</p>
  </section>;
}
