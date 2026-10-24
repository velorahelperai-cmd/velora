"use client";
import type { SubscriptionDestination } from "@/components/app/subscription-navigation";

import { useGSAP } from "@gsap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Locale,
  getDirection,
  setLocaleCookie,
} from "@/lib/i18n";
import { type PlanId, type SectorId, landingCopy } from "@/lib/landing-copy";
import { playLandingMotion, registerLandingMotion, scrollLandingHash } from "@/lib/landing-motion";
import { useDemo } from "@/lib/demo-state";
import Link from "next/link";
import { AccountMenu } from "@/components/app/account-chrome";
import { AboutContact } from "@/components/landing/about-contact";
import { Catalogue, StoryScenes } from "@/components/landing/story-scenes";
import { DemoScene } from "@/components/landing/demo";
import { Faq } from "@/components/landing/faq";
import { SiteFooter } from "@/components/landing/footer";
import { LandingChatbot } from "@/components/landing/landing-chatbot";
import type { SubscriptionOffersView } from "@/components/app/subscription-offers-view";
import { Packages } from "@/components/landing/packages";
import { IconGlobe } from "@/components/admin/admin-icons";

registerLandingMotion();

/** Landing locale choices; extend here when more languages ship. */
const LANDING_LOCALES = [
  { id: "ar" as const, short: "AR", label: "العربية" },
  { id: "en" as const, short: "EN", label: "English" },
] satisfies ReadonlyArray<{ id: Locale; short: string; label: string }>;

