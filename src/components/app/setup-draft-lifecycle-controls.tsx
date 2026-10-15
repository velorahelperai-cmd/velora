"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setupDraftLifecycleAction } from "@/lib/tenancy/setup-draft-actions";
import type { SetupDraftCancellationPreview, SetupDraftRecord, SetupDraftScope } from "@/lib/tenancy/setup-draft";
import { Button, Notice } from "./ui";

export type SetupDraftLifecycleControlsProps = {
  scope: SetupDraftScope; record: SetupDraftRecord; ar: boolean;
  onChange: (record: SetupDraftRecord) => void; onClosed: (record: SetupDraftRecord) => void;
};

/** Receipts bind every action to the rendered account, company and draft generation. */
export function SetupDraftLifecycleControls({ scope, record, ar, onChange, onClosed }: SetupDraftLifecycleControlsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ binding: string; value: SetupDraftCancellationPreview } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const binding = `${scope.expectedUserId}:${scope.expectedCompanyId}:${record.draftId}:${record.revision}:${record.generation}`;
  const liveBinding = useRef<string | null>(binding);
  useEffect(() => { liveBinding.current = binding; return () => { liveBinding.current = null; }; }, [binding]);
  const currentPreview = preview?.binding === binding ? preview.value : null;
  const writable = record.state === "active" || record.state === "legacy_conflict";
  function perform(action: "keep" | "complete" | "preview_cancel" | "confirm_cancel") {
    if (!record.draftId || !record.generation || pending) return;
    const current = binding;
    startTransition(async () => {
      setError(null);
      try {
        const result = await setupDraftLifecycleAction({ ...scope, draftId: record.draftId!, expectedRevision: record.revision,
          generation: record.generation!, action, ...(currentPreview ? { confirmationToken: currentPreview.confirmationToken } : {}) });
        if (liveBinding.current !== current) return;
        if (!result.ok) { setError(result.code); return; }
        if ("confirmationToken" in result.data) { setPreview({ binding: current, value: result.data }); setConfirmation(""); return; }
        setPreview(null);
        const next = { ...record, ...result.data };
        if (result.data.state === "active") onChange(next); else onClosed(next);
      } catch { if (liveBinding.current === current) setError("UNAVAILABLE"); }
    });
  }
  if (!record.draftId || !record.generation) return <Notice>{ar ? "أعد تحميل المسودة المحفوظة لإدارة مهلة الاحتفاظ بها." : "Reload the saved draft to manage its retention."}</Notice>;
  if (!writable) return <Notice>{ar ? "أُغلقت المسودة. حذف الملفات غير مكتمل؛ التنظيف ينتظر سياسة معتمدة. بقي النشاط محفوظًا." : "The draft is closed. File deletion is not complete; cleanup awaits an approved policy. The company remains saved."}</Notice>;
  const expiry = record.expiresAt && Number.isFinite(Date.parse(record.expiresAt)) ? new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Muscat" }).format(new Date(record.expiresAt)) : null;
  return <section aria-label={ar ? "إدارة مسودة التجهيز" : "Setup draft management"} className="space-y-3">
    <p>{record.paidProtected
      ? (ar ? "الدفع يحمي بيانات التجهيز أثناء انتظار التفعيل والدورة المدفوعة. بعد الانتهاء تُطبق سياسة الاحتفاظ بالبيانات المدفوعة." : "Payment protects this setup during activation waiting and the paid cycle. Paid-data retention applies after expiry.")
      : expiry ? <>{ar ? "تنتهي مهلة المسودة المجانية: " : "Free draft expires: "}<bdi>{expiry}</bdi>. {ar ? "التعديل المحفوظ أو الاحتفاظ الصريح يجدد مهلة 30 يومًا." : "A confirmed edit or explicit keep renews the 30-day deadline."}</> : null}</p>
    <div className="flex flex-wrap gap-3">
      <Button type="button" variant="secondary" disabled={pending} onClick={() => perform("keep")}>{ar ? "الاحتفاظ بالمسودة" : "Keep draft"}</Button>
      {scope.expectedCompanyId && <Button type="button" variant="secondary" disabled={pending} onClick={() => perform("complete")}>{ar ? "إنهاء مسودة التجهيز" : "Finish setup draft"}</Button>}
      <Button type="button" variant="secondary" disabled={pending} onClick={() => perform("preview_cancel")}>{ar ? "إغلاق المسودة" : "Close draft"}</Button>
    </div>
    {currentPreview && <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4" role="group" aria-label={ar ? "تأكيد إغلاق المسودة" : "Confirm closing the draft"}>
      <p>{ar ? "سيوقف التأكيد حفظ هذه المسودة فورًا. يبقى النشاط محفوظًا. عدد الملفات المشمولة: " : "Confirmation stops saving this draft immediately. The company remains saved. Included files: "}{currentPreview.scopedFileCount}.</p>
      <p>{ar ? "التنظيف ينتظر سياسة معتمدة، ولا يُعد الحذف مكتملًا. الملفات السابقة غير مشمولة." : "Cleanup awaits an approved policy; deletion is not complete. Previously uploaded files are excluded."}</p>
      <label className="block space-y-2"><span>{ar ? "اكتب CLOSE للتأكيد" : "Type CLOSE to confirm"}</span><input className="min-h-11 rounded-xl border bg-[var(--color-panel-deep)] px-3 focus-visible:outline-2" value={confirmation} disabled={pending} dir="ltr" autoComplete="off" onChange={e => setConfirmation(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={pending || confirmation !== "CLOSE"} onClick={() => perform("confirm_cancel")}>{ar ? "تأكيد الإغلاق" : "Confirm closure"}</Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => setPreview(null)}>{ar ? "رجوع" : "Back"}</Button></div>
    </div>}
    {pending && <p role="status">{ar ? "بانتظار تأكيد الخادم…" : "Waiting for server confirmation…"}</p>}
    {error && <div role="alert"><Notice tone="error">{error === "CONFLICT" ? (ar ? "تغيرت المسودة. أعد تحميل النسخة المحفوظة قبل المتابعة." : "The draft changed. Reload the saved version before continuing.")
      : error === "DRAFT_CLOSED" || error === "DRAFT_EXPIRED" ? (ar ? "أُغلقت هذه المسودة أو انتهت مهلتها. أعد تحميل حالتها." : "This draft is closed or expired. Reload its status.")
      : error === "CONFIRMATION_REQUIRED" ? (ar ? "انتهت صلاحية التأكيد. اعرض نطاق الإغلاق مرة أخرى." : "The confirmation expired. Preview the closure again.")
      : (ar ? "لم يتم تأكيد العملية. أعد المحاولة بعد تحديث المسودة." : "The operation was not confirmed. Refresh the draft and retry.")}</Notice></div>}
  </section>;
}
