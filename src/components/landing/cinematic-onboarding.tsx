"use client";

import Image from "next/image";
import { useState } from "react";
import type { LandingCopy } from "@/lib/landing-copy";
import {
  IconFacebook,
  IconGlobe,
  IconInstagram,
  IconWhatsApp,
} from "@/components/admin/admin-icons";
import styles from "./assistant-setup.module.css";

type PersonaId = "noura" | "lina" | "dana";

const PERSONAS: ReadonlyArray<{
  id: PersonaId;
  src: string;
  alt: string;
}> = [
  { id: "dana", src: "/characters/dana.png", alt: "Dana" },
  { id: "noura", src: "/characters/noor.png", alt: "Noura" },
  { id: "lina", src: "/characters/lina.png", alt: "Lina" },
];

interface CinematicOnboardingProps {
  copy: LandingCopy;
}

export function CinematicOnboarding({ copy }: CinematicOnboardingProps) {
  const [selected, setSelected] = useState<PersonaId>("noura");
  const setup = copy.assistantSetup;
  const scene = copy.scenes.find((item) => item.id === 7)!;
  const characters = copy.onboardingStory.previewUI.characters;
  const active = PERSONAS.find((item) => item.id === selected) ?? PERSONAS[1];
  const activeName =
    selected === "noura" ? characters.noura.name : selected === "lina" ? characters.lina.name : characters.dana.name;

  return (
    <section
      id="setup"
      data-scene="7"
      className={`${styles.root} scene scene-dark relative overflow-hidden px-4 py-16 text-[#f7fbf8] sm:px-6 lg:px-12 lg:py-20`}
      style={{
        background: "linear-gradient(165deg, #07110d 0%, #0c1f17 42%, #08140f 100%)",
      }}
    >
      <div className={`${styles.glowOrb} -start-10 top-10 h-56 w-56`} aria-hidden="true" />
      <div className={`${styles.glowOrb} end-0 bottom-0 h-72 w-72`} aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(56,220,137,0.16) 0%, transparent 42%), radial-gradient(circle at 80% 70%, rgba(24,68,50,0.5) 0%, transparent 48%)",
        }}
      />

      <div data-seq="stage" className="relative z-10 mx-auto grid max-w-[1380px] items-center gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16">
        <div data-seq="setup-copy" className="order-1 min-w-0">
          <div
            data-seq="setup-badge"
            className="inline-flex items-center gap-2 rounded-full border border-[#38dc89]/35 bg-[#38dc89]/10 px-3.5 py-1.5 text-xs font-semibold text-[#9ef0c4]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89]" aria-hidden="true" />
            <span>{setup.badge}</span>
          </div>

          <h2
            data-seq="setup-title"
            className="scene-title mt-4 whitespace-pre-line text-[#f7fbf8]"
          >
            {scene.title}
          </h2>
          <p data-seq="setup-body" className="scene-body mt-4 max-w-[42ch] text-base leading-relaxed text-[#c3d5cb] sm:text-lg">
            {scene.body}
          </p>
          <p className="mt-3 max-w-[48ch] text-xs leading-relaxed text-[#93a79c]">{copy.exampleNote}</p>

          <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2" data-seq="setup-steps">
            {setup.steps.map((step) => (
              <li
                key={step.number}
                data-seq="step"
                className="rounded-2xl border border-white/10 bg-[#0f2119]/70 p-3.5 backdrop-blur-sm sm:p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 text-sm font-bold text-[#38dc89]">
                    {step.number}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#f7fbf8] sm:text-base">{step.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-[#a4b7ab]">{step.body}</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div data-seq="setup-visual" className="order-2 min-w-0">
          <div className="relative mx-auto w-full max-w-[34rem]">
            <div className={styles.stage} data-setup-stage="true">
              <div data-seq="setup-character" className={styles.character}>
                <Image
                  src={active.src}
                  alt={active.alt}
                  width={420}
                  height={560}
                  data-character={active.id}
                  className="drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)]"
                  priority={false}
                />
              </div>

              <div data-seq="setup-phone" className={`${styles.phone} ${styles.phoneGlow}`}>
                <div className="border-b border-white/10 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#38dc89] text-xs font-bold text-[#072317]">
                      V
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[#f7fbf8]">{activeName}</p>
                      <p className="text-[10px] text-[#7d9386]">{copy.illustrative}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 p-3">
                  {setup.chat.map((message, index) => (
                    <p
                      key={`${message.role}-${index}`}
                      data-seq="setup-bubble"
                      className={`${styles.bubble} max-w-[95%] rounded-2xl px-2.5 py-1.5 text-[11px] leading-relaxed ${
                        message.role === "customer"
                          ? "self-end bg-white text-[#101b16]"
                          : "self-start bg-[#1a3a2b] text-[#e7f6ec]"
                      }`}
                    >
                      {message.text}
                    </p>
                  ))}
                </div>
              </div>

              <ul
                className={styles.channels}
                aria-label={copy.locale === "ar" ? "قنوات التواصل" : "Communication channels"}
              >
                {(
                  [
                    ["whatsapp", IconWhatsApp],
                    ["instagram", IconInstagram],
                    ["web", IconGlobe],
                    ["facebook", IconFacebook],
                  ] as const
                ).map(([id, Icon], index) => (
                  <li
                    key={id}
                    data-seq="setup-channel"
                    className={`${styles.floatIcon} inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#38dc89]/35 bg-[#0f2119]/90 text-[#9ef0c4] shadow-[0_8px_20px_rgba(0,0,0,0.35)]`}
                    style={{ animationDelay: `${index * -0.4}s` }}
                  >
                    <Icon className="h-4 w-4" />
                  </li>
                ))}
              </ul>
            </div>

            <ul
              data-seq="setup-personas"
              className="mt-5 grid grid-cols-3 gap-2 sm:gap-3"
              role="list"
            >
              {PERSONAS.map((persona) => {
                const name =
                  persona.id === "noura"
                    ? characters.noura.name
                    : persona.id === "lina"
                      ? characters.lina.name
                      : characters.dana.name;
                const tag = setup.personaTags[persona.id];
                const isSelected = persona.id === selected;
                return (
                  <li key={persona.id}>
                    <button
                      type="button"
                      data-seq="setup-persona"
                      data-persona={persona.id}
                      aria-pressed={isSelected}
                      onClick={() => setSelected(persona.id)}
                      className={`flex w-full flex-col items-center gap-2 rounded-2xl border px-2 py-2.5 text-center transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-[#38dc89]/55 ${
                        isSelected
                          ? "border-[#38dc89]/70 bg-[#142f23]"
                          : "border-white/10 bg-[#0f2119]/55"
                      }`}
                    >
                      <span
                        className={`relative h-12 w-12 overflow-hidden rounded-full border border-white/15 bg-[#0c1813] sm:h-14 sm:w-14 ${
                          isSelected ? styles.selectedRing : ""
                        }`}
                      >
                        <Image
                          src={persona.src}
                          alt=""
                          width={56}
                          height={56}
                          className="h-full w-full object-cover object-top"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-[#f7fbf8] sm:text-sm">
                          {name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-[#93a79c] sm:text-[11px]">
                          {tag}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
