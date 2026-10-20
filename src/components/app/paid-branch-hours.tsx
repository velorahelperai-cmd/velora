"use client";
import {useId, useLayoutEffect, useRef, useState} from "react";
import {
  BRANCH_HOURS_DAYS, cloneBranchHours, knownBranchHoursTimezone, prepareBranchHoursCopy,
  prepareBranchHoursSave, sameBranchHoursScope, validateBranchHours,
  type BranchHoursCopyDraft, type BranchHoursCopyTarget, type BranchHoursDay,
  type BranchHoursDayValue, type BranchHoursSaveDraft, type BranchHoursScope,
  type BranchHoursSnapshot,
} from "@/lib/tenancy/branch-hours-contracts";
import styles from "./paid-branch-hours.module.css";

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
  if (scoped && p.state.phase === "loading") return <section className={styles.view} dir={p.locale === "ar" ? "rtl" : "ltr"} aria-busy="true"><p role="status">{t("جارٍ تحميل مواعيد الفرع…", "Loading branch hours…")}</p></section>;
  if (!scoped || !p.snapshot || !sameBranchHoursScope(p.scope, p.snapshot.scope) ||
      p.state.version !== p.snapshot.version || p.state.phase === "unavailable" || !validateBranchHours(p.snapshot.schedule).ok)
    return <section className={styles.view} dir={p.locale === "ar" ? "rtl" : "ltr"}><p role="status">{t("مواعيد هذا الفرع غير متاحة. أعد تحميل بيانات الفرع.", "Hours for this branch are unavailable. Reload the branch data.")}</p></section>;
  return <HoursForm key={branchHoursViewKey(p)} {...p} snapshot={p.snapshot}/>;
}

