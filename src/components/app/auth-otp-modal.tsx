"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { normalizeEmailCode } from "@/lib/auth/email-code";
import { prefersReducedMotion } from "@/lib/auth/auth-entry-morph";
import { Button, Field, isEmail, useErrorText, type FieldErrorKey } from "@/components/app/ui";

export type AuthOtpPhase = "input" | "diamond" | "orbit" | "radar" | "done";

const CELL_COUNT = 6;

type CellPose = {
  x: number;
  y: number;
  boxRotate: number;
  textRotate: number;
  scale: number;
  opacity: number;
};

function poseFor(phase: AuthOtpPhase, index: number): CellPose {
  const inputX = [-130, -78, -26, 26, 78, 130];
  if (phase === "input") {
    return { x: inputX[index] ?? 0, y: 0, boxRotate: 0, textRotate: 0, scale: 1, opacity: 1 };
  }
  if (phase === "diamond") {
    const spots = [
      { x: -52, y: -48 },
      { x: 52, y: -48 },
      { x: -78, y: 8 },
      { x: 78, y: 8 },
      { x: -52, y: 54 },
      { x: 52, y: 54 },
    ];
    const s = spots[index] ?? { x: 0, y: 0 };
    return { x: s.x, y: s.y, boxRotate: 45, textRotate: -45, scale: 0.96, opacity: 1 };
  }
  if (phase === "orbit") {
    const angle = (Math.PI * 2 * index) / CELL_COUNT - Math.PI / 2;
    return {
      x: Math.cos(angle) * 72,
      y: Math.sin(angle) * 56,
      boxRotate: 135,
      textRotate: -135,
      scale: 0.96,
      opacity: 1,
    };
  }
  // radar / done — collapse toward center
  return { x: 0, y: 0, boxRotate: 225, textRotate: -225, scale: 0.2, opacity: 0 };
}

