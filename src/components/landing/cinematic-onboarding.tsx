"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LandingCopy } from "@/lib/landing-copy";

type StageId = 0 | 1 | 2 | 3;

interface CinematicOnboardingProps {
  copy: LandingCopy;
}

export function CinematicOnboarding({ copy }: CinematicOnboardingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState<StageId>(0);

  // Scroll calculation for desktop sticky presentation
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || typeof window === "undefined") return;

    // Only compute sticky stage progress on desktop screens
    if (window.innerWidth < 1024) return;

    const rect = el.getBoundingClientRect();
    const windowH = window.innerHeight;
    const totalDistance = rect.height - windowH;

    if (totalDistance <= 0) return;

    // How far the top of the container has passed the top of viewport
    const scrolled = -rect.top;
    const progress = Math.min(1, Math.max(0, scrolled / totalDistance));

    // Map 0..1 progress to stages 0..3 with stable threshold windows
    let nextStage: StageId = 0;
    if (progress >= 0.72) {
      nextStage = 3;
    } else if (progress >= 0.46) {
      nextStage = 2;
    } else if (progress >= 0.20) {
      nextStage = 1;
    } else {
      nextStage = 0;
    }

    setActiveStage((prev) => (prev !== nextStage ? nextStage : prev));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleScroll);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Initial check
    handleScroll();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [handleScroll]);

  // Click on a narrative step to scroll smoothly to that step's range
  const scrollToStage = (stage: StageId) => {
    const el = containerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const totalDistance = rect.height - window.innerHeight;
    const targetOffset = (stage / 3.2) * totalDistance;
    const targetY = scrollTop + rect.top + targetOffset;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.scrollTo({
      top: targetY,
      behavior: prefersReduced ? "auto" : "smooth",
    });
  };

  const data = copy.onboardingStory;
  const stages = data.stages;
  const currentStageMeta = stages[activeStage] ?? stages[0];

  return (
    <section
      id="setup"
      data-scene="7"
      ref={containerRef}
      className="scene scene-dark relative !overflow-visible px-4 py-16 sm:px-6 lg:px-12 lg:py-24 text-[#f7fbf8]"
      style={{
        background: "linear-gradient(180deg, #07110d 0%, #0a1b14 50%, #07110d 100%)",
        overflow: "visible",
      }}
    >
      {/* Background ambient lighting */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 opacity-25"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 75% 25%, #184432 0%, transparent 45%), radial-gradient(circle at 25% 75%, #0f3023 0%, transparent 50%)",
        }}
      />

      {/* DESKTOP LAYOUT (1024px and up): Sticky One-Interface Storytelling */}
      <div className="relative z-10 mx-auto hidden max-w-[1380px] lg:block">
        {/* Section Header */}
        <header className="order-1 mb-14 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#38dc89]/30 bg-[#38dc89]/10 px-4 py-1.5 text-xs font-semibold text-[#9ef0c4]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89] animate-pulse" />
            <span>{data.eyebrow}</span>
          </div>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-[#f7fbf8]">
            {data.headline}
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-[#c3d5cb]">
            {data.supporting}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[#93a79c]">{copy.exampleNote}</p>
        </header>

        {/* 2-Column Desktop Grid with Sticky Living Window */}
        <div className="grid grid-cols-12 items-start gap-8 xl:gap-14">
          {/* Narrative Column: 5 Cols (Right in RTL, Left in LTR) */}
          <div className="col-span-5 flex flex-col gap-28 pb-40 pt-4">
            {stages.map((stage, idx: number) => {
              const isCurrent = activeStage === idx;
              return (
                <article
                  key={stage.id}
                  data-seq="step"
                  onClick={() => scrollToStage(idx as StageId)}
                  className={`group relative cursor-pointer rounded-2xl border p-6 transition-all duration-300 ${
                    isCurrent
                      ? "border-[#38dc89] bg-[#12281f]/90 shadow-[0_0_35px_rgba(56,220,137,0.14)]"
                      : "border-white/10 bg-[#0d1c16]/50 opacity-60 hover:border-white/25 hover:opacity-85"
                  }`}
                >
                  {/* Stage Number & Badge */}
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                        isCurrent
                          ? "bg-[#38dc89] text-[#072317] shadow-sm"
                          : "bg-white/10 text-[#a8baa4]"
                      }`}
                    >
                      {stage.number}
                    </span>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                        isCurrent
                          ? "border-[#38dc89]/40 bg-[#38dc89]/15 text-[#9ef0c4]"
                          : "border-white/10 bg-white/5 text-[#889d91]"
                      }`}
                    >
                      {stage.tag}
                    </span>
                  </div>

                  {/* Title & Body */}
                  <h3 className="mt-4 text-xl font-bold tracking-tight text-[#f7fbf8]">
                    {stage.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#c3d5cb]">
                    {stage.body}
                  </p>

                  {/* Active Indicator Pulse Bar */}
                  {isCurrent ? (
                    <div className="mt-4 flex items-center gap-2 text-xs font-medium text-[#38dc89]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89]" />
                      <span>
                        {copy.locale === "ar"
                          ? "معاينة المرحلة نشطة حاليًا"
                          : "Stage preview active"}
                      </span>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {/* Sticky Living Product Interface Column: 7 Cols (Left in RTL, Right in LTR) */}
          <aside className="sticky top-24 col-span-7 self-start">
            <div className="overflow-hidden rounded-3xl border border-[#23493b] bg-[#0c1813] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
              {/* SaaS App Header Chrome */}
              <div className="flex items-center justify-between border-b border-white/10 bg-[#08120e] px-4 py-3 text-xs">
                {/* Window Traffic Lights */}
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                </div>

                {/* Window App Title & Active Stage */}
                <div className="flex items-center gap-2 font-medium text-[#b6c7be]">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#38dc89] text-[9px] font-bold text-[#072317]">
                    V
                  </span>
                  <span>{data.previewUI.appTitle}</span>
                  <span className="text-white/30">/</span>
                  <span className="text-[#38dc89] font-semibold">
                    {currentStageMeta.number} — {currentStageMeta.title}
                  </span>
                </div>

                {/* Illustrative Preview Pill */}
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[#38dc89]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#9ef0c4]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89]" />
                  <span>{data.previewUI.previewBadge}</span>
                </div>
              </div>

              {/* Dynamic Content Canvas: Morphs according to activeStage */}
              <div
                className="relative min-h-[490px] p-5 sm:p-6 transition-all duration-300"
                style={{
                  background:
                    "radial-gradient(ellipse at top right, #112920 0%, #0a1611 60%)",
                }}
              >
                {activeStage === 0 && <StageChooseAssistant ui={data.previewUI} locale={copy.locale} />}
                {activeStage === 1 && <StageTeachBusiness ui={data.previewUI} locale={copy.locale} />}
                {activeStage === 2 && <StageConnectWhatsApp ui={data.previewUI} locale={copy.locale} />}
                {activeStage === 3 && <StageTestAssistant ui={data.previewUI} locale={copy.locale} />}
              </div>

              {/* Living Window Bottom Status Bar */}
              <div className="flex items-center justify-between border-t border-white/10 bg-[#07110d] px-5 py-2.5 text-[11px] text-[#86998e]">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#38dc89]" />
                  <span>
                    {copy.locale === "ar"
                      ? "المرحلة " + (activeStage + 1) + " من 4"
                      : "Stage " + (activeStage + 1) + " of 4"}
                  </span>
                </div>
                <div className="flex items-center gap-1 font-mono text-[10px] text-[#71867a]">
                  <span>velora.cloud/setup/</span>
                  <span className="text-[#38dc89]">{stages[activeStage]?.id}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* MOBILE & TABLET LAYOUT (< 1024px): Stacked Story Progression */}
      <div className="relative z-10 mx-auto max-w-xl lg:hidden">
        {/* Mobile Section Header */}
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#38dc89]/30 bg-[#38dc89]/10 px-3.5 py-1 text-xs font-semibold text-[#9ef0c4]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89]" />
            <span>{data.eyebrow}</span>
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#f7fbf8] sm:text-3xl">
            {data.headline}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#c3d5cb]">
            {data.supporting}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[#93a79c]">{copy.exampleNote}</p>
        </header>

        {/* Sequential 4 Stages Stacked Naturally */}
        <div className="flex flex-col gap-12">
          {stages.map((stage, idx: number) => (
            <article
              key={stage.id}
              className="flex flex-col gap-4 rounded-3xl border border-white/15 bg-[#0e1c16] p-5 shadow-lg"
            >
              {/* Step Header */}
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#38dc89] text-xs font-bold text-[#072317]">
                  {stage.number}
                </span>
                <span className="rounded-full border border-[#38dc89]/30 bg-[#38dc89]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#9ef0c4]">
                  {stage.tag}
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-[#f7fbf8]">{stage.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#c3d5cb]">{stage.body}</p>
              </div>

              {/* Embedded Stage Interface Preview */}
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#08120e] p-3 text-xs">
                {idx === 0 && <StageChooseAssistant ui={data.previewUI} locale={copy.locale} isMobile />}
                {idx === 1 && <StageTeachBusiness ui={data.previewUI} locale={copy.locale} />}
                {idx === 2 && <StageConnectWhatsApp ui={data.previewUI} locale={copy.locale} />}
                {idx === 3 && <StageTestAssistant ui={data.previewUI} locale={copy.locale} />}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

type PreviewUI = LandingCopy["onboardingStory"]["previewUI"];

// ---------------------------------------------------------------------------
// STAGE 01: Choose Your Assistant
// ---------------------------------------------------------------------------
function StageChooseAssistant({
  ui,
  locale,
  isMobile = false,
}: {
  ui: PreviewUI;
  locale: string;
  isMobile?: boolean;
}) {
  const chars = ui.characters;
  const plans = ui.plans;

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <h4 className="text-sm font-bold text-[#f7fbf8]">
            {locale === "ar" ? "اختر مساعدتك الذكية" : "Choose Your Assistant"}
          </h4>
          <p className="text-[11px] text-[#93a79c]">
            {locale === "ar"
              ? "حدد الشخصية ونطاق الردود المعتمد لنشاطك"
              : "Select persona and reply scope for your business"}
          </p>
        </div>
        <span className="rounded-full border border-[#38dc89]/30 bg-[#38dc89]/15 px-2.5 py-0.5 text-[10px] font-semibold text-[#9ef0c4]">
          {locale === "ar" ? "3 شخصيات رسمية" : "3 Official Personas"}
        </span>
      </div>

      {/* 3 Personas Grid */}
      <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-3"}`}>
        {/* NOURA (نورا) — Highlighted Active Example */}
        <div className="relative rounded-2xl border-2 border-[#38dc89] bg-[#142f23] p-3 shadow-[0_0_24px_rgba(56,220,137,0.2)]">
          <div className="absolute -top-2.5 start-3 inline-flex items-center gap-1 rounded-full bg-[#38dc89] px-2 py-0.5 text-[9px] font-bold text-[#072317]">
            <span>✓</span>
            <span>{chars.noura.badge}</span>
          </div>

          <div className="mt-1 flex flex-col items-center text-center">
            <div className="relative h-20 w-20 overflow-hidden rounded-full border-2 border-[#38dc89] bg-[#0c1813]">
              <Image
                src="/characters/noor.png"
                alt="Noura"
                width={80}
                height={80}
                className="h-full w-full object-cover object-top"
              />
            </div>
            <h5 className="mt-2 text-sm font-bold text-[#f7fbf8]">{chars.noura.name}</h5>
            <p className="text-[10px] text-[#9ef0c4] font-medium">{chars.noura.role}</p>
            <span className="mt-1 inline-block rounded-md bg-black/20 px-1.5 py-0.5 text-[9px] text-[#869f91]">
              {chars.noura.dialect}
            </span>
          </div>
        </div>

        {/* LINA (لينا) */}
        <div className="rounded-2xl border border-white/10 bg-[#0f2119]/60 p-3 opacity-80 hover:opacity-100 transition-opacity">
          <div className="flex flex-col items-center text-center">
            <div className="relative h-20 w-20 overflow-hidden rounded-full border border-white/20 bg-[#0c1813]">
              <Image
                src="/characters/lina.png"
                alt="Lina"
                width={80}
                height={80}
                className="h-full w-full object-cover object-top"
              />
            </div>
            <h5 className="mt-2 text-sm font-bold text-[#f7fbf8]">{chars.lina.name}</h5>
            <p className="text-[10px] text-[#a4b7ab]">{chars.lina.role}</p>
            <span className="mt-1 inline-block rounded-md bg-black/20 px-1.5 py-0.5 text-[9px] text-[#869f91]">
              {chars.lina.dialect}
            </span>
          </div>
        </div>

        {/* DANA (دانة) */}
        <div className="rounded-2xl border border-white/10 bg-[#0f2119]/60 p-3 opacity-80 hover:opacity-100 transition-opacity">
          <div className="flex flex-col items-center text-center">
            <div className="relative h-20 w-20 overflow-hidden rounded-full border border-white/20 bg-[#0c1813]">
              <Image
                src="/characters/dana.png"
                alt="Dana"
                width={80}
                height={80}
                className="h-full w-full object-cover object-top"
              />
            </div>
            <h5 className="mt-2 text-sm font-bold text-[#f7fbf8]">{chars.dana.name}</h5>
            <p className="text-[10px] text-[#a4b7ab]">{chars.dana.role}</p>
            <span className="mt-1 inline-block rounded-md bg-black/20 px-1.5 py-0.5 text-[9px] text-[#869f91]">
              {chars.dana.dialect}
            </span>
          </div>
        </div>
      </div>

      {/* Plan Tier Preview Pill */}
      <div className="mt-1 flex items-center justify-between rounded-xl border border-white/10 bg-[#08120e] p-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#93a79c]">
            {locale === "ar" ? "الباقة في المثال:" : "Example Plan:"}
          </span>
          <span className="rounded-md bg-[#38dc89]/15 px-2 py-0.5 text-[11px] font-bold text-[#38dc89]">
            {plans.basic}
          </span>
          <span className="text-[11px] text-[#86998e] line-through">
            {plans.premium}
          </span>
        </div>
        <span className="text-[10px] text-[#6d8175]">{plans.note}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 02: Teach Velora Your Business
// ---------------------------------------------------------------------------
function StageTeachBusiness({
  ui,
  locale,
}: {
  ui: PreviewUI;
  locale: string;
}) {
  const k = ui.knowledge;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <h4 className="text-sm font-bold text-[#f7fbf8]">{k.header}</h4>
          <p className="text-[11px] text-[#93a79c]">
            {locale === "ar"
              ? "معلومات افتراضية مستخدمة في هذا المثال"
              : "Fictional information used in this example"}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-2.5 py-0.5 text-[10px] font-semibold text-[#9ef0c4]">
          <span>✓</span>
          <span>{locale === "ar" ? "بيانات مثال" : "Example Data"}</span>
        </span>
      </div>

      {/* Form Fields Simulation */}
      <div className="grid gap-2.5 text-xs">
        {/* Field 1: Business Name */}
        <div className="rounded-xl border border-white/10 bg-[#091510] p-2.5">
          <span className="text-[10px] font-medium text-[#7d9386]">
            {k.businessNameLabel}
          </span>
          <div className="mt-1 flex items-center justify-between font-semibold text-[#f7fbf8]">
            <span>{k.businessNameValue}</span>
            <span className="h-2 w-2 rounded-full bg-[#38dc89] animate-pulse" />
          </div>
        </div>

        {/* Field 2: Products & Services */}
        <div className="rounded-xl border border-white/10 bg-[#091510] p-2.5">
          <span className="text-[10px] font-medium text-[#7d9386]">
            {k.servicesLabel}
          </span>
          <p className="mt-0.5 text-[11px] text-[#d5e4da]">{k.servicesValue}</p>
        </div>

        {/* Field 3: Hours & Pricing */}
        <div className="rounded-xl border border-white/10 bg-[#091510] p-2.5">
          <span className="text-[10px] font-medium text-[#7d9386]">
            {k.hoursLabel}
          </span>
          <p className="mt-0.5 text-[11px] text-[#d5e4da]">{k.hoursValue}</p>
        </div>

        {/* Field 4: Delivery Policy */}
        <div className="rounded-xl border border-white/10 bg-[#091510] p-2.5">
          <span className="text-[10px] font-medium text-[#7d9386]">
            {k.policyLabel}
          </span>
          <p className="mt-0.5 text-[11px] text-[#d5e4da]">{k.policyValue}</p>
        </div>
      </div>

      {/* Example Status Banner */}
      <div className="flex items-center justify-between rounded-xl border border-[#38dc89]/40 bg-[#12281e] p-2.5 text-xs text-[#9ef0c4]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#38dc89]">✓</span>
          <span className="font-semibold">{k.statusApproved}</span>
        </div>
        <span className="text-[10px] text-[#86998e]">{k.statusSubtext}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 03: Connect WhatsApp Business via Meta
// ---------------------------------------------------------------------------
function StageConnectWhatsApp({
  ui,
  locale,
}: {
  ui: PreviewUI;
  locale: string;
}) {
  const w = ui.whatsapp;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <h4 className="text-sm font-bold text-[#f7fbf8]">{w.header}</h4>
          <p className="text-[11px] text-[#93a79c]">
            {locale === "ar"
              ? "Meta Embedded Signup رسمي برقم شركتك"
              : "Official Meta Embedded Signup for your number"}
          </p>
        </div>
        <span className="rounded-full border border-[#25d366]/40 bg-[#25d366]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#5cf095]">
          WhatsApp WABA
        </span>
      </div>

      {/* Connection Beam Diagram */}
      <div className="relative rounded-2xl border border-white/15 bg-[#091510] p-4 text-center">
        <div className="flex items-center justify-around gap-2">
          {/* Business Phone Icon */}
          <div className="flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#25d366]/50 bg-[#143022] text-[#25d366]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92z" />
              </svg>
            </div>
            <span className="mt-1.5 text-[11px] font-bold text-[#f7fbf8] dir-ltr">
              {w.phoneNumber}
            </span>
            <span className="text-[9px] text-[#7d9386]">{w.wabaTitle}</span>
          </div>

          {/* Animated Connecting Beam */}
          <div className="flex flex-1 flex-col items-center px-2">
            <span className="text-[9px] font-mono text-[#38dc89] mb-1">
              Meta Cloud API
            </span>
            <div className="relative h-1 w-full rounded-full bg-white/15">
              <div className="absolute inset-y-0 start-0 w-2/3 rounded-full bg-[#38dc89] animate-pulse" />
            </div>
            <span className="mt-1 text-[9px] text-[#93a79c]">
              {w.accountStatus}
            </span>
          </div>

          {/* Velora AI Gateway Icon */}
          <div className="flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#38dc89]/50 bg-[#12281e] text-[#38dc89] font-bold text-lg">
              V
            </div>
            <span className="mt-1.5 text-[11px] font-bold text-[#f7fbf8]">
              Velora AI
            </span>
            <span className="text-[9px] text-[#7d9386]">
              {locale === "ar" ? "المساعد الذكي" : "AI Helper"}
            </span>
          </div>
        </div>
      </div>

      {/* 3 Verification Checklist Steps */}
      <div className="grid gap-2">
        {w.steps.map((st, i: number) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-[#091510] px-3 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#38dc89] text-[9px] font-bold text-[#072317]">
                {i + 1}
              </span>
              <span className="text-[#d5e4da]">{st.label}</span>
            </div>
            <span className="text-[10px] text-[#38dc89] font-medium">
              {locale === "ar" ? "خطوة توضيحية" : "Example step"}
            </span>
          </div>
        ))}
      </div>

      <div className="text-center text-[10px] text-[#86998e]">
        {w.syncNotice}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 04: Test Your AI Assistant
// ---------------------------------------------------------------------------
function StageTestAssistant({
  ui,
  locale,
}: {
  ui: PreviewUI;
  locale: string;
}) {
  const c = ui.chatTest;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="relative h-8 w-8 overflow-hidden rounded-full border border-[#38dc89] bg-[#0c1813]">
            <Image
              src="/characters/noor.png"
              alt="Noura"
              width={32}
              height={32}
              className="h-full w-full object-cover object-top"
            />
          </div>
          <div>
            <h4 className="text-xs font-bold text-[#f7fbf8]">{c.header}</h4>
            <span className="text-[10px] text-[#38dc89] font-medium">
              {c.onlineStatus}
            </span>
          </div>
        </div>
        <span className="rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-2.5 py-0.5 text-[10px] font-semibold text-[#9ef0c4]">
          {c.sandboxBadge}
        </span>
      </div>

      {/* Simulated 4-Message Chat Sandbox */}
      <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#091510] p-3 text-xs">
        {c.messages.map((m, idx: number) => {
          const isCustomer = m.role === "customer";
          return (
            <div
              key={idx}
              className={`flex flex-col ${
                isCustomer ? "items-start" : "items-end"
              }`}
            >
              <div
                className={`max-w-[88%] rounded-xl px-3 py-1.5 text-xs ${
                  isCustomer
                    ? "rounded-ts-none bg-[#193527] text-[#e8f2ec]"
                    : "rounded-te-none bg-[#38dc89] text-[#072317] font-medium"
                }`}
              >
                {m.text}
              </div>
              <span className="mt-0.5 text-[8px] text-[#6d8175] px-1">
                {isCustomer
                  ? locale === "ar"
                    ? "العميل"
                    : "Customer"
                  : locale === "ar"
                  ? "نورا AI"
                  : "Noura AI"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Readiness Checklist Banner */}
      <div className="rounded-2xl border border-white/10 bg-[#08120e] p-3 text-xs">
        <div className="text-[11px] font-bold text-[#f7fbf8] mb-2">
          {c.readinessHeader}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          {c.readinessList.map((item, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-[#c3d5cb]">
              <span
                className={`h-3 w-3 rounded-full flex items-center justify-center text-[8px] font-bold ${
                  item.done
                    ? "bg-[#38dc89] text-[#072317]"
                    : "bg-white/20 text-white/70"
                }`}
              >
                {item.done ? "✓" : "⏳"}
              </span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
