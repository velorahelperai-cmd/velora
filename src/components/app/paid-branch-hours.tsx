"use client";
import {useId, useLayoutEffect, useRef, useState} from "react";
import {
  BRANCH_HOURS_DAYS, cloneBranchHours, emptyBranchHours, knownBranchHoursTimezone, prepareBranchHoursCopy,
  prepareBranchHoursSave, sameBranchHoursScope, validateBranchHours,
  type BranchHoursCopyDraft, type BranchHoursCopyTarget, type BranchHoursDay,
  type BranchHoursDayValue, type BranchHoursSaveDraft, type BranchHoursScope,
  type BranchHoursSnapshot, type BranchHoursException, type BranchHoursSchedule,
} from "@/lib/tenancy/branch-hours-contracts";
import styles from "./paid-branch-hours.module.css";
import {confirmSetupLeave,useSetupUnsavedChanges} from './paid-setup-unsaved';

export type PaidBranchHoursProps = {
  locale: "ar" | "en";
  scope: BranchHoursScope;
  boundaryFingerprint: string;
  snapshot: BranchHoursSnapshot | null;
  /** Supplied by the integration host; a resolved callback is never a save receipt. */
  state: {scope: BranchHoursScope; version: number | null; phase: "loading" | "ready" | "saving" | "saved" | "conflict" | "unavailable"};
  copyTargets: readonly BranchHoursCopyTarget[];
  isCurrent: () => boolean;
  onSave?: (draft: BranchHoursSaveDraft) => void | Promise<void>;
  onCopy?: (draft: BranchHoursCopyDraft) => void | Promise<void>;
  onReload?: (scope: BranchHoursScope) => void;
};

export const branchHoursViewKey = (p: PaidBranchHoursProps) => JSON.stringify([
  p.scope.expectedAccountId, p.scope.companyId, p.scope.branchId, p.boundaryFingerprint,
  p.snapshot?.version,
]);

const dayLabels: Record<BranchHoursDay, [string, string]> = {
  sunday: ["الأحد", "Sunday"], monday: ["الاثنين", "Monday"], tuesday: ["الثلاثاء", "Tuesday"], wednesday: ["الأربعاء", "Wednesday"],
  thursday: ["الخميس", "Thursday"], friday: ["الجمعة", "Friday"], saturday: ["السبت", "Saturday"],
};

