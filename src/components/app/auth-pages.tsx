"use client";
import { authFlowHref, savePendingSignup, readPendingSignup, clearPendingSignup } from "@/lib/auth/auth-journey";
import {DiagnosticHint} from "./diagnostic-hint";
import {beginDiagnostic} from "@/lib/diagnostics/flow";
import { normalizeEmailCode } from "@/lib/auth/email-code";
import { createRecoveryReceipt } from "@/lib/auth/operation-recovery";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import { landingCopy } from "@/lib/landing-copy";
import { startOAuth } from "@/lib/auth/browser";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { acceptStaffInvitation, readStaffInvitation, type StaffInvitationView } from "@/lib/tenancy/staff-invitations";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
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

export function AuthShell({ title, body, children, footer }: { title: string; body?: string; children: ReactNode; footer?: ReactNode }) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const tagline = landingCopy(locale).tagline;
  return (
    <main className="app-shell relative overflow-x-hidden px-4 py-6 pb-[max(6rem,env(safe-area-inset-bottom))]">
      <div className="relative z-20 mx-auto flex max-w-[1100px] items-center justify-between gap-2">
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
}: {
  busy?: boolean;
  onGoogle: () => void;
  notice?: string | null;
}) {
  const copy = useAppCopy();
  return (
    <div className="mt-6 grid gap-3">
      <div className="flex items-center gap-3 text-xs text-[var(--color-muted-soft)]" role="separator">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        {copy.auth.orContinue}
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>
      <Button
        type="button"
        variant="secondary"
        busy={busy}
        busyLabel={copy.loading}
        className="w-full min-h-12 border-[color:var(--color-border-soft)] shadow-xs"
        onClick={onGoogle}
      >
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="text-base font-bold text-[#4285F4]">G</span>
          {copy.auth.withGoogle}
        </span>
      </Button>
      <p className="text-center text-xs leading-5 text-[var(--color-muted-soft)]">{copy.auth.socialNote}</p>
      {notice ? <Notice tone="warn">{notice}</Notice> : null}
    </div>
  );
}

