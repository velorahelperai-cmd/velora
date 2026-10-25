"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
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
  onSubmitCode: (code: string) => void | Promise<void>;
  onResend: () => void;
  onCorrectEmail: (email: string) => void;
  onSuccessAnimDone: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const cellRefs = useRef<Array<HTMLInputElement | null>>([]);
  const timersRef = useRef<number[]>([]);
  const focusFrameRef = useRef<number | null>(null);
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: CELL_COUNT }, () => ""));
  const [focusIndex, setFocusIndex] = useState(0);
  const [phase, setPhase] = useState<AuthOtpPhase>("input");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [correctEmail, setCorrectEmail] = useState("");
  const [emailError, setEmailError] = useState<FieldErrorKey>();
  const emailErrText = useErrorText(emailError);
  const submittingRef = useRef(false);
  const submissionSequence = useRef(0);
  const lastAutoCode = useRef<string | null>(null);
  const rejectedInput = useRef(false);
  const digitsRef = useRef(digits);
  const restoreInputFocus = useRef(false);
  useEffect(() => {
    lastAutoCode.current = null;
    return () => {
      submissionSequence.current += 1;
      submittingRef.current = false;
      if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    };
  }, [open, email]);

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
  }, [open, email, verified, verifying, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!open) { restoreInputFocus.current = false; return; }
    if (busy || verifying || verified || phase !== "input") {
      restoreInputFocus.current = true;
      return;
    }
    if (!restoreInputFocus.current) return;
    restoreInputFocus.current = false;
    const frame = window.requestAnimationFrame(() => cellRefs.current[focusIndex]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, busy, verifying, verified, phase, focusIndex]);

  function updateDigits(next: string[]) {
    digitsRef.current = next;
    setDigits(next);
  }

  function submitValue(code: string, automatic: boolean) {
    if (!open || !email || busy || verified || submittingRef.current || phase !== "input") return;
    if (automatic && (retrySessionOnly || lastAutoCode.current === code)) return;
    if (!retrySessionOnly && (rejectedInput.current || !/^[0-9]{6}$/.test(code))) { setCodeInvalid(true); return; }
    if (automatic) lastAutoCode.current = code;
    submittingRef.current = true;
    const request = ++submissionSequence.current;
    let pending: void | Promise<void>;
    try { pending = onSubmitCode(code); }
    catch { if (submissionSequence.current === request) submittingRef.current = false; return; }
    // The real caller owns error presentation. Keep Enter/button serialized with auto-submit.
    void Promise.resolve(pending).catch(() => {}).finally(() => {
      if (submissionSequence.current === request) submittingRef.current = false;
    });
  }

  function maybeAutoSubmit(next: string[]) {
    const code = next.join("");
    if (!/^[0-9]{6}$/.test(code)) { lastAutoCode.current = null; return; }
    submitValue(code, true);
  }

  function applyDigits(next: string[], startIndex = 0) {
    if (next.length > CELL_COUNT) { rejectedInput.current = true; setCodeInvalid(true); return; }
    rejectedInput.current = false;
    const capped = [...next];
    while (capped.length < CELL_COUNT) capped.push("");
    updateDigits(capped);
    maybeAutoSubmit(capped);
    setCodeInvalid(false);
    const filled = capped.findIndex((d) => !d);
    const nextFocus = filled === -1 ? CELL_COUNT - 1 : Math.max(startIndex, filled);
    setFocusIndex(nextFocus);
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => cellRefs.current[nextFocus]?.focus());
  }

  function onCellChange(index: number, raw: string) {
    if (phase !== "input" || busy || verified) return;
    const cleaned = normalizeEmailCode(raw).replace(/\D/g, "");
    if (cleaned.length > 1) {
      // Paste / OTP autofill into one cell
      if (cleaned.length > CELL_COUNT) { rejectedInput.current = true; setCodeInvalid(true); return; }
      const chars = cleaned.split("");
      const next = Array.from({ length: CELL_COUNT }, (_, i) => chars[i] ?? "");
      applyDigits(next, Math.min(chars.length, CELL_COUNT - 1));
      return;
    }
    rejectedInput.current = false;
    const digit = cleaned.slice(-1);
    const next = [...digitsRef.current];
    next[index] = digit;
    updateDigits(next);
    maybeAutoSubmit(next);
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
      rejectedInput.current = false;
      setCodeInvalid(false);
      if (digits[index]) {
        const next = [...digitsRef.current];
        next[index] = "";
        updateDigits(next);
        lastAutoCode.current = null;
        return;
      }
      if (index > 0) {
        const next = [...digitsRef.current];
        next[index - 1] = "";
        updateDigits(next);
        lastAutoCode.current = null;
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
    applyDigits(text.split(""));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    submitValue(retrySessionOnly ? "" : digitsRef.current.join(""), false);
  }

  if (!open) return null;

  const showRadar = verified && (phase === "radar" || phase === "done");
  const completed = verified && phase === "done";
  const pending = verifying && !verified;
  const inputActive = phase === "input" && !pending && !verified;

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
          .auth-otp-scene { height: 72px; transition: height 680ms cubic-bezier(.22,1,.36,1); }
          .auth-otp-scene[data-expanded="true"] { height: 170px; }
          .auth-otp-controls { display:grid; transition: grid-template-rows 680ms cubic-bezier(.22,1,.36,1), opacity 150ms cubic-bezier(.22,1,.36,1); }
          @media (prefers-reduced-motion: reduce) {
            .auth-otp-tile, .auth-otp-anchor, .auth-otp-digit, .auth-otp-radar, .auth-otp-scene, .auth-otp-controls { transition: none !important; animation: none !important; }
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
          <h2 id={titleId} className="grid text-[25px] font-bold leading-snug tracking-tight text-[#172D43]">
            <span className="col-start-1 row-start-1" style={{visibility:completed ? "hidden" : undefined}} aria-hidden={completed || undefined}>{title}</span>
            <span className="col-start-1 row-start-1" style={{visibility:completed ? undefined : "hidden"}} aria-hidden={!completed || undefined}>{successTitle ?? title}</span>
          </h2>
          <p id={descId} className="mt-1 grid text-xs leading-5 text-[#536579]">
            <span className="col-start-1 row-start-1" style={{visibility:completed ? "hidden" : undefined}} aria-hidden={completed || undefined}>{body}</span>
            <span className="col-start-1 row-start-1" style={{visibility:completed ? undefined : "hidden"}} aria-hidden={!completed || undefined}>{successBody ?? body}</span>
          </p>
          <p className="mt-2 text-[11px] leading-4 text-[#087E8B]" style={{visibility:completed ? "hidden" : undefined}} aria-hidden={completed || undefined}>{realBody}</p>
        </div>



          <form className="relative z-10 mt-5 w-full" noValidate onSubmit={submit} onPaste={onPaste}>
            {error ? (
              <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            ) : null}
            {resent ? (
              <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {resentNotice}
              </p>
            ) : null}

            <p className="mb-2 text-center text-xs text-[#536579]" style={{visibility:completed ? "hidden" : undefined}} aria-hidden={completed || undefined}>{codeLabel}</p>
            <div
              className="auth-otp-scene relative mx-auto w-full"
              data-expanded={!inputActive}
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
                    className="auth-otp-anchor pointer-events-none absolute inset-0"
                    style={{transform: phase === "input" ? `translate3d(${((index + 0.5) / CELL_COUNT - 0.5) * 100}%, 0, 0)` : `translate3d(${pose.x}px, ${pose.y}px, 0)`, transition:"transform 680ms cubic-bezier(.22,1,.36,1)"}}
                  >
                  <div
                    className={`auth-otp-tile pointer-events-auto absolute left-1/2 top-1/2 flex items-center justify-center rounded-[16px] bg-[#F0F4F6] ${
                      active
                        ? "border-[1.5px] border-[#E46F51] shadow-[0_0_20px_rgba(228,111,81,0.25)]"
                        : digit
                          ? "border border-[#C8D5DE]"
                          : "border border-[#DCE4EB]"
                    }`}
                    style={{
                      width: "min(52px, calc(100% / 6 - 4px))",
                      aspectRatio: "1",
                      minHeight: "44px",
                      transform: `translate3d(-50%, -50%, 0) rotate(${pose.boxRotate}deg) scale(${pose.scale})`,
                      opacity: pose.opacity,
                      transition:
                        "transform 0.68s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s cubic-bezier(.22,1,.36,1), border-color 0.35s ease, box-shadow 0.35s ease",
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
                      maxLength={phase === "input" ? 10 : 1}
                      pattern="[0-9]*"
                      dir="ltr"
                      aria-label={`${codeLabel} ${index + 1}`}
                      disabled={busy || verifying || verified || retrySessionOnly || phase !== "input"}
                      aria-hidden={phase === "radar" || phase === "done" || undefined}
                      value={digit}
                      onChange={(event) => onCellChange(index, event.target.value)}
                      onKeyDown={(event) => onCellKeyDown(index, event)}
                      onFocus={() => setFocusIndex(index)}
                      className="auth-otp-digit h-full w-full bg-transparent text-center text-lg font-semibold text-[#172D43] outline-none"
                      style={{ transform: `rotate(${pose.textRotate}deg)`, transition: "transform 0.68s cubic-bezier(0.22, 1, 0.36, 1)", outline: "none", borderRadius: "14px" }}
                    />
                  </div>
                  </div>
                );
              })}
              <div
                className="auth-otp-radar pointer-events-none absolute inset-0 grid place-items-center"
                aria-hidden="true"
                data-auth-otp-confirmed={showRadar ? "true" : undefined}
                data-auth-otp-success={completed ? "true" : undefined}
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
            <div className="auth-otp-controls" inert={!inputActive} aria-hidden={!inputActive || undefined} style={{gridTemplateRows:inputActive ? "1fr" : "0fr",opacity:inputActive ? 1 : 0}}>
            <div className="min-h-0 overflow-hidden">
            {codeInvalid ? (
              <p role="alert" className="mt-2 text-center text-xs text-[var(--color-danger-fg)]">
                {codeFormat}
              </p>
            ) : (
              <p className="mt-2 text-center text-[11px] text-[#536579]">{codeHint}</p>
            )}

              <div className="mt-4 grid gap-2">
                <Button type="submit" variant="entry" busy={busy} busyLabel={verifyLabel} disabled={busy || !email}>
                  {verifyLabel}
                </Button>

              </div>
            </div>
            </div>
          </form>

        <div className="auth-otp-controls relative z-10 w-full" style={{gridTemplateRows:inputActive ? "0fr" : "1fr"}}><div className="min-h-0 overflow-hidden">
        <p role="status" className="mt-3 min-h-9 text-center text-xs font-semibold text-[#087E8B]" data-auth-otp-pending={pending ? "true" : undefined}>{pending ? verifyingLabel : showRadar ? verifiedLabel : ""}</p>
        </div></div>
          <div className="auth-otp-controls relative z-10 w-full" inert={!inputActive} aria-hidden={!inputActive || undefined} style={{gridTemplateRows:inputActive ? "1fr" : "0fr",opacity:inputActive ? 1 : 0}}>
          <div className="min-h-0 overflow-hidden text-center text-xs text-[#536579]"><div className="mt-4">
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
          </div></div>
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
