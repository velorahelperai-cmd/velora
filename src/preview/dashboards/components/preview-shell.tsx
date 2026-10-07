"use client";

import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fill, previewCopy, type PreviewLocale } from "../copy";
import type { UiScenario } from "../fixtures/types";
import {
  playPreviewBoardMotion,
  playPreviewShellMotion,
  prefersReducedMotion,
} from "./preview-board-motion";
import styles from "./preview-motion.module.css";

gsap.registerPlugin(useGSAP);

export function DesignPreviewBadge({ locale }: { locale: PreviewLocale }) {
  const c = previewCopy(locale);
  return (
    <span title={c.designPreviewNote} className={styles.badge}>
      <span
        data-preview-badge-dot
        className="h-1.5 w-1.5 rounded-full bg-[#d9a467]"
        aria-hidden
      />
      {c.designPreview}
    </span>
  );
}

export function PreviewShell({
  locale,
  onLocale,
  title,
  scenario,
  scenarios,
  onScenario,
  children,
}: {
  locale: PreviewLocale;
  onLocale: (l: PreviewLocale) => void;
  title: string;
  scenario: UiScenario;
  scenarios: UiScenario[];
  onScenario: (s: UiScenario) => void;
  children: ReactNode;
}) {
  const c = previewCopy(locale);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      playPreviewShellMotion(root);
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      const board = boardRef.current;
      if (!board) return;
      const cleanup = playPreviewBoardMotion(board, scenario);
      return cleanup;
    },
    { scope: boardRef, dependencies: [scenario, locale], revertOnUpdate: true },
  );

  return (
    <div ref={rootRef} className={styles.root} dir={dir}>
      <div data-preview-ambient className={styles.ambient} aria-hidden />
      <div className={styles.shellContent}>
        <header data-preview-header className={styles.header}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Link href="/preview/dashboards" className={`text-sm font-medium hover:underline ${styles.linkAccent}`}>
                {c.backIndex}
              </Link>
              <h1 className="text-base font-bold tracking-tight sm:text-lg">{title}</h1>
              <DesignPreviewBadge locale={locale} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`flex items-center gap-2 text-xs ${styles.muted}`}>
                <span className="whitespace-nowrap">{c.scenario}</span>
                <select
                  value={scenario}
                  onChange={(e) => onScenario(e.target.value as UiScenario)}
                  className={styles.select}
                >
                  {scenarios.map((s) => (
                    <option key={s} value={s}>
                      {c.statusLabels[s]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label={c.langAria}
                onClick={() => onLocale(locale === "ar" ? "en" : "ar")}
                className={styles.langBtn}
              >
                {c.lang}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <div ref={boardRef} key={`${scenario}-${locale}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function usePreviewLocale(initial: PreviewLocale = "ar") {
  const [locale, setLocale] = useState<PreviewLocale>(initial);
  return { locale, setLocale };
}

export function TonePill({ tone, children }: { tone: string; children: ReactNode }) {
  const map: Record<string, string> = {
    ok: styles.pillOk,
    warn: styles.pillWarn,
    bad: styles.pillBad,
    muted: styles.pillMuted,
    info: styles.pillInfo,
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[tone] ?? styles.pillInfo}`}>
      {children}
    </span>
  );
}

export function PreviewPanel({
  title,
  aside,
  children,
  className = "",
  muted,
  lift = true,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  muted?: boolean;
  lift?: boolean;
}) {
  return (
    <section
      data-preview-card
      className={`${styles.panel} ${muted ? styles.panelMuted : ""} ${lift ? styles.cardLift : ""} ${className}`}
    >
      {title ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PreviewNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const toneClass =
    tone === "warn" ? styles.noticeWarn : tone === "error" ? styles.noticeError : styles.noticeInfo;
  return (
    <div data-preview-banner role={tone === "error" ? "alert" : "status"} className={`${styles.notice} ${toneClass}`}>
      {children}
    </div>
  );
}

export function PreviewEmpty({ title, body }: { title: string; body?: string }) {
  return (
    <div className={styles.empty}>
      <p className="font-semibold">{title}</p>
      {body ? <p className={`mt-2 text-sm leading-6 ${styles.muted}`}>{body}</p> : null}
    </div>
  );
}

export function PreviewAction({
  locale,
  label,
  dest,
  kind = "nav",
}: {
  locale: PreviewLocale;
  label: string;
  dest?: string;
  kind?: "nav" | "illustrative" | "payment";
}) {
  const c = previewCopy(locale);
  const hint =
    kind === "payment"
      ? c.btnNoPayment
      : kind === "illustrative"
        ? c.btnIllustrative
        : dest
          ? fill(c.btnGoesTo, { dest })
          : c.btnIllustrative;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={styles.actionBtn}
        onClick={() => {
          if (prefersReducedMotion()) return;
          /* design preview — no side effects */
        }}
        title={hint}
      >
        {label}
      </button>
      <span className={`max-w-xs text-[11px] leading-4 ${styles.soft}`}>{hint}</span>
    </div>
  );
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`${styles.skeleton} ${className}`} aria-hidden />;
}

export { styles as previewStyles };
