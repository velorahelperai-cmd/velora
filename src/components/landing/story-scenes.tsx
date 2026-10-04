"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { LandingCopy } from "@/lib/landing-copy";
import { PhoneMock, SourceCard } from "@/components/landing/conversation-stage";

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
}: {
  copy: LandingCopy;
  onMenu: () => void;
  startHref: string;
  startLabel: string;
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
            <div className="pressure-card pointer-events-none absolute start-0 top-2 z-10 max-w-[230px] rounded-3xl rounded-es-md border border-white/15 bg-[#14221b]/92 px-5 py-3 text-lg font-medium text-[#f7fbf8] shadow-[0_18px_40px_rgba(0,0,0,0.4)] lg:-top-6" data-seq="chip">
              {pressure.chips[0]}
            </div>
            <div className="pressure-card pointer-events-none absolute end-6 -top-10 z-10 max-w-[230px] rounded-3xl rounded-ee-md border border-white/15 bg-[#14221b]/85 px-5 py-3 text-lg font-medium text-[#f7fbf8] shadow-[0_18px_40px_rgba(0,0,0,0.4)] lg:-top-16 lg:end-2" data-seq="chip">
              {pressure.chips[1]}
            </div>
            <div className="pressure-card pointer-events-none absolute -bottom-6 start-8 z-10 max-w-[230px] rounded-3xl rounded-ss-md border border-white/15 bg-[#14221b]/80 px-5 py-3 text-lg font-medium text-[#dfe9e2] shadow-[0_18px_40px_rgba(0,0,0,0.4)] lg:-bottom-12 lg:start-16" data-seq="chip">
              {pressure.chips[2]}
            </div>
            <div className="stage-row">
              <SourceCard title={pressure.example.cardTitle} body={pressure.example.card} />
              <PhoneMock
                question={pressure.example.question}
                answer={pressure.example.answer}
                rotation={-5}
              />
            </div>
          </div>
          <div className="story-copy">
            <p data-seq="tagline" className="text-sm font-medium text-[#38dc89]">{copy.tagline}</p>
            <h1 className="scene-title mt-3 text-[#f7fbf8]">{pressure.title}</h1>
            <p className="scene-body mt-5 text-[#adbeaf]">{pressure.body}</p>
            <div data-seq="hero-actions" className="mt-8 flex flex-wrap gap-3">
              <Link
                href={startHref}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#38dc89] px-6 text-base font-medium text-[#072317]"
              >
                {startLabel}
              </Link>
              <a
                href="#demo"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/25 px-6 text-base font-medium text-[#f7fbf8]"
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
            <div>
              <SourceCard tone="light" title={knowledge.example.cardTitle} body={knowledge.example.card} />
              <span data-seq="highlight" className="mt-3 block h-0.5 w-16 bg-[#087443]" />
            </div>
            <PhoneMock
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
            <PhoneMock
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
          <div className="story-visual stage-row lg:scale-[0.87]">
            <div>
              <SourceCard tone="light" seq="record" title={enquiry.example.cardTitle} body={enquiry.example.card} />
              <p data-seq="confirmed" className="mt-3 text-sm font-medium text-[#087443]">✓ {copy.confirmed}</p>
            </div>
            <PhoneMock
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
        <Veil to="light" />
        <div data-seq="stage" data-phone="start" className="story-stage relative z-10 mx-auto max-w-[1380px]">
          <div className="story-visual stage-row lg:scale-[0.86]">
            <div>
              <SourceCard seq="staff" avatar={copy.staffInitial} title={handoff.example.cardTitle} body={handoff.example.card} />
              <p data-seq="paused" data-indicator="paused" className="mt-4 inline-flex rounded-full bg-[#38dc89]/15 px-4 py-2 text-sm text-[#38dc89]">
                {copy.paused}
              </p>
              <p data-seq="no-repeat" className="mt-3 text-sm text-[#adbeaf]">{copy.noRepeat}</p>
            </div>
            <PhoneMock
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

      <section id={overview.anchor} data-scene="6" className="scene scene-light px-6 py-20 lg:px-12">
        <Veil to="dark" />
        <div data-seq="stage" className="relative z-10 mx-auto grid max-w-[1380px] items-center gap-12 lg:grid-cols-2">
          <article data-seq="panel" className="order-2 rounded-3xl border border-[#cbddd2] bg-white p-6 text-[#101b16] shadow-sm lg:p-8">
            <h3 className="text-xl font-bold">{copy.panelTitle}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {copy.tabs.map((tab) => (
                <span key={tab} data-seq="tab" className="rounded-full bg-[#f5f8f5] px-3 py-2 text-sm">
                  {tab}
                </span>
              ))}
            </div>
            <ul className="mt-4 divide-y divide-[#e4eee8]">
              {copy.rows.map((row, index) => (
                <li
                  key={row[0]}
                  data-seq={index === 0 ? "row-active" : "row"}
                  className={`grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] ${
                    index === 0 ? "rounded-2xl bg-[#def5e7] px-3" : ""
                  }`}
                >
                  <span className="font-medium">{row[0]}</span>
                  <span>{row[1]}</span>
                  {row[2] ? <span className="text-[#4f6258] sm:col-span-2">{row[2]}</span> : null}
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
                key={step}
                data-seq="step"
                className="flex min-h-16 items-center gap-4 rounded-2xl border border-white/10 bg-[#14221b]/80 px-4 text-lg text-[#f7fbf8]"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#38dc89] text-sm font-bold text-[#072317]">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
            <li data-seq="notes" className="mt-2 grid gap-2 text-sm text-[#adbeaf]">
              {copy.sectors.map((sector) => (
                <p key={sector.id}>{sector.note}</p>
              ))}
            </li>
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
