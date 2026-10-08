"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./subscription-panel.module.css";

type CharacterName = "velora" | "noor" | "lina" | "dana";

interface CharacterMedia {
  image: string;
  videoMp4?: string;
  poster?: string;
  packedAlpha?: boolean;
}

const characterAssets: Record<CharacterName, CharacterMedia> = {
  noor: {
    image: "/characters/noor.png",
    videoMp4: "/assets/subscription/noor-cutout-bee9fb6a-v2.mp4",
    poster: "/assets/subscription/noor-cutout-bee9fb6a-v2-poster.png",
    packedAlpha: true,
  },
  velora: {
    image: "/characters/velora.png",
  },
  dana: {
    image: "/characters/dana.png",
  },
  lina: {
    image: "/characters/lina.png",
    videoMp4: "/assets/subscription/lina-cutout-23361fb7-v2.mp4",
    poster: "/assets/subscription/lina-cutout-23361fb7-v2-poster.png",
    packedAlpha: true,
  },
};

/**
 * Interactive 3D Depth & Ambient Floating Character stage
 * Features:
 * - Subtle organic vertical floating & breathing animation (cadenced per character).
 * - Interactive 3D Parallax tilt that dynamically follows mouse movement.
 * - Glowing colored aura responsive to cursor position.
 * - Dynamic floor shadow synchronized with the vertical breathing rhythm.
 */
