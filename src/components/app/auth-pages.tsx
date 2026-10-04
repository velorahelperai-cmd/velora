"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { sampleStaff, useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import { landingCopy } from "@/lib/landing-copy";
import { sendPhoneOtp, startOAuth, verifyPhoneOtp } from "@/lib/auth/browser";
import { toE164Phone } from "@/lib/auth/site-url";
import {
  requestPasswordReset,
  resendVerificationEmail,
  resolvePostAuthPath,
  signInWithEmail,
  signUpWithEmail,
  updatePassword,
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
    <main className="relative min-h-svh overflow-x-hidden bg-[#07110d] px-4 py-6 pb-[max(6rem,env(safe-area-inset-bottom))] text-[#f7fbf8]">
      <Image src="/assets/velora/hero-environment-v2.png" alt="" fill sizes="100vw" className="object-cover object-left opacity-40" priority />
      <div className="hero-veil" />
      <div className="relative z-10 mx-auto flex max-w-[1100px] items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-2xl font-bold">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#38dc89] text-base text-[#072317]">V</span>
          {copy.brand}
        </Link>
        <div className="flex items-center gap-2">
          <PreviewBadge note />
          <LangSwitch />
        </div>
      </div>
      <div className="relative z-10 mx-auto mt-8 grid max-w-[1100px] items-start gap-8 lg:mt-14 lg:grid-cols-[1fr_min(440px,100%)]">
        <div className="hidden lg:block">
          <p className="text-sm text-[#38dc89]">{tagline}</p>
          <h1 className="scene-title mt-4 text-[#f7fbf8]">{title}</h1>
          {body ? <p className="scene-body mt-4 text-[#adbeaf]">{body}</p> : null}
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#0d1a14]/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur sm:p-6">
          <div className="lg:hidden">
            <h1 className="text-2xl font-bold leading-snug">{title}</h1>
            {body ? <p className="mt-2 text-sm leading-6 text-[#adbeaf]">{body}</p> : null}
          </div>
          <div className="mt-5 lg:mt-0">{children}</div>
          {footer ? <div className="mt-5 border-t border-white/10 pt-4 text-sm text-[#adbeaf]">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}

type AuthMethod = "email" | "phone";

function AuthIconButton({
  label,
  active,
  busy,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "border-[#38dc89] bg-[#38dc89]/15 text-[#9af0c3]"
          : "border-white/15 bg-white/5 text-[#f7fbf8] hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function providerErrorMessage(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/provider is not enabled|unsupported provider|validation_failed/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

function AuthAltIcons({
  busy,
  phoneActive,
  onPhone,
  onGoogle,
  onApple,
  notice,
}: {
  busy?: boolean;
  phoneActive?: boolean;
  onPhone: () => void;
  onGoogle: () => void;
  onApple: () => void;
  notice?: string | null;
}) {
  const copy = useAppCopy();
  return (
    <div className="mt-6 grid gap-3">
      <div className="flex items-center gap-3 text-xs text-[#8da195]" role="separator">
        <span className="h-px flex-1 bg-white/10" />
        {copy.auth.orContinue}
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="flex items-center justify-center gap-3">
        <AuthIconButton label={copy.auth.withPhone} active={phoneActive} busy={busy} onClick={onPhone}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current stroke-[1.8]">
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M10 18.5h4" strokeLinecap="round" />
          </svg>
        </AuthIconButton>
        <AuthIconButton label={copy.auth.withGoogle} busy={busy} onClick={onGoogle}>
          <span aria-hidden="true" className="text-lg font-bold text-[#8ab4f8]">G</span>
        </AuthIconButton>
        <AuthIconButton label={copy.auth.withApple} busy={busy} onClick={onApple}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-current">
            <path d="M16.4 12.7c0-2 1.6-3 1.7-3.1-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7-1.4 0-2.8.9-3.5 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.8 2.1 1.1 0 1.5-.7 2.9-.7s1.7.7 2.9.7c1.2 0 1.9-1 2.6-2 .8-1.2 1.1-2.3 1.1-2.4-.1 0-2.2-.9-2.2-3.4zM14.3 6.5c.6-.8 1-1.8.9-2.9-1 .1-2.1.7-2.8 1.5-.6.7-1.1 1.8-1 2.8 1.1.1 2.2-.5 2.9-1.4z" />
          </svg>
        </AuthIconButton>
      </div>
      <p className="text-center text-xs leading-5 text-[#8da195]">{copy.auth.socialNote}</p>
      {notice ? <Notice tone="warn">{notice}</Notice> : null}
    </div>
  );
}

function PhoneAuthForm({ onBack }: { onBack: () => void }) {
  const copy = useAppCopy();
  const router = useRouter();
  const { busy, run } = useAction();
  const [phone, setPhone] = useState("+968");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<FieldErrorKey>();
  const [codeError, setCodeError] = useState<FieldErrorKey>();
  const phoneErrText = useErrorText(phoneError);
  const codeErrText = useErrorText(codeError);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  return (
    <div className="grid gap-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field label={copy.auth.phone} required error={phoneErrText} hint={copy.auth.phoneHint}>
        {(p) => (
          <input
            {...p}
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      {sentTo ? (
        <Field label={copy.auth.code} required error={codeErrText} hint={copy.auth.codeHint}>
          {(p) => (
            <input
              {...p}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          busy={busy}
          busyLabel={copy.loading}
          disabled={busy || cooldown > 0}
          onClick={() => {
            setError(null);
            setPhoneError(undefined);
            const e164 = toE164Phone(phone);
            if (!e164) {
              setPhoneError("phone");
              return;
            }
            void run(async () => {
              try {
                const normalized = await sendPhoneOtp(phone);
                setSentTo(normalized);
                setPhone(normalized);
                setCooldown(RESEND_COOLDOWN_SEC);
              } catch (err) {
                setError(providerErrorMessage(err, copy.auth.phoneUnavailable));
              }
            });
          }}
        >
          {sentTo
            ? (cooldown > 0 ? fill(copy.auth.resendIn, { n: cooldown }) : copy.auth.resendCode)
            : copy.auth.sendCode}
        </Button>
        {sentTo ? (
          <Button
            type="button"
            busy={busy}
            busyLabel={copy.loading}
            onClick={() => {
              setError(null);
              setCodeError(undefined);
              if (!code.trim()) {
                setCodeError("required");
                return;
              }
              void run(async () => {
                try {
                  await verifyPhoneOtp(sentTo, code);
                  const next = await resolvePostAuthPath();
                  router.replace(next.ok ? next.data.next : "/setup");
                } catch (err) {
                  setError(providerErrorMessage(err, copy.errors.authFailed));
                }
              });
            }}
          >
            {copy.auth.verifyPhone}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onBack}>{copy.auth.withEmail}</Button>
      </div>
    </div>
  );
}

function useOAuthHandlers(setNotice: (v: string | null) => void) {
  const copy = useAppCopy();
  const { busy, run } = useAction();
  return {
    busy,
    onGoogle: () => {
      setNotice(null);
      void run(async () => {
        try {
          await startOAuth("google");
        } catch (err) {
          setNotice(providerErrorMessage(err, copy.auth.googleUnavailable));
        }
      });
    },
    onApple: () => {
      setNotice(null);
      void run(async () => {
        try {
          await startOAuth("apple");
        } catch (err) {
          setNotice(providerErrorMessage(err, copy.auth.appleUnavailable));
        }
      });
    },
  };
}

export function SignupPage() {
  const copy = useAppCopy();
  const { state, locale } = useDemo();
  const router = useRouter();
  const params = useSearchParams();
  const prefillEmail = (params.get("email") || "").trim().toLowerCase();
  const { busy, run } = useAction();
  const [method, setMethod] = useState<AuthMethod>("email");
  const [form, setForm] = useState({ name: "", email: prefillEmail, password: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password", FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [altNotice, setAltNotice] = useState<string | null>(null);
  const oauth = useOAuthHandlers(setAltNotice);
  const dirty = Boolean(form.name || form.email || form.password);
  useUnsavedWarning(dirty && !busy);
  const planName = landingCopy(locale).plans.find((p) => p.id === state.planInterest)?.name;
  const nameError = useErrorText(errors.name);
  const emailError = useErrorText(errors.email);
  const passwordError = useErrorText(errors.password);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "required";
    if (!isEmail(form.email)) next.email = "email";
    if (form.password.length < 8) next.password = "password";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    void run(async () => {
      const result = await signUpWithEmail({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      if (!result.ok) {
        setFormError(result.message ?? copy.errors.authFailed);
        return;
      }
      if (result.data.needsVerification) {
        router.push(`/verify-email?email=${encodeURIComponent(result.data.email)}`);
        return;
      }
      router.push("/setup");
    });
  }

  return (
    <AuthShell
      title={copy.auth.signupTitle}
      body={copy.auth.signupBody}
      footer={<>{copy.auth.haveAccount} <Link href="/login" className="text-[#38dc89] underline">{copy.auth.login}</Link></>}
    >
      {planName ? (
        <div className="mb-4">
          <Notice tone="info">{copy.auth.planInterest} <strong>{planName}</strong><br /><span className="text-[#8da195]">{copy.auth.planNote}</span></Notice>
        </div>
      ) : null}

      {method === "email" ? (
        <form className="grid gap-4" onSubmit={submitEmail} noValidate>
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label={copy.auth.name} required error={nameError}>
            {(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />}
          </Field>
          <Field label={copy.auth.email} required error={emailError}>
            {(p) => <input {...p} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" inputMode="email" />}
          </Field>
          <PasswordField label={copy.auth.password} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} hint={copy.auth.passwordHintReal} autoComplete="new-password" />
          <Button type="submit" busy={busy} busyLabel={copy.loading} className="mt-2 w-full">{copy.auth.createAccount}</Button>
        </form>
      ) : (
        <PhoneAuthForm onBack={() => setMethod("email")} />
      )}

      <AuthAltIcons
        busy={busy || oauth.busy}
        phoneActive={method === "phone"}
        onPhone={() => { setMethod(method === "phone" ? "email" : "phone"); setAltNotice(null); }}
        onGoogle={oauth.onGoogle}
        onApple={oauth.onApple}
        notice={altNotice}
      />
    </AuthShell>
  );
}

export function LoginPage() {
  const copy = useAppCopy();
  const router = useRouter();
  const params = useSearchParams();
  const { busy, run } = useAction();
  const [method, setMethod] = useState<AuthMethod>("email");
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<"email" | "password", FieldErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(() => {
    const err = params.get("error");
    if (err === "auth_callback") return copy.errors.authFailed;
    if (err === "oauth_cancelled") return params.get("detail") || copy.auth.oauthCancelled;
    return null;
  });
  const [altNotice, setAltNotice] = useState<string | null>(null);
  const oauth = useOAuthHandlers(setAltNotice);
  const emailError = useErrorText(errors.email);
  const passwordError = useErrorText(errors.password);

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const next: typeof errors = {};
    if (!isEmail(form.email)) next.email = "email";
    if (!form.password) next.password = "required";
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(async () => {
      const result = await signInWithEmail({
        email: form.email.trim(),
        password: form.password,
      });
      if (!result.ok) {
        setFormError(result.message ?? copy.errors.authFailed);
        return;
      }
      router.replace(result.data.next);
    });
  }

  return (
    <AuthShell
      title={copy.auth.loginTitle}
      body={copy.auth.loginBody}
      footer={<>{copy.auth.noAccount} <Link href="/signup" className="text-[#38dc89] underline">{copy.auth.signup}</Link></>}
    >
      {method === "email" ? (
        <form className="grid gap-4" onSubmit={submitEmail} noValidate>
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label={copy.auth.email} required error={emailError}>
            {(p) => <input {...p} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" inputMode="email" />}
          </Field>
          <PasswordField label={copy.auth.password} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} autoComplete="current-password" />
          <div className="flex items-center justify-between gap-3">
            <Link href="/forgot-password" className="text-sm text-[#38dc89] underline">{copy.auth.forgot}</Link>
          </div>
          <Button type="submit" busy={busy} busyLabel={copy.loading} className="w-full">{copy.auth.login}</Button>
        </form>
      ) : (
        <PhoneAuthForm onBack={() => setMethod("email")} />
      )}

      <AuthAltIcons
        busy={busy || oauth.busy}
        phoneActive={method === "phone"}
        onPhone={() => { setMethod(method === "phone" ? "email" : "phone"); setAltNotice(null); }}
        onGoogle={oauth.onGoogle}
        onApple={oauth.onApple}
        notice={altNotice}
      />
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const copy = useAppCopy();
  const router = useRouter();
  const params = useSearchParams();
  const emailFromQuery = (params.get("email") || "").trim().toLowerCase();
  const [registeredEmail, setRegisteredEmail] = useState(emailFromQuery);
  const [correctEmail, setCorrectEmail] = useState("");
  const [emailError, setEmailError] = useState<FieldErrorKey>();
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [hydrated, setHydrated] = useState(Boolean(emailFromQuery));
  const { busy, run } = useAction();
  const emailErrText = useErrorText(emailError);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        if (emailFromQuery) {
          setRegisteredEmail(emailFromQuery);
          setHydrated(true);
          return;
        }
        try {
          const { createClient } = await import("@/lib/supabase/client");
          const supabase = createClient();
          const { data } = await supabase.auth.getUser();
          setRegisteredEmail((data.user?.email ?? "").toLowerCase());
        } catch {
          setRegisteredEmail("");
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

  return (
    <AuthShell title={copy.auth.verifyTitle} body={fill(copy.auth.verifyBody, { email: registeredEmail || "…" })}>
      <div className="grid gap-4">
        <Notice tone="info">{copy.auth.verifyRealBody}</Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
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
        <Button
          busy={busy}
          busyLabel={copy.loading}
          disabled={!hydrated || !registeredEmail || busy || cooldown > 0}
          onClick={() => {
            if (busy || cooldown > 0 || !registeredEmail) return;
            setError(null);
            setResent(false);
            void run(async () => {
              const result = await resendVerificationEmail(registeredEmail);
              if (!result.ok) {
                setError(result.message ?? copy.errors.authFailed);
                return;
              }
              setResent(true);
              setCooldown(RESEND_COOLDOWN_SEC);
            });
          }}
        >
          {cooldown > 0 ? fill(copy.auth.resendIn, { n: cooldown }) : copy.auth.resend}
        </Button>

        <div className="grid gap-3 border-t border-white/10 pt-4">
          <p className="text-xs leading-5 text-[#8da195]">{copy.auth.correctEmailHint}</p>
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
                  setError(null);
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
              router.push(`/signup?email=${encodeURIComponent(cleaned)}`);
            }}
          >
            {copy.auth.correctEmail}
          </Button>
        </div>

        <LinkButton href="/login" variant="secondary">{copy.auth.login}</LinkButton>
      </div>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const copy = useAppCopy();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<FieldErrorKey>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { busy, run } = useAction();
  const emailError = useErrorText(error);
  return (
    <AuthShell title={copy.auth.forgotTitle} body={copy.auth.forgotBody} footer={<Link href="/login" className="text-[#38dc89] underline">{copy.auth.login}</Link>}>
      {sent ? (
        <div className="grid gap-4">
          <Notice tone="success">{copy.auth.resetPrepared}</Notice>
          <LinkButton href="/login" variant="secondary">{copy.auth.login}</LinkButton>
        </div>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            if (!isEmail(email)) { setError("email"); return; }
            setError(undefined);
            void run(async () => {
              const result = await requestPasswordReset(email);
              if (!result.ok) {
                setFormError(result.message ?? copy.errors.authFailed);
                return;
              }
              setSent(true);
            });
          }}
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label={copy.auth.email} required error={emailError}>
            {(p) => <input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />}
          </Field>
          <Button type="submit" busy={busy} busyLabel={copy.loading} className="w-full">{copy.auth.sendReset}</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const copy = useAppCopy();
  const router = useRouter();
  const [ready, setReady] = useState<"loading" | "ok" | "missing">("loading");
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
          const { createClient } = await import("@/lib/supabase/client");
          const supabase = createClient();
          const { data } = await supabase.auth.getUser();
          setReady(data.user ? "ok" : "missing");
        } catch {
          setReady("missing");
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <AuthShell title={copy.auth.resetTitle} footer={<Link href="/login" className="text-[#38dc89] underline">{copy.auth.login}</Link>}>
      {ready === "loading" ? <p className="text-sm text-[#adbeaf]">{copy.loading}</p> : null}
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
            setFormError(null);
            const next: typeof errors = {};
            if (form.password.length < 8) next.password = "password";
            if (form.confirm !== form.password) next.confirm = "match";
            setErrors(next);
            if (Object.keys(next).length) return;
            void run(async () => {
              const result = await updatePassword(form.password);
              if (!result.ok) {
                setFormError(result.message ?? copy.errors.authFailed);
                return;
              }
              setDone(true);
              router.refresh();
            });
          }}
        >
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <PasswordField label={copy.auth.newPassword} value={form.password} onChange={(v) => setForm({ ...form, password: v })} error={passwordError} hint={copy.auth.passwordHintReal} autoComplete="new-password" />
          <PasswordField label={copy.auth.confirmPassword} value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} error={confirmError} autoComplete="new-password" />
          <Button type="submit" busy={busy} busyLabel={copy.loading} className="w-full">{copy.auth.setPassword}</Button>
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
  const { state, update } = useDemo();
  const router = useRouter();
  const { busy, run } = useAction();
  const business = state.business.name || copy.auth.inviteNoBusiness;
  const params = useSearchParams();
  const inviteId = params.get("invite");
  const invited = state.team.find((m) => m.id === inviteId) ?? state.team.find((m) => m.status === "invited") ?? sampleStaff;

  return (
    <AuthShell title={copy.auth.inviteTitle} body={fill(copy.auth.inviteBody, { business, role: copy.auth.roleStaff })}>
      <div className="grid gap-4">
        <Notice tone="warn">{copy.auth.invitePreviewOnly}</Notice>
        <div className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-[#adbeaf]">{copy.setup.businessName}</span><strong>{business}</strong></div>
          <div className="flex justify-between gap-3"><span className="text-[#adbeaf]">{copy.app.roleLabel}</span><strong>{copy.auth.roleStaff}</strong></div>
          <div className="flex justify-between gap-3"><span className="text-[#adbeaf]">{copy.auth.email}</span><span dir="ltr">{invited.email}</span></div>
        </div>
        <Button
          busy={busy}
          busyLabel={copy.loading}
          className="w-full"
          onClick={() => {
            void run(() => {
              update((s) => ({
                account: { name: invited.name, email: invited.email, role: "staff" },
                stage: "active",
                signedIn: true,
                viewAs: "staff",
                team: s.team.some((m) => m.id === invited.id)
                  ? s.team.map((m) => (m.id === invited.id ? { ...m, status: "active" } : m))
                  : [...s.team, { ...invited, status: "active" }],
              }));
              router.push("/login");
            });
          }}
        >
          {copy.auth.login}
        </Button>
      </div>
    </AuthShell>
  );
}