export function LandingPage({
  initialLocale,
  offersView,
  subscriptionDestination,
  authHref = "/signup",
}: {
  initialLocale: Locale;
  offersView?: SubscriptionOffersView;
  subscriptionDestination?: SubscriptionDestination;
  authHref?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [sector, setSector] = useState<SectorId>("services");
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [customQuestion, setCustomQuestion] = useState<string | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const copy = landingCopy(locale);
  const closeCatalogue = useCallback(() => setCatalogueOpen(false), []);
  const demo = useDemo();
  // Real auth path from the server; demo state is not used to open the workspace.
  const startHref = authHref;
  const startLabel =
    authHref === "/verify-email"
      ? copy.verifyFirst
      : authHref === "/setup"
        ? copy.continueSetup
        : authHref.startsWith("/app")
          ? copy.openWorkspace
          : authHref === "/login"
            ? copy.signIn
            : copy.start;

  useEffect(() => {
    document.documentElement.classList.remove("no-js");
    document.documentElement.lang = locale;
    document.documentElement.dir = getDirection(locale);
  }, [locale]);

  // Hash links must scrub the pinned theater — native #how alone leaves the intro visible.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = root;
    let applyingHash = false;

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href^='#']");
      if (!(anchor instanceof HTMLAnchorElement) || !el.contains(anchor)) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const id = href.slice(1);
      if (!id) return;
      event.preventDefault();
      applyingHash = true;
      scrollLandingHash(el, id, { history: "push" });
      applyingHash = false;
      setMenuOpen(false);
    }

    function onHashNav() {
      if (applyingHash) return;
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      scrollLandingHash(el, hash, { history: "none" });
    }

    el.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHashNav);
    window.addEventListener("popstate", onHashNav);
    return () => {
      el.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHashNav);
      window.removeEventListener("popstate", onHashNav);
    };
  }, [locale]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const el = root;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) scrollLandingHash(el, hash, { history: "none" });
    };
    // Theater bind is deferred past first paint; wait for it before hash scrub.
    const timer = window.setTimeout(run, 750);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [locale]);

  const activeQuestion = customQuestion ?? copy.sampleFor(sector).q;

  const restoreScrollRef = useRef<number | null>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const cleanup = playLandingMotion(root);
      const restore = restoreScrollRef.current;
      if (restore !== null) {
        restoreScrollRef.current = null;
        // Pinned chapters are rebuilt for the new locale; return to the same story position.
        requestAnimationFrame(() => window.scrollTo({ top: restore, behavior: "instant" }));
      }
      return cleanup;
    },
    { scope: rootRef, dependencies: [locale], revertOnUpdate: true },
  );

  function applyLocale(next: Locale) {
    setLangMenuOpen(false);
    if (next === locale) return;
    restoreScrollRef.current = window.scrollY;
    setLocaleCookie(next);
    setLocale(next);
    demo.setLocale(next);
    // document lang/dir sync stays in the locale effect above (lint-safe).
  }

  useEffect(() => {
    if (!langMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      const root = langMenuRef.current;
      if (!root || root.contains(event.target as Node)) return;
      setLangMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLangMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [langMenuOpen]);

  function selectPlan(nextPlan: PlanId) {
    setPlan(nextPlan);
    // Plan interest only; it is carried into sign-up and never means a purchase.
    demo.update({ planInterest: nextPlan });
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div ref={rootRef} className="[&_[id]]:scroll-mt-16 lg:[&_[id]]:scroll-mt-[4.25rem]">
      <header
        data-landing-nav="fixed"
        className="fixed inset-x-0 top-0 z-40 bg-[#07110d]/90 px-3 py-2.5 text-[#f7fbf8] backdrop-blur sm:px-4 lg:px-10 lg:py-3"
      >
        <div className="relative flex flex-nowrap items-center justify-between gap-2">
          <a href="#story" className="inline-flex min-h-11 min-w-0 shrink items-center gap-2 text-xl font-bold leading-none sm:text-2xl lg:text-[34px]">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317] lg:h-9 lg:w-9 lg:text-base">V</span>
            <span className="truncate">Velora</span>
          </a>
          <nav className="hidden items-center gap-4 text-sm lg:flex" aria-label="Primary">
            <a className="inline-flex min-h-11 items-center" href="#how">{copy.nav.how}</a>
            <a className="inline-flex min-h-11 items-center" href="#demo">{copy.nav.activities}</a>
            <a className="inline-flex min-h-11 items-center" href="#packages">{copy.nav.packages}</a>
            <a className="inline-flex min-h-11 items-center" href="#faq">{copy.nav.faq}</a>
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 text-sm lg:hidden"
              aria-expanded={menuOpen}
              onClick={() => {
                setLangMenuOpen(false);
                setMenuOpen((open) => !open);
              }}
            >
              {locale === "ar" ? "القائمة" : "Menu"}
            </button>
            <div ref={langMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setLangMenuOpen((open) => !open);
                }}
                aria-label={copy.langAria}
                aria-haspopup="listbox"
                aria-expanded={langMenuOpen}
                title={copy.langAria}
                className="inline-flex h-11 min-h-11 w-[4.75rem] shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/20 px-2.5 text-sm font-medium text-[#f7fbf8]"
              >
                <IconGlobe className="h-4 w-4 shrink-0" />
                <span aria-hidden="true">{copy.lang}</span>
              </button>
              {langMenuOpen ? (
                <ul
                  role="listbox"
                  aria-label={copy.langAria}
                  className="absolute end-0 top-[calc(100%+0.35rem)] z-50 min-w-[9.5rem] overflow-hidden rounded-2xl border border-white/10 bg-[#14221b] py-1 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
                >
                  {LANDING_LOCALES.map((option) => {
                    const selected = option.id === locale;
                    return (
                      <li key={option.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => applyLocale(option.id)}
                          className={`flex w-full min-h-11 items-center justify-between gap-3 px-3 text-start ${
                            selected ? "bg-white/10 text-[#38dc89]" : "text-[#f7fbf8] hover:bg-white/5"
                          }`}
                        >
                          <span>{option.label}</span>
                          <span aria-hidden="true" className="text-xs opacity-70">
                            {option.short}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            <div className="hidden md:block">
              <AccountMenu />
            </div>
            <Link href={startHref} className="inline-flex min-h-11 max-w-[8.5rem] items-center truncate rounded-full bg-[#38dc89] px-2.5 text-[11px] font-medium text-[#072317] sm:max-w-none sm:px-4 sm:text-sm md:hidden">
              {startLabel}
            </Link>
          </div>
          {menuOpen ? (
            <div className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-50 grid rounded-2xl border border-white/10 bg-[#14221b] p-2 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.45)] lg:hidden">
              {(
                [
                  ["how", "#how", copy.nav.how],
                  ["activities", "#demo", copy.nav.activities],
                  ["packages", "#packages", copy.nav.packages],
                  ["faq", "#faq", copy.nav.faq],
                  ["try", "#demo", copy.try],
                  ["contact", "#contact", copy.footer.contact],
                ] as const
              ).map(([key, href, label]) => (
                <a
                  key={key}
                  className="inline-flex min-h-11 items-center rounded-xl px-3 hover:bg-white/5"
                  href={href}
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </a>
              ))}
              <div className="border-t border-white/10 px-1 pt-2">
                <AccountMenu />
              </div>
            </div>
          ) : null}
        </div>
      </header>
      <div aria-hidden="true" data-landing-nav-spacer="" className="h-16 shrink-0 lg:h-[4.25rem]" />

      <main>
        <StoryScenes
          copy={copy}
          onMenu={() => setCatalogueOpen(true)}
          startHref={startHref}
          startLabel={startLabel}
          trial={{
            question: copy.sampleFor(sector).q,
            answer: copy.sampleFor(sector).a,
            note: copy.illustrative,
          }}
          afterPhone={
            <DemoScene
              copy={copy}
              sector={sector}
              onSector={setSector}
            />
          }
        />
        <Packages copy={copy} destination={subscriptionDestination} locale={locale} offersView={offersView} selectedPlan={plan} onSelect={selectPlan} />
        <Faq copy={copy} locale={locale} />
        <AboutContact
          locale={locale}
          copy={copy}
          sector={sector}
          plan={plan}
          question={activeQuestion}
          onSector={setSector}
          onQuestion={(value) => {
            const isSample = value.trim() === "" || value === copy.sampleFor(sector).q;
            setCustomQuestion(isSample ? null : value);
          }}
        />
      </main>
      <SiteFooter copy={copy} locale={locale} />
      <Catalogue copy={copy} open={catalogueOpen} onClose={closeCatalogue} />
      <LandingChatbot key={locale} copy={copy} />
    </div>
  );
}
