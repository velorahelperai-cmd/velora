"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { SubscriptionPersona } from "./subscription-offers-view";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import styles from "./subscription-panel.module.css";

const PERSONA_STRIP: ReadonlyArray<{
  id: SubscriptionPersona;
  image: string;
  alt: string;
}> = [
  { id: "level_3", image: "/characters/dana.png", alt: "Dana" },
  { id: "level_1", image: "/characters/noor.png", alt: "Noura" },
  { id: "level_2", image: "/characters/lina.png", alt: "Lina" },
];

export function SubscriptionBrandGuide({
  locale,
  selectedPersona = null,
  onFocusPersona,
}: {
  locale: "ar" | "en";
  selectedPersona?: SubscriptionPersona | null;
  /** Optional: scroll/focus plan cards without inventing a purchase. */
  onFocusPersona?: (persona: SubscriptionPersona) => void;
}) {
  const c = subscriptionCopy[locale];
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const active = selectedPersona ?? "level_1";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!media.matches) void video.current?.play().catch(() => undefined);
    const onChange = () => {
      if (media.matches) video.current?.pause();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.22, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function togglePlayback() {
    const media = video.current;
    if (!media || failed) return;
    if (playing) media.pause();
    else void media.play().catch(() => undefined);
  }

  return (
    <section
      ref={root}
      className={`${styles.filmHero} ${revealed ? styles.filmHeroIn : ""}`}
      aria-label={locale === "ar" ? "تعرّف على فيلورا" : "Meet Velora"}
      data-revealed={revealed ? "true" : "false"}
    >
      <div className={styles.filmStage}>
        <div className={styles.filmFrame} data-seq="film-frame">
          <video
            ref={video}
            className={styles.heroVideo}
            src="/assets/subscription/velora-intro.mp4"
            poster="/assets/subscription/velora-intro-poster.jpg"
            muted
            loop
            playsInline
            preload="metadata"
            tabIndex={playing ? 0 : -1}
            onClick={togglePlayback}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              togglePlayback();
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
            aria-label={
              locale === "ar"
                ? "فيلم تعريفي لشخصيات فيلورا في المكتب"
                : "Velora characters at work in their office"
            }
          />
          <div className={styles.filmShade} aria-hidden="true" />

          {!failed ? (
            !playing ? (
              <button
                type="button"
                className={styles.filmPlay}
                onClick={togglePlayback}
                aria-label={c.filmPlay}
              >
                <span className={styles.filmPlayIcon} aria-hidden="true">
                  ▶
                </span>
              </button>
            ) : null
          ) : (
            <span className={styles.filmPlayDisabled} role="status">
              {c.filmUnavailable}
            </span>
          )}
        </div>

        <div className={styles.filmCopy}>
          <h3 className={styles.filmHeadline}>
            <span className={styles.filmHeadlineLead}>{c.filmHeadlineLead}</span>
            <span className={styles.filmHeadlineAccent}>{c.filmHeadlineAccent}</span>
          </h3>
          <p>{c.filmBody}</p>
        </div>
      </div>

      <ul className={styles.filmPersonas} aria-label={c.filmPersonasLabel}>
        {PERSONA_STRIP.map((persona) => {
          const tier = subscriptionTiers.find((item) => item.id === persona.id)!;
          const selected = active === persona.id;
          return (
            <li key={persona.id}>
              <button
                type="button"
                data-persona={persona.id}
                data-selected={selected ? "true" : "false"}
                className={styles.filmPersonaCard}
                aria-pressed={selected}
                onClick={() => {
                  onFocusPersona?.(persona.id);
                  document.getElementById("subscription-plans")?.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "auto"
                      : "smooth",
                    block: "start",
                  });
                }}
              >
                <span className={styles.filmPersonaAvatar}>
                  <Image
                    src={persona.image}
                    alt=""
                    width={72}
                    height={72}
                    className={styles.filmPersonaImage}
                  />
                </span>
                <span className={styles.filmPersonaMeta}>
                  <span className={styles.filmPersonaName}>{tier[locale]}</span>
                  <span className={styles.filmPersonaTag}>{c.filmPersonaTags[persona.id]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