function HoursForm(p: PaidBranchHoursProps & {snapshot: BranchHoursSnapshot}) {
  const ar = p.locale === "ar", t = (a: string, e: string) => ar ? a : e, id = useId();
  const [draft, setDraft] = useState(() => cloneBranchHours(p.snapshot.schedule));
  const [selected, setSelected] = useState<string[]>([]);
  const [showCopy, setShowCopy] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const mounted = useRef(false), reserved = useRef(false);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const locked = busy || p.state.phase === "saving" || p.state.phase === "conflict";
  const validated = validateBranchHours(draft);
  const save = prepareBranchHoursSave(p.scope, p.snapshot, draft);
  const copy = prepareBranchHoursCopy(p.scope, p.snapshot, draft, p.copyTargets, selected);
  const fingerprint = JSON.stringify([p.scope, p.snapshot.version, draft, selected, p.copyTargets]);
  const confirming = copy.ok && confirmation === fingerprint;
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.snapshot.schedule);
  const label = (day: BranchHoursDay) => dayLabels[day][ar ? 0 : 1];
  function change(day: BranchHoursDay, value: BranchHoursDayValue) {
    if (locked || !p.isCurrent()) return;
    setDraft(current => ({...current, [day]: value})); setConfirmation(null); setFailed(false);
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
  return <section className={styles.view} dir={ar ? "rtl" : "ltr"} aria-labelledby={id} aria-busy={busy || p.state.phase === "saving"}>
    <header className={styles.header}><h2 id={id}>{t("مواعيد عمل الفرع", "Branch working hours")}</h2>
      <p><bdi>{p.snapshot.branchLabel}</bdi> <span>{t("المنطقة الزمنية: ", "Timezone: ")}<bdi>{p.snapshot.timezone || t("غير معروفة", "Unknown")}</bdi></span></p>
    </header>
    <p className={styles.note}>{t("الأوقات حسب ساعة الفرع المحلية. تُسجّل الفترة في يوم بدايتها؛ امتدادها إلى اليوم التالي يظهر أسفل ذلك اليوم. لا تغيّر هذه الصفحة سياسة الرد خارج الدوام.", "Times use the branch's local clock. Each interval belongs to its starting day; carry-over appears on the following day. This page does not change after-hours reply policy.")}</p>
    {!knownBranchHoursTimezone(p.snapshot.timezone) && <p role="status" className={styles.error}>{t("يجب تأكيد المنطقة الزمنية المخزنة قبل الحفظ أو النسخ. لم تُستخدم منطقة افتراضية.", "Confirm the stored timezone before saving or copying. No default timezone was used.")}</p>}
    {p.state.phase === "conflict" && <div role="alert" className={styles.error}><p>{t("تغيّرت المواعيد المحفوظة. أعد التحميل لمراجعتها قبل الحفظ؛ ستُستبدل تعديلاتك المحلية.", "Saved hours changed. Reload to review them before saving; this replaces your local edits.")}</p>{p.onReload && <button type="button" onClick={() => {if (p.isCurrent()) p.onReload?.({...p.scope});}}>{t("إعادة التحميل", "Reload")}</button>}</div>}
    {p.state.phase === "saved" && !dirty && <p role="status">{t("تم تأكيد حفظ هذه النسخة من الخادم.", "The server confirmed this saved version.")}</p>}
    {failed && <p role="alert" className={styles.error}>{t("تعذر إرسال الطلب. راجع الحالة الحالية قبل المحاولة مجددًا.", "The request could not be submitted. Review the current state before trying again.")}</p>}
    <form noValidate onSubmit={event => {event.preventDefault(); if (save.ok && p.onSave) void dispatch(() => p.onSave?.(save.draft));}}>
      <fieldset className={styles.days} disabled={locked}>
        <legend className={styles.srOnly}>{t("الجدول الأسبوعي", "Weekly schedule")}</legend>
        {BRANCH_HOURS_DAYS.map((day, dayIndex) => {
          const value = draft[day], previous = draft[BRANCH_HOURS_DAYS[(dayIndex + 6) % 7]];
          const carry = previous.state === "open" ? previous.intervals.filter(interval => interval.nextDay && interval.end && interval.end !== "00:00") : [];
          const issues = validated.ok ? [] : validated.issues.filter(issue => issue.day === day || issue.otherDay === day);
          return <fieldset className={styles.day} key={day} data-hours-day={day} aria-describedby={issues.length ? `${id}-${day}-errors` : undefined}>
            <legend>{label(day)}</legend>
            <label className={styles.dayState}><span>{t("الحالة", "Status")}</span><select aria-label={`${label(day)} ${t("الحالة", "status")}`} value={value.state} onChange={event => change(day, event.target.value === "open" ? {state:"open", intervals:[{start:"", end:"", nextDay:false}]} : {state:event.target.value as "unset" | "closed"})}>
              <option value="unset">{t("غير مضبوط", "Not set")}</option><option value="closed">{t("مغلق", "Closed")}</option><option value="open">{t("مفتوح", "Open")}</option>
            </select></label>
            {value.state === "open" && <div className={styles.intervals}>{value.intervals.map((interval, index) => <div className={styles.interval} key={index}>
              <label>{t("من", "From")}<input type="time" dir="ltr" aria-label={`${label(day)} ${index+1} ${t("من", "from")}`} value={interval.start} onChange={event => change(day, {state:"open", intervals:value.intervals.map((v,i) => i===index ? {...v,start:event.target.value} : v)})}/></label>
              <label>{t("إلى", "To")}<input type="time" dir="ltr" aria-label={`${label(day)} ${index+1} ${t("إلى", "to")}`} value={interval.end} onChange={event => change(day, {state:"open", intervals:value.intervals.map((v,i) => i===index ? {...v,end:event.target.value} : v)})}/></label>
              <label className={styles.check}><input type="checkbox" checked={interval.nextDay} aria-label={`${label(day)} ${index+1} ${t("ينتهي في اليوم التالي", "ends next day")}`} onChange={event => change(day, {state:"open", intervals:value.intervals.map((v,i) => i===index ? {...v,nextDay:event.target.checked} : v)})}/>{t("ينتهي في اليوم التالي", "Ends next day")}</label>
              <button type="button" aria-label={`${t("حذف فترة", "Remove interval")} ${label(day)} ${index+1}`} onClick={() => change(day, {state:"open", intervals:value.intervals.filter((_,i)=>i!==index)})}>{t("حذف", "Remove")}</button>
            </div>)}<button type="button" className={styles.add} onClick={() => change(day, {state:"open", intervals:[...value.intervals,{start:"",end:"",nextDay:false}]})}>{t("إضافة فترة", "Add interval")} — {label(day)}</button></div>}
            {carry.length > 0 && <p className={styles.carry}>{t("امتداد من اليوم السابق حتى: ", "Carry-over from the previous day until: ")}<bdi>{carry.map(interval => interval.end).join("، ")}</bdi></p>}
            {issues.length > 0 && <p id={`${id}-${day}-errors`} role="status" className={styles.error}>{issues.some(issue => issue.code === "overlap") ? t("تتداخل هذه الفترة مع فترة أخرى، بما فيها امتداد اليوم السابق أو التالي.", "An interval overlaps another, including carry-over across days.") : t("أدخل بداية ونهاية صحيحتين. إذا امتدت الفترة بعد منتصف الليل، اختر اليوم التالي صراحةً.", "Enter valid start and end times. Explicitly select next day for an overnight interval.")}</p>}
          </fieldset>;
        })}
      </fieldset>
      <div className={styles.actions}><button type="submit" className={styles.primary} disabled={locked || !save.ok || !p.onSave}>{busy || p.state.phase === "saving" ? t("جارٍ الإرسال…", "Submitting…") : t("حفظ المواعيد", "Save hours")}</button>
        <button type="button" disabled={locked} aria-expanded={showCopy} onClick={() => {if(p.isCurrent()){setShowCopy(value=>!value);setConfirmation(null);}}}>{t("نسخ إلى فروع مختارة", "Copy to selected branches")}</button></div>
      {!p.onSave && <p className={styles.note}>{t("الحفظ غير متاح بعد. التعديلات في هذه الصفحة محلية فقط.", "Saving is not available yet. Edits on this page are local only.")}</p>}
    </form>
    {showCopy && <section className={styles.copy} aria-labelledby={`${id}-copy`}>
      <h3 id={`${id}-copy`}>{t("اختر الفروع المستهدفة", "Choose destination branches")}</h3>
      <p>{t("ستُنسخ أيام الأسبوع وأوقات الساعة المعروضة دون تحويل. يحتفظ كل فرع بمنطقته الزمنية.", "The displayed weekday and clock times are copied without conversion. Each branch keeps its timezone.")}</p>
      {p.copyTargets.filter(target=>target.branchId!==p.scope.branchId).map(target=><label className={styles.target} key={target.branchId}><input type="checkbox" disabled={locked || !knownBranchHoursTimezone(target.timezone)} checked={selected.includes(target.branchId)} onChange={event=>{if(!p.isCurrent())return;setSelected(ids=>event.target.checked?[...ids,target.branchId]:ids.filter(value=>value!==target.branchId));setConfirmation(null);}}/><span><bdi>{target.label}</bdi> — <bdi>{target.timezone || t("منطقة زمنية غير معروفة", "Unknown timezone")}</bdi>{target.timezone && target.timezone!==p.snapshot.timezone && <small>{t("منطقة زمنية مختلفة", "Different timezone")}</small>}</span></label>)}
      {!p.copyTargets.some(target=>target.branchId!==p.scope.branchId) && <p>{t("لا توجد فروع أخرى متاحة للنسخ.", "No other branches are available for copying.")}</p>}
      <button type="button" disabled={locked || !copy.ok} onClick={()=>{if(p.isCurrent()&&copy.ok)setConfirmation(fingerprint);}}>{t("مراجعة النسخ", "Review copy")}</button>
      {confirming && <div className={styles.confirm} role="region" aria-label={t("تأكيد النسخ", "Confirm copy")}>
        <h4>{t("مراجعة استبدال المواعيد", "Review schedule replacement")}</h4><p><bdi>{p.snapshot.branchLabel}</bdi> — <bdi>{p.snapshot.timezone}</bdi></p>
        <ul>{BRANCH_HOURS_DAYS.map(day=><li key={day}>{label(day)}: <bdi>{summary(day)}</bdi></li>)}</ul>
        <p>{t("الفروع التي ستُستبدل مواعيدها:", "Branches whose schedules will be replaced:")}</p>
        <ul>{selected.map(branchId=>{const target=p.copyTargets.find(item=>item.branchId===branchId)!;return <li key={branchId}><bdi>{target.label}</bdi> — <bdi>{target.timezone}</bdi>{target.timezone!==p.snapshot.timezone?t(" — منطقة زمنية مختلفة؛ دون تحويل", " — different timezone; no conversion"):null}</li>;})}</ul>
        <button type="button" className={styles.primary} disabled={locked || !p.onCopy} onClick={()=>{if(copy.ok&&confirmation===fingerprint&&p.onCopy)void dispatch(()=>p.onCopy?.(copy.draft));}}>{t("تأكيد النسخ للفروع المختارة", "Confirm copy to selected branches")}</button>
        <button type="button" disabled={locked} onClick={()=>setConfirmation(null)}>{t("إلغاء", "Cancel")}</button>
        {!p.onCopy && <p>{t("تنفيذ النسخ غير متاح بعد؛ لم تتغير مواعيد أي فرع.", "Copying is not available yet; no branch schedule has changed.")}</p>}
      </div>}
    </section>}
  </section>;
}
