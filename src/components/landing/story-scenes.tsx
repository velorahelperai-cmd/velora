"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import type { LandingCopy } from "@/lib/landing-copy";
import {
  PhoneMock,
  PhoneSlot,
  SourceCard,
  StoryTheaterPhone,
} from "@/components/landing/conversation-stage";

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
  const setup = byId(7);

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
              question: trial?.question ?? "",
              answer: trial?.answer ?? "",
              note: trial?.note,
            },
          ]}
        />

        <section id={pressure.anchor} data-scene="1" className="scene scene-dark relative min-h-[100svh] overflow-hidden px-6 py-8 lg:px-12">
          <Image
            src="/assets/velora/hero-environment-v2.png"
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
              <SourceCard seq="staff" avatar={copy.staffInitial} title={handoff.example.cardTitle} body={handoff.example.card} />
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

      <section id={overview.anchor} data-scene="6" className="scene scene-light px-6 py-20 lg:px-12">
        <Veil to="dark" />
        <div data-seq="stage" className="relative z-10 mx-auto grid max-w-[1380px] items-center gap-12 lg:grid-cols-2">
          <article data-seq="panel" className="order-2 rounded-3xl border border-[#cbddd2] bg-white p-5 text-[#101b16] shadow-sm lg:p-6">
            <h3 className="text-2xl font-bold">{copy.panelTitle}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {copy.tabs.map((tab) => (
                <span key={tab} data-seq="tab" className="rounded-full bg-[#e7f3eb] px-4 py-2 text-base font-medium">
                  {tab}
                </span>
              ))}
            </div>
            <ul className="mt-3 divide-y divide-[#e4eee8]">
              {copy.rows.map((row, index) => (
                <li
                  key={row[0]}
                  data-seq={index === 0 ? "row-active" : "row"}
                  className={`grid gap-1 py-4 text-base ${index === 0 ? "rounded-2xl bg-[#def5e7] px-4" : ""}`}
                >
                  <span className="text-lg font-bold">{row[0]}</span>
                  <span className="font-medium text-[#087443]">{row[1]}</span>
                  {row[2] ? <span>{row[2]}</span> : null}
                  {row[3] ? <span className="text-[#4f6258]">{row[3]}</span> : null}
                </li>
              ))}
            </ul>
          </article>
          <div className="order-1">
            <h2 className="scene-title text-[#101b16]">{overview.title}</h2>
            <p className="scene-body mt-5 text-[#4f6258]">{overview.body}</p>
          </div>
        </div>
      </section>

      <section id={setup.anchor} data-scene="7" className="scene scene-dark px-6 py-20 lg:px-12">
        <Veil to="dark" />
        <div data-seq="stage" className="relative z-10 mx-auto grid max-w-[1380px] items-center gap-12 lg:grid-cols-2">
          <ol className="order-2 grid gap-3">
            {copy.steps.map((step, index) => (
              <li
                key={step.title}
                data-seq="step"
                className="flex items-start gap-4 rounded-2xl border border-white/15 bg-[#163026] px-4 py-4 text-[#f7fbf8]"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-sm font-bold text-[#072317]">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-lg font-bold">{step.title}</span>
                  <span className="mt-1 block text-base leading-7 text-[#d5e4da]">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="order-1">
            <h2 className="scene-title text-[#f7fbf8]">{setup.title}</h2>
            <p className="scene-body mt-5 text-[#adbeaf]">{setup.body}</p>
          </div>
        </div>
      </section>
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
