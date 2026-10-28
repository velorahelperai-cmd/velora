"use client";
import { authFlowHref, savePendingSignup, readPendingSignup, clearPendingSignup } from "@/lib/auth/auth-journey";

import {beginDiagnostic} from "@/lib/diagnostics/flow";
import { normalizeEmailCode } from "@/lib/auth/email-code";
import { createRecoveryReceipt } from "@/lib/auth/operation-recovery";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { createContext, Suspense, useContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import { landingCopy } from "@/lib/landing-copy";
import { startOAuth } from "@/lib/auth/browser";
import { safeInternalPath } from "@/lib/auth/safe-next";
import {
  AUTH_ENTRY_MORPH_MS,
  consumeAuthEntryMorph,
  markAuthEntryMorph,
  prefersReducedMotion,
} from "@/lib/auth/auth-entry-morph";
import { acceptStaffInvitation, readStaffInvitation, type StaffInvitationView } from "@/lib/tenancy/staff-invitations";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
import { AuthMotionCanvas } from "@/components/app/auth-motion-canvas";
import { AuthOtpModal } from "@/components/app/auth-otp-modal";
import { rememberVerificationResend, useVerificationCooldown } from "./use-verification-cooldown";
import {
  completeProfileName,
  requestPasswordReset,
  resendVerificationEmail,
  resolvePostAuthPath,
  signUpWithEmail,
  updatePassword,
  verifyEmailCode,
} from "@/lib/tenancy/actions";
import {
  Button, Field, FieldErrorKey, LangSwitch, LinkButton, Notice, PasswordField, PreviewBadge,
  isEmail, useAction, useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

type AuthEntryLock = { busy: boolean; locked: { current: boolean }; run: (fn: () => void | Promise<void>) => Promise<void> };
const AuthEntryContext = createContext<{ lock: AuthEntryLock; changeMode: (href: string) => void; requestEpoch: {current:number} } | null>(null);

function useAuthRequestScope(mode: "login" | "signup", query: string) {
  const shared = useContext(AuthEntryContext);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(() => {
    const epoch = shared?.requestEpoch.current;
    return () => mounted.current && (!shared || (shared.requestEpoch.current === epoch && window.location.pathname === "/"+mode && new URLSearchParams(window.location.search).toString() === query));
  },[shared,mode,query]);
}

const RESEND_COOLDOWN_SEC = 60;
const AUTH_MORPH_OUT_EVENT = "velora-auth-morph-out";

function AuthEntryMorphLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const sharedEntry = useContext(AuthEntryContext);
  return (
    <Link
      href={href}
      prefetch={true}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        if (sharedEntry) { sharedEntry.changeMode(href); return; }
        const stage = event.currentTarget.closest("[data-auth-entry-stage]");
        markAuthEntryMorph(stage ? { height: stage.getBoundingClientRect().height } : undefined);
        if (prefersReducedMotion()) {
          router.push(href);
          return;
        }
        window.dispatchEvent(new CustomEvent(AUTH_MORPH_OUT_EVENT, { detail: { href } }));
      }}
    >
      {children}
    </Link>
  );
}

