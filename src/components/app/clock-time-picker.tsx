"use client";
import {useEffect, useId, useRef, useState} from "react";
import styles from "./clock-time-picker.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  locale: "ar" | "en";
  /** Accessible name of the typed time field (keyboard entry). */
  inputLabel?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function parse(value: string) {
  const [h, m] = (value || "09:00").split(":").map(Number);
  return {h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0};
}

/** Locale clock label for a stored 24h "HH:MM" value. One visible time — never a second conflicting box. */
export function formatClockDisplay(value: string, locale: "ar" | "en"): string {
  const {h, m} = parse(value);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const marker = pm ? (locale === "ar" ? "م" : "PM") : (locale === "ar" ? "ص" : "AM");
  return `${pad(h12)}:${pad(m)} ${marker}`;
}

/** Parse typed time: "09:30", "9:30", "0930", "9:30 pm", "9 م", Arabic digits. Returns 24h "HH:MM" or null. */
export function parseTypedTime(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));
  // Read the AM/PM marker before "." becomes a separator, so "p.m." stays intact.
  const pm = /(p\.?m\.?|م|مساء|مساءً)\s*$/.test(s);
  const am = /(a\.?m\.?|ص|صباح|صباحًا|صباحا)\s*$/.test(s);
  s = s.replace(/(p\.?m\.?|a\.?m\.?|مساءً|مساء|صباحًا|صباحا|صباح|م|ص)\s*$/, "").trim().replace(/[٫،.]/g, ":");
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(s);
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] === undefined ? 0 : Number(match[2]);
  if (m > 59) return null;
  if (pm || am) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function ClockTimePicker({value, onChange, disabled, label, locale, inputLabel}: Props) {
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => formatClockDisplay(value, locale));
  const [typing, setTyping] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  const displayText = typing ? text : formatClockDisplay(value, locale);
  const showInvalid = typing && invalid;
  const {h, m} = parse(value);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const set = (hour: number, minute: number) => onChange(`${pad(hour)}:${pad(minute)}`);
  const pickHour = (n: number) => { set((n % 12) + (pm ? 12 : 0), m); setMode("minute"); };
  const pickMinute = (n: number) => { set(h, n); setOpen(false); setMode("hour"); };
  const setPeriod = (toPm: boolean) => { if (toPm !== pm) set(toPm ? h + 12 : h - 12, m); };

  const items = mode === "hour" ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  const current = mode === "hour" ? h12 : m - (m % 5);
  const angle = (i: number) => (i * 30 - 90) * (Math.PI / 180);
  const selIndex = items.indexOf(current);

  return (
    <div className={styles.root} ref={root} data-clock-time-picker="">
      <div className={styles.control}>
        <input type="text" className={styles.typed} dir="ltr" inputMode="text" autoComplete="off" spellCheck={false}
          maxLength={14} placeholder={ar ? "10:00 ص" : "10:00 AM"} value={displayText} disabled={disabled}
          aria-label={inputLabel || label} aria-invalid={showInvalid || undefined} aria-describedby={hintId}
          onFocus={() => { setText(formatClockDisplay(value, locale)); setInvalid(false); setTyping(true); }}
          onChange={(e) => {
            const next = e.target.value; setTyping(true); setText(next);
            const parsed = parseTypedTime(next);
            setInvalid(parsed === null && next.trim() !== "");
            if (parsed && parsed !== value) onChange(parsed);
          }}
          onBlur={() => { setTyping(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const parsed = parseTypedTime(text);
              if (parsed) { e.preventDefault(); setTyping(false); }
            }
          }} />
        <button type="button" className={styles.trigger} disabled={disabled} aria-label={label} aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => { setMode("hour"); setOpen((v) => !v); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>
      <span id={hintId} className={showInvalid ? styles.typedError : styles.srOnly} role={showInvalid ? "alert" : undefined}>
        {showInvalid ? (ar ? "اكتب الوقت مثل 09:30 أو 9:30 م" : "Type a time like 09:30 or 9:30 PM")
          : (ar ? "وقت واحد بصيغة 12 ساعة (ص/م)، أو 24 ساعة مثل 14:00" : "One 12-hour time (AM/PM), or 24-hour like 14:00")}
      </span>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={label}>
          <div className={styles.head} dir="ltr">
            <button type="button" className={mode === "hour" ? styles.active : ""} onClick={() => setMode("hour")}>{pad(h12)}</button>
            <span>:</span>
            <button type="button" className={mode === "minute" ? styles.active : ""} onClick={() => setMode("minute")}>{pad(m)}</button>
            <div className={styles.period}>
              <button type="button" aria-pressed={!pm} className={!pm ? styles.active : ""} onClick={() => setPeriod(false)}>{ar ? "ص" : "AM"}</button>
              <button type="button" aria-pressed={pm} className={pm ? styles.active : ""} onClick={() => setPeriod(true)}>{ar ? "م" : "PM"}</button>
            </div>
          </div>
          <div className={styles.dial} dir="ltr">
            {selIndex >= 0 && (
              <span className={styles.hand} style={{transform: `rotate(${selIndex * 30}deg)`}} aria-hidden="true" />
            )}
            <span className={styles.center} aria-hidden="true" />
            {items.map((n, i) => (
              <button key={n} type="button"
                className={`${styles.num} ${n === current ? styles.selected : ""}`}
                style={{left: `${50 + 40 * Math.cos(angle(i))}%`, top: `${50 + 40 * Math.sin(angle(i))}%`}}
                onClick={() => (mode === "hour" ? pickHour(n) : pickMinute(n))}
                aria-label={mode === "hour" ? `${n}` : `${pad(n)}`}>
                {mode === "hour" ? n : pad(n)}
              </button>
            ))}
          </div>
          <p className={styles.note}>{mode === "hour" ? (ar ? "اختر الساعة" : "Pick the hour") : (ar ? "اختر الدقائق" : "Pick the minutes")}</p>
        </div>
      )}
    </div>
  );
}
