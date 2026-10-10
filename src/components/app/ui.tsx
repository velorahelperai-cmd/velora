"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { appCopy } from "@/lib/app-copy";

export function useAppCopy() {
  const { locale } = useDemo();
  return appCopy(locale);
}

/** Store these keys in form state so switching locale re-translates errors. */
export type FieldErrorKey = keyof ReturnType<typeof appCopy>["errors"];

export function useErrorText(key?: FieldErrorKey | null): string | undefined {
  const copy = useAppCopy();
  return key ? copy.errors[key] : undefined;
}

const inputBase =
  "min-h-11 w-full min-w-0 rounded-xl border bg-[var(--color-panel-deep)] px-3 text-[15px] text-[var(--color-on-dark)] outline-none transition focus-visible:ring-2 focus-visible:ring-[#38dc89] placeholder:text-[var(--color-muted-soft)]";

export function Field({
  label,
  required,
  hint,
  error,
  children,
  dir,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string; className: string }) => ReactNode;
  dir?: "ltr" | "rtl";
}) {
  const copy = useAppCopy();
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div
      className="grid min-w-0 gap-1.5"
      dir={dir}
      onFocusCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.matches("input, textarea, select")) {
          const reduce = target.closest('[data-internal-ui="true"]')
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
      }}
    >
      <label htmlFor={id} className="flex items-center justify-between text-sm text-[var(--color-on-dark)]">
        <span>{label}</span>
        <span className={`text-xs ${required ? "text-[var(--color-action-on-dark)]" : "text-[var(--color-muted-soft)]"}`}>{required ? copy.required : copy.optional}</span>
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        className: `${inputBase} scroll-mb-28 ${error ? "border-[var(--color-danger)]" : "border-[color:var(--color-border-soft)]"}`,
      })}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-[var(--color-muted-soft)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  autoComplete: string;
}) {
  const copy = useAppCopy();
  const [show, setShow] = useState(false);
  return (
    <Field label={label} required hint={hint} error={error}>
      {(p) => (
        <div className="relative">
          <input
            {...p}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete={autoComplete}
            dir="ltr"
            className={`${p.className} pr-32`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-1 right-1 inline-flex min-h-9 items-center rounded-lg px-3 text-xs text-[var(--color-action-on-dark)] hover:bg-[var(--color-hover-wash)]"
          >
            {show ? copy.hidePassword : copy.showPassword}
          </button>
        </div>
      )}
    </Field>
  );
}

export function Button({
  children,
  variant = "primary",
  busy,
  busyLabel,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
  busyLabel?: string;
}) {
  const styles = {
    primary: "bg-[#38dc89] text-[#072317] hover:bg-[#4fe79a]",
    secondary: "border border-[color:var(--color-border-soft)] text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)]",
    ghost: "text-[var(--color-action-on-dark)] hover:bg-[var(--color-hover-wash)]",
    danger: "border border-[color:var(--color-danger)]/60 text-[var(--color-danger-fg)] hover:bg-[color:var(--color-danger)]/10",
  }[variant];
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    >
      {busy ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const styles = {
    primary: "bg-[#38dc89] text-[#072317] hover:bg-[#4fe79a]",
    secondary: "border border-[color:var(--color-border-soft)] text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)]",
    ghost: "text-[var(--color-action-on-dark)] hover:bg-[var(--color-hover-wash)]",
  }[variant];
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error" | "warn"; children: ReactNode }) {
  const styles = {
    info: "border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] text-[var(--color-on-dark)]",
    success: "border-[#38dc89]/40 bg-[#38dc89]/10 text-[var(--color-success-fg)]",
    error: "border-[color:var(--color-danger)]/50 bg-[color:var(--color-danger)]/10 text-[var(--color-danger-fg)]",
    warn: "border-[#d9a467]/50 bg-[#d9a467]/10 text-[var(--color-warn-fg)]",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm leading-6 ${styles}`}>
      {children}
    </div>
  );
}

export function PreviewBadge(props: { note?: boolean }) {
  void props;
  return null;
}

export function SimTag() {
  const copy = useAppCopy();
  return <span className="rounded-md bg-[var(--color-hover-wash)] px-2 py-0.5 text-[11px] text-[var(--color-muted-on-dark)]">{copy.simulated}</span>;
}

export function LangSwitch() {
  const { locale, setLocale } = useDemo();
  const copy = appCopy(locale);
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
      aria-label={copy.langAria}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[color:var(--color-border-soft)] px-3 text-sm text-[var(--color-on-dark)]"
    >
      {copy.lang}
    </button>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--color-line)] bg-[var(--color-hover-wash)] p-6 text-center">
      <p className="font-semibold text-[var(--color-on-dark)]">{title}</p>
      {body ? <p className="mt-2 text-sm leading-6 text-[var(--color-muted-on-dark)]">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "", aside }: { title?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-[color:var(--color-line)] bg-[var(--color-panel)] p-5 shadow-[0_8px_28px_rgba(16,27,22,0.06)] ${className}`}>
      {title ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-[var(--color-on-dark)]">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const copy = useAppCopy();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("button")];
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
      role="presentation"
      onClick={onCancel}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-5 text-[var(--color-on-dark)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold">{title}</h2>
        {body ? <p className="mt-2 text-sm leading-6 text-[var(--color-muted-on-dark)]">{body}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>{copy.cancel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/** Warns before leaving the tab/page while a form has unsaved changes. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/** Simulates a short async action and blocks repeat clicks while running. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => void | Promise<void>, ms = 0) => {
    if (busy) return;
    setBusy(true);
    try {
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const isPhone = (v: string) => /^\+\d{7,15}$/.test(v.replace(/[\s-]/g, ""));

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full border border-[color:var(--color-border-soft)] bg-[#0d1a14] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`min-h-11 shrink-0 snap-start rounded-full px-4 text-sm transition ${value === t.id ? "bg-[#38dc89] text-[#072317]" : "text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)]"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