function AuthTitle({ title }: { title: string }) {
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2) return <>{title}</>;
  const head = parts.slice(0, -1).join(" ");
  const tail = parts[parts.length - 1];
  return (
    <>
      {head}{" "}
      <span className="text-[var(--service-accent)]">{tail}</span>
    </>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.348 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function EntryFieldIcon({ kind }: { kind: "user" | "mail" | "lock" }) {
  const common = "pointer-events-none absolute start-3.5 h-4 w-4 text-[#536579]";
  if (kind === "user") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (kind === "mail") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EntrySubmitArrow() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function AuthEntryHeading({title,body}:{title:string;body?:string}) {
  return <div className="text-center">
                  <h1 tabIndex={-1} data-auth-entry-heading="true" className="text-[25px] font-bold leading-snug tracking-tight text-[#172D43] focus:outline-none">
                    <AuthTitle title={title} />
                  </h1>
                  {body ? <p className="mt-1 text-xs leading-5 text-[#536579]">{body}</p> : null}
                </div>;
}

export function AuthShell({
  title,
  body,
  children,
  footer,
  entry = false,
  /** Non-interactive entry chrome behind the verify OTP modal. */
  entryBackdrop = false,
  onEntryModeChange,
  onEntryInterrupt,
}: {
  title: string;
  body?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Owner-approved motion entry chrome for /login and /signup only. */
  entry?: boolean;
  entryBackdrop?: boolean;
  onEntryModeChange?: (href:string) => void;
  onEntryInterrupt?: () => void;
}) {
  const copy = useAppCopy();
  const embedded = useContext(AuthEntryContext);
  const { locale } = useDemo();
  const router = useRouter();
  const pushRoute = router.push;
  const tagline = landingCopy(locale).tagline;
  const [collapsed, setCollapsed] = useState(false);
  const [contentVisible, setContentVisible] = useState(true);
  const morphTimer = useRef<number | null>(null);
  const morphingOut = useRef(false);
  const navigationStarted = useRef(false);
  const pendingModeHref = useRef<string|null>(null);
  const focusAfterMorph = useRef(false);
  const incomingFrames = useRef<number[]>([]);
  const [incoming, setIncoming] = useState(false);
  const incomingMorph = useRef<ReturnType<typeof consumeAuthEntryMorph> | undefined>(undefined);
  const entryBody = useRef<HTMLDivElement | null>(null);
  const [expandedHeight, setExpandedHeight] = useState<number>();
  const [sourceStageHeight, setSourceStageHeight] = useState<number>();
  const signupTall = /إنشاء|Create|Sign up|حساب/i.test(title);

  useLayoutEffect(() => {
    if (!entry || !entryBody.current) return;
    const body = entryBody.current;
    const measure = () => setExpandedHeight(Math.max(signupTall ? 544 : 448, Math.ceil(body.scrollHeight + 2)));
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(body);
    return () => observer?.disconnect();
  }, [entry, signupTall]);

  useLayoutEffect(() => {
    if (!entry || entryBackdrop || embedded) return;
    const shouldMorphIn = incomingMorph.current ?? consumeAuthEntryMorph();
    incomingMorph.current = shouldMorphIn;
    if (!shouldMorphIn || prefersReducedMotion()) return;
    // Restore the incoming geometry before paint; waiting for an effect would flash the full card.
    if (typeof shouldMorphIn === "object") setSourceStageHeight(shouldMorphIn.height);
    setIncoming(true);
    // Set the incoming pose before paint; give CSS a frame before revealing it.
    setCollapsed(true);
    setContentVisible(false);
    let revealFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => {
        setCollapsed(false);
        morphTimer.current = window.setTimeout(() => {
          incomingMorph.current = false;
          setContentVisible(true);
          setIncoming(false);
        }, AUTH_ENTRY_MORPH_MS - 160);
        incomingFrames.current.push(revealFrame);
      });
    });
    incomingFrames.current.push(frame);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(revealFrame);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
    };
  }, [entry, entryBackdrop, embedded]);

  useLayoutEffect(() => {
    if (!entry || entryBackdrop || embedded) return;
    function clearMotion() {
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
      for (const frame of incomingFrames.current) window.cancelAnimationFrame(frame);
      incomingFrames.current = [];
    }
    function restoreEntry() {
      clearMotion();consumeAuthEntryMorph();incomingMorph.current = false;
      morphingOut.current = false;navigationStarted.current = false;pendingModeHref.current = null;
      focusAfterMorph.current = true;
      onEntryInterrupt?.();
      setCollapsed(false);setContentVisible(true);setIncoming(false);
    }
    if (morphingOut.current) restoreEntry();
    function commit(href:string) {
      navigationStarted.current = true;
      if (onEntryModeChange) onEntryModeChange(href);
      else pushRoute(href, {scroll:false});
    }
    function onMorphOut(event:Event) {
      const href = (event as CustomEvent<{href?:string}>).detail?.href;
      if (!href || morphingOut.current || (onEntryModeChange && !/^\/(login|signup)(?:\?|$)/.test(href))) return;
      clearMotion();morphingOut.current = true;navigationStarted.current = false;pendingModeHref.current = href;
      focusAfterMorph.current = true;
      const measured = entryBody.current?.closest('[data-auth-entry-stage]')?.getBoundingClientRect().height;
      if (measured && measured > 0) setSourceStageHeight(measured);
      if (prefersReducedMotion()) { commit(href);restoreEntry();return; }
      setIncoming(false);setContentVisible(false);setCollapsed(true);
      morphTimer.current = window.setTimeout(() => {
        commit(href);
        if (onEntryModeChange) {
          // Exact reference EC: mode commit at600ms, hold the closed shape80ms, then reopen.
          morphTimer.current = window.setTimeout(() => {
            setCollapsed(false);setContentVisible(true);setIncoming(false);
            morphingOut.current = false;navigationStarted.current = false;pendingModeHref.current = null;
          }, 80);
        }
      }, onEntryModeChange ? 600 : AUTH_ENTRY_MORPH_MS);
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    function onMotionPreference() {
      if (!media.matches || !morphingOut.current) return;
      const href = pendingModeHref.current;
      if (href && !navigationStarted.current) commit(href);
      restoreEntry();
    }
    window.addEventListener(AUTH_MORPH_OUT_EVENT,onMorphOut);
    window.addEventListener('popstate',restoreEntry);window.addEventListener('pageshow',restoreEntry);window.addEventListener('pagehide',restoreEntry);
    media.addEventListener('change',onMotionPreference);
    return () => {
      window.removeEventListener(AUTH_MORPH_OUT_EVENT,onMorphOut);
      window.removeEventListener('popstate',restoreEntry);window.removeEventListener('pageshow',restoreEntry);window.removeEventListener('pagehide',restoreEntry);
      media.removeEventListener('change',onMotionPreference);clearMotion();
      if (morphingOut.current && !navigationStarted.current) consumeAuthEntryMorph();
    };
  },[entry,entryBackdrop,embedded,pushRoute,onEntryModeChange,onEntryInterrupt]);

  useEffect(() => {
    if (!entry || embedded || collapsed || !contentVisible || !focusAfterMorph.current) return;
    const timer = window.setTimeout(() => {
      entryBody.current?.querySelector<HTMLElement>('[data-auth-entry-heading]')?.focus({preventScroll:true});
      focusAfterMorph.current = false;
    },prefersReducedMotion() ? 0 : 150);
    return () => window.clearTimeout(timer);
  },[entry,embedded,collapsed,contentVisible,title]);

  // The shared layout owns the single canvas/card. Route-specific controllers only supply their form/footer.
  if (entry && embedded) return <><AuthEntryHeading title={title} body={body}/><div className="mt-6">{children}</div>{footer ? <div className="mt-5 text-center text-xs text-[#536579]">{footer}</div> : null}</>;

  if (entry) {
    return (
      <main
        className="app-shell relative min-h-svh overflow-x-hidden bg-transparent px-4 py-6 pb-[max(6rem,env(safe-area-inset-bottom))]"
        data-auth-entry-shell="true"
        data-auth-entry-backdrop={entryBackdrop ? "true" : undefined}
      >
        <AuthMotionCanvas />
        <style>{`
          .auth-entry-card {
            transition: width ${AUTH_ENTRY_MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
              height ${AUTH_ENTRY_MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
              min-height ${AUTH_ENTRY_MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
              transform ${AUTH_ENTRY_MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
              border-radius ${AUTH_ENTRY_MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
          }
          .auth-entry-card-body { transition: opacity 300ms ease 150ms, transform 300ms ease 150ms; }
          [data-auth-entry-collapsed="true"] .auth-entry-card-body { transition-duration:150ms; transition-delay:0ms; }
          @media (prefers-reduced-motion: reduce) {
            .auth-entry-card, .auth-entry-card-body, .auth-entry-lock, [data-auth-entry-stage] { transition: none !important; }
          }
        `}</style>
        <div className={`relative z-10 mx-auto flex max-w-[1100px] items-center justify-between gap-2 ${entryBackdrop ? "pointer-events-none select-none" : ""}`}>
          <Link href="/" className="inline-flex min-h-11 min-w-0 items-center gap-2 text-xl font-bold sm:text-2xl" tabIndex={entryBackdrop ? -1 : undefined}>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--service-accent)] text-sm text-white sm:h-9 sm:w-9 sm:text-base">V</span>
            <span className="truncate text-[var(--service-ink)]">{copy.brand}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:inline-flex"><PreviewBadge note /></span>
            <LangSwitch />
          </div>
        </div>
        <div className="relative z-10 mx-auto mt-8 flex max-w-[1100px] flex-col items-center lg:mt-12">
          <p className="mb-4 hidden text-center text-sm text-[var(--service-accent)] sm:block">{tagline}</p>
          <div
            className="relative z-10 flex w-full max-w-[440px] items-center justify-center min-h-[min(560px,70svh)]"
            data-auth-entry-stage="true"
            style={{ height: collapsed && sourceStageHeight ? sourceStageHeight : expandedHeight, transition: incoming && collapsed ? "none" : "height 580ms cubic-bezier(0.22, 1, 0.36, 1)" }}
          >
            <div
              className={`auth-entry-card relative flex flex-col items-center justify-center overflow-hidden border border-[#DCE4EB] bg-[#FFFFFF]/95 shadow-[0_30px_80px_rgba(23,45,67,0.12),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl ${
                collapsed ? "rounded-[34px]" : "rounded-[28px]"
              } ${entryBackdrop ? "pointer-events-none opacity-55" : ""}`}
              data-auth-entry-card="true"
              data-auth-entry-collapsed={collapsed ? "true" : "false"}
              style={{
                transition: incoming && collapsed ? "none" : undefined,
                width: collapsed ? "170px" : "min(100%, 400px)",
                height: collapsed ? "170px" : expandedHeight,
                minHeight: collapsed || expandedHeight ? undefined : signupTall ? "34rem" : "28rem",
                maxWidth: "400px",
                transform: collapsed ? "rotate(-45deg)" : "rotate(0deg)",
              }}
            >
              <div
                className="pointer-events-none absolute start-0 top-0 h-40 w-40 rounded-ss-[28px] border-s-2 border-t-2 border-[#087E8B]/90"
                style={{
                  WebkitMaskImage: "linear-gradient(135deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 65%)",
                  maskImage: "linear-gradient(135deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 65%)",
                }}
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute end-0 bottom-0 h-40 w-40 rounded-ee-[28px] border-e-2 border-b-2 border-[#087E8B]/90"
                style={{
                  WebkitMaskImage: "linear-gradient(-45deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 65%)",
                  maskImage: "linear-gradient(-45deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 65%)",
                }}
                aria-hidden="true"
              />
              <div aria-hidden="true" data-auth-lock-mark="true" className={`auth-entry-lock absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-300 ${collapsed ? "opacity-100 scale-100 delay-100" : "opacity-0 scale-50"}`}>
                <div className="rotate-45 w-14 h-14 rounded-2xl bg-[#F0F4F6] border border-[#B5C9D2] flex items-center justify-center"><div className="w-8 h-[2px] bg-[#087E8B]/30 -rotate-45"/></div>
              </div>
              <div
                ref={entryBody}
                className={`auth-entry-card-body flex shrink-0 flex-col justify-between px-6 py-8 sm:px-7 sm:py-9 ${collapsed ? "opacity-0" : contentVisible ? "opacity-100" : "opacity-0"}`}
                style={{
                  transition: incoming && collapsed ? "none" : undefined,
                  transform: collapsed ? "scale(0.9)" : "scale(1)",
                  width: "min(calc(100vw - 34px), 398px)",
                }}
                {...(entryBackdrop || collapsed ? ({ inert: true } as { inert: boolean }) : {})}
              >
                {!onEntryModeChange ? <AuthEntryHeading title={title} body={body}/> : null}
                <div className={onEntryModeChange ? "flex w-full flex-col justify-between" : "mt-6 flex w-full flex-col justify-between"}>{children}</div>
                {footer ? <div className="mt-5 text-center text-xs text-[#536579]">{footer}</div> : null}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="app-shell relative overflow-x-hidden px-4 py-6 pb-[max(6rem,env(safe-area-inset-bottom))]">
      <div className="relative z-10 mx-auto flex max-w-[1100px] items-center justify-between gap-2">
        <Link href="/" className="inline-flex min-h-11 min-w-0 items-center gap-2 text-xl font-bold sm:text-2xl">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317] sm:h-9 sm:w-9 sm:text-base">V</span>
          <span className="truncate">{copy.brand}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden sm:inline-flex"><PreviewBadge note /></span>
          <LangSwitch />
          <AccountMenu compact />
        </div>
      </div>
      <div className="relative z-10 mx-auto mt-8 grid max-w-[1100px] items-start gap-8 lg:mt-14 lg:grid-cols-[1fr_min(440px,100%)]">
        <div className="hidden lg:block">
          <p className="text-sm text-[var(--color-action-on-dark)]">{tagline}</p>
          <h1 className="scene-title mt-4 text-[var(--color-on-dark)]">{title}</h1>
          {body ? <p className="scene-body mt-4 text-[var(--color-muted-on-dark)]">{body}</p> : null}
        </div>
        <div className="app-panel rounded-3xl p-5 sm:p-6">
          <div className="lg:hidden">
            <h1 className="text-2xl font-bold leading-snug">{title}</h1>
            {body ? <p className="mt-2 text-sm leading-6 text-[var(--color-muted-on-dark)]">{body}</p> : null}
          </div>
          <div className="mt-5 lg:mt-0">{children}</div>
          {footer ? <div className="mt-5 border-t border-[color:var(--color-border-soft)] pt-4 text-sm text-[var(--color-muted-on-dark)]">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}

function authEntryFailure(code: unknown, copy: ReturnType<typeof useAppCopy>, login: boolean) {
  if (code === "INVALID_INPUT") return copy.auth.checkFields;
  if (code === "AUTH_ERROR") return login ? copy.auth.loginRejected : copy.auth.signupRejected;
  return copy.auth.serviceUnavailable;
}

function providerErrorMessage(err: unknown, fallback: string) { void err; return fallback; }

function GoogleAuthButton({
  busy,
  onGoogle,
  notice,
  entry = false,
}: {
  busy?: boolean;
  onGoogle: () => void;
  notice?: string | null;
  entry?: boolean;
}) {
  const copy = useAppCopy();
  return (
    <div className={entry ? "mt-5 grid gap-3" : "mt-6 grid gap-3"}>
      <div
        className={entry ? "flex items-center gap-3 text-xs text-[#536579]" : "flex items-center gap-3 text-xs text-[var(--color-muted-soft)]"}
        role="separator"
      >
        <span className={entry ? "h-px flex-1 bg-[#DCE4EB]" : "h-px flex-1 bg-[var(--color-line)]"} />
        {copy.auth.orContinue}
        <span className={entry ? "h-px flex-1 bg-[#DCE4EB]" : "h-px flex-1 bg-[var(--color-line)]"} />
      </div>
      <Button
        type="button"
        variant="secondary"
        busy={busy}
        busyLabel={copy.loading}
        className={
          entry
            ? "w-full min-h-11 rounded-xl border-[#DCE4EB] bg-white text-xs font-semibold text-[#172D43] shadow-none hover:bg-[#F0F4F6] focus-visible:ring-[#087E8B]"
            : "w-full min-h-12 border-[color:var(--color-border-soft)] shadow-xs"
        }
        onClick={onGoogle}
      >
        <span className="inline-flex items-center gap-2">
          <GoogleMark />
          {copy.auth.withGoogle}
        </span>
      </Button>
      <p className={entry ? "text-center text-[11px] leading-4 text-[#536579]" : "text-center text-xs leading-5 text-[var(--color-muted-soft)]"}>
        {copy.auth.socialNote}
      </p>
      {notice ? <Notice tone="warn">{notice}</Notice> : null}
    </div>
  );
}

function useAuthEntryLock(): AuthEntryLock {
  const shared = useContext(AuthEntryContext);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => void | Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  return shared?.lock ?? { busy, run, locked };
}

function useGoogleAuth(
  setNotice: (v: string | null) => void,
  next: string | null | undefined,
  entryLock: { busy: boolean; run: (fn: () => void | Promise<void>) => Promise<void> },
  captureScope: () => () => boolean,
) {
  const copy = useAppCopy();
  return {
    busy: entryLock.busy,
    onGoogle: () => {
      const current = captureScope();
      setNotice(null);
      void entryLock.run(async () => {
        if (!current()) return;
        try {
          const destination = next != null ? safeInternalPath(next, "/setup") : "/setup";
          await startOAuth("google", destination, current);
        } catch (err) {
          if (current()) setNotice(providerErrorMessage(err, copy.auth.googleUnavailable));
        }
      });
    },
  };
}

function useAuthenticatedAuthRedirect(next:string|null, paused=false, navigate?: (path:string)=>void){
 const session=useOptionalAccountSession(),router=useRouter();
 useEffect(()=>{
  if(paused||session?.status!=="ready"||!session.identity)return;
  let cancelled=false;
  void resolvePostAuthPath(next).then(result=>{if(!cancelled&&result.ok&&!result.data.next.startsWith("/login")){if(navigate)navigate(result.data.next);else router.replace(result.data.next);}}).catch(()=>{});
  return ()=>{cancelled=true;};
 },[session?.status,session?.identity,next,router,paused,navigate]);
}
/** One mounted entry experience; route adapters retain both public deep links. */
function AuthEntryMode({mode}:{mode:"login"|"signup"}) {
  const query = useSearchParams().toString();
  return <div key={mode+":"+query} className="auth-mode-surface" data-auth-entry-mode={mode}>{<AuthEntryForm mode={mode} />}</div>;
}
export function AuthEntryExperience() {
  const mode = usePathname() === "/signup" ? "signup" : "login";
  const copy = useAppCopy();
  const lock = useAuthEntryLock();
  const requestEpoch = useRef(0);
  const commitMode = useCallback((href:string) => { window.history.pushState(null,"",href); },[]);
  const interrupt = useCallback(() => { requestEpoch.current += 1; },[]);
  const changeMode = useCallback((href:string) => {
    if (!/^\/(login|signup)(?:\?|$)/.test(href) || window.location.pathname+window.location.search === href) return;
    requestEpoch.current += 1;
    window.dispatchEvent(new CustomEvent(AUTH_MORPH_OUT_EVENT,{detail:{href}}));
  },[]);
  useEffect(() => { document.title = mode === "signup" ? "Create account · Velora" : "Sign in · Velora"; },[mode]);
  return <div data-auth-entry-host="true">
    <AuthShell entry title={mode === "signup" ? copy.auth.signupTitle : copy.auth.loginTitle} body={mode === "signup" ? copy.auth.signupBody : copy.auth.loginBody} onEntryModeChange={commitMode} onEntryInterrupt={interrupt}>
      <AuthEntryContext.Provider value={{lock,changeMode,requestEpoch}}>
        <Suspense fallback={<div role="status" aria-busy="true" className="min-h-64 text-center text-sm text-[#536579]">{copy.loading}</div>}><AuthEntryMode mode={mode}/></Suspense>
      </AuthEntryContext.Provider>
    </AuthShell>
  </div>;
}

/** Both entry modes share this form, field state, submit controller and visual implementation. */
export function AuthEntryForm({mode}:{mode:"login"|"signup"}) {
  const signup = mode === "signup";
  const copy = useAppCopy();
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = signup ? safeInternalPath(params.get("next"), "") : params.get("next");
  const captureScope = useAuthRequestScope(mode, params.toString());
  const entryLock = useAuthEntryLock();
  const {busy, run} = entryLock;
  const [redirecting, setRedirecting] = useState(false);
  const navigate = useCallback((path:string) => {
    // The newly admitted cookie is read through a fresh protected document.
    setRedirecting(true);
    window.location.replace(path);
  }, []);
  useAuthenticatedAuthRedirect(returnTo, busy || redirecting, navigate);
  const [form, setForm] = useState({name:"", email:signup ? (params.get("email") || "").trim().toLowerCase() : "", password:"", confirm:""});
  const [errors, setErrors] = useState<Partial<Record<"name"|"email"|"password"|"confirm",FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string|null>(() => {
    if (signup) return null;
    const error = params.get("error");
    if (error === "verification_browser") return copy.auth.verificationBrowser;
    if (error === "auth_callback") return copy.errors.authFailed;
    if (error === "oauth_cancelled") return copy.auth.oauthCancelled;
    return null;
  });
  const [continuation, setContinuation] = useState<{email:string;next:string;outcome:"pending"|"uncertain"}|null>(null);
  const [altNotice, setAltNotice] = useState<string|null>(null);
  const google = useGoogleAuth(setAltNotice, returnTo, entryLock, captureScope);
  useUnsavedWarning(signup && !continuation && Boolean(form.name || form.email || form.password || form.confirm) && !busy && !redirecting);
  const nameError = useErrorText(errors.name);
  const emailError = useErrorText(errors.email);
  const passwordError = useErrorText(errors.password);
  const confirmError = useErrorText(errors.confirm);

  function showSignupContinuation(email:string, outcome:"pending"|"uncertain", next=returnTo || "") {
    // A pending journey is browser intent, never evidence of account existence or mail delivery.
    setContinuation({email:email.trim().toLowerCase(),next:safeInternalPath(next,""),outcome});
    setForm(previous=>({...previous,password:"",confirm:""}));
    setFormError(null);setErrors({});
  }

  function submitEmail(event:React.FormEvent) {
    event.preventDefault();
    if (busy || redirecting || entryLock.locked.current) return;
    setFormError(null);
    const normalizedEmail = form.email.trim().toLowerCase();
    const previousJourney = signup && isEmail(normalizedEmail) ? readPendingSignup() : null;
    if (previousJourney?.email === normalizedEmail) {
      showSignupContinuation(normalizedEmail,"pending",returnTo || previousJourney.next);
      return;
    }
    const next:typeof errors = {};
    if (signup && form.name.trim().length < 2) next.name = "required";
    if (!isEmail(form.email)) next.email = "email";
    if (signup ? form.password.length < 8 : !form.password) next.password = signup ? "password" : "required";
    if (signup && form.confirm !== form.password) next.confirm = "match";
    setErrors(next);
    if (Object.keys(next).length) {
      const fields = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>("input"));
      const order = signup ? ["name", "email", "password", "confirm"] as const : ["email", "password"] as const;
      fields[order.findIndex(key => Boolean(next[key]))]?.focus();
      return;
    }
    const current = captureScope();
    const trace = beginDiagnostic(signup ? "auth_signup" : "auth_login");
    let signupAttempted = false;
    void run(async () => {
      if (!current()) { trace.finish("CONFLICT"); return; }
      trace.stage("session");
      const {ensureBrowserContinuity, clearAuthGestureNonce} = await import("@/lib/auth/browser-continuity");
      const continuity = await ensureBrowserContinuity(mode, trace.correlation);
      if (!current()) { trace.finish("CONFLICT"); if (continuity.ok) clearAuthGestureNonce(continuity.requestNonce); return; }
      if (!continuity.ok) {
        trace.finish("UNAVAILABLE");
        setFormError(continuity.code === "CONTINUITY_RECOVERY_REQUIRED" ? copy.errors.continuityRecovery : copy.auth.serviceUnavailable);
        return;
      }
      trace.stage("provider");
      // UI is shared; the two server operations and their security contracts remain distinct.
      if (signup) {
        signupAttempted = true;
        const result = await signUpWithEmail({name:form.name.trim(), email:form.email.trim(), password:form.password, confirmPassword:form.confirm, next:returnTo, requestNonce:continuity.requestNonce, correlation: trace.correlation});
        if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
        if (!current()) { trace.finish("CONFLICT"); return; }
        if (!result.ok) {
          trace.finish(result.diagnostic?.code ?? (result.code === "UNAVAILABLE" ? "UNAVAILABLE" : result.code === "INVALID_INPUT" ? "INVALID_INPUT" : "AUTH_ERROR"));
          if (result.code === "UNAVAILABLE") showSignupContinuation(normalizedEmail,"uncertain");
          else setFormError(authEntryFailure(result.code, copy, false));
          return;
        }
        if (result.data.needsVerification) {
          // Processing completed; this is not proof of a new account or delivered email.
          trace.stage("completed");trace.finish("OK");
          savePendingSignup(result.data.email, returnTo || "");
          void rememberVerificationResend(result.data.email);
          showSignupContinuation(result.data.email,"pending");
          return;
        }
        clearPendingSignup();
        const destination = await resolvePostAuthPath(returnTo, trace.correlation);
        if (!current()) { trace.finish("CONFLICT"); return; }
        if (!destination.ok) { trace.finish("UNAVAILABLE"); setFormError(authEntryFailure(destination.code, copy, false)); return; }
        trace.stage("handoff");trace.finish("OK");
        navigate(destination.data.next);
        return;
      }
      const {signInWithEmail} = await import("@/lib/tenancy/actions");
      const admitted = await signInWithEmail({email:form.email.trim().toLowerCase(), password:form.password, next:returnTo, requestNonce:continuity.requestNonce, correlation: trace.correlation});
      if (admitted.ok || admitted.code === "INVALID_INPUT" || admitted.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
      if (!current()) { trace.finish("CONFLICT"); return; }
      if (!admitted.ok) {
        trace.finish(admitted.diagnostic?.code ?? (admitted.code === "UNAVAILABLE" ? "UNAVAILABLE" : admitted.code === "INVALID_INPUT" ? "INVALID_INPUT" : "AUTH_ERROR"));
        setFormError(authEntryFailure(admitted.code, copy, true));
        return;
      }
      trace?.stage("access");
      const destination = admitted.data?.next ? {ok:true as const, data:{next:admitted.data.next}} : await resolvePostAuthPath(returnTo, trace.correlation);
      if (!current()) { trace.finish("CONFLICT"); return; }
      if (!destination.ok) { trace.finish("UNAVAILABLE"); setFormError(authEntryFailure(destination.code, copy, true)); return; }
      trace?.stage("handoff");trace?.finish("OK");clearPendingSignup();
      navigate(destination.data.next);
    }).catch(() => {
      trace.finish("OUTCOME_UNKNOWN");
      if (!current()) { trace.finish("CONFLICT"); return; }
      if (signupAttempted) showSignupContinuation(normalizedEmail,"uncertain");
      else setFormError(copy.auth.serviceUnavailable);
    });
  }
  return <AuthShell entry title={continuation ? copy.auth.signupNextTitle : signup ? copy.auth.signupTitle : copy.auth.loginTitle} body={continuation ? fill(copy.auth.signupNextBody,{email:continuation.email}) : signup ? copy.auth.signupBody : copy.auth.loginBody}
    footer={continuation ? undefined : <>{signup ? copy.auth.haveAccount : copy.auth.noAccount}{" "}<AuthEntryMorphLink href={authFlowHref(signup ? "/login" : "/signup", returnTo)} className="font-semibold text-[#087E8B] underline">{signup ? copy.auth.login : copy.auth.signup}</AuthEntryMorphLink></>}>
    {continuation ? <div className="space-y-4" data-auth-signup-continuation={continuation.outcome}>
      {continuation.outcome === "uncertain" ? <Notice tone="warn">{copy.auth.signupOutcomeUnknown}</Notice> : null}
      <Button type="button" variant="entry" data-auth-continue-verification onClick={()=>router.replace(authFlowHref("/verify-email",continuation.next,continuation.email))}>{copy.auth.enterVerificationCode}</Button>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
        <AuthEntryMorphLink href={authFlowHref("/login",continuation.next)} className="inline-flex min-h-11 items-center font-semibold text-[#087E8B] underline">{copy.auth.login}</AuthEntryMorphLink>
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center font-medium text-[#087E8B] underline">{copy.auth.forgot}</Link>
      </div>
      {continuation.outcome === "pending" ? <button type="button" data-auth-use-another-email className="mx-auto block min-h-11 text-sm font-medium text-[#37545C] underline" onClick={()=>setContinuation(null)}>{copy.auth.useAnotherEmail}</button> : null}
    </div> : <><form className={signup ? "space-y-3" : "space-y-4"} onSubmit={submitEmail} noValidate data-auth-entry-form={mode}>
      {!signup && params.get("reason") === "session_expired" ? <Notice tone="warn">{copy.errors.sessionExpiredBody}</Notice> : null}
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      {signup ? <Field label={copy.auth.name} required error={nameError} tone="entry">{props => <div className="relative flex items-center"><EntryFieldIcon kind="user"/><input {...props} value={form.name} onChange={event=>setForm({...form,name:event.target.value})} autoComplete="name"/></div>}</Field> : null}
      <Field label={copy.auth.email} required error={emailError} tone="entry">{props => <div className="relative flex items-center"><EntryFieldIcon kind="mail"/><input {...props} type="email" dir="ltr" value={form.email} onChange={event=>setForm({...form,email:event.target.value})} autoComplete="email" inputMode="email"/></div>}</Field>
      <PasswordField tone="entry" label={copy.auth.password} value={form.password} onChange={value=>setForm({...form,password:value})} error={passwordError} hint={signup ? copy.auth.passwordHintReal : undefined} autoComplete={signup ? "new-password" : "current-password"}/>
      {signup ? <PasswordField tone="entry" label={copy.auth.confirmPasswordSignup} value={form.confirm} onChange={value=>setForm({...form,confirm:value})} error={confirmError} autoComplete="new-password"/> : <div className="flex items-center justify-end text-xs"><Link href="/forgot-password" className="font-medium text-[#087E8B]">{copy.auth.forgot}</Link></div>}
      <Button type="submit" variant="entry" busy={busy || redirecting} busyLabel={copy.loading} className={signup ? "mt-1" : undefined}>{signup ? copy.auth.createAccount : copy.auth.login}{!busy && !redirecting ? <EntrySubmitArrow/> : null}</Button>
    </form>
    <GoogleAuthButton entry busy={busy || redirecting || google.busy} onGoogle={google.onGoogle} notice={altNotice}/></>}
  </AuthShell>;
}

/** Compatibility exports have no separate form or transition implementation. */
export function SignupPage() { return <AuthEntryForm mode="signup"/>; }
export function LoginPage() { return <AuthEntryForm mode="login"/>; }

type VerificationBoundary = {
  userId: string | null;
  boundaryFingerprint: string | null;
  status: string;
  /** Lowercased mailbox from live identity when present — never userId alone for renewal. */
  email: string | null;
};
type VerifiedBoundary = { userId: string; boundaryFingerprint: string };
type VerificationCapture = {
  trace: ReturnType<typeof beginDiagnostic>;
  epoch: number;
  /** Journey mailbox captured at start — binds same-user renewal to this verification email. */
  journeyEmail: string;
  baseline: VerificationBoundary | null;
  observed: VerificationBoundary[];
  overflow?: true;
};
type ConfirmedVerification = { capture: VerificationCapture; boundary: VerifiedBoundary; next: string };
/** Exact fence break reason — public copy stays generic; tests assert this code. */
type VerificationFenceReason =
  | "unmounted"
  | "capture_replaced"
  | "epoch_changed"
  | "overflow"
  | "status_locked"
  | "status_expired"
  | "account_switched"
  | "signed_out"
  | "foreign_session"
  | "not_ready";
type VerificationFenceResult = { ok: true; reason: null } | { ok: false; reason: VerificationFenceReason };
function sameVerificationBoundary(a: VerificationBoundary | null, b: VerificationBoundary | null) {
  return a?.userId === b?.userId && a?.boundaryFingerprint === b?.boundaryFingerprint;
}
function matchesVerifiedBoundary(value: VerificationBoundary | null, expected?: VerifiedBoundary) {
  return Boolean(expected && value?.userId === expected.userId && value.boundaryFingerprint === expected.boundaryFingerprint);
}
/**
 * SESSION-001 fence for one observation.
 * Same-user fingerprint renewal requires matching userId AND journey mailbox continuity
 * (live identity email when present, else baseline email). userId alone is never enough.
 * Account switch, logout, locked/expired, and foreign sessions on a guest journey still break.
 */
function observationFenceReason(
  value: VerificationBoundary,
  baseline: VerificationBoundary | null,
  expected: VerifiedBoundary | undefined,
  journeyEmail: string,
): VerificationFenceReason | null {
  if (value.status === "locked") return "status_locked";
  if (value.status === "expired") return "status_expired";
  if (sameVerificationBoundary(value, baseline)) return null;
  if (matchesVerifiedBoundary(value, expected)) return null;
  const mailbox = (value.email || baseline?.email || "").trim().toLowerCase();
  const journey = journeyEmail.trim().toLowerCase();
  const mailboxBound = Boolean(journey) && (!mailbox || mailbox === journey);
  // Same authenticated principal renewing its boundary fingerprint mid-flight.
  if (
    value.userId
    && baseline?.userId
    && value.userId === baseline.userId
    && mailboxBound
    && (value.status === "ready" || value.status === "error" || value.status === baseline.status)
  ) {
    return null;
  }
  // Post-admit expected identity may rotate fingerprint; still require mailbox continuity.
  if (expected?.userId && value.userId === expected.userId && mailboxBound && value.status !== "guest") return null;
  if (baseline?.userId && value.userId && value.userId !== baseline.userId) return "account_switched";
  if (baseline?.userId && !value.userId) return "signed_out";
  if (!baseline?.userId && value.userId && expected && value.userId !== expected.userId) return "account_switched";
  if (!baseline?.userId && value.userId) return "foreign_session";
  return "foreign_session";
}

export function VerifyEmailPage() {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const session = useOptionalAccountSession();
  const params = useSearchParams();
  const [storedReturn, setStoredReturn] = useState("");
  const pendingReturn = safeInternalPath(params.get("next"), "") || storedReturn;
  const emailFromQuery = (params.get("email") || "").trim().toLowerCase();
  const [registeredEmail, setRegisteredEmail] = useState(emailFromQuery);
  const [resent, setResent] = useState(false);


  const [error, setError] = useState<string | null>(null);
  const [fenceReason, setFenceReason] = useState<VerificationFenceReason | null>(null);
  const resendClock = useVerificationCooldown(registeredEmail);
  const cooldown = resendClock.ready ? resendClock.seconds : 1;
  const [hydrated, setHydrated] = useState(Boolean(emailFromQuery));
  const [modalOpen, setModalOpen] = useState(true);
  const [verified, setVerified] = useState(false);
  const [successNext, setSuccessNext] = useState<string | null>(null);
  const [retrySessionOnly, setRetrySessionOnly] = useState(false);
  const [verificationRequest, setVerificationRequest] = useState<{ email: string; next: string; query: string } | null>(null);
  const { busy, run } = useAction();
  const journey = useRef({ mounted: false, epoch: 0 });
  const activeCapture = useRef<VerificationCapture | null>(null);
  const successCapture = useRef<{ capture: VerificationCapture; boundary: VerifiedBoundary } | null>(null);
  const confirmedCapture = useRef<ConfirmedVerification | null>(null);

  useLayoutEffect(() => {
    journey.current = { mounted: true, epoch: journey.current.epoch + 1 };
    activeCapture.current = null;
    successCapture.current = null;
    confirmedCapture.current = null;
    return () => {
      journey.current = { mounted: false, epoch: journey.current.epoch + 1 };
      activeCapture.current = null;
      successCapture.current = null;
      confirmedCapture.current = null;
    };
  }, [emailFromQuery, registeredEmail, pendingReturn]);

  function observe(capture: VerificationCapture) {
    const live = session?.liveSnapshot() ?? null;
    if (live) {
      const email = (session?.identity?.email || "").trim().toLowerCase() || null;
      const row: VerificationBoundary = {
        userId: live.userId,
        boundaryFingerprint: live.boundaryFingerprint,
        status: live.status,
        email,
      };
      const previous = capture.observed.at(-1);
      if (!previous || !sameVerificationBoundary(previous, row) || previous.status !== row.status || previous.email !== row.email) {
        if (capture.observed.length >= 64) capture.overflow = true;
        else capture.observed.push(row);
      }
      return { ...live, email };
    }
    return live;
  }
  useLayoutEffect(() => {
    if (activeCapture.current) observe(activeCapture.current);
  });

  function captureJourney(operation: "auth_verification" | "auth_verification_resend" = "auth_verification"): VerificationCapture {
    const live = session?.liveSnapshot() ?? null;
    const email = (session?.identity?.email || "").trim().toLowerCase() || null;
    const baseline: VerificationBoundary | null = live
      ? { userId: live.userId, boundaryFingerprint: live.boundaryFingerprint, status: live.status, email }
      : null;
    const capture: VerificationCapture = {
      trace: beginDiagnostic(operation),
      epoch: journey.current.epoch,
      journeyEmail: registeredEmail.trim().toLowerCase(),
      baseline,
      observed: baseline ? [{ ...baseline }] : [],
    };
    capture.trace.stage("session");
    activeCapture.current = capture;
    return capture;
  }
  function evaluateCurrent(capture: VerificationCapture, expected?: VerifiedBoundary, requireVerified = false): VerificationFenceResult {
    const live = observe(capture);
    if (!journey.current.mounted) return { ok: false, reason: "unmounted" };
    if (activeCapture.current !== capture) return { ok: false, reason: "capture_replaced" };
    if (journey.current.epoch !== capture.epoch) return { ok: false, reason: "epoch_changed" };
    if (capture.overflow) return { ok: false, reason: "overflow" };
    for (const value of capture.observed) {
      const reason = observationFenceReason(value, capture.baseline, expected, capture.journeyEmail);
      if (reason) return { ok: false, reason };
    }
    if (requireVerified && session) {
      if (live?.ready && live.status === "ready" && matchesVerifiedBoundary(live, expected)) return { ok: true, reason: null };
      if (live?.userId && expected && live.userId !== expected.userId) return { ok: false, reason: "account_switched" };
      if (live && (live.status === "locked" || live.status === "expired")) {
        return { ok: false, reason: live.status === "locked" ? "status_locked" : "status_expired" };
      }
      return { ok: false, reason: "not_ready" };
    }
    return { ok: true, reason: null };
  }
  function reportInterrupted(capture: VerificationCapture, reason: VerificationFenceReason, resend = false) {
    capture.trace.event("session", "CONFLICT");
    // A stale response must never write into a different email journey or unmounted page.
    if (!journey.current.mounted || activeCapture.current !== capture || journey.current.epoch !== capture.epoch) return;
    successCapture.current = null;
    confirmedCapture.current = null;
    setVerified(false);
    setSuccessNext(null);
    setRetrySessionOnly(false);
    setFenceReason(reason);
    setError(copy.auth.verificationContextChanged);
    capture.trace.event("session", "UNAVAILABLE");
    void resend;
  }
  function clearVerifyError() {
    setFenceReason(null);
    setError(null);
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        setStoredReturn(readPendingSignup()?.next ?? "");
        setRetrySessionOnly(false);
        if (emailFromQuery) {
          setRegisteredEmail(emailFromQuery);
          setHydrated(true);
          return;
        }
        try {
          const { getAccountProfile } = await import("@/lib/tenancy/actions");
          const profile = await getAccountProfile();
          setRegisteredEmail((profile.ok ? profile.data.email : readPendingSignup()?.email ?? "").toLowerCase());
        } catch {
          setRegisteredEmail(readPendingSignup()?.email ?? "");
        } finally {
          setHydrated(true);
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [emailFromQuery]);



  function verificationMessage(message?: string, fallback = copy.auth.verificationUnavailable) {
    if (message === "verification_code_invalid") return copy.auth.verificationCodeInvalid;
    if (message === "verification_rate_limited") return copy.auth.verificationRateLimited;
    if (message === "verification_incomplete") return copy.auth.verificationIncomplete;
    if (message === "verification_confirmed_session_unavailable") return locale === "ar" ? "تأكد بريدك، لكن تعذر إنشاء الجلسة. سجّل الدخول مجددًا للمتابعة." : "Your email is confirmed, but the session could not be created. Sign in again to continue.";
    return fallback;
  }

  async function finishVerification(confirmed: ConfirmedVerification) {
    const { capture, boundary } = confirmed;
    try {
      capture.trace.stage("refresh");
      await session?.refresh(capture.trace.correlation);
    } catch {
      capture.trace.event("refresh", "OUTCOME_UNKNOWN");
      const gate = evaluateCurrent(capture, boundary);
      if (gate.ok) {
        setFenceReason(null);
        setRetrySessionOnly(true);
        setError(copy.auth.verificationSessionUnavailable);
      } else reportInterrupted(capture, gate.reason);
      return;
    }
    const afterRefresh = evaluateCurrent(capture, boundary);
    if (!afterRefresh.ok) { reportInterrupted(capture, afterRefresh.reason); return; }
    // refresh() resolves on transport failure too. Identity alone is not READY.
    const ready = evaluateCurrent(capture, boundary, true);
    if (!ready.ok) {
      if (ready.reason === "account_switched" || ready.reason === "signed_out" || ready.reason === "foreign_session" || ready.reason === "status_locked" || ready.reason === "status_expired") {
        reportInterrupted(capture, ready.reason);
        return;
      }
      capture.trace.event("refresh", "REFRESH_FAILED");
      setFenceReason(null);
      setRetrySessionOnly(true);
      setError(copy.auth.verificationSessionUnavailable);
      return;
    }
    capture.trace.event("refresh", "OK");
    clearPendingSignup();
    successCapture.current = { capture, boundary };
    setFenceReason(null);
    setRetrySessionOnly(false);
    setSuccessNext(confirmed.next);
    setVerified(true);
  }

  function submitCode(code: string) {
    if (busy || !hydrated || !registeredEmail || verified) return;
    const confirmed = confirmedCapture.current;
    if (confirmed) {
      const gate = evaluateCurrent(confirmed.capture, confirmed.boundary);
      if (!gate.ok) { reportInterrupted(confirmed.capture, gate.reason); return; }
      clearVerifyError();
      return run(() => finishVerification(confirmed));
    }
    clearVerifyError();

    setResent(false);
    const normalized = normalizeEmailCode(code);
    if (!/^[0-9]{6}$/.test(normalized)) {
      setFenceReason(null);
      setError(copy.auth.verificationCodeFormat);
      return;
    }
    const capture = captureJourney();
    const journeyEmail = registeredEmail;
    const journeyNext = pendingReturn;
    return run(async () => {
      setVerificationRequest({ email: journeyEmail, next: journeyNext, query: emailFromQuery });
      try {
        // Fence before continuity/provider: locked/expired/foreign never reach verifyEmailCode.
        const beforeContinuity = evaluateCurrent(capture);
        if (!beforeContinuity.ok) { reportInterrupted(capture, beforeContinuity.reason); return; }
        const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
        const continuity = await ensureBrowserContinuity("verify_email", capture.trace.correlation);
        const afterContinuity = evaluateCurrent(capture);
        if (!afterContinuity.ok) { reportInterrupted(capture, afterContinuity.reason); return; }
        if (!continuity.ok) {
          capture.trace.finish("UNAVAILABLE");
          setFenceReason(null);
          setError(
            continuity.code === "CONTINUITY_RECOVERY_REQUIRED"
              ? copy.errors.continuityRecovery
              : copy.auth.verificationUnavailable,
          );
          return;
        }
        capture.trace.stage("provider");
        const result = await verifyEmailCode({
          email: journeyEmail,
          code: normalized,
          correlation: capture.trace.correlation,
          next: journeyNext,
          requestNonce: continuity.requestNonce,
        });
        const boundary = result.ok ? result.data : undefined;
        const afterProvider = evaluateCurrent(capture, boundary);
        if (!afterProvider.ok) { reportInterrupted(capture, afterProvider.reason); return; }
        if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR") {
          clearAuthGestureNonce(continuity.requestNonce);
        }

        if (!result.ok) {
          capture.trace.finish(result.diagnostic?.code ?? (result.code === "UNAVAILABLE" ? "UNAVAILABLE" : result.code === "INVALID_INPUT" ? "INVALID_INPUT" : "AUTH_ERROR"));
          setFenceReason(null);
          setError(result.code === "INVALID_INPUT" ? copy.auth.verificationCodeFormat : verificationMessage(result.message));
          return;
        }
        capture.trace.event("provider", "OK");
        const confirmed = { capture, boundary: result.data, next: result.data.next };
        confirmedCapture.current = confirmed;
        await finishVerification(confirmed);
      } catch {
        capture.trace.finish("OUTCOME_UNKNOWN");
        const gate = evaluateCurrent(capture);
        if (!gate.ok) { reportInterrupted(capture, gate.reason); return; }
        setFenceReason(null);
        setError(copy.auth.verificationUnavailable);
      } finally {
        // Presentation only: run() serializes this operation; server result fences above stay authoritative.
        if (journey.current.mounted) setVerificationRequest(null);
      }
    });
  }

  if (hydrated && !registeredEmail.trim()) {
    return <AuthShell entry title={copy.auth.verifyTitle} body={locale === "ar" ? "ابدأ التسجيل أو سجّل الدخول لتأكيد بريدك الإلكتروني." : "Sign up or sign in to confirm your email address."}>
      <div className="grid gap-3">
        <LinkButton href={authFlowHref("/signup", pendingReturn)}>{locale === "ar" ? "إنشاء حساب" : "Create account"}</LinkButton>
        <LinkButton href={authFlowHref("/login", pendingReturn)} variant="secondary">{copy.auth.login}</LinkButton>
      </div>
    </AuthShell>;
  }

  return (
    <>
      <AuthShell
        entry
        entryBackdrop={modalOpen && hydrated && Boolean(registeredEmail)}
        title={copy.auth.verifyTitle}
        body={fill(copy.auth.verifyBody, { email: registeredEmail || "…" })}

      >
        <p className="text-center text-xs leading-5 text-[#536579]">{copy.auth.verifyRealBody}</p>
        {!modalOpen ? (
          <div className="mt-4 grid gap-2">
            <Button type="button" variant="entry" onClick={() => setModalOpen(true)}>
              {copy.auth.verifyCode}
            </Button>
            <Link href={authFlowHref("/login", pendingReturn)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#DCE4EB] bg-white px-4 text-xs font-semibold text-[#172D43] hover:bg-[#F0F4F6] focus-visible:outline-2 focus-visible:outline-[#087E8B]">
              {copy.auth.login}
            </Link>
          </div>
        ) : null}
      </AuthShell>

      <AuthOtpModal
        open={modalOpen && hydrated && Boolean(registeredEmail)}
        email={registeredEmail}
        title={copy.auth.verifyTitle}
        body={fill(copy.auth.verifyBody, { email: registeredEmail || "…" })}
        realBody={copy.auth.verifyRealBody}
        codeLabel={copy.auth.verificationCodeLabel}
        codeHint={copy.auth.verificationCodeHint}
        codeFormat={copy.auth.verificationCodeFormat}
        verifyLabel={retrySessionOnly ? copy.auth.verificationSessionRetry : copy.auth.verifyCode}
        retrySessionOnly={retrySessionOnly}
        resendPrompt={copy.auth.didntReceiveCode}
        resendLabel={copy.auth.resendShort}
        resendInLabel={fill(copy.auth.resendIn, { n: cooldown })}
        resentNotice={copy.auth.resent}
        correctEmailLabel={copy.auth.correctEmail}
        correctEmailHint={copy.auth.correctEmailHint}
        loginLabel={copy.auth.login}
        loginHref={authFlowHref("/login", pendingReturn)}
        closeLabel={copy.close}
        busy={busy}
        error={error && fenceReason ? `${error} (${fenceReason.toUpperCase()})` : error}

        resent={resent}
        cooldown={cooldown}
        verified={verified}
        verifying={busy && verificationRequest?.email === registeredEmail && verificationRequest.next === pendingReturn && verificationRequest.query === emailFromQuery}
        verifyingLabel={copy.auth.verificationPending}
        verifiedLabel={copy.auth.verificationSecured}
        successTitle={copy.auth.verifiedTitle}
        successBody={copy.auth.verifiedBody}
        onClose={() => {
          if (verified) return;
          setModalOpen(false);
        }}
        onSubmitCode={submitCode}
        onResend={() => {
          if (busy || cooldown > 0 || !registeredEmail || verified || retrySessionOnly) return;
          const capture = captureJourney("auth_verification_resend");
          clearVerifyError();
          setResent(false);
          void run(async () => {
            try {
              // Fence before continuity/provider so locked/expired/foreign never touch the mail provider.
              const beforeContinuity = evaluateCurrent(capture);
              if (!beforeContinuity.ok) { reportInterrupted(capture, beforeContinuity.reason, true); return; }
              const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
              // Fresh gesture every click so a spent PKCE intent cannot block Auth `/resend`.
              const continuity = await ensureBrowserContinuity("verification_resend", capture.trace.correlation, { freshGesture: true });
              const afterContinuity = evaluateCurrent(capture);
              if (!afterContinuity.ok) { reportInterrupted(capture, afterContinuity.reason, true); return; }
              if (!continuity.ok) { capture.trace.finish("UNAVAILABLE"); setFenceReason(null); setError(copy.auth.verificationResendUnavailable); return; }
              // Soft claim only — durable wait starts after provider acceptance or provider rate-limit.
              if (!await resendClock.reserve()) {
                capture.trace.finish("CONFLICT");
                setFenceReason(null);
                // Active advisory wait (e.g. after signup acceptance) — not Auth acceptance of this click.
                if (resendClock.seconds > 0) setError(copy.auth.verificationRateLimited);
                return;
              }
              const afterReserve = evaluateCurrent(capture);
              if (!afterReserve.ok) { resendClock.release(); reportInterrupted(capture, afterReserve.reason, true); return; }
              capture.trace.stage("provider");
              const result = await resendVerificationEmail(registeredEmail, pendingReturn, continuity.requestNonce, capture.trace.correlation);
              const afterResend = evaluateCurrent(capture);
              const rateLimited = !result.ok && result.message === "verification_rate_limited";
              const retryAfter = rateLimited && result.data && typeof result.data.retryAfterSeconds === "number"
                ? result.data.retryAfterSeconds
                : undefined;
              // Provider acceptance (ok or rate_limit) commits the advisory wait even if the UI journey fences after the reply.
              const providerAcceptedWait = result.ok || rateLimited;
              if (!afterResend.ok) {
                if (providerAcceptedWait) resendClock.extend(retryAfter);
                else resendClock.release();
                reportInterrupted(capture, afterResend.reason, true);
                return;
              }
              if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR" || (!result.ok && result.message === "verification_gesture_spent")) {
                clearAuthGestureNonce(continuity.requestNonce);
              }

              if (!result.ok) {
                capture.trace.finish(result.diagnostic?.code ?? (result.code === "UNAVAILABLE" ? "UNAVAILABLE" : result.code === "INVALID_INPUT" ? "INVALID_INPUT" : "AUTH_ERROR"));
                setFenceReason(null);
                setError(verificationMessage(result.message, copy.auth.verificationResendUnavailable));
                // Rate limit is a wait, not send success — never setResent.
                if (rateLimited) resendClock.extend(retryAfter);
                else resendClock.release();
                return;
              }
              // Accepted by Auth/mail path — not proof the inbox received the message.
              capture.trace.finish("OK");
              setResent(true);
              resendClock.extend();
            } catch {
              capture.trace.finish("OUTCOME_UNKNOWN");
              resendClock.release();
              const gate = evaluateCurrent(capture);
              if (!gate.ok) { reportInterrupted(capture, gate.reason, true); return; }
              setFenceReason(null);
              setError(copy.auth.verificationResendUnavailable);
            }
          });
        }}
        onCorrectEmail={(cleaned) => {
          router.push(authFlowHref("/signup", pendingReturn, cleaned));
        }}
        onSuccessAnimDone={() => {
          const success = successCapture.current;
          if (!successNext || !success) return;
          const gate = evaluateCurrent(success.capture, success.boundary);
          if (!gate.ok) { reportInterrupted(success.capture, gate.reason); return; }
          const ready = evaluateCurrent(success.capture, success.boundary, true);
          if (!ready.ok) {
            if (ready.reason === "account_switched" || ready.reason === "signed_out" || ready.reason === "foreign_session" || ready.reason === "status_locked" || ready.reason === "status_expired") {
              reportInterrupted(success.capture, ready.reason);
              return;
            }
            success.capture.trace.event("refresh", "REFRESH_FAILED");
            // Verification already succeeded. Recover the same session without replaying the consumed code.
            successCapture.current = null;
            setFenceReason(null);
            setVerified(false);
            setRetrySessionOnly(true);
            setError(copy.auth.verificationSessionUnavailable);
            return;
          }
          success.capture.trace.stage("handoff");success.capture.trace.finish("OK");
          router.replace(successNext);
          router.refresh();
        }}
      />
      {fenceReason ? <span hidden data-auth-verify-fence={fenceReason} /> : null}
    </>
  );
}

async function requestBoundPasswordReset(email: string) {
 const {ensureBrowserContinuity,clearAuthGestureNonce}=await import("@/lib/auth/browser-continuity");
 const continuity=await ensureBrowserContinuity("password_reset");
 if(!continuity.ok)return {ok:false} as const;
 const result=await requestPasswordReset(email,continuity.requestNonce);
 if(result.ok)clearAuthGestureNonce(continuity.requestNonce);
 return result;
}

export function ForgotPasswordPage() {
  const copy = useAppCopy();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<FieldErrorKey>();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const { busy, run } = useAction();
  const emailError = useErrorText(error);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  return (
    <AuthShell title={copy.auth.forgotTitle} body={copy.auth.forgotBody} footer={<Link href="/login" className="font-semibold text-[var(--color-action-on-dark)] underline">{copy.auth.login}</Link>}>
      <div className="mb-4">
        <Notice tone="info">{copy.auth.googleOnlyNote}</Notice>
      </div>
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      {sent ? (
        <div className="grid gap-4">
          {!formError ? <Notice tone="success">{copy.auth.resetPrepared}</Notice> : null}
          <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.auth.resetResendHint}</p>
          <Button
            type="button"
            variant="secondary"
            busy={busy}
            busyLabel={copy.loading}
            disabled={busy || cooldown > 0}
            onClick={() => {
              if (busy || !isEmail(email) || cooldown > 0) return;
              setFormError(null);
              void run(async () => {
                const result = await requestBoundPasswordReset(email);
                if (!result.ok) { setFormError(copy.errors.authFailed); return; }
                setCooldown(RESEND_COOLDOWN_SEC);
              }).catch(() => setFormError(copy.errors.authFailed));
            }}
          >
            {cooldown > 0 ? fill(copy.auth.resendIn, { n: cooldown }) : copy.auth.sendReset}
          </Button>
          <LinkButton href="/login" variant="secondary">{copy.auth.login}</LinkButton>
        </div>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (!isEmail(email)) { setError("email"); return; }
            setError(undefined);
            setFormError(null);
            void run(async () => {
              const result = await requestBoundPasswordReset(email);
              if (!result.ok) { setFormError(copy.errors.authFailed); return; }
              setSent(true);
              setCooldown(RESEND_COOLDOWN_SEC);
            }).catch(() => setFormError(copy.errors.authFailed));
          }}
        >
          <Field label={copy.auth.email} required error={emailError}>
            {(p) => <input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />}
          </Field>
          <Button type="submit" busy={busy} busyLabel={copy.loading} className="w-full">{copy.auth.sendReset}</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function CompleteProfilePage() {
  const copy = useAppCopy();
  const router = useRouter();
  const params=useSearchParams();
  const session = useOptionalAccountSession();
  const { busy, run } = useAction();
  const currentUserId = session?.status === "ready" ? session.identity?.userId ?? null : null;
  const [nameOwner, setNameOwner] = useState(currentUserId);
  const [name, setName] = useState("");
  const [error, setError] = useState<FieldErrorKey>();
  const [formError, setFormError] = useState<string | null>(null);
  const nameError = useErrorText(error);
  const isCurrentProfileUser = session?.isCurrentUser;
  if (nameOwner !== currentUserId) {
    setNameOwner(currentUserId); setName(""); setError(undefined); setFormError(null);
  }

  useEffect(() => {
    if (!nameOwner || !isCurrentProfileUser) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const { getAccountProfile } = await import("@/lib/tenancy/actions");
          const profile = await getAccountProfile();
          if (cancelled || !isCurrentProfileUser(nameOwner) || !profile.ok || profile.data.userId !== nameOwner) return;
          const meta = String(profile.data.fullName || "").trim();
          if (meta) setName(meta);
        } catch {
          /* ignore */
        }
      })();
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [nameOwner, isCurrentProfileUser]);

  return (
    <AuthShell title={copy.auth.completeProfileTitle} body={copy.auth.completeProfileBody}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const expectedUserId = session?.identity?.userId;
          if (busy || session?.status !== "ready" || !expectedUserId || !session.isCurrentUser(expectedUserId)) return;
          setFormError(null);
          if (name.trim().length < 2) {
            setError("required");
            return;
          }
          setError(undefined);
          void run(async () => {
            const result = await completeProfileName(name,params.get("next"),expectedUserId);
            if (expectedUserId && session && !session.isCurrentUser(expectedUserId)) return;
            if (!result.ok) {
              setFormError(result.message ?? copy.errors.authFailed);
              return;
            }
            clearPendingSignup();router.replace(result.data.next);router.refresh();
          });
        }}
      >
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field label={copy.auth.name} required error={nameError}>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        </Field>
        <Button type="submit" busy={busy} disabled={session?.status !== "ready" || !session.identity} busyLabel={copy.loading} className="w-full">{copy.auth.completeProfileSave}</Button>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const copy = useAppCopy();
  const { locale } = useDemo();

  const router = useRouter();
  const session = useOptionalAccountSession();
  const [ready, setReady] = useState<"loading" | "ok" | "missing" | "unavailable">("loading");
  const [expectedUserId, setExpectedUserId] = useState<string | null>(null);
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<"password" | "confirm", FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { busy, run } = useAction();
  const passwordError = useErrorText(errors.password);
  const confirmError = useErrorText(errors.confirm);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const { readBrokerSessionStatus } = await import("@/lib/auth/broker-actions");
          const status = await readBrokerSessionStatus();
          if (!status.ok) {
            setReady(status.code === "UNAVAILABLE" ? "unavailable" : "missing");
            return;
          }
          setExpectedUserId(status.userId);
          setReady("ok");
        } catch {
          setReady("unavailable");
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <AuthShell title={copy.auth.resetTitle} footer={<Link href="/login" className="font-semibold text-[var(--color-action-on-dark)] underline">{copy.auth.login}</Link>}>
      {ready === "loading" ? <p className="text-sm text-[var(--color-muted-on-dark)]">{copy.loading}</p> : null}
      {ready === "unavailable" ? <div className="grid gap-3"><Notice tone="error">{copy.errors.unavailableBody}</Notice><Button onClick={() => window.location.reload()}>{copy.errors.accessRetry}</Button></div> : null}
      {ready === "missing" ? (
        <div className="grid gap-4">
          <Notice tone="error"><strong>{copy.auth.expiredTitle}</strong><br />{copy.auth.expiredBody}</Notice>
          <LinkButton href="/forgot-password" variant="secondary">{copy.auth.forgotTitle}</LinkButton>
        </div>
      ) : null}
      {ready === "ok" && !done ? (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !expectedUserId || session?.status !== "ready" || !session.isCurrentUser(expectedUserId)) return;
            setFormError(null);
            const next: typeof errors = {};

            if (form.password.length < 8) next.password = "password";
            if (form.confirm !== form.password) next.confirm = "match";
            setErrors(next);
            if (Object.keys(next).length) return;
            void run(async () => {
              if (!expectedUserId) return;
              const boundaryFp = session?.boundaryFingerprint ?? null;
              if (!boundaryFp || session?.status !== "ready" || !session.hasCurrentUser()) {
                setFormError(copy.errors.authFailed);
                return;
              }
              const receipt = createRecoveryReceipt(expectedUserId, boundaryFp, "password_revoke");
              let result: Awaited<ReturnType<typeof updatePassword>>;
              try {
                result = await updatePassword(form.password, expectedUserId, boundaryFp, receipt.operationKey);
              } catch {
                const live = session.liveSnapshot();
                if (live.ready && live.userId === expectedUserId && live.boundaryFingerprint === boundaryFp) {
                  setForm({ password: "", confirm: "" });
                  session.recoverOperation?.(receipt);
                }
                return;
              }
              // Live tip after await — refs, not stale React boundary (C4-05).
              const live = session.liveSnapshot?.();
              if (
                !live?.ready ||
                live.userId !== expectedUserId ||
                live.boundaryFingerprint !== boundaryFp ||
                !session.isCurrentUser(expectedUserId)
              ) {
                return;
              }
              if (!result.ok) {

                if (result.data?.operationId) {
                  setForm({ password: "", confirm: "" });
                  session.recoverOperation?.(receipt);
                }
                setFormError(result.message==='PASSWORD_CHANGED_SESSION_REVOCATION_PENDING'?(locale==='ar'?'تغيّرت كلمة المرور، لكن لم نتأكد من إغلاق كل الجلسات. سجّل خروجك وتواصل مع الدعم لإكمال التحقق.':'Your password changed, but closing every session could not be confirmed. Sign out and contact support to complete verification.'):copy.errors.authFailed);
                return;
              }
              setDone(true);
              router.refresh();
            }).catch(() => {
              const trace = beginDiagnostic("auth_password_update");
              trace.stage("provider");
              void (trace.finish("OUTCOME_UNKNOWN"));
              setFormError(copy.errors.authFailed);
            });
          }}
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <PasswordField label={copy.auth.newPassword} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} hint={copy.auth.passwordHintReal} autoComplete="new-password" />
          <PasswordField label={copy.auth.confirmPassword} value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} error={confirmError} autoComplete="new-password" />
          <Button type="submit" busy={busy} disabled={session?.status !== "ready" || !expectedUserId || !session.isCurrentUser(expectedUserId)} busyLabel={copy.loading} className="w-full">{copy.auth.setPassword}</Button>
        </form>
      ) : null}
      {done ? (
        <div className="grid gap-4">
          <Notice tone="success">{copy.auth.resetDone}</Notice>
          <LinkButton href="/login">{copy.auth.login}</LinkButton>
        </div>
      ) : null}
    </AuthShell>
  );
}