const DISPLAY_DAYS: readonly BranchHoursDay[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

const previousDayOf: Record<BranchHoursDay, BranchHoursDay> = {
  sunday: "saturday",
  monday: "sunday",
  tuesday: "monday",
  wednesday: "tuesday",
  thursday: "wednesday",
  friday: "thursday",
  saturday: "friday",
};

const WORKDAYS_SUN_THU: readonly BranchHoursDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday"];
const ALL_WEEK_DAYS: readonly BranchHoursDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WORKDAYS_SAT_THU: readonly BranchHoursDay[] = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday"];

type QuickApplyTarget = "open" | "all" | "workdays";
type HoursPreset = "workdays_sun_thu" | "all_week" | "workdays_sat_thu";

export function PaidBranchHours(p: PaidBranchHoursProps) {
  const t = (ar: string, en: string) => p.locale === "ar" ? ar : en;
  const scoped = !!p.boundaryFingerprint && sameBranchHoursScope(p.scope, p.state.scope);

  // Security & tenant boundary: fail closed if boundary is missing or scope is mismatched
  if (!scoped || (p.snapshot && (!sameBranchHoursScope(p.scope, p.snapshot.scope) || (p.state.version !== null && p.state.version !== p.snapshot.version) || !validateBranchHours(p.snapshot.schedule).ok))) {
    return (
      <section className={styles.view} dir={p.locale === "ar" ? "rtl" : "ltr"}>
        <p role="status">{t("مواعيد هذا الفرع غير متاحة. أعد تحميل بيانات الفرع.", "Hours for this branch are unavailable. Reload the branch data.")}</p>
      </section>
    );
  }

  // Key on scope and boundary to prevent remount churn when version updates
  const scopeKey = `${p.scope.expectedAccountId}:${p.scope.companyId}:${p.scope.branchId}:${p.boundaryFingerprint}`;
  return <HoursForm key={scopeKey} {...p} />;
}

function HoursForm(p: PaidBranchHoursProps) {
  const ar = p.locale === "ar", t = (a: string, e: string) => ar ? a : e, id = useId();
  const formId = `${id}-hours-form`;
  const initialSchedule = p.snapshot?.schedule ? cloneBranchHours(p.snapshot.schedule) : emptyBranchHours();
  const [draft, setDraft] = useState<BranchHoursSchedule>(() => initialSchedule);
  const [selected, setSelected] = useState<string[]>([]);
  const [showCopy, setShowCopy] = useState(false);
  const [showExceptions, setShowExceptions] = useState(() => (initialSchedule.exceptions?.length ?? 0) > 0);
  const [activePreset, setActivePreset] = useState<HoursPreset | null>(null);
  const [quickTarget, setQuickTarget] = useState<QuickApplyTarget>("workdays");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [conflictWithServer, setConflictWithServer] = useState(false);

  const mounted = useRef(false), reserved = useRef(false);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);

  const [userEdited,setUserEdited]=useState(false);
  const [sourceVersion,setSourceVersion]=useState(p.snapshot?.version??null);

  // Adopt a new server revision during this render, before children commit.
  // Dirty local fields remain intact and the difference is explicitly shown.
  if(p.snapshot&&sourceVersion!==p.snapshot.version){
    setSourceVersion(p.snapshot.version);
    if(!userEdited){setDraft(cloneBranchHours(p.snapshot.schedule));setConflictWithServer(false);}
    else setConflictWithServer(JSON.stringify(draft)!==JSON.stringify(cloneBranchHours(p.snapshot.schedule)));
  }

  // Find initial quick hours from first configured day or fallback to standard 09:00-17:00
  const findFirstInterval = (sch: BranchHoursSchedule) => {
    for (const d of DISPLAY_DAYS) {
      const val = sch[d];
      if (val.state === "open" && val.intervals.length > 0 && val.intervals[0].start && val.intervals[0].end) {
        return val.intervals[0];
      }
    }
    return null;
  };

  const initialInterval = findFirstInterval(initialSchedule);
  const [quickStart, setQuickStart] = useState(() => initialInterval?.start || "09:00");
  const [quickEnd, setQuickEnd] = useState(() => initialInterval?.end || "17:00");
  const [quickNextDay, setQuickNextDay] = useState(() => initialInterval?.nextDay || false);

  const locked = busy || p.state.phase === "saving" || p.state.phase === "conflict";
  const validated = validateBranchHours(draft);

  const canSaveAuthoritative = (p.state.phase === "ready" || p.state.phase === "saved") && p.snapshot !== null && typeof p.snapshot.version === "number" && knownBranchHoursTimezone(p.snapshot.timezone);
  const save = canSaveAuthoritative && p.snapshot ? prepareBranchHoursSave(p.scope, p.snapshot, draft) : { ok: false as const };
  const copy = canSaveAuthoritative && p.snapshot ? prepareBranchHoursCopy(p.scope, p.snapshot, draft, p.copyTargets, selected) : { ok: false as const };

  const fingerprint = JSON.stringify([p.scope, p.snapshot?.version, draft, selected, p.copyTargets]);
  const confirming = copy.ok && confirmation === fingerprint;

  const baseSchedule = p.snapshot ? cloneBranchHours(p.snapshot.schedule) : emptyBranchHours();
  const dirty = userEdited && JSON.stringify(draft) !== JSON.stringify(baseSchedule);
  useSetupUnsavedChanges(dirty, p.isCurrent, p.locale);

  const label = (day: BranchHoursDay) => dayLabels[day][ar ? 0 : 1];
  const timezoneLabel = p.snapshot?.timezone || t("غير معروفة", "Unknown");

  function change(day: BranchHoursDay, value: BranchHoursDayValue) {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    setActivePreset(null);
    setDraft(current => ({...current, [day]: value}));
    setConfirmation(null);
    setFailed(false);
  }

  function changeExceptions(exceptions: BranchHoursException[]) {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    setDraft(current => ({...current, exceptions}));
    setConfirmation(null);
    setFailed(false);
  }

  function applyPreset(preset: HoursPreset | "closed_all" | "reset_all") {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    const start = quickStart || "09:00";
    const end = quickEnd || "17:00";
    const nextDay = quickNextDay;
    const interval = { start, end, nextDay };

    setDraft(current => {
      const next = cloneBranchHours(current);
      if (preset === "workdays_sun_thu") {
        for (const d of WORKDAYS_SUN_THU) next[d] = { state: "open", intervals: [{ ...interval }] };
        next.friday = { state: "closed" };
        next.saturday = { state: "closed" };
      } else if (preset === "all_week") {
        for (const d of ALL_WEEK_DAYS) next[d] = { state: "open", intervals: [{ ...interval }] };
      } else if (preset === "workdays_sat_thu") {
        for (const d of WORKDAYS_SAT_THU) next[d] = { state: "open", intervals: [{ ...interval }] };
        next.friday = { state: "closed" };
      } else if (preset === "closed_all") {
        for (const d of ALL_WEEK_DAYS) next[d] = { state: "closed" };
      } else if (preset === "reset_all") {
        for (const d of ALL_WEEK_DAYS) next[d] = { state: "unset" };
      }
      return next;
    });
    setActivePreset(preset === "closed_all" || preset === "reset_all" ? null : preset);
    setConfirmation(null);
    setFailed(false);
  }

  function applyQuickHours(targetDays: readonly BranchHoursDay[]) {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    setActivePreset(null);
    const start = quickStart || "09:00";
    const end = quickEnd || "17:00";
    const nextDay = quickNextDay;
    const interval = { start, end, nextDay };

    setDraft(current => {
      const next = cloneBranchHours(current);
      for (const d of targetDays) {
        next[d] = { state: "open", intervals: [{ ...interval }] };
      }
      return next;
    });
    setConfirmation(null);
    setFailed(false);
  }

  function applyQuickToOpenDays() {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    setActivePreset(null);
    const start = quickStart || "09:00";
    const end = quickEnd || "17:00";
    const nextDay = quickNextDay;
    const interval = { start, end, nextDay };

    setDraft(current => {
      const next = cloneBranchHours(current);
      for (const d of ALL_WEEK_DAYS) {
        if (next[d].state === "open") {
          next[d] = { state: "open", intervals: [{ ...interval }] };
        }
      }
      return next;
    });
    setConfirmation(null);
    setFailed(false);
  }

  function runQuickApply() {
    if (quickTarget === "open") applyQuickToOpenDays();
    else if (quickTarget === "all") applyQuickHours(ALL_WEEK_DAYS);
    else applyQuickHours(WORKDAYS_SUN_THU);
  }

  function copyDayTo(sourceDay: BranchHoursDay, targetDays: readonly BranchHoursDay[]) {
    if (locked || !p.isCurrent()) return;
    const source = draft[sourceDay];
    if (source.state !== "open" || !source.intervals.length) return;
    setUserEdited(true);
    setActivePreset(null);
    setDraft(current => {
      const next = cloneBranchHours(current);
      for (const d of targetDays) {
        if (d !== sourceDay) {
          next[d] = {
            state: "open",
            intervals: source.intervals.map(inv => ({ ...inv })),
          };
        }
      }
      return next;
    });
    setConfirmation(null);
    setFailed(false);
  }

  async function dispatch(callback: (() => void | Promise<void>) | undefined) {
    if (!callback || locked || reserved.current || !p.isCurrent()) return;
    reserved.current = true; setBusy(true); setFailed(false); setConfirmation(null);
    try {await callback();} catch {if (mounted.current && p.isCurrent()) setFailed(true);}
    finally {reserved.current = false; if (mounted.current && p.isCurrent()) setBusy(false);}
  }

  function summary(day: BranchHoursDay) {
    const value = draft[day];
    if (value.state === "open") return value.intervals.map(interval => `${interval.start}–${interval.end}${interval.nextDay ? t(" (اليوم التالي)", " (next day)") : ""}`).join("، ");
    return value.state === "unset" ? t("غير مضبوط", "Not set") : t("مغلق", "Closed");
  }

  const presets: {id: HoursPreset; ar: string; en: string}[] = [
    {id: "workdays_sun_thu", ar: "الأحد – الخميس", en: "Sun – Thu"},
    {id: "workdays_sat_thu", ar: "السبت – الخميس", en: "Sat – Thu"},
    {id: "all_week", ar: "طوال الأسبوع", en: "All week"},
  ];

  return (
    <section
      className={styles.view}
      data-setup-unsaved={dirty ? "true" : undefined}
      data-hours-studio=""
      dir={ar ? "rtl" : "ltr"}
      aria-labelledby={id}
      aria-busy={busy || p.state.phase === "saving" || p.state.phase === "loading"}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 id={id}>{t("مواعيد العمل", "Working hours")}</h2>
          <p className={styles.sub}>{t("حدد أيام وساعات العمل", "Set open days and hours")}</p>
        </div>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.ghost}
            disabled={locked || !canSaveAuthoritative}
            aria-expanded={showCopy}
            onClick={() => {
              if (p.isCurrent()) {
                setShowCopy((value) => !value);
                setConfirmation(null);
              }
            }}
          >
            {t("نسخ أيام العمل", "Copy hours")}
          </button>
          <button
            type="submit"
            form={formId}
            className={styles.primary}
            disabled={locked || !save.ok || !p.onSave || !canSaveAuthoritative}
          >
            {busy || p.state.phase === "saving" ? t("جارٍ الحفظ…", "Saving…") : t("حفظ", "Save")}
          </button>
          <details className={styles.more}>
            <summary>{t("المزيد", "More")}</summary>
            <div className={styles.moreMenu}>
              <p className={styles.meta}><bdi>{timezoneLabel}</bdi></p>
              <button type="button" disabled={locked} onClick={() => applyPreset("closed_all")}>{t("إغلاق جميع الأيام", "Close all days")}</button>
              <button type="button" disabled={locked} onClick={() => { if (p.isCurrent()) setShowExceptions((value) => !value); }}>
                {showExceptions ? t("إخفاء الاستثناءات", "Hide exceptions") : t("الاستثناءات", "Exceptions")}
              </button>
            </div>
          </details>
        </div>
      </header>

      {p.state.phase === "loading" && (
        <p role="status" className={styles.status}>{t("جارٍ تحميل مواعيد الفرع…", "Loading branch hours…")}</p>
      )}

      {p.state.phase === "unavailable" && (
        <div role="alert" className={styles.errorBox}>
          <p>{t("مواعيد هذا الفرع غير متاحة. الحفظ غير مؤكد.", "Hours for this branch are unavailable. Saving is not confirmed.")}</p>
          {p.onReload && (
            <button
              type="button"
              onClick={(event) => {
                if (p.isCurrent() && confirmSetupLeave(event.currentTarget.closest("section"), p.locale)) {
                  p.onReload?.({ ...p.scope });
                }
              }}
            >
              {t("إعادة المحاولة", "Retry")}
            </button>
          )}
        </div>
      )}

      {p.snapshot && !knownBranchHoursTimezone(p.snapshot.timezone) && (
        <p role="status" className={styles.error}>{t("أكد المنطقة الزمنية قبل الحفظ.", "Confirm the timezone before saving.")}</p>
      )}

      {conflictWithServer && p.snapshot && (
        <div role="alert" className={styles.warning}>
          <p>{t("وصلت مواعيد محفوظة تختلف عن مسودتك.", "Saved hours differ from your draft.")}</p>
          <button
            type="button"
            onClick={() => {
              if (p.snapshot) {
                setDraft(cloneBranchHours(p.snapshot.schedule));
                setUserEdited(false);
                setConflictWithServer(false);
                setActivePreset(null);
              }
            }}
          >
            {t("استعادة مواعيد الخادم", "Load server hours")}
          </button>
        </div>
      )}

      {p.state.phase === "conflict" && (
        <div role="alert" className={styles.errorBox}>
          <p>{t("تغيّرت المواعيد المحفوظة. أعد التحميل قبل الحفظ.", "Saved hours changed. Reload before saving.")}</p>
          {p.onReload && (
            <button
              type="button"
              onClick={(event) => {
                if (p.isCurrent() && confirmSetupLeave(event.currentTarget.closest("section"), p.locale)) {
                  p.onReload?.({ ...p.scope });
                }
              }}
            >
              {t("إعادة التحميل", "Reload")}
            </button>
          )}
        </div>
      )}

      {p.state.phase === "saved" && !dirty && p.snapshot && (
        <p role="status" className={styles.status}>{t("تم تأكيد حفظ هذه النسخة من الخادم.", "The server confirmed this saved version.")}</p>
      )}

      {failed && (
        <p role="alert" className={styles.error}>{t("تعذر إرسال الطلب.", "The request could not be submitted.")}</p>
      )}

      <div className={styles.controls} aria-label={t("تطبيق سريع", "Quick apply")}>
        <div className={styles.presets} role="group" aria-label={t("قوالب المواعيد", "Schedule presets")}>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-hours-preset={preset.id}
              className={activePreset === preset.id ? styles.presetActive : styles.preset}
              disabled={locked}
              aria-pressed={activePreset === preset.id}
              onClick={() => applyPreset(preset.id)}
            >
              {t(preset.ar, preset.en)}
            </button>
          ))}
          <button
            type="button"
            className={styles.reset}
            disabled={locked}
            data-hours-preset="reset_all"
            onClick={() => applyPreset("reset_all")}
          >
            {t("إعادة ضبط", "Reset")}
          </button>
        </div>

        <div className={styles.quickApply}>
          <span className={styles.quickLabel}>{t("تطبيق سريع", "Quick apply")}</span>
          <label className={styles.field}>
            {t("من", "From")}
            <input
              type="time"
              dir="ltr"
              value={quickStart}
              disabled={locked}
              aria-label={t("توقيت البدء السريع", "Quick start time")}
              onChange={(e) => setQuickStart(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            {t("إلى", "To")}
            <input
              type="time"
              dir="ltr"
              value={quickEnd}
              disabled={locked}
              aria-label={t("توقيت الانتهاء السريع", "Quick end time")}
              onChange={(e) => setQuickEnd(e.target.value)}
            />
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={quickNextDay}
              disabled={locked}
              aria-label={t("ينتهي في اليوم التالي للتطبيق السريع", "Ends next day for quick apply")}
              onChange={(e) => setQuickNextDay(e.target.checked)}
            />
            {t("ينتهي في اليوم التالي", "Ends next day")}
          </label>
          <label className={styles.field}>
            <span className={styles.srOnly}>{t("نطاق التطبيق", "Apply scope")}</span>
            <select
              value={quickTarget}
              disabled={locked}
              aria-label={t("نطاق التطبيق", "Apply scope")}
              onChange={(e) => setQuickTarget(e.target.value as QuickApplyTarget)}
            >
              <option value="open">{t("على الأيام المفتوحة", "To open days")}</option>
              <option value="all">{t("على كل الأيام", "To all days")}</option>
              <option value="workdays">{t("على أيام العمل", "To workdays")}</option>
            </select>
          </label>
          <button type="button" className={styles.apply} disabled={locked} onClick={runQuickApply}>
            {t("تطبيق", "Apply")}
          </button>
        </div>
      </div>

      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (save.ok && p.onSave) void dispatch(() => p.onSave?.(save.draft));
        }}
      >
        <fieldset className={styles.days} disabled={locked}>
          <legend className={styles.srOnly}>{t("الجدول الأسبوعي", "Weekly schedule")}</legend>
          {DISPLAY_DAYS.map((day) => {
            const value = draft[day];
            const previous = draft[previousDayOf[day]];
            const carry = previous.state === "open" ? previous.intervals.filter(interval => interval.nextDay && interval.end && interval.end !== "00:00") : [];
            const issues = validated.ok ? [] : validated.issues.filter(issue => issue.day === day || issue.otherDay === day);
            return (
              <fieldset
                className={styles.day}
                key={day}
                data-hours-day={day}
                data-state={value.state}
                aria-describedby={issues.length ? `${id}-${day}-errors` : undefined}
              >
                <div className={styles.dayRow}>
                  <legend className={styles.dayName}>{label(day)}</legend>
                  <label className={styles.dayState}>
                    <span className={styles.srOnly}>{label(day)} {t("الحالة", "Status")}</span>
                    <select
                      aria-label={`${label(day)} ${t("الحالة", "status")}`}
                      value={value.state}
                      onChange={(event) =>
                        change(
                          day,
                          event.target.value === "open"
                            ? { state: "open", intervals: [{ start: quickStart || "09:00", end: quickEnd || "17:00", nextDay: quickNextDay }] }
                            : { state: event.target.value as "unset" | "closed" }
                        )
                      }
                    >
                      <option value="unset">{t("غير مضبوط", "Not set")}</option>
                      <option value="closed">{t("مغلق", "Closed")}</option>
                      <option value="open">{t("مفتوح", "Open")}</option>
                    </select>
                  </label>

                  {value.state === "open" && (
                    <div className={styles.dayBody}>
                      {value.intervals.map((interval, index) => (
                        <div className={styles.interval} key={index}>
                          <label>
                            {t("من", "From")}
                            <input
                              type="time"
                              dir="ltr"
                              aria-label={`${label(day)} ${index + 1} ${t("من", "from")}`}
                              value={interval.start}
                              onChange={(event) =>
                                change(day, {
                                  state: "open",
                                  intervals: value.intervals.map((v, i) => (i === index ? { ...v, start: event.target.value } : v)),
                                })
                              }
                            />
                          </label>
                          <label>
                            {t("إلى", "To")}
                            <input
                              type="time"
                              dir="ltr"
                              aria-label={`${label(day)} ${index + 1} ${t("إلى", "to")}`}
                              value={interval.end}
                              onChange={(event) =>
                                change(day, {
                                  state: "open",
                                  intervals: value.intervals.map((v, i) => (i === index ? { ...v, end: event.target.value } : v)),
                                })
                              }
                            />
                          </label>
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={interval.nextDay}
                              aria-label={`${label(day)} ${index + 1} ${t("ينتهي في اليوم التالي", "ends next day")}`}
                              onChange={(event) =>
                                change(day, {
                                  state: "open",
                                  intervals: value.intervals.map((v, i) => (i === index ? { ...v, nextDay: event.target.checked } : v)),
                                })
                              }
                            />
                            {t("اليوم التالي", "Next day")}
                          </label>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label={`${t("حذف فترة", "Remove interval")} ${label(day)} ${index + 1}`}
                            onClick={() =>
                              change(day, {
                                state: "open",
                                intervals: value.intervals.filter((_, i) => i !== index),
                              })
                            }
                          >
                            {t("حذف", "Remove")}
                          </button>
                        </div>
                      ))}
                      <div className={styles.dayTools}>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() =>
                            change(day, {
                              state: "open",
                              intervals: [...value.intervals, { start: "", end: "", nextDay: false }],
                            })
                          }
                        >
                          {t("+ إضافة فترة", "+ Add interval")}
                        </button>
                        <details className={styles.dayMenu}>
                          <summary>{t("نسخ", "Copy")}</summary>
                          <div className={styles.dayMenuList}>
                            <button
                              type="button"
                              className={styles.copyDayBtn}
                              title={t("نسخ مواعيد هذا اليوم إلى الأحد والاثنين والثلاثاء والأربعاء والخميس", "Copy this day's hours to Sun, Mon, Tue, Wed, Thu")}
                              onClick={() => copyDayTo(day, WORKDAYS_SUN_THU)}
                            >
                              {t("إلى الأحد – الخميس", "To Sun–Thu")}
                            </button>
                            <button
                              type="button"
                              className={styles.copyDayBtn}
                              title={t("نسخ مواعيد هذا اليوم لجميع أيام الأسبوع", "Copy this day's hours to all week days")}
                              onClick={() => copyDayTo(day, ALL_WEEK_DAYS)}
                            >
                              {t("إلى كل الأيام", "To all days")}
                            </button>
                            <button
                              type="button"
                              className={styles.copyDayBtn}
                              onClick={() => change(day, { state: "closed" })}
                            >
                              {t("إغلاق اليوم", "Close day")}
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                  )}
                </div>
                {carry.length > 0 && (
                  <p className={styles.carry}>
                    {t("امتداد من اليوم السابق حتى: ", "Carry-over from the previous day until: ")}
                    <bdi>{carry.map((interval) => interval.end).join("، ")}</bdi>
                  </p>
                )}
                {issues.length > 0 && (
                  <p id={`${id}-${day}-errors`} role="status" className={styles.error}>
                    {issues.some((issue) => issue.code === "overlap")
                      ? t("تتداخل هذه الفترة مع فترة أخرى، بما فيها امتداد اليوم السابق أو التالي.", "An interval overlaps another, including carry-over across days.")
                      : t("أدخل بداية ونهاية صحيحتين. إذا امتدت الفترة بعد منتصف الليل، اختر اليوم التالي صراحةً.", "Enter valid start and end times. Explicitly select next day for an overnight interval.")}
                  </p>
                )}
              </fieldset>
            );
          })}
        </fieldset>

        {showExceptions && (
          <fieldset className={styles.exceptions} disabled={locked}>
            <legend>{t("الاستثناءات", "Exceptions")}</legend>
            {(draft.exceptions ?? []).map((entry, index) => {
              const entries = draft.exceptions ?? [];
              const update = (next: BranchHoursException) => changeExceptions(entries.map((item, i) => (i === index ? next : item)));
              return (
                <fieldset className={styles.exception} key={index}>
                  <legend className={styles.srOnly}>{t("استثناء", "Exception")} {index + 1}</legend>
                  <label className={styles.field}>
                    {t("التاريخ", "Date")}
                    <input
                      type="date"
                      min="1000-01-01"
                      max="9999-12-31"
                      dir="ltr"
                      aria-label={`${t("تاريخ الاستثناء", "Exception date")} ${index + 1}`}
                      value={entry.date}
                      onChange={(event) => update({ ...entry, date: event.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    {t("الحالة", "Status")}
                    <select
                      aria-label={`${t("حالة الاستثناء", "Exception status")} ${index + 1}`}
                      value={entry.hours.state}
                      onChange={(event) =>
                        update({
                          ...entry,
                          hours: event.target.value === "open" ? { state: "open", intervals: [{ start: "", end: "", nextDay: false }] } : { state: "closed" },
                        })
                      }
                    >
                      <option value="closed">{t("مغلق طوال اليوم", "Closed all day")}</option>
                      <option value="open">{t("ساعات خاصة", "Special hours")}</option>
                    </select>
                  </label>
                  {entry.hours.state === "open" && (
                    <div className={styles.dayBody}>
                      {entry.hours.intervals.map((interval, intervalIndex) => {
                        const intervals = entry.hours.state === "open" ? entry.hours.intervals : [];
                        return (
                          <div className={styles.interval} key={intervalIndex}>
                            <label>
                              {t("من", "From")}
                              <input
                                type="time"
                                dir="ltr"
                                aria-label={`${t("استثناء من", "Exception from")} ${index + 1} ${intervalIndex + 1}`}
                                value={interval.start}
                                onChange={(event) =>
                                  update({
                                    ...entry,
                                    hours: {
                                      state: "open",
                                      intervals: intervals.map((v, i) => (i === intervalIndex ? { ...v, start: event.target.value } : v)),
                                    },
                                  })
                                }
                              />
                            </label>
                            <label>
                              {t("إلى", "To")}
                              <input
                                type="time"
                                dir="ltr"
                                aria-label={`${t("استثناء إلى", "Exception to")} ${index + 1} ${intervalIndex + 1}`}
                                value={interval.end}
                                onChange={(event) =>
                                  update({
                                    ...entry,
                                    hours: {
                                      state: "open",
                                      intervals: intervals.map((v, i) =>
                                        i === intervalIndex
                                          ? { ...v, end: event.target.value, nextDay: event.target.value === "00:00" }
                                          : v
                                      ),
                                    },
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() =>
                                update({
                                  ...entry,
                                  hours: {
                                    state: "open",
                                    intervals: intervals.filter((_, i) => i !== intervalIndex),
                                  },
                                })
                              }
                            >
                              {t("حذف فترة", "Remove interval")}
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() =>
                          update({
                            ...entry,
                            hours: {
                              state: "open",
                              intervals: [...(entry.hours.state === "open" ? entry.hours.intervals : []), { start: "", end: "", nextDay: false }],
                            },
                          })
                        }
                      >
                        {t("+ إضافة فترة", "+ Add interval")}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => changeExceptions(entries.filter((_, i) => i !== index))}
                  >
                    {t("حذف الاستثناء", "Remove exception")}
                  </button>
                </fieldset>
              );
            })}
            <button
              type="button"
              className={styles.linkBtn}
              disabled={(draft.exceptions?.length ?? 0) >= 366}
              onClick={() => changeExceptions([...(draft.exceptions ?? []), { date: "", hours: { state: "closed" } }])}
            >
              {t("+ إضافة استثناء", "+ Add exception")}
            </button>
            {!validated.ok && validated.issues.some((issue) => issue.code === "invalid_exception") && (
              <p role="status" className={styles.error}>
                {t("اختر تاريخًا صحيحًا غير مكرر، وفترات لا تتداخل داخل اليوم نفسه.", "Choose a valid unique date and non-overlapping intervals within the same day.")}
              </p>
            )}
            <p className={styles.hint}>{t("الاستثناء يستبدل اليوم كاملًا، بما فيه امتداد اليوم السابق.", "An exception replaces the entire date, including previous-day carry-over.")}</p>
          </fieldset>
        )}

        {!canSaveAuthoritative && (
          <p className={styles.hint}>
            {t(
              "الحفظ غير متاح قبل تأكيد الاتصال بالخادم وجلب نسخة المواعيد الحالية.",
              "Saving is disabled until server connection and version are confirmed."
            )}
          </p>
        )}
      </form>

      {showCopy && p.snapshot && (
        <section className={styles.copy} aria-labelledby={`${id}-copy`}>
          <h3 id={`${id}-copy`}>{t("نسخ أيام العمل", "Copy hours")}</h3>
          {p.copyTargets
            .filter((target) => target.branchId !== p.scope.branchId)
            .map((target) => (
              <label className={styles.target} key={target.branchId}>
                <input
                  type="checkbox"
                  disabled={locked || !knownBranchHoursTimezone(target.timezone)}
                  checked={selected.includes(target.branchId)}
                  onChange={(event) => {
                    if (!p.isCurrent()) return;
                    setSelected((ids) => (event.target.checked ? [...ids, target.branchId] : ids.filter((value) => value !== target.branchId)));
                    setConfirmation(null);
                  }}
                />
                <span>
                  <bdi>{target.label}</bdi> — <bdi>{target.timezone || t("منطقة زمنية غير معروفة", "Unknown timezone")}</bdi>
                </span>
              </label>
            ))}
          {!p.copyTargets.some((target) => target.branchId !== p.scope.branchId) && (
            <p>{t("لا توجد فروع أخرى متاحة للنسخ.", "No other branches are available for copying.")}</p>
          )}
          <button
            type="button"
            disabled={locked || dirty || !copy.ok}
            onClick={() => {
              if (p.isCurrent() && copy.ok) setConfirmation(fingerprint);
            }}
          >
            {t("مراجعة النسخ", "Review copy")}
          </button>
          {confirming && (
            <div className={styles.confirm} role="region" aria-label={t("تأكيد النسخ", "Confirm copy")}>
              <h4>{t("تأكيد الاستبدال", "Confirm replacement")}</h4>
              <ul>
                {BRANCH_HOURS_DAYS.map((day) => (
                  <li key={day}>
                    {label(day)}: <bdi>{summary(day)}</bdi>
                  </li>
                ))}
              </ul>
              {!!draft.exceptions?.length && (
                <ul>
                  {draft.exceptions.map((entry) => (
                    <li key={entry.date}>
                      <bdi>{entry.date}</bdi>:{" "}
                      {entry.hours.state === "closed"
                        ? t("مغلق طوال اليوم", "Closed all day")
                        : entry.hours.intervals.map((interval) => `${interval.start}–${interval.end}`).join(", ")}
                    </li>
                  ))}
                </ul>
              )}
              <ul>
                {selected.map((branchId) => {
                  const target = p.copyTargets.find((item) => item.branchId === branchId)!;
                  return (
                    <li key={branchId}>
                      <bdi>{target.label}</bdi> — <bdi>{target.timezone}</bdi>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className={styles.primary}
                disabled={locked || dirty || !p.onCopy}
                onClick={() => {
                  if (copy.ok && confirmation === fingerprint && p.onCopy) void dispatch(() => p.onCopy?.(copy.draft));
                }}
              >
                {t("تأكيد النسخ", "Confirm copy")}
              </button>
              <button type="button" disabled={locked} onClick={() => setConfirmation(null)}>
                {t("إلغاء", "Cancel")}
              </button>
              {!p.onCopy && <p>{t("تنفيذ النسخ غير متاح بعد.", "Copying is not available yet.")}</p>}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