function useGoogleAuth(setNotice: (v: string | null) => void, next?: string | null) {
  const copy = useAppCopy();
  const { busy, run } = useAction();
  return {
    busy,
    onGoogle: () => {
      setNotice(null);
      void run(async () => {
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
  const { state, locale } = useDemo();
  const router = useRouter();
  const params = useSearchParams();
  const accountSession=useOptionalAccountSession();
  const prefillEmail = (params.get("email") || "").trim().toLowerCase();
  const { busy, run } = useAction();
  const [form, setForm] = useState({ name: "", email: prefillEmail, password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password" | "confirm", FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [diagnostic,setDiagnostic]=useState<unknown>(null);
  const [altNotice, setAltNotice] = useState<string | null>(null);
  const returnTo = safeInternalPath(params.get("next"), "");
  useAuthenticatedAuthRedirect(returnTo,busy);
  const google = useGoogleAuth(setAltNotice, returnTo || null);
  const dirty = Boolean(form.name || form.email || form.password || form.confirm);
  useUnsavedWarning(dirty && !busy);
  const planName = landingCopy(locale).plans.find((p) => p.id === state.planInterest)?.name;
  const nameError = useErrorText(errors.name);
  const emailError = useErrorText(errors.email);
  const passwordError = useErrorText(errors.password);
  const confirmError = useErrorText(errors.confirm);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      try { await accountSession?.refresh(); } catch { /* Signup is already confirmed. */ }
      const destination = await resolvePostAuthPath(returnTo);
      if (!destination.ok) { setDiagnostic(destination.diagnostic);setFormError(copy.errors.authFailed); return; }
      router.replace(destination.data.next);router.refresh();
    }).catch(() => setFormError(copy.errors.authFailed));
  }

  return (
    <AuthShell
      title={copy.auth.signupTitle}
      body={copy.auth.signupBody}
      footer={<>{copy.auth.haveAccount} <Link href={returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login"} className="font-semibold text-[var(--color-action-on-dark)] underline">{copy.auth.login}</Link></>}
    >
      {planName ? (
        <div className="mb-4">
          <Notice tone="info">{copy.auth.planInterest} <strong>{planName}</strong><br /><span className="text-[var(--color-muted-soft)]">{copy.auth.planNote}</span></Notice>
        </div>
      ) : null}

      <form className="grid gap-4" onSubmit={submitEmail} noValidate>
        {formError ? <Notice tone="error">{formError}</Notice> : null}<DiagnosticHint diagnostic={diagnostic} locale={locale}/>
        <Field label={copy.auth.name} required error={nameError}>
          {(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />}
        </Field>
        <Field label={copy.auth.email} required error={emailError}>
          {(p) => <input {...p} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" inputMode="email" />}
        </Field>
        <PasswordField label={copy.auth.password} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} hint={copy.auth.passwordHintReal} autoComplete="new-password" />
        <PasswordField label={copy.auth.confirmPasswordSignup} value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} error={confirmError} autoComplete="new-password" />
        <Button type="submit" busy={busy} busyLabel={copy.loading} className="mt-2 w-full min-h-12 text-base font-semibold shadow-sm">{copy.auth.createAccount}</Button>
      </form>

      <GoogleAuthButton busy={busy || google.busy} onGoogle={google.onGoogle} notice={altNotice} />
    </AuthShell>
  );
}

export function LoginPage() {
  const {locale}=useDemo();
  const copy = useAppCopy();
  const params = useSearchParams();
  const returnTo = params.get("next");
  const { busy, run } = useAction();
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
  const google = useGoogleAuth(setAltNotice, returnTo);
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
      title={copy.auth.loginTitle}
      body={copy.auth.loginBody}
      footer={<>{copy.auth.noAccount} <Link href={safeInternalPath(returnTo, "") ? `/signup?next=${encodeURIComponent(safeInternalPath(returnTo, ""))}` : "/signup"} className="font-semibold text-[var(--color-action-on-dark)] underline">{copy.auth.signup}</Link></>}
    >
      <form className="grid gap-4" onSubmit={submitEmail} noValidate>
        {params.get("reason") === "session_expired" ? <Notice tone="warn">{copy.errors.sessionExpiredBody}</Notice> : null}
        {formError ? <Notice tone="error">{formError}</Notice> : null}<DiagnosticHint diagnostic={diagnostic} locale={locale}/>
        <Field label={copy.auth.email} required error={emailError}>
          {(p) => <input {...p} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" inputMode="email" />}
        </Field>
        <PasswordField label={copy.auth.password} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} autoComplete="current-password" />
        <div className="flex items-center justify-between gap-3">
          <Link href="/forgot-password" className="text-sm font-medium text-[var(--color-action-on-dark)] underline">{copy.auth.forgot}</Link>
        </div>
        <Button type="submit" busy={busy||redirecting} busyLabel={copy.loading} className="w-full min-h-12 text-base font-semibold shadow-sm">{copy.auth.login}</Button>
      </form>

      <GoogleAuthButton busy={busy || redirecting || google.busy} onGoogle={google.onGoogle} notice={altNotice} />
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const copy = useAppCopy();

  const router = useRouter();
  const session = useOptionalAccountSession();
  const params = useSearchParams();
  const [storedReturn,setStoredReturn]=useState("");
  const pendingReturn=safeInternalPath(params.get("next"),"")||storedReturn;
  const emailFromQuery = (params.get("email") || "").trim().toLowerCase();
  const [registeredEmail, setRegisteredEmail] = useState(emailFromQuery);
  const [correctEmail, setCorrectEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [emailError, setEmailError] = useState<FieldErrorKey>();
  const [resent, setResent] = useState(false);
  const {locale}=useDemo();const [diagnostic,setDiagnostic]=useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [hydrated, setHydrated] = useState(Boolean(emailFromQuery));
  const { busy, run } = useAction();
  const emailErrText = useErrorText(emailError);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        setStoredReturn(readPendingSignup()?.next??"");
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
          setRegisteredEmail(readPendingSignup()?.email??"");
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

  function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !hydrated || !registeredEmail) return;
    setError(null);setDiagnostic(null);
    setResent(false);
    const normalized = normalizeEmailCode(code);
    if (!/^[0-9]{6}$/.test(normalized)) {
      setCodeInvalid(true);
      return;
    }
    setCodeInvalid(false);
    void run(async () => {
      try {
        const { ensureBrowserContinuity, clearAuthGestureNonce } = await import("@/lib/auth/browser-continuity");
        const continuity = await ensureBrowserContinuity("verify_email");
        if (!continuity.ok) {
          setError(
            continuity.code === "CONTINUITY_RECOVERY_REQUIRED"
              ? copy.errors.continuityRecovery
              : copy.auth.verificationUnavailable,
          );
          return;
        }
        const result = await verifyEmailCode({
          email: registeredEmail,
          code: normalized,
          next: pendingReturn,
          requestNonce: continuity.requestNonce,
        });
        if (result.ok || result.code === "INVALID_INPUT" || result.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
        setDiagnostic(result.diagnostic);if (!result.ok) {
          setError(result.code === "INVALID_INPUT" ? copy.auth.verificationCodeFormat : verificationMessage(result.message));
          return;
        }
        setCode("");
        clearPendingSignup();
        try { await session?.refresh(); } catch { /* Verification is already confirmed. */ }
        router.replace(result.data.next);
        router.refresh();
      } catch {
        setError(copy.auth.verificationUnavailable);
      }
    });
  }

  return (
    <AuthShell title={copy.auth.verifyTitle} body={fill(copy.auth.verifyBody, { email: registeredEmail || "…" })}>
      <div className="grid gap-4">
        <Notice tone="info">{copy.auth.verifyRealBody}</Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}<DiagnosticHint diagnostic={diagnostic} locale={locale}/>
        {resent ? <Notice tone="success">{copy.auth.resent}</Notice> : null}
        <Field label={copy.auth.verifyEmailLabel} hint={copy.auth.verifyEmailHint}>
          {(p) => (
            <input
              {...p}
              type="email"
              dir="ltr"
              value={registeredEmail}
              readOnly
              className={`${p.className} opacity-80`}
            />
          )}
        </Field>
        <form className="grid gap-3" noValidate onSubmit={submitCode}>
          <Field label={copy.auth.verificationCodeLabel} required hint={copy.auth.verificationCodeHint}
            error={codeInvalid ? copy.auth.verificationCodeFormat : undefined}>
            {(p) => <input {...p} type="text" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} pattern="[0-9]{6}" required value={code} disabled={busy}
              onChange={(event) => {
                setCode(normalizeEmailCode(event.target.value));
                setCodeInvalid(false);
                setError(null);setDiagnostic(null);
              }} />}
          </Field>
          <Button type="submit" busy={busy} busyLabel={copy.loading} disabled={!hydrated || !registeredEmail || busy}>
            {copy.auth.verifyCode}
          </Button>
        </form>
        <Button
          type="button"
          variant="secondary"
          busy={busy}
          busyLabel={copy.loading}
          disabled={!hydrated || !registeredEmail || busy || cooldown > 0}
          onClick={() => {
            if (busy || cooldown > 0 || !registeredEmail) return;
            setError(null);setDiagnostic(null);
            setResent(false);
            void run(async () => {
              try {
                const result = await resendVerificationEmail(registeredEmail,pendingReturn);
                setDiagnostic(result.diagnostic);if (!result.ok) {
                  setError(verificationMessage(result.message));
                  if (result.message === "verification_rate_limited") setCooldown(RESEND_COOLDOWN_SEC);
                  return;
                }
                setCode("");
                setResent(true);
                setCooldown(RESEND_COOLDOWN_SEC);
              } catch {
                setError(copy.auth.verificationUnavailable);
              }
            });
          }}
        >
          {cooldown > 0 ? fill(copy.auth.resendIn, { n: cooldown }) : copy.auth.resend}
        </Button>

        <div className="grid gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
          <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.auth.correctEmailHint}</p>
          <Field label={copy.auth.correctEmail} error={emailErrText}>
            {(p) => (
              <input
                {...p}
                type="email"
                dir="ltr"
                inputMode="email"
                autoComplete="email"
                value={correctEmail}
                disabled={busy}
                onChange={(e) => {
                  setCorrectEmail(e.target.value);
                  setEmailError(undefined);
                  setError(null);setDiagnostic(null);
                  setResent(false);
                }}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              const cleaned = correctEmail.trim().toLowerCase();
              if (!isEmail(cleaned)) {
                setEmailError("email");
                return;
              }
              // Real new signup path — email only in query; never password.
              router.push(authFlowHref("/signup",pendingReturn,cleaned));
            }}
          >
            {copy.auth.correctEmail}
          </Button>
        </div>

        <LinkButton href={authFlowHref("/login",pendingReturn)} variant="secondary">{copy.auth.login}</LinkButton>
        <LinkButton href="/forgot-password" variant="secondary">{copy.auth.forgotTitle}</LinkButton>
      </div>
    </AuthShell>
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
