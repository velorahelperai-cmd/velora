"use client";
import { authFlowHref, savePendingSignup, readPendingSignup, clearPendingSignup } from "@/lib/auth/auth-journey";
import {DiagnosticHint} from "./diagnostic-hint";
import {beginDiagnostic} from "@/lib/diagnostics/flow";
import { normalizeEmailCode } from "@/lib/auth/email-code";
import { createRecoveryReceipt } from "@/lib/auth/operation-recovery";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        markAuthEntryMorph();
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

export function AuthShell({
  title,
  body,
  children,
  footer,
  entry = false,
  /** Non-interactive entry chrome behind the verify OTP modal. */
  entryBackdrop = false,
}: {
  title: string;
  body?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Owner-approved motion entry chrome for /login and /signup only. */
  entry?: boolean;
  entryBackdrop?: boolean;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const tagline = landingCopy(locale).tagline;
  const [collapsed, setCollapsed] = useState(false);
  const [contentVisible, setContentVisible] = useState(true);
  const morphTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!entry || entryBackdrop) return;
    // Defer morph decisions to a timer so setState is not sync inside the effect body.
    const boot = window.setTimeout(() => {
      const reduce = prefersReducedMotion();
      const shouldMorphIn = consumeAuthEntryMorph();
      if (!shouldMorphIn || reduce) {
        setCollapsed(false);
        setContentVisible(true);
        return;
      }
      setCollapsed(true);
      setContentVisible(false);
      morphTimer.current = window.setTimeout(() => {
        setCollapsed(false);
        window.setTimeout(() => setContentVisible(true), 40);
      }, 40);
    }, 0);
    return () => {
      window.clearTimeout(boot);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
    };
  }, [entry, entryBackdrop]);

  useEffect(() => {
    if (!entry || entryBackdrop) return;
    function onMorphOut(event: Event) {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (!href) return;
      if (prefersReducedMotion()) {
        router.push(href);
        return;
      }
      setContentVisible(false);
      setCollapsed(true);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
      morphTimer.current = window.setTimeout(() => {
        router.push(href);
      }, AUTH_ENTRY_MORPH_MS);
    }
    window.addEventListener(AUTH_MORPH_OUT_EVENT, onMorphOut);
    return () => {
      window.removeEventListener(AUTH_MORPH_OUT_EVENT, onMorphOut);
      if (morphTimer.current) window.clearTimeout(morphTimer.current);
    };
  }, [entry, entryBackdrop, router]);

  if (entry) {
    const signupTall = typeof title === "string" && /إنشاء|Create|Sign up|حساب/i.test(title);
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
          .auth-entry-card-body { transition: opacity 0.28s ease; }
          @media (prefers-reduced-motion: reduce) {
            .auth-entry-card, .auth-entry-card-body { transition: none !important; }
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
          <div className="relative z-10 flex w-full max-w-[440px] items-center justify-center min-h-[min(560px,70svh)]">
            <div
              className={`auth-entry-card relative flex flex-col items-center justify-center overflow-hidden border border-[#DCE4EB] bg-[#FFFFFF]/95 shadow-[0_30px_80px_rgba(23,45,67,0.12),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl ${
                collapsed ? "rounded-[34px]" : "rounded-[38px]"
              } ${entryBackdrop ? "pointer-events-none opacity-55" : ""}`}
              data-auth-entry-card="true"
              data-auth-entry-collapsed={collapsed ? "true" : "false"}
              style={{
                width: collapsed ? "170px" : "min(100%, 385px)",
                height: collapsed ? "170px" : undefined,
                minHeight: collapsed ? undefined : signupTall ? "34rem" : "28rem",
                maxWidth: "385px",
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
              <div
                className={`auth-entry-card-body flex h-full w-full flex-col justify-between px-6 py-8 sm:px-7 sm:py-9 ${collapsed ? "opacity-0" : contentVisible ? "opacity-100" : "opacity-0"}`}
                style={{
                  transform: collapsed ? "rotate(45deg)" : "none",
                }}
                {...(entryBackdrop || collapsed ? ({ inert: true } as { inert: boolean }) : {})}
              >
                <div className="text-center">
                  <h1 className="text-[25px] font-bold leading-snug tracking-tight text-[#172D43]">
                    <AuthTitle title={title} />
                  </h1>
                  {body ? <p className="mt-1 text-xs leading-5 text-[#536579]">{body}</p> : null}
                </div>
                <div className="mt-6 flex w-full flex-col justify-between">{children}</div>
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

function providerErrorMessage(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/provider is not enabled|unsupported provider|validation_failed/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

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

function useAuthEntryLock() {
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
      setBusy(false);
    }
  }, []);
  return { busy, run, locked };
}

function useGoogleAuth(
  setNotice: (v: string | null) => void,
  next: string | null | undefined,
  entryLock: { busy: boolean; run: (fn: () => void | Promise<void>) => Promise<void> },
) {
  const copy = useAppCopy();
  return {
    busy: entryLock.busy,
    onGoogle: () => {
      setNotice(null);
      void entryLock.run(async () => {
        try {
          const destination = next != null ? safeInternalPath(next, "/setup") : "/setup";
          await startOAuth("google", destination);
        } catch (err) {
          setNotice(providerErrorMessage(err, copy.auth.googleUnavailable));
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
export function SignupPage() {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const params = useSearchParams();
  const prefillEmail = (params.get("email") || "").trim().toLowerCase();
  const entryLock = useAuthEntryLock();
  const { busy, run } = entryLock;
  const [redirecting, setRedirecting] = useState(false);
  const navigate = useCallback((path: string) => {
    // Read the newly admitted Auth cookie through a fresh protected document.
    setRedirecting(true);
    window.location.replace(path);
  }, []);
  const [form, setForm] = useState({ name: "", email: prefillEmail, password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password" | "confirm", FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [diagnostic,setDiagnostic]=useState<unknown>(null);
  const [altNotice, setAltNotice] = useState<string | null>(null);
  const returnTo = safeInternalPath(params.get("next"), "");
  useAuthenticatedAuthRedirect(returnTo,busy || redirecting,navigate);
  const google = useGoogleAuth(setAltNotice, returnTo || null, entryLock);
  const dirty = Boolean(form.name || form.email || form.password || form.confirm);
  useUnsavedWarning(dirty && !busy && !redirecting);
  const nameError = useErrorText(errors.name);
  const emailError = useErrorText(errors.email);
  const passwordError = useErrorText(errors.password);
  const confirmError = useErrorText(errors.confirm);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy || redirecting) return;
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = "required";
    if (!isEmail(form.email)) next.email = "email";
    if (form.password.length < 8) next.password = "password";
    if (form.confirm !== form.password) next.confirm = "match";
    setErrors(next);
    setFormError(null);setDiagnostic(null);
    if (Object.keys(next).length) return;
    void run(async () => {
      const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
      const continuity = await ensureBrowserContinuity("signup");
      if (!continuity.ok) {
        setFormError(
          continuity.code === "CONTINUITY_RECOVERY_REQUIRED"
            ? copy.errors.continuityRecovery
            : copy.errors.authFailed,
        );
        return;
      }
      const result = await signUpWithEmail({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.confirm,
        next: returnTo,
        requestNonce: continuity.requestNonce,
      });
      if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
      if (!result.ok) {
        setDiagnostic(result.diagnostic);setFormError(copy.errors.authFailed);
        return;
      }
      if (result.data.needsVerification) {
        savePendingSignup(result.data.email,returnTo);
        router.replace(authFlowHref("/verify-email",returnTo,result.data.email));
        return;
      }
      clearPendingSignup();
      const destination = await resolvePostAuthPath(returnTo);
      if (!destination.ok) { setDiagnostic(destination.diagnostic);setFormError(copy.errors.authFailed); return; }
      navigate(destination.data.next);
    }).catch(() => setFormError(copy.errors.authFailed));
  }

  return (
    <AuthShell
      entry
      title={copy.auth.signupTitle}
      body={copy.auth.signupBody}
      footer={<>{copy.auth.haveAccount} <AuthEntryMorphLink href={returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login"} className="font-semibold text-[#087E8B] underline">{copy.auth.login}</AuthEntryMorphLink></>}
    >
      <form className="space-y-3" onSubmit={submitEmail} noValidate data-auth-entry-form="signup">
        {formError ? <Notice tone="error">{formError}</Notice> : null}<DiagnosticHint diagnostic={diagnostic} locale={locale}/>
        <Field label={copy.auth.name} required error={nameError} tone="entry">
          {(p) => (
            <div className="relative flex items-center">
              <EntryFieldIcon kind="user" />
              <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
            </div>
          )}
        </Field>
        <Field label={copy.auth.email} required error={emailError} tone="entry">
          {(p) => (
            <div className="relative flex items-center">
              <EntryFieldIcon kind="mail" />
              <input {...p} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" inputMode="email" />
            </div>
          )}
        </Field>
        <PasswordField tone="entry" label={copy.auth.password} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} hint={copy.auth.passwordHintReal} autoComplete="new-password" />
        <PasswordField tone="entry" label={copy.auth.confirmPasswordSignup} value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} error={confirmError} autoComplete="new-password" />
        <Button type="submit" variant="entry" busy={busy || redirecting} busyLabel={copy.loading} className="mt-1">
          {copy.auth.createAccount}
          {!busy && !redirecting ? <EntrySubmitArrow /> : null}
        </Button>
      </form>

      <GoogleAuthButton entry busy={busy || redirecting || google.busy} onGoogle={google.onGoogle} notice={altNotice} />
    </AuthShell>
  );
}

export function LoginPage() {
  const {locale}=useDemo();
  const copy = useAppCopy();
  const params = useSearchParams();
  const returnTo = params.get("next");
  const entryLock = useAuthEntryLock();
  const { busy, run } = entryLock;
  const [redirecting, setRedirecting] = useState(false);
  const navigate = useCallback((path:string) => {
    // A new Auth cookie needs a fresh protected document, without competing
    // profile actions or a cached RSC tree from the previous identity.
    setRedirecting(true);
    window.location.replace(path);
  }, []);
  useAuthenticatedAuthRedirect(returnTo,busy||redirecting,navigate);
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<"email" | "password", FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(() => {
    const err = params.get("error");
    if (err === "verification_browser") return copy.auth.verificationBrowser;
    if (err === "auth_callback") return copy.errors.authFailed;
    if (err === "oauth_cancelled") return copy.auth.oauthCancelled;
    return null;
  });
  const [diagnostic,setDiagnostic]=useState<unknown>(null);
  const [altNotice, setAltNotice] = useState<string | null>(null);
  const google = useGoogleAuth(setAltNotice, returnTo, entryLock);
  const emailError = useErrorText(errors.email);
  const passwordError = useErrorText(errors.password);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy||redirecting) return;
    setFormError(null);setDiagnostic(null);
    const next: typeof errors = {};
    if (!isEmail(form.email)) next.email = "email";
    if (!form.password) next.password = "required";
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(async () => {
      const trace=beginDiagnostic("auth_login");trace.stage("provider");
      const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
      const continuity = await ensureBrowserContinuity("login");
      if (!continuity.ok) {
        setFormError(
          continuity.code === "CONTINUITY_RECOVERY_REQUIRED"
            ? copy.errors.continuityRecovery
            : copy.errors.authFailed,
        );
        return;
      }
      // WP01A: password login goes through the server session broker (opaque handles).
      const {signInWithEmail}=await import("@/lib/tenancy/actions");
      const admitted=await signInWithEmail({
        email:form.email.trim().toLowerCase(),
        password:form.password,
        next:returnTo,
        requestNonce: continuity.requestNonce,
      });
      if (admitted.ok || admitted.code === "INVALID_INPUT" || admitted.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
      if(!admitted.ok){setDiagnostic(admitted.diagnostic??trace.finish("AUTH_ERROR"));setFormError(copy.errors.authFailed);return;}
      trace.stage("access");
      const result=admitted.data?.next
        ? {ok:true as const,data:{next:admitted.data.next},diagnostic:admitted.diagnostic}
        : await resolvePostAuthPath(returnTo);
      if (!result.ok) {
        setDiagnostic(result.diagnostic);setFormError(copy.errors.authFailed);
        return;
      }
      trace.stage("handoff");trace.finish("OK");clearPendingSignup();
      navigate(result.data.next);
    }).catch(() => setFormError(copy.errors.authFailed));
  }

  return (
    <AuthShell
      entry
      title={copy.auth.loginTitle}
      body={copy.auth.loginBody}
      footer={<>{copy.auth.noAccount} <AuthEntryMorphLink href={safeInternalPath(returnTo, "") ? `/signup?next=${encodeURIComponent(safeInternalPath(returnTo, ""))}` : "/signup"} className="font-semibold text-[#087E8B] underline">{copy.auth.signup}</AuthEntryMorphLink></>}
    >
      <form className="space-y-4" onSubmit={submitEmail} noValidate data-auth-entry-form="login">
        {params.get("reason") === "session_expired" ? <Notice tone="warn">{copy.errors.sessionExpiredBody}</Notice> : null}
        {formError ? <Notice tone="error">{formError}</Notice> : null}<DiagnosticHint diagnostic={diagnostic} locale={locale}/>
        <Field label={copy.auth.email} required error={emailError} tone="entry">
          {(p) => (
            <div className="relative flex items-center">
              <EntryFieldIcon kind="mail" />
              <input {...p} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" inputMode="email" />
            </div>
          )}
        </Field>
        <PasswordField tone="entry" label={copy.auth.password} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} autoComplete="current-password" />
        <div className="flex items-center justify-end text-xs">
          <Link href="/forgot-password" className="font-medium text-[#087E8B]">{copy.auth.forgot}</Link>
        </div>
        <Button type="submit" variant="entry" busy={busy || redirecting} busyLabel={copy.loading}>
          {copy.auth.login}
          {!busy && !redirecting ? <EntrySubmitArrow /> : null}
        </Button>
      </form>

      <GoogleAuthButton entry busy={busy || redirecting || google.busy} onGoogle={google.onGoogle} notice={altNotice} />
    </AuthShell>
  );
}

type VerificationBoundary = { userId: string | null; boundaryFingerprint: string | null; status: string };
type VerifiedBoundary = { userId: string; boundaryFingerprint: string };
type VerificationCapture = {
  epoch: number;
  baseline: VerificationBoundary | null;
  observed: VerificationBoundary[];
  overflow?: true;
};
type ConfirmedVerification = { capture: VerificationCapture; boundary: VerifiedBoundary; next: string };
function sameVerificationBoundary(a: VerificationBoundary | null, b: VerificationBoundary | null) {
  return a?.userId === b?.userId && a?.boundaryFingerprint === b?.boundaryFingerprint;
}
function matchesVerifiedBoundary(value: VerificationBoundary | null, expected?: VerifiedBoundary) {
  return Boolean(expected && value?.userId === expected.userId && value.boundaryFingerprint === expected.boundaryFingerprint);
}

export function VerifyEmailPage() {
  const copy = useAppCopy();
  const router = useRouter();
  const session = useOptionalAccountSession();
  const params = useSearchParams();
  const [storedReturn, setStoredReturn] = useState("");
  const pendingReturn = safeInternalPath(params.get("next"), "") || storedReturn;
  const emailFromQuery = (params.get("email") || "").trim().toLowerCase();
  const [registeredEmail, setRegisteredEmail] = useState(emailFromQuery);
  const [resent, setResent] = useState(false);
  const { locale } = useDemo();
  const [diagnostic, setDiagnostic] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [hydrated, setHydrated] = useState(Boolean(emailFromQuery));
  const [modalOpen, setModalOpen] = useState(true);
  const [verified, setVerified] = useState(false);
  const [successNext, setSuccessNext] = useState<string | null>(null);
  const [retrySessionOnly, setRetrySessionOnly] = useState(false);
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
      const previous = capture.observed.at(-1);
      if (!previous || !sameVerificationBoundary(previous, live) || previous.status !== live.status) {
        if (capture.observed.length >= 64) capture.overflow = true;
        else capture.observed.push({ ...live });
      }
    }
    return live;
  }
  useLayoutEffect(() => {
    if (activeCapture.current) observe(activeCapture.current);
  });

  function captureJourney(): VerificationCapture {
    const baseline = session?.liveSnapshot() ?? null;
    const capture = { epoch: journey.current.epoch, baseline, observed: baseline ? [{ ...baseline }] : [] };
    activeCapture.current = capture;
    return capture;
  }
  function isCurrent(capture: VerificationCapture, expected?: VerifiedBoundary, requireVerified = false) {
    const live = observe(capture);
    return journey.current.mounted && activeCapture.current === capture
      && journey.current.epoch === capture.epoch && !capture.overflow
      && capture.observed.every(value => value.status !== "locked" && value.status !== "expired"
        && (sameVerificationBoundary(value, capture.baseline) || matchesVerifiedBoundary(value, expected)))
      && (!requireVerified || !session || Boolean(live?.ready && live.status === "ready" && matchesVerifiedBoundary(live, expected)));
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  function verificationMessage(message?: string) {
    if (message === "verification_code_invalid") return copy.auth.verificationCodeInvalid;
    if (message === "verification_rate_limited") return copy.auth.verificationRateLimited;
    if (message === "verification_incomplete") return copy.auth.verificationIncomplete;
    return copy.auth.verificationUnavailable;
  }

  async function finishVerification(confirmed: ConfirmedVerification) {
    const { capture, boundary } = confirmed;
    try {
      await session?.refresh();
    } catch {
      if (isCurrent(capture, boundary)) {
        setRetrySessionOnly(true);
        setError(copy.auth.verificationSessionUnavailable);
      }
      return;
    }
    if (!isCurrent(capture, boundary)) return;
    // refresh() resolves on transport failure too. Identity alone is not READY.
    if (!isCurrent(capture, boundary, true)) {
      setRetrySessionOnly(true);
      setError(copy.auth.verificationSessionUnavailable);
      return;
    }
    clearPendingSignup();
    successCapture.current = { capture, boundary };
    setRetrySessionOnly(false);
    setSuccessNext(confirmed.next);
    setVerified(true);
  }

  function submitCode(code: string) {
    if (busy || !hydrated || !registeredEmail || verified) return;
    const confirmed = confirmedCapture.current;
    if (confirmed) {
      if (!isCurrent(confirmed.capture, confirmed.boundary)) return;
      setError(null);
      void run(() => finishVerification(confirmed));
      return;
    }
    setError(null);
    setDiagnostic(null);
    setResent(false);
    const normalized = normalizeEmailCode(code);
    if (!/^[0-9]{6}$/.test(normalized)) {
      setError(copy.auth.verificationCodeFormat);
      return;
    }
    const capture = captureJourney();
    const journeyEmail = registeredEmail;
    const journeyNext = pendingReturn;
    void run(async () => {
      try {
        const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
        const continuity = await ensureBrowserContinuity("verify_email");
        if (!isCurrent(capture)) return;
        if (!continuity.ok) {
          setError(
            continuity.code === "CONTINUITY_RECOVERY_REQUIRED"
              ? copy.errors.continuityRecovery
              : copy.auth.verificationUnavailable,
          );
          return;
        }
        const result = await verifyEmailCode({
          email: journeyEmail,
          code: normalized,
          next: journeyNext,
          requestNonce: continuity.requestNonce,
        });
        const boundary = result.ok ? result.data : undefined;
        if (!isCurrent(capture, boundary)) return;
        if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR") {
          clearAuthGestureNonce(continuity.requestNonce);
        }
        setDiagnostic(result.diagnostic);
        if (!result.ok) {
          setError(result.code === "INVALID_INPUT" ? copy.auth.verificationCodeFormat : verificationMessage(result.message));
          return;
        }
        const confirmed = { capture, boundary: result.data, next: result.data.next };
        confirmedCapture.current = confirmed;
        await finishVerification(confirmed);
      } catch {
        if (!isCurrent(capture)) return;
        setError(copy.auth.verificationUnavailable);
      }
    });
  }

  return (
    <>
      <AuthShell
        entry
        entryBackdrop
        title={copy.auth.verifyTitle}
        body={fill(copy.auth.verifyBody, { email: registeredEmail || "…" })}
        footer={
          !modalOpen ? (
            <button
              type="button"
              className="font-semibold text-[#087E8B] underline"
              onClick={() => setModalOpen(true)}
            >
              {copy.auth.verifyCode}
            </button>
          ) : null
        }
      >
        <p className="text-center text-xs leading-5 text-[#536579]">{copy.auth.verifyRealBody}</p>
        {!modalOpen ? (
          <div className="mt-4 grid gap-2">
            <Button type="button" variant="entry" onClick={() => setModalOpen(true)}>
              {copy.auth.verifyCode}
            </Button>
            <LinkButton href={authFlowHref("/login", pendingReturn)} variant="secondary">
              {copy.auth.login}
            </LinkButton>
          </div>
        ) : null}
      </AuthShell>

      <AuthOtpModal
        open={modalOpen}
        email={registeredEmail}
        title={copy.auth.verifyTitle}
        body={fill(copy.auth.verifyBody, { email: registeredEmail || "…" })}
        realBody={copy.auth.verifyRealBody}
        codeLabel={copy.auth.verificationCodeLabel}
        codeHint={copy.auth.verificationCodeHint}
        codeFormat={copy.auth.verificationCodeFormat}
        verifyLabel={retrySessionOnly ? copy.auth.verificationSessionRetry : copy.auth.verifyCode}
        retrySessionOnly={retrySessionOnly}
        resendLabel={copy.auth.resend}
        resendInLabel={fill(copy.auth.resendIn, { n: cooldown })}
        resentNotice={copy.auth.resent}
        correctEmailLabel={copy.auth.correctEmail}
        correctEmailHint={copy.auth.correctEmailHint}
        loginLabel={copy.auth.login}
        loginHref={authFlowHref("/login", pendingReturn)}
        closeLabel={copy.close}
        busy={busy}
        error={error}
        diagnostic={<DiagnosticHint diagnostic={diagnostic} locale={locale} />}
        resent={resent}
        cooldown={cooldown}
        verified={verified}
        onClose={() => {
          if (verified) return;
          setModalOpen(false);
        }}
        onSubmitCode={submitCode}
        onResend={() => {
          if (busy || cooldown > 0 || !registeredEmail || verified || retrySessionOnly) return;
          const capture = captureJourney();
          setError(null);
          setDiagnostic(null);
          setResent(false);
          void run(async () => {
            try {
              const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
              const continuity = await ensureBrowserContinuity("verification_resend");
              if (!isCurrent(capture)) return;
              if (!continuity.ok) { setError(copy.auth.verificationUnavailable); return; }
              const result = await resendVerificationEmail(registeredEmail, pendingReturn, continuity.requestNonce);
              if (!isCurrent(capture)) return;
              if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
              setDiagnostic(result.diagnostic);
              if (!result.ok) {
                setError(verificationMessage(result.message));
                if (result.message === "verification_rate_limited") setCooldown(RESEND_COOLDOWN_SEC);
                return;
              }
              setResent(true);
              setCooldown(RESEND_COOLDOWN_SEC);
            } catch {
              if (!isCurrent(capture)) return;
              setError(copy.auth.verificationUnavailable);
            }
          });
        }}
        onCorrectEmail={(cleaned) => {
          router.push(authFlowHref("/signup", pendingReturn, cleaned));
        }}
        onSuccessAnimDone={() => {
          const success = successCapture.current;
          if (!successNext || !success || !isCurrent(success.capture, success.boundary, true)) return;
          router.replace(successNext);
          router.refresh();
        }}
      />
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
  const [diagnostic, setDiagnostic] = useState<unknown>(null);
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
            setDiagnostic(null);
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
                setDiagnostic(result.diagnostic);
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
              setDiagnostic(trace.finish("OUTCOME_UNKNOWN"));
              setFormError(copy.errors.authFailed);
            });
          }}
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <DiagnosticHint diagnostic={diagnostic} locale={locale} />
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
                  router.replace("/app/conversations");
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
