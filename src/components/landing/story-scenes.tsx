"use client";

import Image from "next/image";
import heroEnvironment from "../../../public/assets/velora/hero-environment-v2.png";
import Link from "next/link";
import { useEffect, useRef, type ReactNode, type SVGProps } from "react";
import styles from "./hero-layout.module.css";
import type { LandingCopy } from "@/lib/landing-copy";
import {
  PhoneMock,
  PhoneSlot,
  SourceCard,
  StoryTheaterPhone,
} from "@/components/landing/conversation-stage";
import { CinematicOnboarding } from "@/components/landing/cinematic-onboarding";
import {
  IconCalendarCheck,
  IconCheckCircle,
  IconFacebook,
  IconFileText,
  IconGlobe,
  IconInbox,
  IconInstagram,
  IconListChecks,
  IconMessageCircle,
  IconTarget,
  IconUserRound,
  IconUsers,
  IconWhatsApp,
} from "@/components/admin/admin-icons";

type BenefitIcon = LandingCopy["valuePoints"][number]["icon"];
type ChannelId = LandingCopy["channels"][number]["id"];
type RowChannel = LandingCopy["rows"][number]["channel"];
type RowTone = LandingCopy["rows"][number]["tone"];
type FollowIcon = LandingCopy["followUpSteps"][number]["icon"];

function BenefitGlyph({ name, className }: { name: BenefitIcon; className?: string }) {
  const props = { className: className ?? "h-5 w-5" } satisfies SVGProps<SVGSVGElement>;
  switch (name) {
    case "fileText":
      return <IconFileText {...props} />;
    case "check":
      return <IconCheckCircle {...props} />;
    case "users":
      return <IconUsers {...props} />;
    case "listChecks":
      return <IconListChecks {...props} />;
    default:
      return null;
  }
}

function ChannelGlyph({ id, className }: { id: ChannelId | RowChannel; className?: string }) {
  const props = { className: className ?? "h-4 w-4" } satisfies SVGProps<SVGSVGElement>;
  switch (id) {
    case "all":
      return <IconInbox {...props} />;
    case "whatsapp":
      return <IconWhatsApp {...props} />;
    case "instagram":
      return <IconInstagram {...props} />;
    case "web":
      return <IconGlobe {...props} />;
    case "facebook":
      return <IconFacebook {...props} />;
    case "calendar":
      return <IconCalendarCheck {...props} />;
    default:
      return <IconGlobe {...props} />;
  }
}

function FollowGlyph({ name, className }: { name: FollowIcon; className?: string }) {
  const props = { className: className ?? "h-5 w-5" } satisfies SVGProps<SVGSVGElement>;
  switch (name) {
    case "message":
      return <IconMessageCircle {...props} />;
    case "listChecks":
      return <IconListChecks {...props} />;
    case "user":
      return <IconUserRound {...props} />;
    case "target":
      return <IconTarget {...props} />;
    default:
      return null;
  }
}

function rowToneClass(tone: RowTone, isFirst: boolean): string {
  if (isFirst || tone === "awaiting") {
    return "border-[#a5dab9] bg-[#eefaf2]";
  }
  if (tone === "verify") {
    return "border-[#e2ede5] bg-white";
  }
  if (tone === "info") {
    return "border-[#e2ede5] bg-white";
  }
  return "border-[#e2ede5] bg-white";
}

function statusToneClass(tone: RowTone, isFirst: boolean): string {
  if (isFirst || tone === "awaiting") {
    return "bg-[#087443] text-white";
  }
  if (tone === "verify") {
    return "border border-[#e8d7a8] bg-[#fbf6e8] text-[#7a5d12]";
  }
  if (tone === "info") {
    return "border border-[#c5d5e8] bg-[#eef4fb] text-[#2f4f73]";
  }
  return "border border-[#cddcd2] bg-[#eaf1ec] text-[#2c4737]";
}

/** Theme veil that fades in at the end of a chapter to hand off to the next scene's surface. */
function Veil({ to }: { to: "light" | "dark" }) {
  return (
    <div
      data-seq="veil"
      aria-hidden="true"
      className="scene-veil"
      style={{ background: to === "light" ? "#f5f8f5" : "#07110d" }}
    />
  );
}

function Trace() {
  return (
    <svg className="hidden h-16 w-28 shrink-0 lg:block" viewBox="0 0 112 64" aria-hidden="true">
      <path
        data-trace
        d="M110 44 C 80 44, 64 14, 36 14 S 8 20, 2 20"
        stroke="#38DC89"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="2" cy="20" r="4" fill="#38DC89" />
    </svg>
  );
}

