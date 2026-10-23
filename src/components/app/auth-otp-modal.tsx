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
      { x: -52, y: 64 },
      { x: 52, y: 64 },
    ];
    const s = spots[index] ?? { x: 0, y: 0 };
    return { x: s.x, y: s.y, boxRotate: 45, textRotate: -45, scale: 0.94, opacity: 1 };
  }
  if (phase === "orbit") {
    const angle = (Math.PI * 2 * index) / CELL_COUNT - Math.PI / 2;
    return {
      x: Math.cos(angle) * 88,
      y: Math.sin(angle) * 72,
      boxRotate: 135,
      textRotate: -135,
      scale: 0.92,
      opacity: 1,
    };
  }
  // radar / done — collapse toward center
  return { x: 0, y: 0, boxRotate: 225, textRotate: -225, scale: phase === "done" ? 0.15 : 0.35, opacity: phase === "done" ? 0 : 0.55 };
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
  resendLabel,
  resendInLabel,
  resentNotice,
  correctEmailLabel,
  correctEmailHint,
  loginLabel,
  loginHref,
  closeLabel,
  busy = false,
  error = null,
  diagnostic = null,
  resent = false,
  cooldown = 0,
  verified = false,
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
        if (phase === "input" && !verified) onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, phase, verified]);

  useEffect(() => {
    if (!verified) return;
    clearTimers();
    const start = window.setTimeout(() => {
      if (prefersReducedMotion()) {
        setPhase("done");
        timersRef.current.push(window.setTimeout(() => onSuccessAnimDone(), 120));
        return;
      }
      setPhase("diamond");
      timersRef.current.push(window.setTimeout(() => setPhase("orbit"), 700));
      timersRef.current.push(window.setTimeout(() => setPhase("radar"), 1500));
      timersRef.current.push(
        window.setTimeout(() => {
          setPhase("done");
          onSuccessAnimDone();
        }, 2400),
      );
    }, 0);
    timersRef.current.push(start);
    return () => clearTimers();
  }, [verified, clearTimers, onSuccessAnimDone]);

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

  const showRadar = phase === "radar" || phase === "done";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1a24]/35 px-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && phase === "input" && !verified) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-auth-otp-modal="true"
        data-auth-otp-phase={phase}
        className={`relative flex w-full max-w-[24rem] flex-col items-center justify-between overflow-hidden rounded-[38px] border bg-white px-6 py-8 shadow-[0_30px_80px_rgba(23,45,67,0.16),inset_0_1px_0_rgba(255,255,255,0.85)] sm:max-w-[385px] sm:px-7 sm:py-9 ${
          showRadar
            ? "border-emerald-500/25 shadow-[0_25px_80px_rgba(16,185,129,0.1)]"
            : "border-[#DCE4EB]"
        }`}
      >
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
            {title}
          </h2>
          <p id={descId} className="mt-1 text-xs leading-5 text-[#536579]">
            {body}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-[#087E8B]">{realBody}</p>
        </div>

        {phase === "done" ? (
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
              className="relative mx-auto h-[170px] w-full"
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
                    className={`absolute left-1/2 top-1/2 flex h-[56px] w-[48px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[16px] bg-[#F0F4F6] sm:w-[52px] ${
                      active
                        ? "border-[1.5px] border-[#E46F51] shadow-[0_0_20px_rgba(228,111,81,0.25)]"
                        : digit
                          ? "border border-[#C8D5DE]"
                          : "border border-[#DCE4EB]"
                    }`}
                    style={{
                      transform: `translate3d(calc(-50% + ${pose.x}px), calc(-50% + ${pose.y}px), 0) rotate(${pose.boxRotate}deg) scale(${pose.scale})`,
                      opacity: pose.opacity,
                      transition:
                        "transform 0.68s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease, border-color 0.35s ease, box-shadow 0.35s ease",
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
                      disabled={busy || verified || phase !== "input"}
                      value={digit}
                      onChange={(event) => onCellChange(index, event.target.value)}
                      onKeyDown={(event) => onCellKeyDown(index, event)}
                      onFocus={() => setFocusIndex(index)}
                      className="h-full w-full bg-transparent text-center text-lg font-semibold text-[#172D43] outline-none"
                      style={{ transform: `rotate(${pose.textRotate}deg)` }}
                    />
                  </div>
                );
              })}
            </div>
            {codeInvalid ? (
              <p role="alert" className="mt-2 text-center text-xs text-[var(--color-danger-fg)]">
                {codeFormat}
              </p>
            ) : (
              <p className="mt-2 text-center text-[11px] text-[#536579]">{codeHint}</p>
            )}

            {phase === "input" ? (
              <div className="mt-4 grid gap-2">
                <Button type="submit" variant="entry" busy={busy} busyLabel={verifyLabel} disabled={busy || !email}>
                  {verifyLabel}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="border-[#DCE4EB] bg-white text-[#172D43] hover:bg-[#F0F4F6]"
                  busy={busy}
                  disabled={busy || !email || cooldown > 0}
                  onClick={() => {
                    if (busy || cooldown > 0 || !email) return;
                    onResend();
                  }}
                >
                  {cooldown > 0 ? resendInLabel : resendLabel}
                </Button>
              </div>
            ) : null}
          </form>
        )}

        {phase === "input" ? (
          <div className="relative z-10 mt-5 w-full border-t border-[#E7EEF3] pt-4">
            <p className="text-[11px] leading-4 text-[#536579]">{correctEmailHint}</p>
            <Field label={correctEmailLabel} error={emailErrText} tone="entry">
              {(p) => (
                <input
                  {...p}
                  type="email"
                  dir="ltr"
                  inputMode="email"
                  autoComplete="email"
                  value={correctEmail}
                  disabled={busy}
                  onChange={(event) => {
                    setCorrectEmail(event.target.value);
                    setEmailError(undefined);
                  }}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="secondary"
              className="mt-2 w-full border-[#DCE4EB] bg-white text-[#172D43] hover:bg-[#F0F4F6]"
              disabled={busy}
              onClick={() => {
                const cleaned = correctEmail.trim().toLowerCase();
                if (!isEmail(cleaned)) {
                  setEmailError("email");
                  return;
                }
                onCorrectEmail(cleaned);
              }}
            >
              {correctEmailLabel}
            </Button>
            <a href={loginHref} className="mt-3 block text-center text-xs font-semibold text-[#087E8B] underline">
              {loginLabel}
            </a>
          </div>
        ) : null}
        {phase === "input" ? (
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
