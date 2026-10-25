"use client";

import { useEffect, useRef, useState } from "react";
import { IconGlobe } from "@/components/admin/admin-icons";
import { appCopy } from "@/lib/app-copy";
import { useDemo } from "@/lib/demo-state";
import type { Locale } from "@/lib/i18n";
import styles from "./setup-studio.module.css";

const STUDIO_LOCALES = [
  { id: "ar" as const, short: "AR", label: "العربية" },
  { id: "en" as const, short: "EN", label: "English" },
] as const;

/** Homepage-style locale chooser (globe + menu), light chrome for /setup studio. */
export function SetupStudioLangSwitch() {
  const { locale, setLocale } = useDemo();
  const copy = appCopy(locale);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  function apply(next: Locale) {
    setOpen(false);
    if (next !== locale) setLocale(next);
  }
  return (
    <div ref={rootRef} className={styles.langSwitch} data-studio-lang="true">
      <button
        type="button"
        className={styles.langTrigger}
        onClick={() => setOpen((value) => !value)}
        aria-label={copy.langAria}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={copy.langAria}
      >
        <IconGlobe className={styles.langGlobe} />
        <span aria-hidden="true">{copy.lang}</span>
      </button>
      {open ? (
        <ul role="listbox" aria-label={copy.langAria} className={styles.langMenu}>
          {STUDIO_LOCALES.map((option) => {
            const selected = option.id === locale;
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={styles.langOption}
                  data-selected={selected ? "true" : undefined}
                  onClick={() => apply(option.id)}
                >
                  <span>{option.label}</span>
                  <span aria-hidden="true" className={styles.langShort}>
                    {option.short}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
