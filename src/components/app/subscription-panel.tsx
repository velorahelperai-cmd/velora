"use client";

import { useState } from "react";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionCycle, SubscriptionView } from "./subscription-model";
import { SubscriptionBrandGuide } from "./subscription-brand-guide";
import { SubscriptionCompareTable, SubscriptionOfferCards } from "./subscription-offer-cards";
import type { SubscriptionOffersView, SubscriptionChoice } from "./subscription-offers-view";
import { catalogHasTerm, currentSubscriptionChoice } from "./subscription-offers-view";
import styles from "./subscription-panel.module.css";

export function SubscriptionPanel({ locale, view, offersView, preview = false, onRetry }: {
  locale: "ar" | "en"; view: SubscriptionView; offersView?: SubscriptionOffersView; preview?: boolean; onRetry?: () => void;
}) {
  const c = subscriptionCopy[locale];
  const yearlyPublished = catalogHasTerm(offersView, "yearly");
  const [cycle, setCycle] = useState<SubscriptionCycle>(view.cycle === "yearly" && yearlyPublished ? "yearly" : "monthly");
  const [choice, setChoice] = useState<SubscriptionChoice | null>(null);
  const activeCycle = cycle === "yearly" && !yearlyPublished ? "monthly" : cycle;
  const validChoice = currentSubscriptionChoice(choice, activeCycle, offersView);
  const selected = validChoice?.persona ?? null;
  const current = subscriptionTiers.find((tier) => tier.id === view.currentTier);
  const selectedOffer=validChoice ? offersView?.offers.find(offer=>offer.versionId===validChoice.versionId&&offer.term===validChoice.term) : null;
  const chosen = subscriptionTiers.find((tier) => tier.id === selected);
  const changingTier = selected !== null && view.currentTier !== null && selected !== view.currentTier;
  const upgrading = changingTier && Number(selected?.slice(-1)) > Number(view.currentTier?.slice(-1));
  const action = view.state === "expired" && !changingTier ? c.renew
    : upgrading ? c.upgrade : view.state === "active" || changingTier ? c.manage : c.subscribe;
  const catalogNote = offersView?.status === "ready" ? c.catalogReady : offersView?.status === "empty" ? c.catalogEmpty : offersView?.status === "error" ? c.catalogError : c.catalogReasons.schema_unavailable;
  const note = c[`${view.state}Note`];
  const blocked = view.state === "suspended" ? c.suspendedBlocked
    : view.state === "pending" ? c.pendingBlocked : changingTier ? c.upgradeBlocked : c.blocked;

  return (
    <div className={styles.root} data-surface="account" data-design-only={preview ? "true" : undefined} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className={styles.heading}>
        <div><h1>{c.title}</h1><p>{c.intro}</p></div>
        <span className={styles.concept}>{c.concept}</span>
      </header>
      <SubscriptionBrandGuide locale={locale} selectedPersona={selected} />
      <section className={styles.summary} aria-labelledby="subscription-current">
        <div className={styles.summaryTitle}>
          <h2 id="subscription-current">{c.current}</h2>
          <span className={styles.status} data-state={view.state}>{c.states[view.state]}</span>
        </div>
        <p role={view.state === "error" ? "alert" : "status"}>{note}</p>
        {view.state === "loading" ? <div className={styles.skeleton} aria-busy="true" /> : (
          <dl className={styles.facts}>
            <div><dt>{c.currentPlan}</dt><dd>{current ? current[locale] : c.noPlan}</dd></div>
            <div><dt>{c.cycle}</dt><dd>{view.cycle ? c[view.cycle] : c.unknown}</dd></div>
            <div><dt>{c.renewal}</dt><dd>{view.paidThrough ? <bdi>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(view.paidThrough))}</bdi> : c.unknown}</dd></div>
          </dl>
        )}
        {view.state === "error" && onRetry ? <button className={styles.secondary} type="button" onClick={onRetry}>{c.retry}</button> : null}
      </section>

      <section aria-labelledby="subscription-plans">
        <div className={styles.planHeading}>
          <div><h2 id="subscription-plans">{c.choose}</h2><p>{c.chooseNote}</p></div>
          <div className={styles.cycles} role="group" aria-label={c.cycle}>
            <button type="button" aria-pressed={activeCycle === "monthly"} onClick={() => { setCycle("monthly"); setChoice(null); }}>{c.monthly}</button>
            {yearlyPublished ? <button type="button" aria-pressed={activeCycle === "yearly"} onClick={() => { setCycle("yearly"); setChoice(null); }}>{c.yearly}</button> : null}
          </div>
        </div>
        <SubscriptionOfferCards locale={locale} term={activeCycle} offers={offersView?.status === "ready" ? offersView.offers : []} catalogStatus={offersView?.status} selectedPersona={selected} selectedPackage={validChoice?.package} currentPersona={view.currentTier}
          disabled={view.state === "loading" || view.state === "error" || view.state === "suspended"}
          onSelectionInvalidated={() => setChoice(null)} onSelect={setChoice} />
        <p className={styles.catalogNote} role={offersView?.status === "error" ? "alert" : "status"}>{catalogNote}</p>
      </section>

      <SubscriptionCompareTable locale={locale} term={activeCycle} offers={offersView?.status === "ready" ? offersView.offers : []} catalogStatus={offersView?.status} selectedPersona={selected} />

      <section className={styles.next} aria-labelledby="subscription-next">
        <div><h2 id="subscription-next">{c.next}</h2>
          <p className={styles.selectionTitle}>{chosen && validChoice ? <>{chosen[locale]} · {c[validChoice.package]} / {c[activeCycle]}</> : c.selectionEmpty}</p>
          {selectedOffer?<dl className={styles.facts}><div><dt>{c.orderAmount}</dt><dd><bdi>{new Intl.NumberFormat(locale,{style:"currency",currency:selectedOffer.currency}).format(selectedOffer.amountBaisa/1000)}</bdi></dd></div><div><dt>{c.cycle}</dt><dd>{c[activeCycle]}</dd></div></dl>:null}
          {selectedOffer?.features.length ? <ul className={styles.features}>{selectedOffer.features.map(feature => <li key={feature.id}><span>{feature.label[locale]}</span><span className={styles.featureState} data-availability={feature.availability}>{c.featureAvailability[feature.availability]}</span></li>)}</ul> : null}
          <p id="subscription-payment-block">{blocked}</p>
          {changingTier ? <p>{c.blocked}</p> : null}
        </div>
        <button type="button" className={styles.pay} disabled aria-describedby="subscription-payment-block">{action}</button>
      </section>

    </div>
  );
}
