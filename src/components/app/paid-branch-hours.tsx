"use client";
import {useId, useLayoutEffect, useRef, useState} from "react";
import {
  BRANCH_HOURS_DAYS, cloneBranchHours, emptyBranchHours, knownBranchHoursTimezone, prepareBranchHoursCopy,
  prepareBranchHoursSave, sameBranchHoursScope, validateBranchHours,
  type BranchHoursCopyDraft, type BranchHoursCopyTarget, type BranchHoursDay,
  type BranchHoursSaveDraft, type BranchHoursScope,
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

type HoursPreset = "workdays_sun_thu" | "all_week" | "workdays_sat_thu";
type HoursMode = "rest" | "compose";

function scheduleConfigured(schedule: BranchHoursSchedule) {
  return DISPLAY_DAYS.some((day) => schedule[day].state !== "unset");
}

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
  const [mode, setMode] = useState<HoursMode>("rest");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);

  const mounted = useRef(false), reserved = useRef(false);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);

  const [userEdited,setUserEdited]=useState(false);
  const [sourceVersion,setSourceVersion]=useState(p.snapshot?.version??null);

  // Adopt a new server revision during this render, before children commit.
  // Dirty local fields remain intact and the difference is explicitly shown.
  if(p.snapshot&&sourceVersion!==p.snapshot.version){
    setSourceVersion(p.snapshot.version);
    if(!userEdited){setDraft(cloneBranchHours(p.snapshot.schedule));}
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

  function changeExceptions(exceptions: BranchHoursException[]) {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    setDraft(current => ({...current, exceptions}));
    setConfirmation(null);
    setFailed(false);
  }

  function applyPreset(
    preset: HoursPreset | "closed_all" | "reset_all",
    times?: { start: string; end: string; nextDay: boolean },
  ) {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
    const start = times?.start || quickStart || "09:00";
    const end = times?.end || quickEnd || "17:00";
    const nextDay = times?.nextDay ?? quickNextDay;
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

  function updateTimes(next: { start?: string; end?: string; nextDay?: boolean }) {
    if (locked || !p.isCurrent()) return;
    const start = next.start ?? quickStart;
    const end = next.end ?? quickEnd;
    const nextDay = next.nextDay ?? quickNextDay;
    if (next.start !== undefined) setQuickStart(next.start);
    if (next.end !== undefined) setQuickEnd(next.end);
    if (next.nextDay !== undefined) setQuickNextDay(next.nextDay);
    if (activePreset) applyPreset(activePreset, { start, end, nextDay });
  }

  function openCompose(kind: "add" | "edit") {
    if (!p.isCurrent()) return;
    setMode("compose");
    setShowCopy(false);
    if (kind === "add" && !scheduleConfigured(draft)) {
      applyPreset("workdays_sun_thu", { start: quickStart || "09:00", end: quickEnd || "17:00", nextDay: quickNextDay });
    } else if (!activePreset) {
      const first = findFirstInterval(draft);
      if (first) {
        setQuickStart(first.start || "09:00");
        setQuickEnd(first.end || "17:00");
        setQuickNextDay(!!first.nextDay);
      }
    }
  }

  function cancelCompose() {
    if (!p.isCurrent()) return;
    if (p.snapshot) {
      setDraft(cloneBranchHours(p.snapshot.schedule));
      setUserEdited(false);
      const first = findFirstInterval(p.snapshot.schedule);
      setQuickStart(first?.start || "09:00");
      setQuickEnd(first?.end || "17:00");
      setQuickNextDay(!!first?.nextDay);
    }
    setActivePreset(null);
    setMode("rest");
    setFailed(false);
  }

  async function dispatch(callback: (() => void | Promise<void>) | undefined) {
    if (!callback || locked || reserved.current || !p.isCurrent()) return;
    reserved.current = true; setBusy(true); setFailed(false); setConfirmation(null);
    try {await callback();} catch {if (mounted.current && p.isCurrent()) setFailed(true);}
    finally {reserved.current = false; if (mounted.current && p.isCurrent()) setBusy(false);}
  }

  function summary(day: BranchHoursDay) {
    if (!p.snapshot && !userEdited) return p.state.phase === "loading" ? t("جارٍ التحقق", "Checking") : t("غير متاح", "Unavailable");
    const value = draft[day];
    if (value.state === "open") return value.intervals.map(interval => `${interval.start}–${interval.end}${interval.nextDay ? t(" (اليوم التالي)", " (next day)") : ""}`).join("، ");
    return value.state === "unset" ? t("غير مضبوط", "Not set") : t("مغلق", "Closed");
  }

  const presets: {id: HoursPreset; ar: string; en: string; hintAr: string; hintEn: string}[] = [
    {id: "workdays_sun_thu", ar: "الأحد – الخميس", en: "Sun – Thu", hintAr: "عطلة الجمعة والسبت", hintEn: "Fri & Sat closed"},
    {id: "workdays_sat_thu", ar: "السبت – الخميس", en: "Sat – Thu", hintAr: "عطلة الجمعة فقط", hintEn: "Friday closed"},
    {id: "all_week", ar: "طوال الأسبوع", en: "All week", hintAr: "كل الأيام بنفس التوقيت", hintEn: "Same hours every day"},
  ];
  const configured = scheduleConfigured(draft);
  const composing = mode === "compose";

  return (
    <section
      className={styles.view}
      data-setup-unsaved={dirty ? "true" : undefined}
      data-hours-studio=""
      data-hours-mode={mode}
      dir={ar ? "rtl" : "ltr"}
      aria-labelledby={id}
      aria-busy={busy || p.state.phase === "saving" || p.state.phase === "loading"}
    >
      <div className={styles.stage}>
        {p.snapshot && !knownBranchHoursTimezone(p.snapshot.timezone) && (
          <p role="status" className={styles.error}>{t("أكد المنطقة الزمنية قبل الحفظ.", "Confirm the timezone before saving.")}</p>
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

        {failed && (
          <p role="alert" className={styles.error}>{t("تعذر إرسال الطلب.", "The request could not be submitted.")}</p>
        )}

        {!composing && (
          <div className={styles.hero} data-hours-rest="">
            <p className={styles.kicker}><bdi>{timezoneLabel}</bdi></p>
            <h2 id={id}>{t("مواعيد العمل", "Working hours")}</h2>
            <p className={styles.lede}>
              {configured
                ? t("هذا جدول الفرع الحالي. عدّله عند الحاجة ثم احفظ.", "This is the current branch schedule. Edit when needed, then save.")
                : t("حدد أيام وساعات دوام الفرع في خطوة واحدة.", "Set this branch’s open days and hours in one step.")}
            </p>
            <ul className={styles.weekSummary} aria-label={t("ملخص الجدول الأسبوعي", "Weekly schedule summary")}>
              {DISPLAY_DAYS.map((day) => {
                const value = draft[day];
                const previous = draft[previousDayOf[day]];
                const carry = previous.state === "open" ? previous.intervals.filter(interval => interval.nextDay && interval.end && interval.end !== "00:00") : [];
                return (
                  <li className={styles.summaryDay} key={day} data-hours-day={day} data-state={!p.snapshot && !userEdited ? "unknown" : value.state}>
                    <span className={styles.dayName}>{label(day)}</span>
                    <span className={styles.daySummary} dir="ltr">{summary(day)}</span>
                    {carry.length > 0 && (
                      <p className={styles.carry}>
                        {t("امتداد من اليوم السابق حتى: ", "Carry-over from the previous day until: ")}
                        <bdi>{carry.map((interval) => interval.end).join("، ")}</bdi>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className={styles.heroActions}>
              <button
                type="button"
                className={styles.primary}
                disabled={locked}
                data-hours-action={configured ? "edit" : "add"}
                onClick={() => openCompose(configured ? "edit" : "add")}
              >
                {configured ? t("تعديل", "Edit") : t("إضافة مواعيد", "Add hours")}
              </button>
              <details className={styles.more}>
                <summary>{t("المزيد", "More")}</summary>
                <div className={styles.moreMenu}>
                  <button
                    type="button"
                    disabled={locked || !canSaveAuthoritative}
                    aria-expanded={showCopy}
                    onClick={() => {
                      if (p.isCurrent()) {
                        setShowCopy((value) => !value);
                        setConfirmation(null);
                      }
                    }}
                  >
                    {t("نسخ إلى فرع آخر", "Copy to another branch")}
                  </button>
                  <button type="button" disabled={locked} onClick={() => { if (p.isCurrent()) setShowExceptions((value) => !value); }}>
                    {showExceptions ? t("إخفاء الاستثناءات", "Hide exceptions") : t("الاستثناءات", "Exceptions")}
                  </button>
                  <button type="button" disabled={locked} data-hours-preset="closed_all" onClick={() => applyPreset("closed_all")}>{t("إغلاق جميع الأيام", "Close all days")}</button>
                </div>
              </details>
            </div>
          </div>
        )}

        {composing && (
          <div className={styles.panel} data-hours-compose="" role="region" aria-labelledby={id}>
            <header className={styles.panelHead}>
              <div>
                <h2 id={id}>{configured ? t("تعديل المواعيد", "Edit hours") : t("إضافة مواعيد", "Add hours")}</h2>
                <p className={styles.sub}>{t("اختر الأيام ثم التوقيت — ثم احفظ.", "Choose the days, set the times, then save.")}</p>
              </div>
              <button type="button" className={styles.textBtn} disabled={locked} onClick={cancelCompose}>{t("إلغاء", "Cancel")}</button>
            </header>

            <div className={styles.patterns} role="radiogroup" aria-label={t("أيام العمل", "Working days")}>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  data-hours-preset={preset.id}
                  className={activePreset === preset.id ? styles.patternActive : styles.pattern}
                  disabled={locked}
                  aria-checked={activePreset === preset.id}
                  onClick={() => applyPreset(preset.id)}
                >
                  <strong>{t(preset.ar, preset.en)}</strong>
                  <span>{t(preset.hintAr, preset.hintEn)}</span>
                </button>
              ))}
            </div>

            <div className={styles.times} role="group" aria-label={t("ساعات العمل", "Business hours")}>
              <label className={styles.field}>
                {t("من", "From")}
                <input
                  type="time"
                  dir="ltr"
                  value={quickStart}
                  disabled={locked}
                  aria-label={t("توقيت البدء السريع", "Quick start time")}
                  onChange={(e) => updateTimes({ start: e.target.value })}
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
                  onChange={(e) => updateTimes({ end: e.target.value })}
                />
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={quickNextDay}
                  disabled={locked}
                  aria-label={t("ينتهي في اليوم التالي للتطبيق السريع", "Ends next day for quick apply")}
                  onChange={(e) => updateTimes({ nextDay: e.target.checked })}
                />
                {t("يمتد لليوم التالي", "Ends next day")}
              </label>
            </div>

            <ul className={styles.weekPreview} aria-label={t("معاينة الأسبوع", "Week preview")}>
              {DISPLAY_DAYS.map((day) => (
                <li key={day} data-hours-day={day} data-state={draft[day].state}>
                  <span>{label(day)}</span>
                  <bdi dir="ltr">{summary(day)}</bdi>
                </li>
              ))}
            </ul>

            {!validated.ok && (
              <p role="status" className={styles.error}>
                {t("راجع التوقيت أو امتداد منتصف الليل ثم حاول الحفظ.", "Check the times or overnight flag, then try saving.")}
              </p>
            )}

            <div className={styles.panelActions}>
              <button
                type="submit"
                form={formId}
                className={styles.primary}
                disabled={locked || !save.ok || !p.onSave || !canSaveAuthoritative || !activePreset}
              >
                {busy || p.state.phase === "saving" ? t("جارٍ الحفظ…", "Saving…") : t("حفظ المواعيد", "Save hours")}
              </button>
              <details className={styles.more}>
                <summary>{t("المزيد", "More")}</summary>
                <div className={styles.moreMenu}>
                  <p className={styles.meta}><bdi>{timezoneLabel}</bdi></p>
                  <button type="button" disabled={locked} onClick={() => { if (p.isCurrent()) setShowExceptions((value) => !value); }}>
                    {showExceptions ? t("إخفاء الاستثناءات", "Hide exceptions") : t("الاستثناءات", "Exceptions")}
                  </button>
                  <button type="button" disabled={locked} data-hours-preset="reset_all" onClick={() => applyPreset("reset_all")}>{t("مسح الجدول", "Clear schedule")}</button>
                </div>
              </details>
            </div>
          </div>
        )}

      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!(save.ok && p.onSave)) return;
          void dispatch(async () => {
            await p.onSave?.(save.draft);
            if (mounted.current && p.isCurrent()) setMode("rest");
          });
        }}
      >

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

      </form>
      </div>

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
