"use client";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LandingCopy, PlanId } from "@/lib/landing-copy";
import { subscriptionCopy, subscriptionTiers } from "@/components/app/subscription-copy";
import { commercialAmount, commercialPlan, matchingCommercialOffer } from "@/components/app/subscription-commercial-catalog";
import { catalogOfferState } from "@/components/app/subscription-catalog-state";
import { formatOmrBaisa, type SubscriptionOffersView, type SubscriptionPersona, type SubscriptionPackage, type SubscriptionTerm } from "@/components/app/subscription-offers-view";
import type { SubscriptionDestination, SubscriptionIntent } from "@/components/app/subscription-navigation";
import { SubscriptionBrandGuide } from "@/components/app/subscription-brand-guide";
import catalogStyles from "@/components/app/subscription-panel.module.css";
import { SubscriptionCompareTable } from "@/components/app/subscription-offer-cards";
import { packageMedia } from "./approved-assets";
import { PackagePlayback } from "./package-playback";
import styles from "./approved-sections.module.css";

const ids = ["noura", "lina", "dana"] as const;
const planByPersona: Record<SubscriptionPersona, PlanId> = { level_1: "support", level_2: "expanded", level_3: "integrated" };
const descriptions = {
  ar: [
    "لمن يريد تنظيم استفسارات العملاء، وتوضيح الخدمات والسياسات، مع تحويل المحادثة إلى الموظف المناسب عند الحاجة.",
    "لأصحاب المشاريع الذين يرغبون في تحقيق التوازن بين الكفاءة والمرونة والنمو المستدام.",
    "للقادة الطموحين الذين يبحثون عن أعلى مستويات الأداء ودعم شامل لإدارة وتنمية أعمالهم باحترافية.",
  ],
  en: [
    "For businesses organizing customer inquiries and explaining services and policies, with conversations handed to the right employee when needed.",
    "For business owners who want to balance efficiency, flexibility and sustainable growth.",
    "For ambitious leaders seeking the highest levels of performance and comprehensive support to manage and grow their businesses professionally.",
  ],
};
const iconPaths = {
  message: ["M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.4", "M8 11.5h.01M12 11.5h.01M16 11.5h.01"],
  chart: ["M3 20h18M6 20V12M10 20V8M14 20V4M18 20V10"],
  people: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 21v-2a4 4 0 0 0-3-3.87"],
  link: ["M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
};
function FeatureIcon({ id }: { id: string }) {
  const key = /report|summar/.test(id) ? "chart" : /routing|staff|lead/.test(id) ? "people" : /workflow|instagram|recovery/.test(id) ? "link" : "message";
  return <svg className="feature-icon" viewBox="0 0 24 24" aria-hidden="true">{iconPaths[key].map(d => <path key={d} d={d} />)}</svg>;
}
export function Packages({ copy, locale, destination, offersView, selectedPlan, onSelect }: {
  copy: LandingCopy; locale: "ar" | "en"; destination?: SubscriptionDestination; offersView?: SubscriptionOffersView;
  selectedPlan: PlanId | null; onSelect: (plan: PlanId) => void;
}) {
  void copy; void selectedPlan; void destination;
  const homepageActive = usePathname() === "/";
  const ar = locale === "ar", c = subscriptionCopy[locale];
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [term, setTerm] = useState<SubscriptionTerm>("monthly");
  const [tiers, setTiers] = useState<Record<SubscriptionPersona, SubscriptionPackage>>({ level_1: "basic", level_2: "basic", level_3: "basic" });
  const [intent, setIntent] = useState<SubscriptionIntent>({ term: "monthly" });
  const [player] = useState(() => new PackagePlayback());
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getServerSnapshot);
  const videos = useRef<Array<HTMLVideoElement | null>>([]);
  const cards = useRef<Array<HTMLElement | null>>([]);
  useLayoutEffect(() => {
    const nodes = videos.current.filter((v): v is HTMLVideoElement => !!v);
    const articles = cards.current.filter((v): v is HTMLElement => !!v);
    player.connect(nodes, ids.map(id => packageMedia[id][locale]));
    const visible = new Set<number>(), reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let suspended = false;
    const sync = () => player.environment(visible, document.hidden || suspended || !homepageActive || window.location.pathname !== "/", reduce.matches);
    const hide = () => { suspended = true; sync(); };
    const show = () => { suspended = false; sync(); };
    const route = () => { if (window.location.pathname === "/") show(); else hide(); };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => { const url = (event as Event & { destination?: { url: string } }).destination?.url; if (url && new URL(url, window.location.href).pathname !== "/") hide(); };
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { const index = articles.indexOf(entry.target as HTMLElement); if (entry.isIntersecting) visible.add(index); else visible.delete(index); }); sync();
    }, { threshold: 0.35 });
    articles.forEach(article => observer.observe(article));
    document.addEventListener("visibilitychange", sync); reduce.addEventListener("change", sync);
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("popstate", route); navigation?.addEventListener("navigate", navigate);
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== "homepage-packages") player.externalPause(); };
    window.addEventListener("velora-character-play", other); sync();
    return () => { window.removeEventListener("popstate", route); navigation?.removeEventListener("navigate", navigate); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); observer.disconnect(); document.removeEventListener("visibilitychange", sync); reduce.removeEventListener("change", sync); window.removeEventListener("velora-character-play", other); player.disconnect(); };
  }, [locale, player, homepageActive]);
  const offers = offersView?.status === "ready" ? offersView.offers : [];
  return <><div className={styles.originalFilm} lang={locale} dir={ar ? "rtl" : "ltr"}><div className={catalogStyles.root} data-surface="public"><SubscriptionBrandGuide homepage active={homepageActive} locale={locale} selectedPersona={intent.persona} onFocusPersona={persona => { setIntent({ term, persona, package: tiers[persona] }); onSelect(planByPersona[persona]); }} /></div></div><section id="packages" data-scene="8" className={styles.pricing + " scene"} lang={locale} dir={ar ? "rtl" : "ltr"}>
    <div className="background" aria-hidden="true" />
    <div className="hero" id="subscription-plans">
      <h2 data-seq="packages-title">{c.packagesTitle}</h2><p data-seq="packages-lead">{c.oneProduct}</p>
      <div className="global-controls">
        <div className="segment" role="group" aria-label={c.cycle}>{(["monthly", "yearly"] as const).map(value => <button key={value} type="button" aria-pressed={term === value} onClick={() => { setTerm(value); setIntent(previous => ({ term: value, ...(previous.persona && previous.package ? { persona: previous.persona, package: previous.package } : {}) })); }}>{c[value]}{value === "yearly" ? " −20%" : ""}</button>)}</div>
      </div>
      {playback.error ? <p className="media-status" role="status">{ar ? "تعذّر تشغيل الفيديو. اضغط على الشخصية للمحاولة مجددًا." : "The video could not play. Select the character to try again."}</p> : null}
    </div>
    <p className="character-help" id="packages-media-help">{ar ? "اضغط على الشخصية لتشغيل المعاينة أو إيقافها. عند التركيز عليها، اضغط M لكتم الصوت أو تشغيله." : "Select a character to play or pause her preview. When focused, press M to mute or enable sound."}</p>
    <div className="stage">
      {subscriptionTiers.map((persona, index) => {
        const id = ids[index], media = packageMedia[id], pack = tiers[persona.id], plan = commercialPlan(persona.id, pack);
        const offer = matchingCommercialOffer(plan, term, offers), state = catalogOfferState(offer, term, offersView?.status);
        const mismatch = (offers.some(item => item.persona === persona.id && item.package === pack && item.term === term) && !offer);
        return <article key={persona.id} ref={node => { cards.current[index] = node; }} className={"persona" + (playback.current === index && playback.playing ? " is-playing" : "")} data-id={id} data-persona={persona.id} aria-label={persona[locale]}>
          <div className="halo" aria-hidden="true" /><div className="contact-shadow" aria-hidden="true" />
          <button type="button" className="character" aria-label={(ar ? "تشغيل معاينة " : "Play preview for ") + persona[locale]} aria-pressed={playback.current === index && playback.playing} aria-describedby="packages-media-help" aria-keyshortcuts="M" onClick={() => { if (playback.current === index) player.toggle(); else player.select(index); }} onKeyDown={event => { if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) { event.preventDefault(); player.mute(); } }}>
            <video key={locale + id} ref={node => { videos.current[index] = node; }} className="character-media" width="640" height="960" poster={locale === "en" ? media.enPoster : media.poster} preload="none" muted={playback.muted} playsInline aria-hidden="true"
            onPlay={event => { player.played(index, event.currentTarget); window.dispatchEvent(new CustomEvent("velora-character-play", { detail: "homepage-packages" })); }}
            onPause={event => player.paused(index, event.currentTarget)} onEnded={event => player.ended(index, event.currentTarget)} onError={event => player.failed(index, event.currentTarget)} />
          </button>
          <div className="persona-title"><h3>{ar ? ["نورا", "لينا", "دانا"][index] : persona.en}</h3><span className="roman" lang={ar ? "en" : "ar"}>{ar ? persona.en : ["نورا", "لينا", "دانا"][index]}</span>
            <p className="role">{index === 1 ? ar ? "أسلوب مرن للتنمية" : "A flexible approach to growth" : (ar ? ["إجابات واضحة واهتمام بعملائك", "أسلوب مرن للتنمية", "عمليات منظمة ومتابعة واضحة"] : ["Clear answers. Thoughtful customer care.", "A flexible approach to growth", "Organized operations. Clear follow-through."])[index]}</p>
            <div className="preview-sequence"><div className="preview-track" aria-hidden="true">{ids.map((key, dot) => <span key={key} style={{ display: "contents" }}>{dot ? <span className="preview-line" /> : null}<span className={"preview-dot" + (dot === playback.current ? " active" : "")} /></span>)}</div><span className="preview-caption">{ar ? "معاينة ثقافية" : "Cultural preview"}</span></div>
          </div>
          <div className="panel">
            <div className="plan-segment" role="group" aria-label={c.packageLevel + " " + persona[locale]}>{(["basic", "premium"] as const).map(value => <button key={value} type="button" data-tier={value} aria-pressed={pack === value} onClick={() => { setTiers(previous => ({ ...previous, [persona.id]: value })); if (intent.persona === persona.id) setIntent({ term, persona: persona.id, package: value }); }}>{c[value]}{value === "premium" ? <svg className="premium-crown" viewBox="0 0 20 20" aria-hidden="true"><defs><linearGradient id={"premium-gold-" + id} x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stopColor="#fff1a2" /><stop offset=".45" stopColor="#e6b742" /><stop offset="1" stopColor="#ad7724" /></linearGradient></defs><path fill={"url(#premium-gold-" + id + ")"} d="m2 5 4 3 4-5 4 5 4-3-2 10H4Z" /><path d="M5 18h10M5 13h10" /></svg> : null}</button>)}</div>
            <div className="price"><bdi className="amount">{formatOmrBaisa(commercialAmount(plan, term), locale)}</bdi><span className="period">{c[term]}</span></div>
            <p className="billing">{term === "yearly" ? ar ? "خصم 20٪ · إجمالي سنوي يُدفع مقدمًا" : "20% discount · Annual total paid upfront" : ar ? "الفوترة الشهرية" : "Billed monthly"}</p>
            {term === "yearly" && <p className="billing">{ar ? "ما يعادل " : "Equivalent to "}<bdi>{formatOmrBaisa(commercialAmount(plan, term) / 12, locale)}</bdi>{ar ? " شهريًا" : " per month"}</p>}
            <p className="quota">{plan.replies.toLocaleString("en-US")} {ar ? "رد شهريًا" : "replies / month"} · {ar ? "المالك + " + plan.employees + " موظفين · " + (plan.channels === 1 ? "قناة واحدة" : "قناتان") : "Owner + " + plan.employees + " employees · " + plan.channels + " channel" + (plan.channels > 1 ? "s" : "")}</p>
            <p className="panel-description">{descriptions[locale][index]}</p>
            <details><summary>{c.featuresHeading} ({plan.features.length})</summary><ul className="features feature-viewport" tabIndex={0} data-lenis-prevent="" aria-label={c.featuresHeading + " " + persona[locale]}>{plan.features.map(feature => {
              const availability = offer?.features.find(item => item.id === feature.id)?.availability;
              return <li key={feature.id} data-feature-id={feature.id}><FeatureIcon id={feature.id} /><span>{feature.label[locale]}{availability ? <small> · {c.featureAvailability[availability]}</small> : null}</span></li>;
            })}</ul></details>
            {plan.addons.length ? <details className="catalog-detail"><summary>{ar ? "إضافات اختيارية بسعر إضافي" : "Optional paid add-ons"}</summary><ul>{plan.addons.map(addon => <li key={addon.id}>{addon.label[locale]}</li>)}</ul><p>{ar ? "تُحدد الحصص ورسوم التجهيز والتشغيل قبل الشراء." : "Allowances, setup and recurring charges are quoted before purchase."}</p></details> : null}
            <div className="plan-footer"><button type="button" className="cta" disabled={mismatch} aria-pressed={intent.persona === persona.id && intent.package === pack} onClick={() => { setIntent({ term, persona: persona.id, package: pack }); onSelect(planByPersona[persona.id]); }}>{c.select}</button>
            <p className="purchase-note" data-purchase-state={state.purchase}>{mismatch ? ar ? "سعر العرض المنشور لا يطابق السعر المعروض. الدفع غير متاح لهذه الباقة." : "The published offer does not match this price. Checkout is unavailable for this plan." : state.purchase === "live" ? ar ? "تخضع أهلية الدفع وتفعيل الخدمة للتحقق." : "Payment and service eligibility require verification." : state.purchase === "test_only" ? ar ? "الدفع التجريبي فقط؛ الدفع الحقيقي غير متاح." : "Test checkout only; live payment is unavailable." : ar ? "استعرض الباقة؛ الدفع غير متاح حتى تجهيز عرض مطابق." : "Explore this plan; checkout requires a matching qualified offer."}</p>
            <p className="note" data-service-state={state.service}>{state.service === "planned" ? ar ? "خدمة مخططة." : "Planned service." : ar ? "جاهزية الخدمة غير متحقق منها." : "Service readiness is not verified."} {ar ? "السعر لكل فرع. رسوم واتساب والإعلانات منفصلة." : "Price per branch. WhatsApp and advertising fees are separate."}</p>
            </div>
          </div><span className="speaking">{ar ? "تعرّف عليّ" : "Meet me"}</span>
        </article>;
      })}
    </div>
    <div id="packages-chat-slot" />
    <div className="catalog-comparison">
      <button id="packages-compare-toggle" type="button" className="compare-toggle" aria-expanded={comparisonOpen} aria-controls="packages-comparison" onClick={() => setComparisonOpen(open => !open)}><span>{ar ? "قارن الباقات" : "Compare packages"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg></button>
      <div id="packages-comparison" className="comparison-expansion" role="region" aria-labelledby="packages-compare-toggle" aria-hidden={!comparisonOpen} inert={!comparisonOpen} data-open={comparisonOpen}><div className="comparison-reveal"><div className={catalogStyles.root + " comparison-content"} data-surface="public"><SubscriptionCompareTable homepage locale={locale} term={term} offers={offers} catalogStatus={offersView?.status} selectedPersona={intent.persona ?? null} /></div></div></div>
    </div>
  </section></>;
}