export function AcceptInvitePage() {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const session = useOptionalAccountSession();
  const token = params.get("token") ?? "";
  const returnTo = `/accept-invite?token=${encodeURIComponent(token)}`;
  const { busy, run } = useAction();
  const [loaded, setLoaded] = useState<{ token: string; invitation?: StaffInvitationView; code?: string } | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptedToken, setAcceptedToken] = useState<string | null>(null);
  const accepted = acceptedToken === token;
  const invitation = loaded?.token === token ? loaded.invitation : undefined;
  const loading = loaded?.token !== token;
  const signedIn = session?.status === "ready" && Boolean(session.identity);
  const emailConfirmed = signedIn && session?.identity?.emailConfirmed === true;

  function errorText(code: string) {
    if (code === "EMAIL_MISMATCH") return locale === "ar" ? "سجّل الدخول بالبريد الذي وُجّهت إليه الدعوة." : "Sign in with the email address this invitation was sent to.";
    if (code === "UNVERIFIED") return locale === "ar" ? "أكّد بريدك الإلكتروني أولًا، ثم عُد لقبول الدعوة." : "Confirm your email address, then return to accept this invitation.";
    if (code === "UNAUTHENTICATED") return copy.errors.sessionExpiredBody;
    if (code === "MEMBER_EXISTS") return locale === "ar" ? "هذه العضوية موجودة مسبقًا. اطلب من مالك النشاط مراجعة صلاحياتها." : "This membership already exists. Ask the business owner to review its access.";
    if (code === "UNAVAILABLE") return locale === "ar" ? "تعذّر تحميل الدعوة أو قبولها. أعد المحاولة." : "Could not load or accept this invitation. Try again.";
    return locale === "ar" ? "الدعوة غير صالحة أو انتهت صلاحيتها أو استُخدمت. اطلب رابطًا جديدًا من مالك النشاط." : "This invitation is invalid, expired, or already used. Ask the business owner for a new link.";
  }

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      setAcceptError(null);
      void readStaffInvitation(token).then((result) => {
        if (!cancelled) setLoaded(result.ok ? { token, invitation: result.data } : { token, code: result.code });
      }).catch(() => { if (!cancelled) setLoaded({ token, code: "UNAVAILABLE" }); });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [token]);

  return (
    <AuthShell title={copy.auth.inviteTitle} body={invitation ? fill(copy.auth.inviteBody, { business: invitation.business, role: copy.auth.roleStaff }) : undefined}>
      <div className="grid gap-4">
        {loading ? <p className="text-sm text-[var(--color-muted-on-dark)]" aria-busy="true">{copy.loading}</p> : null}
        {!loading && !invitation ? <Notice tone="error">{errorText(loaded?.code ?? "INVITE_INVALID")}</Notice> : null}
        {accepted ? <Notice tone="success">{copy.auth.inviteAccepted}</Notice> : null}
        {acceptError ? <Notice tone={accepted ? "warn" : "error"}>{acceptError}</Notice> : null}
        {invitation ? (
          <>
            <div className="grid gap-2 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4 text-sm">
              <div className="flex justify-between gap-3"><span className="text-[var(--color-muted-on-dark)]">{copy.setup.businessName}</span><strong>{invitation.business}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-[var(--color-muted-on-dark)]">{copy.app.roleLabel}</span><strong>{copy.auth.roleStaff}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-[var(--color-muted-on-dark)]">{copy.auth.email}</span><span dir="ltr">{invitation.maskedEmail}</span></div>
              <p className="text-xs text-[var(--color-muted-soft)]">{locale === "ar" ? "صالحة حتى" : "Valid until"}: {new Date(invitation.expiresAt).toLocaleString(locale === "ar" ? "ar-OM" : "en-OM")}</p>
            </div>
            {emailConfirmed ? (
              <Button busy={busy} disabled={accepted} busyLabel={copy.loading} className="w-full" onClick={() => {
                if (busy || accepted) return;
                setAcceptError(null);
                let committed = false;
                void run(async () => {
                  const result = await acceptStaffInvitation(token);
                  if (!result.ok) { setAcceptError(errorText(result.code)); return; }
                  committed = true;
                  setAcceptedToken(token);
                  try { await session?.refresh(); } catch { /* Membership acceptance is already confirmed. */ }
                  router.replace(result.data.branchId ? `/branch?company=${encodeURIComponent(result.data.companyId)}&branch=${encodeURIComponent(result.data.branchId)}` : "/app/conversations");
                  router.refresh();
                }).catch(() => setAcceptError(committed
                  ? (locale === "ar" ? "تم قبول الدعوة وحفظ العضوية. تعذر تحديث الوصول؛ افتح مساحة العمل مجددًا." : "Invitation accepted and membership saved. Access refresh is unavailable; open the workspace again.")
                  : errorText("UNAVAILABLE")));
              }}>{copy.auth.acceptInvite}</Button>
            ) : signedIn ? (
              <>
                <Notice tone="warn">{errorText("UNVERIFIED")}</Notice>
                <LinkButton href={authFlowHref("/verify-email", returnTo, session?.identity?.email)}>{copy.auth.verifyTitle}</LinkButton>
              </>
            ) : (
              <>
                <LinkButton href={authFlowHref("/login", returnTo)} className="w-full min-h-12 text-base font-semibold shadow-sm">{copy.auth.login}</LinkButton>
                <LinkButton href={authFlowHref("/signup", returnTo)} variant="secondary" className="w-full">{copy.auth.signup}</LinkButton>
              </>
            )}
          </>
        ) : !loading ? <LinkButton href="/login" className="w-full min-h-12 text-base font-semibold shadow-sm">{copy.auth.login}</LinkButton> : null}
      </div>
    </AuthShell>
  );
}