export function AuthOtpModal({
  open,
  email,
  title,
  body,
  realBody,
  codeLabel,
  codeHint,
  codeFormat,
  verifyLabel,
  resendPrompt,
  resendLabel,
  resendInLabel,
  resentNotice,
  correctEmailLabel,
  correctEmailHint,
  closeLabel,
  busy = false,
  error = null,
  diagnostic = null,
  resent = false,
  cooldown = 0,
  verified = false,
  verifying = false,
  verifyingLabel = "Verifying…",
  verifiedLabel = "Verified & Secured",
  successTitle,
  successBody,
  retrySessionOnly = false,
  onClose,
  onSubmitCode,
  onResend,
  onCorrectEmail,
  onSuccessAnimDone,
}: {
  open: boolean;
  email: string;
  title: string;
  body: string;
  realBody: string;
  codeLabel: string;
  codeHint: string;
  codeFormat: string;
  verifyLabel: string;
  resendPrompt?: string;
  resendLabel: string;
  resendInLabel: string;
  resentNotice: string;
  correctEmailLabel: string;
  correctEmailHint: string;
  loginLabel: string;
  loginHref: string;
  closeLabel: string;
  busy?: boolean;
  error?: string | null;
  diagnostic?: ReactNode;
  resent?: boolean;
  cooldown?: number;
  /** Flip true only after server verifyEmailCode OK — starts success morph. */
  verified?: boolean;
  /** True only for the current real verification request, never resend or a demo timer. */
  verifying?: boolean;
  verifyingLabel?: string;
  verifiedLabel?: string;
  successTitle?: string;
  successBody?: string;
  /** Email code is already consumed; submit rechecks only the admitted session. */
  retrySessionOnly?: boolean;
  onClose: () => void;
  onSubmitCode: (code: string) => void;
  onResend: () => void;
  onCorrectEmail: (email: string) => void;
  onSuccessAnimDone: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const cellRefs = useRef<Array<HTMLInputElement | null>>([]);
  const timersRef = useRef<number[]>([]);
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: CELL_COUNT }, () => ""));
  const [focusIndex, setFocusIndex] = useState(0);
  const [phase, setPhase] = useState<AuthOtpPhase>("input");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [correctEmail, setCorrectEmail] = useState("");
  const [emailError, setEmailError] = useState<FieldErrorKey>();
  const emailErrText = useErrorText(emailError);
  const submittingRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => cellRefs.current[0]?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: Event) {
      const ke = event as globalThis.KeyboardEvent;
      if (ke.key === "Escape") {
        ke.preventDefault();
        if (!verified) onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, phase, verified]);

  const onSuccessAnimDoneRef = useRef(onSuccessAnimDone);

  useEffect(() => {
    onSuccessAnimDoneRef.current = onSuccessAnimDone;
  }, [onSuccessAnimDone]);

  useEffect(() => {
    clearTimers();
    if (!open) return;
    const start = window.setTimeout(() => {
      if (verified) {
        if (prefersReducedMotion()) {
          setPhase("done");
          timersRef.current.push(window.setTimeout(() => onSuccessAnimDoneRef.current(), 120));
          return;
        }
        // The provider result, not an elapsed demo timer, unlocks the success graphic.
        setPhase("radar");
        timersRef.current.push(window.setTimeout(() => setPhase("done"), 900));
        timersRef.current.push(window.setTimeout(() => onSuccessAnimDoneRef.current(), 1200));
        return;
      }
      setPhase("input");
      if (!verifying || prefersReducedMotion()) return;
      timersRef.current.push(window.setTimeout(() => setPhase("diamond"), 280));
      timersRef.current.push(window.setTimeout(() => setPhase("orbit"), 1050));
      // A slow or unknown response stays in this neutral orbit indefinitely.
    }, 0);
    timersRef.current.push(start);
    return () => clearTimers();
  }, [open, verified, verifying, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  function applyDigits(next: string[], startIndex = 0) {
    const capped = next.slice(0, CELL_COUNT);
    while (capped.length < CELL_COUNT) capped.push("");
    setDigits(capped);
    setCodeInvalid(false);
    const filled = capped.findIndex((d) => !d);
    const nextFocus = filled === -1 ? CELL_COUNT - 1 : Math.max(startIndex, filled);
    setFocusIndex(nextFocus);
    window.requestAnimationFrame(() => cellRefs.current[nextFocus]?.focus());
  }

  function onCellChange(index: number, raw: string) {
    if (phase !== "input" || busy || verified) return;
    const cleaned = normalizeEmailCode(raw).replace(/\D/g, "");
    if (cleaned.length > 1) {
      // Paste / OTP autofill into one cell
      const chars = cleaned.slice(0, CELL_COUNT).split("");
      const next = Array.from({ length: CELL_COUNT }, (_, i) => chars[i] ?? "");
      applyDigits(next, Math.min(chars.length, CELL_COUNT - 1));
      return;
    }
    const digit = cleaned.slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setCodeInvalid(false);
    if (digit && index < CELL_COUNT - 1) {
      setFocusIndex(index + 1);
      cellRefs.current[index + 1]?.focus();
    }
  }

  function onCellKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (phase !== "input" || busy || verified) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      if (digits[index]) {
        const next = [...digits];
        next[index] = "";
        setDigits(next);
        return;
      }
      if (index > 0) {
        const next = [...digits];
        next[index - 1] = "";
        setDigits(next);
        setFocusIndex(index - 1);
        cellRefs.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const target = Math.max(0, index - 1);
      setFocusIndex(target);
      cellRefs.current[target]?.focus();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const target = Math.min(CELL_COUNT - 1, index + 1);
      setFocusIndex(target);
      cellRefs.current[target]?.focus();
    }
  }

  function onPaste(event: React.ClipboardEvent) {
    if (phase !== "input" || busy || verified) return;
    const text = normalizeEmailCode(event.clipboardData.getData("text")).replace(/\D/g, "");
    if (!text) return;
    event.preventDefault();
    applyDigits(text.slice(0, CELL_COUNT).split(""));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || verified || submittingRef.current || phase !== "input") return;
    if (retrySessionOnly) { onSubmitCode(""); return; }
    const code = digits.join("");
    if (!/^[0-9]{6}$/.test(code)) {
      setCodeInvalid(true);
      return;
    }
    submittingRef.current = true;
    try {
      onSubmitCode(code);
    } finally {
      submittingRef.current = false;
    }
  }

  if (!open) return null;

  const showRadar = verified && (phase === "radar" || phase === "done");
  const completed = verified && phase === "done";
  const pending = verifying && !verified;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1a24]/35 px-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !verified) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={busy || verifying || undefined}
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-auth-otp-modal="true"
        data-auth-otp-phase={phase}
        className={`relative max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain flex w-full max-w-[24rem] flex-col items-center rounded-[38px] border bg-white px-6 py-6 shadow-[0_30px_80px_rgba(23,45,67,0.16),inset_0_1px_0_rgba(255,255,255,0.85)] sm:max-w-[385px] sm:px-7 sm:py-7 ${
          showRadar
            ? "border-emerald-500/25 shadow-[0_25px_80px_rgba(16,185,129,0.1)]"
            : "border-[#DCE4EB]"
        }`}
      >
        <style>{`
          @media (prefers-reduced-motion: reduce) {
            .auth-otp-tile, .auth-otp-digit, .auth-otp-radar { transition: none !important; animation: none !important; }
          }
        `}</style>
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${
            showRadar ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(16,185,129,0.12),transparent_62%)]" />
          {phase === "radar" || phase === "done"
            ? [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                <span
                  key={deg}
                  className="absolute left-1/2 top-[42%] h-24 w-px origin-bottom bg-gradient-to-t from-emerald-400/40 to-transparent"
                  style={{ transform: `translate(-50%, -100%) rotate(${deg}deg)` }}
                />
              ))
            : null}
        </div>

        <div className="relative z-10 w-full text-center">
          <h2 id={titleId} className="text-[25px] font-bold leading-snug tracking-tight text-[#172D43]">
            {completed ? successTitle ?? title : title}
          </h2>
          <p id={descId} className="mt-1 text-xs leading-5 text-[#536579]">
            {completed ? successBody ?? body : body}
          </p>
          {!completed ? <p className="mt-2 text-[11px] leading-4 text-[#087E8B]">{realBody}</p> : null}
        </div>

        {completed ? (
          <div className="relative z-10 my-10 grid place-items-center" data-auth-otp-success="true" aria-live="polite">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl text-white shadow-[0_12px_40px_rgba(16,185,129,0.35)]">
              ✓
            </span>
          </div>
        ) : (
          <form className="relative z-10 mt-5 w-full" noValidate onSubmit={submit} onPaste={onPaste}>
            {error ? (
              <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            ) : null}
            {diagnostic}
            {resent ? (
              <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {resentNotice}
              </p>
            ) : null}

            <p className="mb-2 text-center text-xs text-[#536579]">{codeLabel}</p>
            <div
              className={`relative mx-auto w-full ${phase === "input" && !pending ? "h-[72px]" : "h-[170px]"}`}
              role="group"
              aria-label={codeLabel}
              data-auth-otp-cells="true"
            >
              {digits.map((digit, index) => {
                const pose = poseFor(phase, index);
                const active = phase === "input" && focusIndex === index;
                return (
                  <div
                    key={index}
                    className={`auth-otp-tile absolute left-1/2 top-1/2 flex h-[56px] w-[48px] items-center justify-center rounded-[16px] bg-[#F0F4F6] sm:w-[52px] ${
                      active
                        ? "border-[1.5px] border-[#E46F51] shadow-[0_0_20px_rgba(228,111,81,0.25)]"
                        : digit
                          ? "border border-[#C8D5DE]"
                          : "border border-[#DCE4EB]"
                    }`}
                    style={{
                      left: phase === "input" ? `${((index + 0.5) * 100) / CELL_COUNT}%` : undefined,
                      width: phase === "input" ? "min(52px, calc(100% / 6 - 4px))" : undefined,
                      height: phase === "input" ? "auto" : undefined,
                      aspectRatio: phase === "input" ? "1" : undefined,
                      minHeight: phase === "input" ? "44px" : undefined,
                      transform: phase === "input" ? "translate3d(-50%, -50%, 0)" : `translate3d(calc(-50% + ${pose.x}px), calc(-50% + ${pose.y}px), 0) rotate(${pose.boxRotate}deg) scale(${pose.scale})`,
                      opacity: pose.opacity,
                      transition:
                        "left 0.68s cubic-bezier(0.22, 1, 0.36, 1), width 0.68s cubic-bezier(0.22, 1, 0.36, 1), transform 0.68s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease, border-color 0.35s ease, box-shadow 0.35s ease",
                    }}
                  >
                    <input
                      ref={(node) => {
                        cellRefs.current[index] = node;
                      }}
                      data-auth-otp-cell={String(index)}
                      type="text"
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      maxLength={phase === "input" ? 6 : 1}
                      pattern="[0-9]*"
                      dir="ltr"
                      aria-label={`${codeLabel} ${index + 1}`}
                      disabled={busy || verifying || verified || retrySessionOnly || phase !== "input"}
                      value={digit}
                      onChange={(event) => onCellChange(index, event.target.value)}
                      onKeyDown={(event) => onCellKeyDown(index, event)}
                      onFocus={() => setFocusIndex(index)}
                      className="auth-otp-digit h-full w-full bg-transparent text-center text-lg font-semibold text-[#172D43] outline-none"
                      style={{ transform: `rotate(${pose.textRotate}deg)`, transition: "transform 0.68s cubic-bezier(0.22, 1, 0.36, 1)", outline: "none", borderRadius: "14px" }}
                    />
                  </div>
                );
              })}
              <div
                className="auth-otp-radar pointer-events-none absolute inset-0 grid place-items-center"
                aria-hidden="true"
                data-auth-otp-confirmed={showRadar ? "true" : undefined}
                style={{ opacity: showRadar ? 1 : 0, transform: completed ? "scale(1.1)" : "scale(1)", transition: "opacity 700ms ease, transform 550ms ease" }}
              >
                <div className="absolute h-[154px] w-[154px] rounded-full border border-emerald-500/25">
                  <span className="absolute left-1/2 top-1/2 h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500/20" />
                  {[0,45,90,135,180,225,270,315].map(deg => <span key={deg} className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-emerald-500/70" style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-77px)` }} />)}
                </div>
                <span className="relative grid h-[62px] w-[62px] place-items-center rounded-[18px] bg-emerald-500 text-white shadow-[0_12px_40px_rgba(16,185,129,0.3)]">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" style={{ strokeDasharray:24, strokeDashoffset:showRadar ? 0 : 24, transition:"stroke-dashoffset 450ms ease 150ms" }} /></svg>
                </span>
              </div>
            </div>
            {phase === "input" && !pending ? codeInvalid ? (
              <p role="alert" className="mt-2 text-center text-xs text-[var(--color-danger-fg)]">
                {codeFormat}
              </p>
            ) : (
              <p className="mt-2 text-center text-[11px] text-[#536579]">{codeHint}</p>
            ) : null}

            {phase === "input" && !pending ? (
              <div className="mt-4 grid gap-2">
                <Button type="submit" variant="entry" busy={busy} busyLabel={verifyLabel} disabled={busy || !email}>
                  {verifyLabel}
                </Button>

              </div>
            ) : null}
          </form>
        )}

        {pending || showRadar ? <p role="status" className="relative z-10 mt-3 min-h-9 text-center text-xs font-semibold text-[#087E8B]" data-auth-otp-pending={pending ? "true" : undefined}>{pending ? verifyingLabel : verifiedLabel}</p> : null}
        {phase === "input" && !pending && !verified ? (
          <div className="relative z-10 mt-4 w-full text-center text-xs text-[#536579]">
            <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
              {resendPrompt ? <span>{resendPrompt}</span> : null}
              <button
                type="button"
                data-auth-otp-resend="true"
                className="min-h-9 font-semibold text-[#087E8B] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-[#087E8B] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !email || cooldown > 0 || verified || retrySessionOnly}
                onClick={() => {
                  if (busy || cooldown > 0 || !email || verified || retrySessionOnly) return;
                  onResend();
                }}
              >
                {cooldown > 0 ? resendInLabel : resendLabel}
              </button>
            </p>
            <details className="mt-2 text-start">
              <summary className="cursor-pointer py-2 text-center text-xs font-medium text-[#536579] focus-visible:outline-2 focus-visible:outline-[#087E8B]">{correctEmailLabel}</summary>
              <p className="mb-2 text-[11px] leading-4 text-[#536579]">{correctEmailHint}</p>
              <Field label={correctEmailLabel} error={emailErrText} tone="entry">
                {(p) => (
                  <input {...p} type="email" dir="ltr" inputMode="email" autoComplete="email"
                    value={correctEmail} disabled={busy || verified || retrySessionOnly}
                    onChange={(event) => { setCorrectEmail(event.target.value); setEmailError(undefined); }} />
                )}
              </Field>
              <button type="button"
                className="mt-2 min-h-11 w-full rounded-xl border border-[#DCE4EB] bg-white px-3 text-xs font-semibold text-[#172D43] hover:bg-[#F0F4F6] focus-visible:outline-2 focus-visible:outline-[#087E8B] disabled:opacity-60"
                disabled={busy || verified || retrySessionOnly}
                onClick={() => {
                  const cleaned = correctEmail.trim().toLowerCase();
                  if (!isEmail(cleaned)) { setEmailError("email"); return; }
                  onCorrectEmail(cleaned);
                }}>
                {correctEmailLabel}
              </button>
            </details>
          </div>
        ) : null}
        {!verified ? (
          <button
            type="button"
            className="absolute end-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full text-lg text-[#536579] hover:bg-[#F0F4F6]"
            aria-label={closeLabel}
            data-auth-otp-close="true"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
