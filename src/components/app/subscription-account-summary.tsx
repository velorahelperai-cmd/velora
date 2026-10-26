"use client";
import Image from "next/image";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import type { SubscriptionView } from "./subscription-model";
import { choiceFromOffer, formatOmrBaisa, isPurchasableOffer, type SubscriptionChoice, type SubscriptionOffersView } from "./subscription-offers-view";
import { matchesCommercialOffer } from "./subscription-commercial-catalog";
import styles from "./subscription-account-summary.module.css";

const portraits = {
  level_1: "/media/packages/noura-poster-f20db67a7dfb.png",
  level_2: "/media/packages/lina-poster-c42ca73c2033.png",
  level_3: "/media/packages/dana-poster-677c3569e967.png",
};

export function SubscriptionAccountSummary({ view, catalog, locale, companyName, preview, busy, onSelect, onRetry }: {
  view: SubscriptionView; catalog?: SubscriptionOffersView; locale: "ar" | "en";
  companyName?: string | null; preview?: boolean; busy?: boolean;
  onSelect: (choice: SubscriptionChoice) => void; onRetry?: () => void;
}) {
  const ar = locale === "ar", c = subscriptionCopy[locale];
  const tier = subscriptionTiers.find(item => item.id === view.currentTier);
  const candidates = catalog?.status === "ready" ? catalog.offers.filter(offer =>
    offer.persona === view.currentTier && offer.package === view.currentPackage && offer.term === view.cycle && matchesCommercialOffer(offer)) : [];
  const offer = candidates.find(item => item.versionId === view.planVersionId) ?? (candidates.length === 1 ? candidates[0] : undefined);
  const mayRenew = view.state === "expired" && !!offer && isPurchasableOffer(offer.persona, offer.package, offer.term, offer, catalog?.status);
  const reason = preview ? (ar ? "معاينة فقط؛ الدفع غير متاح هنا." : "Preview only; checkout is unavailable here.")
    : view.state === "active" ? (ar ? "التجديد المبكر غير متاح حاليًا. يمكنك مراجعة الباقات أدناه." : "Early renewal is not currently available. You can review plans below.")
    : view.state === "expired" && !mayRenew ? (ar ? "لم يتوفر عرض تجديد صالح للدفع. راجع الباقات أو تواصل مع الدعم." : "No payable renewal offer is available. Review plans or contact support.")
    : c[`${view.state}Note`];
  const paidDate = view.paidThrough ? new Date(view.paidThrough) : null;
  const plan = tier ? `${tier[locale]}${view.currentPackage ? ` — ${c[view.currentPackage]}` : ""}` : c.noPlan;
  return <section className={styles.layout} aria-label={ar ? "تفاصيل الاشتراك والتجديد" : "Subscription and renewal details"}>
    <div className={styles.current}>
      <div className={styles.identity}>
        <div><h2>{ar ? "باقتك الحالية" : "Your current plan"}</h2><p className={styles.name}>{plan}</p><p>{companyName ?? c.noCompany}</p></div>
        {tier && <Image className={styles.character} src={portraits[tier.id]} alt={tier[locale]} loading="eager" width={220} height={320} />}
      </div>
      <dl className={styles.facts}>
        <div><dt>{ar ? "حالة الاشتراك" : "Subscription status"}</dt><dd>{c.states[view.state]}</dd></div>
        <div><dt>{c.cycle}</dt><dd>{view.cycle ? c[view.cycle] : c.unknown}</dd></div>
        <div><dt>{c.renewal}</dt><dd>{paidDate && Number.isFinite(paidDate.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(paidDate) : c.unknown}</dd></div>
      </dl>
      {view.state === "active" && view.operationalReady === false && <p role="status">{ar ? "تم إثبات الدفع، والخدمة تنتظر جاهزية القناة أو بداية الدورة المحددة." : "Payment is proven; service is waiting for channel readiness or its scheduled cycle start."}</p>}
      {view.state === "error" && onRetry && <button type="button" onClick={onRetry}>{c.retry}</button>}
    </div>
    <div className={styles.renewal}>
      <h2>{ar ? "ملخص التجديد" : "Renewal summary"}</h2>
      <dl className={styles.facts}><div><dt>{c.currentPlan}</dt><dd>{plan}</dd></div><div><dt>{c.cycle}</dt><dd>{view.cycle ? c[view.cycle] : c.unknown}</dd></div></dl>
      <p>{ar ? "قيمة العرض المتاح" : "Available offer amount"}</p>
      <p className={styles.amount}>{offer ? formatOmrBaisa(offer.amountBaisa, locale) : c.unknown}</p>
      <button className={styles.primary} type="button" disabled={!mayRenew || preview || busy} aria-describedby="renewal-status" onClick={() => { if (offer && mayRenew && !preview && !busy) onSelect(choiceFromOffer(offer)); }}>{ar ? "جدّد اشتراكك" : "Renew subscription"}</button>
      <p id="renewal-status" role="status">{mayRenew && !preview ? (ar ? "راجع الاختيار والشروط قبل الانتقال للدفع." : "Review your selection and terms before checkout.") : reason}</p>
      <a href="#subscription-plans">{ar ? "استعراض الباقات" : "Browse plans"}</a>
    </div>
  </section>;
}
