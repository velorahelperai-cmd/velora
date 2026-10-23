"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight full-viewport motion backdrop for auth entry pages.
 * Derived from the owner-approved velora-motion-bg.html canvas, without demo OTP/timers.
 * Pauses when the tab is hidden or prefers-reduced-motion is set.
 */
export function AuthMotionCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let dpr = 1;
    let tick = 0;
    let mx = 0.5;
    let my = 0.5;
    let frame = 0;
    let running = false;

    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.8 + 0.6,
      s: Math.random() * 0.0006 + 0.0002,
      o: Math.random() < 0.3,
    }));

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas!.width = Math.floor(window.innerWidth * dpr);
      height = canvas!.height = Math.floor(window.innerHeight * dpr);
      paintStatic();
    }

    function ribbon(col: string, off: number, amp: number, yb: number, n: number, a: number) {
      for (let k = 0; k < n; k++) {
        ctx!.beginPath();
        for (let i = 0; i <= width; i += 8) {
          const p = i / width;
          const y =
            height * yb +
            Math.sin(p * 3 + tick * 0.6 + off + k * 0.12) * amp * height +
            Math.sin(p * 7 - tick * 0.9 + k * 0.2) * amp * 0.35 * height +
            (my - 0.5) * 4 * k * dpr;
          if (i) ctx!.lineTo(i, y + k * 6 * dpr);
          else ctx!.moveTo(i, y);
        }
        ctx!.strokeStyle = `rgba(${col},${(a - (k / n) * a * 0.9).toFixed(3)})`;
        ctx!.lineWidth = 1.2 * dpr;
        ctx!.stroke();
      }
    }

    function paintStatic() {
      ctx!.fillStyle = "#F4F6F8";
      ctx!.fillRect(0, 0, width, height);
      (
        [
          ["8,126,139", 0.2, 0.25, 0.16],
          ["247,147,30", 0.8, 0.75, 0.14],
          ["23,45,67", 0.6, 0.2, 0.06],
        ] as const
      ).forEach(([c, px, py, a], i) => {
        const cx = width * (px + Math.sin(i) * 0.04);
        const cy = height * (py + Math.cos(i) * 0.04);
        const r = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.4);
        r.addColorStop(0, `rgba(${c},${a})`);
        r.addColorStop(1, `rgba(${c},0)`);
        ctx!.fillStyle = r;
        ctx!.fillRect(0, 0, width, height);
      });
      ribbon("8,126,139", 0, 0.06, 0.3, 10, 0.28);
      ribbon("247,147,30", 2, 0.07, 0.72, 8, 0.3);
    }

    function paintFrame() {
      tick += 0.016;
      ctx!.fillStyle = "#F4F6F8";
      ctx!.fillRect(0, 0, width, height);
      (
        [
          ["8,126,139", 0.2, 0.25, 0.16],
          ["247,147,30", 0.8, 0.75, 0.14],
          ["23,45,67", 0.6, 0.2, 0.06],
        ] as const
      ).forEach(([c, px, py, a], i) => {
        const cx = width * (px + Math.sin(tick * 0.3 + i) * 0.12 + (mx - 0.5) * 0.05);
        const cy = height * (py + Math.cos(tick * 0.25 + i) * 0.1);
        const r = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.4);
        r.addColorStop(0, `rgba(${c},${a})`);
        r.addColorStop(1, `rgba(${c},0)`);
        ctx!.fillStyle = r;
        ctx!.fillRect(0, 0, width, height);
      });
      ribbon("8,126,139", 0, 0.06, 0.3, 18, 0.35);
      ribbon("247,147,30", 2, 0.07, 0.72, 14, 0.4);
      for (const p of particles) {
        p.y -= p.s;
        if (p.y < 0) p.y = 1;
        const px = (p.x + Math.sin(tick + p.y * 10) * 0.01) * width;
        ctx!.beginPath();
        ctx!.arc(px, p.y * height, p.r * dpr, 0, Math.PI * 2);
        ctx!.fillStyle = p.o ? "rgba(247,147,30,.6)" : "rgba(8,126,139,.45)";
        ctx!.fill();
      }
    }

    function stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    function start() {
      if (running || reduced.matches || document.visibilityState === "hidden") {
        paintStatic();
        return;
      }
      running = true;
      const loop = () => {
        if (!running) return;
        paintFrame();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }

    function onPointer(e: PointerEvent) {
      mx = e.clientX / window.innerWidth;
      my = e.clientY / window.innerHeight;
    }

    function onVisibility() {
      stop();
      start();
    }

    function onReduced() {
      stop();
      start();
    }

    resize();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onReduced);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onReduced);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
