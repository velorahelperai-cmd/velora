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
  monday: ["الاثنين", "Monday"], tuesday: ["الثلاثاء", "Tuesday"], wednesday: ["الأربعاء", "Wednesday"],
  thursday: ["الخميس", "Thursday"], friday: ["الجمعة", "Friday"], saturday: ["السبت", "Saturday"], sunday: ["الأحد", "Sunday"],
};

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
  const initialSchedule = p.snapshot?.schedule ? cloneBranchHours(p.snapshot.schedule) : emptyBranchHours();
  const [draft, setDraft] = useState<BranchHoursSchedule>(() => initialSchedule);
  const [selected, setSelected] = useState<string[]>([]);
  const [showCopy, setShowCopy] = useState(false);
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

  function change(day: BranchHoursDay, value: BranchHoursDayValue) {
    if (locked || !p.isCurrent()) return;
    setUserEdited(true);
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

  const branchLabel = p.snapshot?.branchLabel || t("الفرع الحالي", "Current branch");
  const timezoneLabel = p.snapshot?.timezone || t("غير معروفة", "Unknown");

  return (
    <section
      className={styles.view}
      data-setup-unsaved={dirty ? "true" : undefined}
      dir={ar ? "rtl" : "ltr"}
      aria-labelledby={id}
      aria-busy={busy || p.state.phase === "saving" || p.state.phase === "loading"}
    >
      <header className={styles.header}>
        <h2 id={id}>{t("مواعيد عمل الفرع", "Branch working hours")}</h2>
        <p>
          <bdi>{branchLabel}</bdi>
          <span>
            {t("المنطقة الزمنية: ", "Timezone: ")}
            <bdi>{p.snapshot ? timezoneLabel : t("جارٍ التحقق…", "Verifying…")}</bdi>
          </span>
        </p>
      </header>

      <p className={styles.note}>
        {t(
          "الأوقات حسب ساعة الفرع المحلية. تُسجّل الفترة في يوم بدايتها؛ امتدادها إلى اليوم التالي يظهر أسفل ذلك اليوم. لا تغيّر هذه الصفحة سياسة الرد خارج الدوام.",
          "Times use the branch's local clock. Each interval belongs to its starting day; carry-over appears on the following day. This page does not change after-hours reply policy."
        )}
      </p>

      {/* Non-blocking background loading indicator */}
      {p.state.phase === "loading" && (
        <p role="status" className={styles.note}>
          {t("جارٍ تحميل مواعيد الفرع…", "Loading branch hours…")}
        </p>
      )}

      {/* Non-blocking background failure indicator */}
      {p.state.phase === "unavailable" && (
        <div role="alert" className={styles.error}>
          <p>
            {t(
              "مواعيد هذا الفرع غير متاحة. لم نؤكد الحفظ؛ تعديلاتك المحلية محفوظة في هذه الشاشة.",
              "Hours for this branch are unavailable. Saving is not confirmed; your local edits are retained in this screen."
            )}
          </p>
          {p.onReload && (
            <button
              type="button"
              onClick={(event) => {
                if (p.isCurrent() && confirmSetupLeave(event.currentTarget.parentElement?.parentElement ?? null, p.locale)) {
                  p.onReload?.({ ...p.scope });
                }
              }}
            >
              {t("إعادة المحاولة", "Retry")}
            </button>
          )}
        </div>
      )}

      {/* Confirmed server timezone check */}
      {p.snapshot && !knownBranchHoursTimezone(p.snapshot.timezone) && (
        <p role="status" className={styles.error}>
          {t(
            "يجب تأكيد المنطقة الزمنية المخزنة قبل الحفظ أو النسخ. لم تُستخدم منطقة افتراضية.",
            "Confirm the stored timezone before saving or copying. No default timezone was used."
          )}
        </p>
      )}

      {/* Explicit server conflict alert */}
      {conflictWithServer && p.snapshot && (
        <div role="alert" className={styles.warning}>
          <p>
            {t(
              "وصلت المواعيد المحفوظة من الخادم وتختلف عن مسودتك الحالية. يمكنك مراجعتها وحفظ تعديلاتك فوقها، أو استعادة نسخة الخادم.",
              "Saved hours arrived from the server and differ from your current draft. You can keep and save your edits, or load the server version."
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              if (p.snapshot) {
                setDraft(cloneBranchHours(p.snapshot.schedule));
                setUserEdited(false);
                setConflictWithServer(false);
              }
            }}
          >
            {t("استعادة مواعيد الخادم", "Load server hours")}
          </button>
        </div>
      )}

      {/* CAS conflict on save */}
      {p.state.phase === "conflict" && (
        <div role="alert" className={styles.error}>
          <p>
            {t(
              "تغيّرت المواعيد المحفوظة. أعد التحميل لمراجعتها قبل الحفظ؛ ستُستبدل تعديلاتك المحلية.",
              "Saved hours changed. Reload to review them before saving; this replaces your local edits."
            )}
          </p>
          {p.onReload && (
            <button
              type="button"
              onClick={(event) => {
                if (p.isCurrent() && confirmSetupLeave(event.currentTarget.closest("section")?.parentElement ?? null, p.locale)) {
                  p.onReload?.({ ...p.scope });
                }
              }}
            >
              {t("إعادة التحميل", "Reload")}
            </button>
          )}
        </div>
      )}

      {/* Confirmed saved message */}
      {p.state.phase === "saved" && !dirty && p.snapshot && (
        <p role="status">{t("تم تأكيد حفظ هذه النسخة من الخادم.", "The server confirmed this saved version.")}</p>
      )}

      {failed && (
        <p role="alert" className={styles.error}>
          {t("تعذر إرسال الطلب. راجع الحالة الحالية قبل المحاولة مجددًا.", "The request could not be submitted. Review the current state before trying again.")}
        </p>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (save.ok && p.onSave) void dispatch(() => p.onSave?.(save.draft));
        }}
      >
        <fieldset className={styles.days} disabled={locked}>
          <legend className={styles.srOnly}>{t("الجدول الأسبوعي", "Weekly schedule")}</legend>
          {BRANCH_HOURS_DAYS.map((day, dayIndex) => {
            const value = draft[day], previous = draft[BRANCH_HOURS_DAYS[(dayIndex + 6) % 7]];
            const carry = previous.state === "open" ? previous.intervals.filter(interval => interval.nextDay && interval.end && interval.end !== "00:00") : [];
            const issues = validated.ok ? [] : validated.issues.filter(issue => issue.day === day || issue.otherDay === day);
            return (
              <fieldset className={styles.day} key={day} data-hours-day={day} aria-describedby={issues.length ? `${id}-${day}-errors` : undefined}>
                <legend>{label(day)}</legend>
                <label className={styles.dayState}>
                  <span>{t("الحالة", "Status")}</span>
                  <select
                    aria-label={`${label(day)} ${t("الحالة", "status")}`}
                    value={value.state}
                    onChange={(event) =>
                      change(day, event.target.value === "open" ? { state: "open", intervals: [{ start: "", end: "", nextDay: false }] } : { state: event.target.value as "unset" | "closed" })
                    }
                  >
                    <option value="unset">{t("غير مضبوط", "Not set")}</option>
                    <option value="closed">{t("مغلق", "Closed")}</option>
                    <option value="open">{t("مفتوح", "Open")}</option>
                  </select>
                </label>
                {value.state === "open" && (
                  <div className={styles.intervals}>
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
                          {t("ينتهي في اليوم التالي", "Ends next day")}
                        </label>
                        <button
                          type="button"
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
                    <button
                      type="button"
                      className={styles.add}
                      onClick={() =>
                        change(day, {
                          state: "open",
                          intervals: [...value.intervals, { start: "", end: "", nextDay: false }],
                        })
                      }
                    >
                      {t("إضافة فترة", "Add interval")} — {label(day)}
                    </button>
                  </div>
                )}
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

        <fieldset className={styles.days} disabled={locked}>
          <legend>{t("العطلات والاستثناءات بتاريخ محدد", "Holidays and date exceptions")}</legend>
          <p className={styles.note}>
            {t(
              "الاستثناء يستبدل اليوم المحلي كاملًا، بما فيه امتداد اليوم السابق. قسّم الدوام الليلي على تاريخين. النهاية 00:00 تعني منتصف الليل في نهاية ذلك التاريخ. حذف الاستثناء يعيد الجدول الأسبوعي لذلك التاريخ.",
              "An exception replaces the entire local date, including previous-day carry-over. Split overnight hours across two dates. An end of 00:00 means midnight at the end of that date. Removing an exception restores the weekly schedule for that date."
            )}
          </p>
          {(draft.exceptions ?? []).map((entry, index) => {
            const entries = draft.exceptions ?? [];
            const update = (next: BranchHoursException) => changeExceptions(entries.map((item, i) => (i === index ? next : item)));
            return (
              <fieldset className={styles.day} key={index}>
                <legend>{t("استثناء", "Exception")} {index + 1}</legend>
                <label>
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
                <label>
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
                  <div className={styles.intervals}>
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
                      {t("إضافة فترة خاصة", "Add special interval")}
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => changeExceptions(entries.filter((_, i) => i !== index))}>
                  {t("حذف الاستثناء", "Remove exception")}
                </button>
              </fieldset>
            );
          })}
          <button
            type="button"
            disabled={(draft.exceptions?.length ?? 0) >= 366}
            onClick={() => changeExceptions([...(draft.exceptions ?? []), { date: "", hours: { state: "closed" } }])}
          >
            {t("إضافة عطلة أو استثناء", "Add holiday or exception")}
          </button>
          {!validated.ok && validated.issues.some((issue) => issue.code === "invalid_exception") && (
            <p role="status" className={styles.error}>
              {t("اختر تاريخًا صحيحًا غير مكرر، وفترات لا تتداخل داخل اليوم نفسه.", "Choose a valid unique date and non-overlapping intervals within the same day.")}
            </p>
          )}
        </fieldset>

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.primary}
            disabled={locked || !save.ok || !p.onSave || !canSaveAuthoritative}
          >
            {busy || p.state.phase === "saving" ? t("جارٍ الإرسال…", "Submitting…") : t("حفظ المواعيد", "Save hours")}
          </button>
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
            {t("نسخ إلى فروع مختارة", "Copy to selected branches")}
          </button>
        </div>

        {!canSaveAuthoritative && (
          <p className={styles.note}>
            {t(
              "الحفظ غير متاح قبل تأكيد الاتصال بالخادم وجلب نسخة المواعيد الحالية.",
              "Saving is disabled until server connection and version are confirmed."
            )}
          </p>
        )}
      </form>

      {showCopy && p.snapshot && (
        <section className={styles.copy} aria-labelledby={`${id}-copy`}>
          <h3 id={`${id}-copy`}>{t("اختر الفروع المستهدفة", "Choose destination branches")}</h3>
          <p>
            {t(
              "تُنسخ المواعيد الأسبوعية المحفوظة واستثناءات التواريخ دون تحويل. يحتفظ كل فرع بمنطقته الزمنية. احفظ تعديلاتك قبل النسخ.",
              "The saved weekly hours and date exceptions are copied without conversion. Each branch keeps its timezone. Save your edits before copying."
            )}
          </p>
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
                  {target.timezone && target.timezone !== p.snapshot?.timezone && <small>{t("منطقة زمنية مختلفة", "Different timezone")}</small>}
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
              <h4>{t("مراجعة استبدال المواعيد", "Review schedule replacement")}</h4>
              <p>
                <bdi>{p.snapshot.branchLabel}</bdi> — <bdi>{p.snapshot.timezone}</bdi>
              </p>
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
              <p>{t("الفروع التي ستُستبدل مواعيدها:", "Branches whose schedules will be replaced:")}</p>
              <ul>
                {selected.map((branchId) => {
                  const target = p.copyTargets.find((item) => item.branchId === branchId)!;
                  return (
                    <li key={branchId}>
                      <bdi>{target.label}</bdi> — <bdi>{target.timezone}</bdi>
                      {target.timezone !== p.snapshot?.timezone ? t(" — منطقة زمنية مختلفة؛ دون تحويل", " — different timezone; no conversion") : null}
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
                {t("تأكيد النسخ للفروع المختارة", "Confirm copy to selected branches")}
              </button>
              <button type="button" disabled={locked} onClick={() => setConfirmation(null)}>
                {t("إلغاء", "Cancel")}
              </button>
              {!p.onCopy && <p>{t("تنفيذ النسخ غير متاح بعد؛ لم تتغير مواعيد أي فرع.", "Copying is not available yet; no branch schedule has changed.")}</p>}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
