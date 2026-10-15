"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./subscription-panel.module.css";

type CharacterName = "velora" | "noor" | "lina" | "dana";
const assets: Record<CharacterName, { image: string; video?: string; poster?: string }> = {
  velora: { image: "/characters/velora.png" },
  noor: { image: "/characters/noor.png", video: "/assets/subscription/noura-intro-bcb4f550-portrait.mp4", poster: "/assets/subscription/noura-intro-bcb4f550-portrait-poster.webp" },
  lina: { image: "/characters/lina.png", video: "/assets/subscription/lina-intro-153ef539-portrait.mp4", poster: "/assets/subscription/lina-intro-153ef539-portrait-poster.webp" },
  dana: { image: "/characters/dana.png" },
};

/** Recorded introductions: no provider calls, autoplay or background decoding. */
export function SubscriptionCharacter({ name, label, locale, selected = false, size = "staff" }: {
  name: CharacterName; label: string; locale: "ar" | "en"; selected?: boolean; size?: "host" | "staff";
}) {
  const playbackId = useId(), videoRef = useRef<HTMLVideoElement>(null), stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false), [playError, setPlayError] = useState(false), [muted, setMuted] = useState(false);
  const media = assets[name], hasVideo = !!media.video && !failed, ar = locale === "ar";
  useEffect(() => {
    const video = videoRef.current;
    if (!hasVideo || !video) return;
    const pauseOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== playbackId) video.pause();
    };
    const pauseHidden = () => { if (document.hidden) video.pause(); };
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) video.pause(); }, { threshold: 0.1 });
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("velora-character-play", pauseOther);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      observer.disconnect(); window.removeEventListener("velora-character-play", pauseOther);
      document.removeEventListener("visibilitychange", pauseHidden);
      video.pause();
    };
  }, [hasVideo, playbackId]);
  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    setPlayError(false);
    if (!video.paused) { video.pause(); return; }
    if (video.ended) video.currentTime = 0;
    try { await video.play(); } catch { setPlayError(true); }
  }
  return <div ref={stageRef} className={styles.characterStage} data-character={name} data-media={hasVideo ? "video" : "image"} data-controls="true" data-size={size} data-selected={selected}>
    <div className={styles.characterParallaxLayer}><div className={styles.characterFloatWrapper}>
      {hasVideo ? <video ref={videoRef} className={styles.characterVideo} width={640} height={600} preload="none" playsInline muted={muted}
        poster={media.poster} aria-label={ar ? `التعريف بشخصية ${label}` : `${label} introduction`}
        onPlay={() => { setPlaying(true); setPlayError(false); window.dispatchEvent(new CustomEvent("velora-character-play", { detail: playbackId })); }}
        onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setFailed(true)}>
        <source src={media.video} type="video/mp4" />
        {ar ? `تعرف على ${label} من الوصف الموجود في البطاقة.` : `Meet ${label} in the card description.`}
      </video> : <Image className={styles.characterImage} src={media.image} alt={ar ? `شخصية ${label}` : `${label} character`}
        width={1024} height={1536} sizes={size === "host" ? "(max-width: 760px) 280px, 420px" : "(max-width: 760px) 90vw, 380px"} draggable={false} />}
    </div></div>
    {hasVideo ? <div className={styles.characterMediaControls}><button type="button" onClick={() => void togglePlayback()}
      aria-label={ar ? (playing ? `إيقاف تعريف ${label} مؤقتًا` : `اسمع تعريف ${label}`) : (playing ? `Pause ${label} introduction` : `Play ${label} introduction`)}>
      <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span><span>{ar ? (playing ? "إيقاف مؤقت" : "اسمع التعريف") : (playing ? "Pause" : "Listen")}</span>
    </button><button type="button" aria-pressed={muted} onClick={() => setMuted(value => !value)} aria-label={ar ? (muted ? `تشغيل صوت ${label}` : `كتم صوت ${label}`) : (muted ? `Unmute ${label}` : `Mute ${label}`)}>{ar ? (muted ? "تشغيل الصوت" : "كتم الصوت") : (muted ? "Unmute" : "Mute")}</button></div> : null}
    {playError ? <p role="status">{ar ? "تعذّر تشغيل التعريف. حاول مرة أخرى." : "Could not play the introduction. Try again."}</p> : null}
  </div>;
}
