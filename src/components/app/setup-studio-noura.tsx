"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./setup-studio.module.css";

const ANIMATED_SRC = "/media/setup/character-short-hair-petrol-alpha.webm";
const POSTER_SRC = "/media/setup/character-short-hair-petrol-alpha-poster.png";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const visible = () => document.visibilityState === "visible";
function subscribeReduced(notify: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
}
function subscribeVisible(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

/** Mounted only while eligible: no hidden video source or player controls. */
function CharacterPlayback({ label, onFailure }: { label: string; onFailure: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("src", ANIMATED_SRC);
    video.load();
    void video.play()?.catch(() => { if (!cancelled) onFailure(); });
    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [onFailure]);
  return <video ref={ref} className={styles.nouraMotion} src={ANIMATED_SRC} poster={POSTER_SRC} autoPlay loop muted playsInline preload="none" controls={false} disablePictureInPicture disableRemotePlayback tabIndex={-1} aria-label={label} data-character-motion="animated" data-playing={playing} onPlaying={() => setPlaying(true)} onEmptied={() => setPlaying(false)} onError={onFailure} />;
}

/** Selected source kept verbatim, separate from scenery and live business summary. */
export function SetupStudioNoura({ ar, motionEnabled }: { ar: boolean; motionEnabled: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeReduced, reduced, () => true);
  const visibleDoc = useSyncExternalStore(subscribeVisible, visible, () => false);
  const [inView, setInView] = useState(true);
  const [criticalDone, setCriticalDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const onFailure = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.2 });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setCriticalDone(true));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, []);

  const animate = motionEnabled && !reducedMotion && visibleDoc && inView && criticalDone && !failed;
  const label = ar ? "دليل إعداد النشاط" : "Business setup guide";
  return (
    <div ref={hostRef} className={styles.nouraStage} data-setup-noura="true">
      {/* Transparent first-frame fallback stays behind the transparent video. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- exact decoded alpha poster */}
      <img
        className={styles.nouraMedia}
        src={POSTER_SRC}
        alt={animate ? "" : label}
        aria-hidden={animate}
        width={784}
        height={1168}
        decoding="async"
        data-character-poster="static"
        data-character-motion={animate ? undefined : "static"}
      />
      {animate ? <CharacterPlayback label={label} onFailure={onFailure} /> : null}
    </div>
  );
}
