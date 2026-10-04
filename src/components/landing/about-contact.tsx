"use client";

import { useState } from "react";
import type { LandingCopy, PlanId, SectorId } from "@/lib/landing-copy";

export function AboutContact({
  copy,
  sector,
  plan,
  question,
  onSector,
  onQuestion,
}: {
  copy: LandingCopy;
  sector: SectorId;
  plan: PlanId | null;
  question: string;
  onSector: (sector: SectorId) => void;
  onQuestion: (value: string) => void;
}) {
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<"copied" | "manual" | null>(null);
  const [fallback, setFallback] = useState("");

  const planName =
    copy.plans.find((item) => item.id === plan)?.name ?? copy.nonePlan;
  const sectorName =
    copy.sectors.find((item) => item.id === sector)?.label ?? "";

  const requestText = [
    copy.mailSubject,
    `${copy.businessName}: ${name || "-"}`,
    `${copy.sectorField}: ${sectorName}`,
    `${copy.planField}: ${planName}`,
    `${copy.questionField}: ${question}`,
  ].join("\n");

  function openMail() {
    const href = `mailto:${copy.contactEmail}?subject=${encodeURIComponent(copy.mailSubject)}&body=${encodeURIComponent(requestText)}`;
    window.location.href = href;
  }

  async function prepare() {
    setNotice(null);
    setFallback("");
    try {
      await navigator.clipboard.writeText(requestText);
      setNotice("copied");
      openMail();
    } catch {
      setFallback(requestText);
      setNotice("manual");
    }
  }

  return (
    <div className="bg-[#07110d] px-6 py-16 text-[#f7fbf8] lg:px-12">
      <div className="mx-auto grid max-w-[1100px] gap-12 lg:grid-cols-2">
        <section id="about">
          <h2 className="text-3xl font-bold">{copy.aboutTitle}</h2>
          <p className="mt-4 text-lg leading-8 text-[#adbeaf]">{copy.about}</p>
        </section>
        <section id="contact">
          <h2 className="text-3xl font-bold">{copy.contactTitle}</h2>
          <p className="mt-3 text-sm leading-6 text-[#adbeaf]">{copy.noDestination}</p>
          <a
            href={`mailto:${copy.contactEmail}`}
            dir="ltr"
            className="mt-3 inline-flex min-h-11 items-center text-base font-medium text-[#38dc89] underline underline-offset-4"
          >
            {copy.contactEmail}
          </a>
          <div className="mt-2">
            <a
              href={`mailto:${copy.contactEmail}`}
              className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 text-sm text-[#f7fbf8] hover:bg-white/5"
            >
              {copy.emailUs}
            </a>
          </div>
          <form
            className="mt-5 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void prepare();
            }}
          >
            <label className="grid gap-1 text-sm">
              {copy.businessName}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-h-11 rounded-xl border border-white/15 bg-[#14221b] px-3"
              />
            </label>
            <label className="grid gap-1 text-sm">
              {copy.sectorField}
              <select
                value={sector}
                onChange={(event) => onSector(event.target.value as SectorId)}
                className="min-h-11 rounded-xl border border-white/15 bg-[#14221b] px-3"
              >
                {copy.sectors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-[#adbeaf]">
              {copy.planField}: {planName}
            </p>
            <label className="grid gap-1 text-sm">
              {copy.questionField}
              <textarea
                value={question}
                onChange={(event) => onQuestion(event.target.value)}
                rows={3}
                className="rounded-xl border border-white/15 bg-[#14221b] px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#38dc89] px-5 font-medium text-[#072317]"
            >
              {copy.prepare}
            </button>
          </form>
          {notice === "copied" ? (
            <p role="status" className="mt-3 text-sm text-[#38dc89]">
              {copy.copied}
            </p>
          ) : null}
          {notice === "manual" ? (
            <div className="mt-3" role="status">
              <p className="text-sm text-[#d9a467]">{copy.manual}</p>
              <textarea readOnly value={fallback} rows={5} className="mt-2 w-full rounded-xl bg-[#14221b] p-3 text-sm" />
              <a
                href={`mailto:${copy.contactEmail}?subject=${encodeURIComponent(copy.mailSubject)}&body=${encodeURIComponent(fallback)}`}
                className="mt-3 inline-flex min-h-11 items-center text-sm text-[#38dc89] underline"
              >
                {copy.emailUs}
              </a>
            </div>
          ) : null}
        </section>
      </div>
      <section id="privacy" className="mx-auto mt-12 max-w-[1100px] border-t border-white/10 pt-8">
        <h2 className="text-2xl font-bold">{copy.privacyTitle}</h2>
        <p className="mt-3 max-w-[70ch] text-base leading-7 text-[#adbeaf]">{copy.privacy}</p>
      </section>
    </div>
  );
}
