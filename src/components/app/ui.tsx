"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type AriaRole, type ReactNode } from "react";
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
  "min-h-11 w-full min-w-0 rounded-xl border bg-[var(--color-panel-deep)] px-3 text-base text-[var(--color-on-dark)] outline-none transition focus-visible:ring-2 focus-visible:ring-[#38dc89] placeholder:text-[var(--color-muted-soft)]";

/** Owner-approved motion entry chrome (login/signup card fields). */
const inputEntry =
  "min-h-0 w-full min-w-0 rounded-xl border border-[#DCE4EB] bg-[#F0F4F6] py-2.5 ps-10 pe-4 text-xs text-[#172D43] outline-none transition placeholder:text-[#8A9BAB] focus:border-[#087E8B]/70 focus-visible:ring-2 focus-visible:ring-[#087E8B]/35";

export function Field({
  label,
  required,
  hint,
  error,
  children,
  dir,
  tone = "default",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string; className: string }) => ReactNode;
  dir?: "ltr" | "rtl";
  tone?: "default" | "entry";
}) {
  const copy = useAppCopy();
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const entry = tone === "entry";
  return (
    <div
      className={entry ? "min-w-0" : "grid min-w-0 gap-1.5"}
      dir={dir}
      onFocusCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.matches("input, textarea, select")) {
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
      }}
    >
      <label
        htmlFor={id}
        className={
          entry
            ? "mb-1.5 block text-xs text-[#536579]"
            : "flex items-center justify-between text-sm text-[var(--color-on-dark)]"
        }
      >
        {entry ? (
          label
        ) : (
          <>
            <span>{label}</span>
            <span className={`text-xs ${required ? "text-[var(--color-action-on-dark)]" : "text-[var(--color-muted-soft)]"}`}>
              {required ? copy.required : copy.optional}
            </span>
          </>
        )}
      </label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        className: entry
          ? `${inputEntry} scroll-mb-28 ${error ? "border-[var(--color-danger)]" : ""}`
          : `${inputBase} scroll-mb-28 ${error ? "border-[var(--color-danger)]" : "border-[color:var(--color-border-soft)]"}`,
      })}
      {error ? (
        <p id={`${id}-err`} role="alert" className={entry ? "mt-1 text-xs text-[var(--color-danger-fg)]" : "text-sm text-[var(--color-danger-fg)]"}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={entry ? "mt-1 text-[11px] leading-4 text-[#536579]" : "text-xs leading-5 text-[var(--color-muted-soft)]"}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  tone = "default",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  autoComplete: string;
  tone?: "default" | "entry";
}) {
  const copy = useAppCopy();
  const [show, setShow] = useState(false);
  const entry = tone === "entry";
  return (
    <Field label={label} required hint={hint} error={error} tone={tone}>
      {(p) => (
        <div className="relative flex items-center">
          {entry ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute start-3.5 h-4 w-4 text-[#536579]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : null}
          <input
            {...p}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete={autoComplete}
            dir="ltr"
            className={entry ? `${p.className} pe-10` : `${p.className} pr-32`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? copy.hidePassword : copy.showPassword}
            className={
              entry
                ? "absolute end-3.5 text-[#536579] hover:text-[#172D43]"
                : "absolute inset-y-1 right-1 inline-flex min-h-9 items-center rounded-lg px-3 text-xs text-[var(--color-action-on-dark)] hover:bg-[var(--color-hover-wash)]"
            }
          >
            {entry ? <EyeIcon open={show} /> : show ? copy.hidePassword : copy.showPassword}
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
  variant?: "primary" | "secondary" | "ghost" | "danger" | "entry";
  busy?: boolean;
  busyLabel?: string;
}) {
  const styles = {
    primary: "min-h-11 rounded-full bg-[#38dc89] px-5 text-sm text-[#072317] hover:bg-[#4fe79a] focus-visible:ring-[#38dc89]",
    secondary: "min-h-11 rounded-full border border-[color:var(--color-border-soft)] px-5 text-sm text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)] focus-visible:ring-[#38dc89]",
    ghost: "min-h-11 rounded-full px-5 text-sm text-[var(--color-action-on-dark)] hover:bg-[var(--color-hover-wash)] focus-visible:ring-[#38dc89]",
    danger: "min-h-11 rounded-full border border-[color:var(--color-danger)]/60 px-5 text-sm text-[var(--color-danger-fg)] hover:bg-[color:var(--color-danger)]/10 focus-visible:ring-[#38dc89]",
    entry:
      "min-h-0 w-full rounded-xl bg-gradient-to-r from-[#087E8B] to-[#066975] px-5 py-2.5 text-xs font-semibold text-white shadow-[0_0_25px_rgba(8,126,139,0.20)] hover:brightness-105 focus-visible:ring-[#087E8B]",
  }[variant];
  return (
    <button
      {...rest}
      data-button={variant}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
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
      data-button={variant}
      className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Notice({
  tone = "info",
  children,
  id,
  role,
}: {
  tone?: "info" | "success" | "error" | "warn";
  children: ReactNode;
  id?: string;
  role?: AriaRole;
}) {
  const styles = {
    info: "border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] text-[var(--color-on-dark)]",
    success: "border-[#38dc89]/40 bg-[#38dc89]/10 text-[var(--color-success-fg)]",
    error: "border-[color:var(--color-danger)]/50 bg-[color:var(--color-danger)]/10 text-[var(--color-danger-fg)]",
    warn: "border-[#d9a467]/50 bg-[#d9a467]/10 text-[var(--color-warn-fg)]",
  }[tone];
  return (
    <div
     data-notice={tone}
     id={id}
     role={role ?? (tone === "error" ? "alert" : "status")}
     className={`rounded-xl border px-4 py-3 text-sm leading-6 ${styles}`}
    >
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

/** Blocks repeat calls synchronously while an async action is running. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const run = async (fn: () => void | Promise<void>, ms = 0) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      await fn();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const isPhone = (v: string) => /^\+\d{7,15}$/.test(v.replace(/[\s-]/g, ""));

export function Tabs<T extends string>({ tabs, value, onChange, panelId }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; panelId?: string }) {
  return (
    <div role={panelId ? "tablist" : "group"} className="flex gap-1 overflow-x-auto rounded-full border border-[color:var(--color-border-soft)] bg-[#0d1a14] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <button
          key={t.id}
          role={panelId ? "tab" : undefined}
          id={panelId ? `${panelId}-tab-${t.id}` : undefined}
          aria-controls={panelId}
          tabIndex={value === t.id ? 0 : -1}
          type="button"
          aria-selected={panelId ? value === t.id : undefined}
          aria-pressed={panelId ? undefined : value === t.id}
          onKeyDown={event => {
            const direction = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
            const index = tabs.findIndex(tab => tab.id === t.id);
            let next: number;
            if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else if (event.key === "ArrowRight") next = (index + direction + tabs.length) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index - direction + tabs.length) % tabs.length;
            else return;
            event.preventDefault();
            (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
            onChange(tabs[next].id);
          }}
          onClick={() => onChange(t.id)}
          className={`min-h-11 shrink-0 snap-start rounded-full px-4 text-sm transition ${value === t.id ? "bg-[#38dc89] text-[#072317]" : "text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)]"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
