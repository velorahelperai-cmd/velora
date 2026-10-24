"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  active = true,
  homepage = false,
  onFocusPersona,
}: {
  locale: "ar" | "en";
  selectedPersona?: SubscriptionPersona | null;
  /** The homepage owner disables media before leaving its route. */
  active?: boolean;
  homepage?: boolean;
  /** Optional: scroll/focus plan cards without inventing a purchase. */
  onFocusPersona?: (persona: SubscriptionPersona) => void;
}) {
  const c = subscriptionCopy[locale];
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const focusedPersona = selectedPersona ?? "level_1";

  const playback = useRef<{ toggle: () => void; played: () => void; owns: () => boolean }>({ toggle() {}, played() {}, owns: () => false });
  useLayoutEffect(() => {
    const node = video.current;
    if (!node) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let live = true, suspended = false, visible = false, userPaused = false, explicitPlayback = false, epoch = 0;
    const allowed = () => live && active && !suspended && !document.hidden && visible && (!homepage || window.location.pathname === "/");
    const owns = () => allowed() && !userPaused && (!media.matches || explicitPlayback);
    const stop = () => { epoch++; explicitPlayback = false; node.pause(); if (live) setPlaying(false); };
    const start = (explicit = false) => {
      if (!allowed() || userPaused || (media.matches && !explicit)) return;
      explicitPlayback = explicit;
      const request = ++epoch;
      void node.play().then(() => {
        // A reused node may already belong to a newer, valid effect/request.
        if (playback.current !== controller && playback.current.owns()) return;
        if (!owns()) node.pause();
      }).catch(() => { if (live && request === epoch) setPlaying(false); });
    };
    const sync = () => { if (!allowed() || media.matches || userPaused) stop(); else start(); };
    const hide = () => { suspended = true; stop(); };
    const show = () => { suspended = false; sync(); };
    const route = () => { if (homepage) { if (window.location.pathname === "/") show(); else hide(); } };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => { const url = (event as Event & { destination?: { url: string } }).destination?.url; if (homepage && url && new URL(url, window.location.href).pathname !== "/") hide(); };
    const controller = {
      toggle() { if (!node.paused) { userPaused = true; stop(); } else { userPaused = false; start(true); } },
      played() { if (!owns()) node.pause(); else setPlaying(true); },
      owns,
    };
    playback.current = controller;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.15 });
    observer.observe(node);
    media.addEventListener("change", sync); document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("popstate", route); navigation?.addEventListener("navigate", navigate);
    return () => {
      live = false; suspended = true; epoch++;
      observer.disconnect(); media.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("popstate", route); navigation?.removeEventListener("navigate", navigate);
      if (playback.current === controller) playback.current = { toggle() {}, played() {}, owns: () => false };
      node.pause(); node.load();
    };
  }, [active, homepage]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const ready = window.setTimeout(() => setRevealed(true), 0);
      return () => window.clearTimeout(ready);
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
    if (!failed) playback.current.toggle();
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
            onPlay={() => playback.current.played()}
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
          const selected = focusedPersona === persona.id;
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