export function StoryScenes({
  copy,
  onMenu,
  startHref,
  startLabel,
  afterPhone,
  trial,
}: {
  copy: LandingCopy;
  onMenu: () => void;
  startHref: string;
  startLabel: string;
  /** Inserted after scene 5, still inside the phone theater. */
  afterPhone?: ReactNode;
  trial?: { question: string; answer: string; note?: string };
}) {
  const byId = (id: number) => copy.scenes.find((scene) => scene.id === id)!;

  const pressure = byId(1);
  const knowledge = byId(2);
  const reply = byId(3);
  const enquiry = byId(4);
  const handoff = byId(5);
  const overview = byId(6);

  return (
    <>
      <div data-story-phone-range className="story-phone-range">
        <StoryTheaterPhone
          orbit={pressure.chips}
          screens={[
            { id: "1", question: pressure.example.question, answer: pressure.example.answer },
            { id: "2", question: knowledge.example.question, answer: knowledge.example.answer },
            {
              id: "3",
              question: reply.example.question,
              answer: reply.example.answer,
              menuLabel: copy.menu,
              onMenu,
            },
            { id: "4", question: enquiry.example.question, answer: enquiry.example.answer },
            { id: "5", question: handoff.example.question, answer: handoff.example.answer },
            {
              id: "9",
              question: trial?.question || copy.scenes.find((s) => s.id === 9)!.example.question,
              answer: trial?.answer || copy.scenes.find((s) => s.id === 9)!.example.answer,
              note: trial?.note,
            },
          ]}
        />

        <section id={pressure.anchor} data-scene="1" className={`${styles.hero} scene scene-dark relative min-h-[100svh] overflow-hidden px-6 py-8 lg:px-12`}>
          <Image
            src={heroEnvironment}
            alt=""
            fill
            priority
            sizes="100vw"
            data-seq="environment"
            className="object-cover object-left"
          />
          <div className="hero-veil" />
          <Veil to="light" />
          <div className="scroll-hint hidden lg:flex" data-seq="scroll-hint" aria-hidden="true">
            <span>{copy.scrollHint}</span>
          </div>
          <div data-seq="stage" data-phone="start" className="story-stage relative z-10 mx-auto min-h-[78svh] max-w-[1380px]">
            <div className="story-visual relative">
              <div className="stage-row">
                <PhoneSlot />
                <PhoneMock
                  className="story-phone-local"
                  question={pressure.example.question}
                  answer={pressure.example.answer}
                  orbit={pressure.chips}
                />
              </div>
            </div>
            <div className="story-copy">
              <p data-seq="tagline" className="max-w-[36ch] text-base font-medium leading-7 text-[#9ef0c4]">{copy.tagline}</p>
              <h1 className="scene-title mt-3 text-[#f7fbf8]">{pressure.title}</h1>
              <p className="scene-body mt-4 text-[#d5e4da]">{pressure.body}</p>
              <div data-seq="hero-actions" className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
                <Link
                  href={startHref}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#38dc89] px-6 text-base font-medium text-[#072317] sm:w-auto"
                >
                  {startLabel}
                </Link>
                <a
                  href="#how"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-white/25 px-6 text-base font-medium text-[#f7fbf8] sm:w-auto"
                >
                  {copy.try}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id={knowledge.anchor} data-scene="2" data-bridge className="scene scene-light px-6 py-20 lg:px-12">
          <Veil to="dark" />
          <div data-seq="stage" data-phone="end" className="story-stage relative z-10 mx-auto max-w-[1380px]">
            <div className="story-visual stage-row">
              <div className="grid gap-3">
                <SourceCard tone="light" title={knowledge.example.cardTitle} body={knowledge.example.card} />
                <p data-seq="highlight" className="source-link text-base font-medium text-[#087443]">{copy.fromSource}</p>
              </div>
              <PhoneSlot />
              <PhoneMock
                className="story-phone-local"
                question={knowledge.example.question}
                answer={knowledge.example.answer}
              />
            </div>
            <div className="story-copy">
              <h2 className="scene-title text-[#101b16]">{knowledge.title}</h2>
              <p className="scene-body mt-5 text-[#4f6258]">{knowledge.body}</p>
            </div>
          </div>
        </section>

        <section id={reply.anchor} data-scene="3" className="scene scene-dark px-6 py-20 lg:px-12">
          <Veil to="light" />
          <div data-seq="stage" data-phone="start" className="story-stage relative z-10 mx-auto max-w-[1380px]">
            <div className="story-visual stage-row">
              <SourceCard title={reply.example.cardTitle} body={reply.example.card} />
              <Trace />
              <PhoneSlot />
              <PhoneMock
                className="story-phone-local"
                question={reply.example.question}
                answer={reply.example.answer}
                rotation={2}
                menuLabel={copy.menu}
                onMenu={onMenu}
              />
            </div>
            <div className="story-copy">
              <h2 className="scene-title text-[#f7fbf8]">{reply.title}</h2>
              <p className="scene-body mt-5 text-[#adbeaf]">{reply.body}</p>
            </div>
          </div>
        </section>

        <section id={enquiry.anchor} data-scene="4" className="scene scene-light px-6 py-20 lg:px-12">
          <Veil to="dark" />
          <div data-seq="stage" data-phone="end" className="story-stage relative z-10 mx-auto max-w-[1380px]">
          <div className="story-visual stage-row">
            <div className="grid gap-3">
              <SourceCard tone="light" seq="record" title={enquiry.example.cardTitle} body={enquiry.example.card} />
              <p data-seq="confirmed" className="text-base font-medium text-[#087443]">{copy.confirmed}</p>
              <p className="text-sm font-medium text-[#4f6258]">{copy.illustrative}</p>
            </div>
            <PhoneSlot />
            <PhoneMock
              className="story-phone-local"
              question={enquiry.example.question}
              answer={enquiry.example.answer}
            />
          </div>
            <div className="story-copy">
              <h2 className="scene-title text-[#101b16]">{enquiry.title}</h2>
              <p className="scene-body mt-5 text-[#4f6258]">{enquiry.body}</p>
            </div>
          </div>
        </section>

        <section id={handoff.anchor} data-scene="5" className="scene scene-dark px-6 py-20 lg:px-12">
          <Veil to="dark" />
          <div data-seq="stage" data-phone="start" className="story-stage relative z-10 mx-auto max-w-[1380px]">
          <div className="story-visual stage-row">
            <div>
              <SourceCard seq="staff" team title={handoff.example.cardTitle} body={handoff.example.card} />
              <p data-seq="paused" data-indicator="paused" className="mt-4 inline-flex rounded-full bg-[#38dc89]/15 px-4 py-2 text-base font-medium text-[#b6f5d4]">
                {copy.paused}
              </p>
              <p data-seq="no-repeat" className="mt-3 text-sm text-[#adbeaf]">{copy.noRepeat}</p>
            </div>
            <PhoneSlot />
            <PhoneMock
              className="story-phone-local"
              question={handoff.example.question}
              answer={handoff.example.answer}
            />
          </div>
            <div className="story-copy">
              <h2 className="scene-title text-[#f7fbf8]">{handoff.title}</h2>
              <p className="scene-body mt-5 text-[#adbeaf]">{handoff.body}</p>
            </div>
          </div>
        </section>

        {afterPhone}
      </div>

      <section id={overview.anchor} data-scene="6" className="scene scene-light px-4 py-16 sm:px-6 lg:px-12 lg:py-20">
        <Veil to="dark" />
        <div data-seq="stage" className="relative z-10 mx-auto max-w-[1380px]">
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-14">
            <div className="order-1 min-w-0">
              <div data-seq="overview-lead">
                <h2 className="scene-title whitespace-pre-line text-[#101b16]">{overview.title}</h2>
                <p className="scene-body mt-5 max-w-[42ch] text-base leading-relaxed text-[#4f6258] sm:text-lg">
                  {overview.body}
                </p>
              </div>
              <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4" data-seq="value-points">
                {copy.valuePoints.map((point) => (
                  <li
                    key={point.title}
                    data-seq="benefit"
                    className="flex min-w-0 items-start gap-3 rounded-2xl border border-[#d7e6dc] bg-white/70 p-3.5 sm:p-4"
                  >
                    <span
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#def5e7] text-[#087443] shadow-[0_1px_2px_rgba(8,116,67,0.12)]"
                      aria-hidden="true"
                    >
                      <BenefitGlyph name={point.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold leading-snug text-[#101b16]">{point.title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-[#4f6258]">{point.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <article
              data-seq="panel"
              className="order-2 min-w-0 overflow-hidden rounded-[1.75rem] border border-[#cbddd2] bg-white text-[#101b16] shadow-[0_18px_40px_rgba(16,27,22,0.08)]"
            >
              <div className="flex flex-col md:flex-row">
                <aside className="border-b border-[#e2ede5] bg-[#f7fbf8] p-4 md:w-[11.5rem] md:shrink-0 md:border-b-0 md:border-e">
                  <p className="text-sm font-semibold text-[#101b16]">{copy.conversationsTitle}</p>
                  <ul className="mt-3 flex flex-wrap gap-2 md:flex-col md:gap-1.5" role="list">
                    {copy.channels.map((channel, index) => {
                      const active = index === 0;
                      return (
                        <li key={channel.id} data-seq="channel" className="min-w-0">
                          <span
                            className={`inline-flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-sm ${
                              active
                                ? "bg-[#087443] font-medium text-white"
                                : "bg-white text-[#4f6258] md:bg-transparent"
                            }`}
                          >
                            <ChannelGlyph id={channel.id} className="h-4 w-4 shrink-0 opacity-90" />
                            <span className="truncate">{channel.label}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </aside>

                <div className="min-w-0 flex-1 p-4 sm:p-5 lg:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-lg font-bold tracking-tight text-[#101b16] sm:text-xl">
                      {copy.panelTitle}
                    </h3>
                    <span className="inline-flex items-center rounded-full border border-[#b6e2c9] bg-[#def5e7] px-3 py-1 text-xs font-semibold text-[#087443]">
                      {copy.illustrativeBadge}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2" role="note" aria-label={copy.tabs[1]}>
                    {copy.tabs.map((tab, idx) => {
                      const isActive = idx === 1;
                      return (
                        <span
                          key={tab}
                          data-seq="tab"
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium sm:text-sm ${
                            isActive
                              ? "bg-[#087443] text-white"
                              : "border border-[#d6e4db]/60 bg-[#edf4ef] text-[#4f6258]"
                          }`}
                        >
                          {tab}
                        </span>
                      );
                    })}
                  </div>

                  <ul className="mt-4 flex flex-col gap-2.5 sm:gap-3">
                    {copy.rows.map((row, index) => {
                      const isFirst = index === 0;
                      return (
                        <li
                          key={`${row.sector}-${row.title}`}
                          data-seq={isFirst ? "row-active" : "row"}
                          className={`relative rounded-2xl border p-3.5 sm:p-4 ${rowToneClass(row.tone, isFirst)}`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#087443] shadow-[0_1px_2px_rgba(16,27,22,0.06)]"
                              aria-hidden="true"
                            >
                              <ChannelGlyph id={row.channel} className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-medium text-[#6a7d72]">{row.sector}</p>
                                  <p className="text-base font-bold tracking-tight text-[#101b16] sm:text-lg">
                                    {row.title}
                                  </p>
                                </div>
                                <span
                                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${statusToneClass(
                                    row.tone,
                                    isFirst,
                                  )}`}
                                >
                                  {row.status}
                                </span>
                              </div>
                              <p
                                className={`mt-1.5 text-sm leading-relaxed ${
                                  isFirst ? "font-medium text-[#1d4a34]" : "text-[#4f6258]"
                                }`}
                              >
                                {row.body}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </article>
          </div>

          <div
            data-seq="follow-strip"
            className="mt-10 rounded-[1.75rem] border border-[#d7e6dc] bg-white/80 p-5 sm:mt-12 sm:p-6 lg:p-7"
          >
            <h3 data-seq="follow-title" className="text-base font-semibold text-[#101b16] sm:text-lg">
              {copy.followUpHowTitle}
            </h3>
            <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
              {copy.followUpSteps.map((step, index) => (
                <li
                  key={step.number}
                  data-seq="follow-step"
                  className={`relative flex min-w-0 gap-3 lg:px-4 ${
                    index > 0 ? "lg:border-s lg:border-[#d7e6dc]" : ""
                  }`}
                >
                  <span
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#def5e7] text-[#087443]"
                    aria-hidden="true"
                  >
                    <FollowGlyph name={step.icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-[#087443]">{step.number}</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#101b16]">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#4f6258]">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <CinematicOnboarding copy={copy} />
    </>
  );
}

export function Catalogue({
  copy,
  open,
  onClose,
}: {
  copy: LandingCopy;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const closeButton = dialog?.querySelector<HTMLButtonElement>("button");
    closeButton?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>("button, a, input, select, textarea")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="catalogue-title" className="w-full max-w-md rounded-3xl bg-[#f5f8f5] p-6 text-[#101b16]">
        <h2 id="catalogue-title" className="text-2xl font-bold">{copy.catalogueTitle}</h2>
        <ul className="mt-4 grid gap-2">
          {copy.catalogue.map((item) => (
            <li key={item} className="rounded-2xl bg-white px-4 py-3">{item}</li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#087443] px-5 text-white">
          {copy.close}
        </button>
      </div>
    </div>
  );
}