export function SubscriptionCharacter({
  name,
  label,
  locale,
  selected = false,
  size = "staff",
}: {
  name: CharacterName;
  label: string;
  locale: "ar" | "en";
  selected?: boolean;
  size?: "host" | "staff";
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const userPaused = useRef(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const candidate = characterAssets[name];
  const isVideoCandidate = !videoFailed && Boolean(candidate.videoMp4);
  useEffect(() => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!isVideoCandidate || !candidate.packedAlpha || !video || !canvas) return;
    const context = canvas.getContext("2d", {willReadFrequently:true});
    const buffer = document.createElement("canvas"), bufferContext = buffer.getContext("2d", {willReadFrequently:true});
    if (!context || !bufferContext) return;
    let stopped = false, ready = false, animation = 0, lastFrame = -1;
    const draw = () => {
      if (stopped || video.readyState < 2 || !video.videoWidth) return;
      const sourceHeight = video.videoHeight / 2;
      const width = video.videoWidth, height = sourceHeight;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      // Each effect owns a fresh offscreen buffer, even when React reuses an
      // already-sized visible canvas during StrictMode or source changes.
      if (buffer.width !== width || buffer.height !== video.videoHeight) { buffer.width = width; buffer.height = video.videoHeight; }
      // Copy once so foreground and alpha come from the same decoded frame.
      bufferContext.drawImage(video, 0, 0);
      const pixels = bufferContext.getImageData(0, 0, width, height), alpha = bufferContext.getImageData(0, height, width, height).data;
      let opaque = 0;
      for (let i = 3; i < pixels.data.length; i += 4) { pixels.data[i] = alpha[i - 3]; if (pixels.data[i] > 200) opaque++; }
      // Retain the transparent poster/last complete frame while a decoder is
      // warming up; never show a partial head-only alpha plane.
      if (opaque < width * height * 0.25) return;
      context.putImageData(pixels, 0, 0);
      if (!ready) { ready = true; setFrameReady(true); }
    };
    const loop = () => {
      const frame = Math.floor(video.currentTime * 24);
      if (frame !== lastFrame) { lastFrame = frame; draw(); }
      if (stopped || video.paused || video.ended) return;
      // Hidden decoding videos do not present frames to the compositor, so
      // requestVideoFrameCallback may never fire. Render the visible canvas at 24fps.
      animation = requestAnimationFrame(loop);
    };
    const start = () => { cancelAnimationFrame(animation); lastFrame = -1; loop(); };
    video.addEventListener("loadeddata", draw); video.addEventListener("seeked", draw); video.addEventListener("play", start);
    if (video.readyState >= 2) start();
    return () => { stopped = true; cancelAnimationFrame(animation); video.removeEventListener("loadeddata", draw); video.removeEventListener("seeked", draw); video.removeEventListener("play", start); };
  }, [candidate.packedAlpha, isVideoCandidate, name]);
  useEffect(() => {
    const video = videoRef.current, stage = stageRef.current;
    if (!isVideoCandidate || !video || !stage) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden && !motion.matches && !userPaused.current) void video.play().catch(() => {});
      else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, {threshold:0.15});
    observer.observe(stage);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); motion.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); video.pause(); };
  }, [isVideoCandidate, name]);
  useEffect(() => {
    const onAudio = (event: Event) => { if ((event as CustomEvent<string>).detail !== name) setMuted(true); };
    window.addEventListener("velora-character-audio", onAudio);
    return () => window.removeEventListener("velora-character-audio", onAudio);
  }, [name]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const dx = (x - 0.5) * 2; // -1 to +1
    const dy = (y - 0.5) * 2; // -1 to +1

    // 3D Parallax Tilt & Offset
    el.style.setProperty("--tilt-x", `${-dy * 8}deg`);
    el.style.setProperty("--tilt-y", `${dx * 8}deg`);
    el.style.setProperty("--parallax-x", `${dx * 14}px`);
    el.style.setProperty("--parallax-y", `${dy * 9}px`);
    el.style.setProperty("--glow-x", `${x * 100}%`);
    el.style.setProperty("--glow-y", `${y * 100}%`);
    el.style.setProperty("--glow-opacity", "0.9");
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowControls(false);
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--parallax-x", "0px");
    el.style.setProperty("--parallax-y", "0px");
    el.style.setProperty("--glow-opacity", "0");
  }, []);

  return (
    <div
      ref={stageRef}
      className={styles.characterStage}
      data-character={name}
      data-media={isVideoCandidate ? "video" : "image"}
      data-controls={showControls}
      onPointerDown={(event) => { if (event.pointerType === "touch") setShowControls(true); }}
      data-size={size}
      data-selected={selected}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Background ambient halo glow */}
      <span className={styles.characterHalo} aria-hidden="true" />

      {/* Dynamic interactive cursor glare glow */}
      <span className={styles.characterDynamicGlow} aria-hidden="true" />

      {/* Synchronized breathing floor shadow */}
      <span className={styles.characterFloor} aria-hidden="true" />

      {/* 3D Parallax Container */}
      <div className={styles.characterParallaxLayer}>
        {/* Ambient floating & breathing wrapper */}
        <div className={styles.characterFloatWrapper}>
          {isVideoCandidate ? (<>
            <video
              ref={videoRef}
              className={candidate.packedAlpha ? styles.characterPackedVideo : styles.characterVideo}
              loop
              muted={muted}
              playsInline
              preload="metadata"
              poster={candidate.poster ?? candidate.image}
              aria-label={locale === "ar" ? `شخصية ${label}` : `${label} character`}
              onError={() => setVideoFailed(true)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            >
              {candidate.videoMp4 && (
                <source src={candidate.videoMp4} type="video/mp4" />
              )}
              <Image
                className={styles.characterImage}
                src={candidate.image}
                alt={locale === "ar" ? `شخصية ${label}` : `${label} character`}
                width={1024}
                height={1536}
                sizes={
                  size === "host"
                    ? "(max-width: 760px) 280px, 420px"
                    : "(max-width: 760px) 160px, 180px"
                }
                draggable={false}
              />
            </video>
            {candidate.packedAlpha ? <>
              {!frameReady ? <Image className={styles.characterImage} src={candidate.poster ?? candidate.image} alt="" width={640} height={720} draggable={false}/> : null}
              <canvas ref={canvasRef} className={styles.characterCanvas} style={{visibility:frameReady?"visible":"hidden"}} role="img" aria-label={locale === "ar" ? `شخصية ${label} المتحركة` : `${label} animated character`}/>
            </> : null}
          </>) : (
            <Image
              className={styles.characterImage}
              src={candidate.image}
              alt={locale === "ar" ? `شخصية ${label}` : `${label} character`}
              width={1024}
              height={1536}
              sizes={
                size === "host"
                  ? "(max-width: 760px) 280px, 420px"
                  : "(max-width: 760px) 160px, 180px"
              }
              draggable={false}
            />
          )}
        </div>
      </div>
      {isVideoCandidate ? <div className={styles.characterMediaControls}>
        <button type="button" aria-label={locale === "ar" ? (playing ? "إيقاف الفيديو مؤقتًا" : "تشغيل الفيديو") : (playing ? "Pause video" : "Play video")} onClick={(event) => {
          event.stopPropagation(); const video = videoRef.current; if (!video) return;
          if (!video.paused) { userPaused.current = true; video.pause(); } else { userPaused.current = false; void video.play().catch(() => {}); }
        }}>{playing ? "Ⅱ" : "▶"}</button>
        <button type="button" aria-pressed={!muted} aria-label={locale === "ar" ? (muted ? "تشغيل الصوت" : "كتم الصوت") : (muted ? "Enable audio" : "Mute audio")} onClick={(event) => {
          event.stopPropagation(); if (muted) window.dispatchEvent(new CustomEvent("velora-character-audio", {detail:name})); setMuted(!muted);
        }}>{muted ? "♪" : "♫"}</button>
      </div> : null}
    </div>
  );
}
