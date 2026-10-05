"use client";

import { useGSAP } from "@gsap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Locale,
  getDirection,
  setLocaleCookie,
} from "@/lib/i18n";
import { type PlanId, type SectorId, landingCopy } from "@/lib/landing-copy";
import { playLandingMotion, registerLandingMotion, replaySample } from "@/lib/landing-motion";
import { useDemo } from "@/lib/demo-state";
import Link from "next/link";
import { AccountMenu } from "@/components/app/account-chrome";
import { AboutContact } from "@/components/landing/about-contact";
import { Catalogue, StoryScenes } from "@/components/landing/story-scenes";
import { DemoScene } from "@/components/landing/demo";
import { Faq } from "@/components/landing/faq";
import { SiteFooter } from "@/components/landing/footer";
import { LandingChatbot } from "@/components/landing/landing-chatbot";
import { Packages } from "@/components/landing/packages";

registerLandingMotion();

export function LandingPage({
  initialLocale,
  authHref = "/signup",
}: {
  initialLocale: Locale;
  authHref?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [sector, setSector] = useState<SectorId>("restaurant");
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [customQuestion, setCustomQuestion] = useState<string | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  function switchLocale() {
    const next: Locale = locale === "ar" ? "en" : "ar";
    restoreScrollRef.current = window.scrollY;
    setLocaleCookie(next);
    setLocale(next);
    demo.setLocale(next);
    document.documentElement.lang = next;
    document.documentElement.dir = getDirection(next);
    document.documentElement.classList.remove("no-js");
  }

  function selectPlan(nextPlan: PlanId) {
    setPlan(nextPlan);
    // Plan interest only; it is carried into sign-up and never means a purchase.
    demo.update({ planInterest: nextPlan });
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div ref={rootRef}>
      <header className="sticky top-0 z-40 bg-[#07110d]/90 px-3 py-2.5 text-[#f7fbf8] backdrop-blur sm:px-4 lg:px-10 lg:py-3">
        <div className="relative flex flex-nowrap items-center justify-between gap-2">
          <a href="#story" className="inline-flex min-h-11 min-w-0 shrink items-center gap-2 text-xl font-bold leading-none sm:text-2xl lg:text-[34px]">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317] lg:h-9 lg:w-9 lg:text-base">V</span>
            <span className="truncate">Velora</span>
          </a>
          <nav className="hidden items-center gap-4 text-sm lg:flex" aria-label="Primary">
            <a className="inline-flex min-h-11 items-center" href="#how">{copy.nav.how}</a>
            <a className="inline-flex min-h-11 items-center" href="#activities">{copy.nav.activities}</a>
            <a className="inline-flex min-h-11 items-center" href="#packages">{copy.nav.packages}</a>
            <a className="inline-flex min-h-11 items-center" href="#faq">{copy.nav.faq}</a>
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 text-sm lg:hidden"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {locale === "ar" ? "القائمة" : "Menu"}
            </button>
            <button type="button" onClick={switchLocale} aria-label={copy.langAria} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/20 px-3 text-sm">
              {copy.lang}
            </button>
            <div className="hidden md:block">
              <AccountMenu />
            </div>
            <Link href={startHref} className="inline-flex min-h-11 max-w-[8.5rem] items-center truncate rounded-full bg-[#38dc89] px-2.5 text-[11px] font-medium text-[#072317] sm:max-w-none sm:px-4 sm:text-sm md:hidden">
              {startLabel}
            </Link>
          </div>
          {menuOpen ? (
            <div className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-50 grid rounded-2xl border border-white/10 bg-[#14221b] p-2 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.45)] lg:hidden">
              {[
                ["#how", copy.nav.how],
                ["#activities", copy.nav.activities],
                ["#packages", copy.nav.packages],
                ["#faq", copy.nav.faq],
                ["#demo", copy.try],
                ["#contact", copy.footer.contact],
              ].map(([href, label]) => (
                <a
                  key={href}
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
              onReplay={() => {
                const root = rootRef.current;
                if (root) replaySample(root);
              }}
              onPrepare={() => {
                document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
              }}
              startHref={startHref}
              startLabel={startLabel}
            />
          }
        />
        <Packages copy={copy} selectedPlan={plan} onSelect={selectPlan} />
        <Faq copy={copy} />
        <AboutContact
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
      <SiteFooter copy={copy} />
      <Catalogue copy={copy} open={catalogueOpen} onClose={closeCatalogue} />
      <LandingChatbot key={locale} copy={copy} />
    </div>
  );
}
