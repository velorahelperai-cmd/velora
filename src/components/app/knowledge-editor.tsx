"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  deleteKnowledgeSource,
  listKnowledgeSources,
  repairStoredKnowledgeFile,
  retryFailedKnowledgeFile,
  retryKnowledgePrepare,
  saveTextKnowledgeSource,
  setKnowledgeSourceApproval,
  uploadKnowledgeFiles,
} from "@/lib/knowledge/actions";
import {
  KNOWLEDGE_ACCEPT,
  isPreparableKnowledgeFile,
  validateKnowledgeBatch,
  validateKnowledgeFile,
} from "@/lib/knowledge/constants";
import { isApprovedForAnswers, type KnowledgeApprovalFoundation, type KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { fill } from "@/lib/app-copy";
import {
  Button, ConfirmDialog, EmptyState, Field, FieldErrorKey, Notice,
  useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

type Props = {
  compact?: boolean;
  focusTitle?: string;
  canWrite: boolean;
  canDelete?: boolean;
  initialSources: KnowledgeSourceRecord[];
  /** True when the server failed to load sources (do not show empty state). */
  initialLoadFailed?: boolean;
  approvalFoundation?: KnowledgeApprovalFoundation;
  onSourcesChange?: (sources: KnowledgeSourceRecord[]) => void;
  /** Notify parent when load failure clears/sets (e.g. setup Next button). */
  onLoadStateChange?: (failed: boolean) => void;
};

function fileErrorMessage(code: string | undefined, copy: ReturnType<typeof useAppCopy>) {
  if (code === "TOO_LARGE") return copy.knowledge.fileTooLarge;
  if (code === "INVALID_TYPE") return copy.knowledge.fileInvalidType;
  if (code === "EMPTY") return copy.knowledge.fileEmpty;
  if (code === "BATCH_TOO_MANY") return copy.knowledge.batchTooMany;
  if (code === "BATCH_TOO_LARGE") return copy.knowledge.batchTooLarge;
  if (code === "CLEANUP_FAILED") return copy.knowledge.cleanupFailed;
  return copy.knowledge.fileUploadFailed;
}

function statusLabel(status: string, copy: ReturnType<typeof useAppCopy>) {
  const map = copy.knowledge.statuses as Record<string, string>;
  return map[status] ?? status;
}

function reasonText(code: string | null | undefined, copy: ReturnType<typeof useAppCopy>) {
  if (!code) return null;
  const map = copy.knowledge.reasons as Record<string, string>;
  return map[code] ?? map.extract_failed ?? null;
}

/** Company knowledge editor (setup + /app/knowledge). Always persists to DB when rendered. */
export function KnowledgeEditor({
  compact,
  focusTitle,
  canWrite,
  canDelete = canWrite,
  initialSources,
  initialLoadFailed = false,
  approvalFoundation: initialApprovalFoundation = "ready",
  onSourcesChange,
  onLoadStateChange,
}: Props) {
  const copy = useAppCopy();
  const router = useRouter();
  const [sources, setSources] = useState<KnowledgeSourceRecord[]>(initialSources);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  const [approvalFoundation, setApprovalFoundation] = useState<KnowledgeApprovalFoundation>(initialApprovalFoundation);
  const [mode, setMode] = useState<"text" | "file" | null>(focusTitle && !initialLoadFailed ? "text" : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ title: focusTitle ?? "", content: "", files: null as FileList | null });
  const [usageRole, setUsageRole] = useState<"knowledge" | "business_instructions">("knowledge");
  const [errors, setErrors] = useState<Partial<Record<"title" | "content" | "files", FieldErrorKey>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewRefreshFailed, setViewRefreshFailed] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ fileName: string; ok: boolean; status?: string; message?: string }[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryId, setRetryId] = useState<string | null>(null);
  const listGen = useRef(0);
  const [trackedProps, setTrackedProps] = useState(() => ({
    sources: initialSources,
    failed: initialLoadFailed,
    foundation: initialApprovalFoundation,
  }));

  // Adopt newer SSR props after router.refresh — do not keep a stale client list.
  if (
    trackedProps.sources !== initialSources
    || trackedProps.failed !== initialLoadFailed
    || trackedProps.foundation !== initialApprovalFoundation
  ) {
    setTrackedProps({
      sources: initialSources,
      failed: initialLoadFailed,
      foundation: initialApprovalFoundation,
    });
    setSources(initialSources);
    setLoadFailed(initialLoadFailed);
    setApprovalFoundation(initialApprovalFoundation);
    setViewRefreshFailed(false);
  }

  const dirty = mode !== null && Boolean(form.title || form.content || (form.files && form.files.length));
  useUnsavedWarning(dirty);
  const titleError = useErrorText(errors.title);
  const contentError = useErrorText(errors.content);
  const fileError = useErrorText(errors.files);

  useEffect(() => {
    listGen.current += 1;
  }, [initialSources, initialLoadFailed, initialApprovalFoundation]);

  useEffect(() => {
    onSourcesChange?.(sources);
  }, [sources, onSourcesChange]);

  function setLoadFailedState(failed: boolean) {
    setLoadFailed(failed);
    onLoadStateChange?.(failed);
  }

  function reset() {
    setUsageRole("knowledge");
    setMode(null);
    setEditing(null);
    setForm({ title: "", content: "", files: null });
    setErrors({});
  }

  /** Refresh dashboard readiness cache without rewriting knowledge. */
  function refreshAppViews() {
    try {
      router.refresh();
    } catch {
      /* refresh optional */
    }
  }

  async function reload(opts?: { keepNotice?: string | null; keepError?: boolean }) {
    const gen = ++listGen.current;
    setBusy(true);
    if (!opts?.keepError) setError(null);
    if (!opts?.keepNotice) setNotice(null);
    if (!opts?.keepError) setViewRefreshFailed(false);
    try {
      const result = await listKnowledgeSources();
      if (gen !== listGen.current) return;
      if (!result.ok) {
        setLoadFailedState(true);
        if (opts?.keepNotice) {
          setViewRefreshFailed(true);
          setNotice(opts.keepNotice);
        }
        return;
      }
      setLoadFailedState(false);
      setApprovalFoundation(result.data.approvalFoundation);
      setSources(result.data.sources);
      if (opts?.keepNotice) setNotice(opts.keepNotice);
    } catch {
      if (gen !== listGen.current) return;
      if (opts?.keepNotice) {
        setViewRefreshFailed(true);
        setNotice(opts.keepNotice);
      } else {
        setLoadFailedState(true);
      }
    } finally {
      if (gen === listGen.current) setBusy(false);
    }
  }

  async function saveTextDb() {
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = "required";
    if (!form.content.trim()) next.content = "required";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setViewRefreshFailed(false);
    try {
      const result = await saveTextKnowledgeSource({
        id: editing ?? undefined,
        title: form.title,
        content: form.content,
        usageRole,
      });
      if (!result.ok) {
        // Keep form inputs on failure — do not clear the draft.
        setError(result.message ?? copy.knowledge.saveFailed);
        return;
      }
      setSources((prev) => {
        const others = prev.filter((s) => s.id !== result.data.id);
        return [result.data, ...others];
      });
      setNotice(copy.saved);
      reset();
      refreshAppViews();
      await reload({ keepNotice: copy.saved });
    } finally {
      setBusy(false);
    }
  }

  async function saveFilesDb() {
    if (!form.files?.length) {
      setErrors({ files: "required" });
      return;
    }
    const batchErr = validateKnowledgeBatch(
      Array.from(form.files).map((f) => ({ name: f.name, size: f.size, type: f.type })),
    );
    if (batchErr) {
      setError(fileErrorMessage(batchErr, copy));
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setUploadResults([]);
    try {
      const fd = new FormData();
      Array.from(form.files).forEach((f) => fd.append("files", f));
      const result = await uploadKnowledgeFiles(fd);
      if (!result.ok) {
        setError(fileErrorMessage(result.message, copy) || result.message || copy.knowledge.saveFailed);
        return;
      }
      const rows = result.data;
      setUploadResults(
        rows.map((r) => {
          if (r.ok) return { fileName: r.fileName, ok: true, status: r.source?.status };
          const extractReason = reasonText(r.source?.failure_code ?? r.message, copy);
          const message =
            r.code === "UPLOAD_OK_EXTRACT_FAILED" || r.uploaded
              ? `${copy.knowledge.uploadOkExtractFailed}${extractReason ? ` (${extractReason})` : ""}`
              : (extractReason ?? fileErrorMessage(r.code, copy));
          return { fileName: r.fileName, ok: false, status: r.source?.status, message };
        }),
      );
      const touched = rows.filter((r) => r.source).map((r) => r.source!);
      if (touched.length) {
        setSources((prev) => {
          const merged = [...touched, ...prev];
          const seen = new Set<string>();
          return merged.filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          });
        });
      }
      const allReady = rows.every((r) => r.ok && r.source?.status !== "failed");
      const anyUploadOkExtractFail = rows.some(
        (r) => !r.ok && (r.code === "UPLOAD_OK_EXTRACT_FAILED" || r.uploaded),
      );
      if (allReady) setNotice(copy.knowledge.uploadDone);
      else if (anyUploadOkExtractFail) setError(copy.knowledge.uploadOkExtractFailed);
      else setError(copy.knowledge.uploadPartial);
      reset();
      refreshAppViews();
      if (touched.length) {
        await reload({
          keepNotice: allReady ? copy.knowledge.uploadDone : null,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!canWrite) return;
    if (loadFailed && !viewRefreshFailed && sources.length === 0) return;
    if (mode === "text") void saveTextDb();
    else void saveFilesDb();
  }

  async function removeDb(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await deleteKnowledgeSource(id);
      setPendingDelete(null);
      if (!result.ok) {
        const msg = result.message ?? "";
        setError(
          msg.startsWith("DELETE_PARTIAL:")
            ? copy.knowledge.deletePartial
            : (result.message ?? copy.knowledge.deleteFailed),
        );
        return;
      }
      setSources((prev) => prev.filter((s) => s.id !== id));
      setNotice(copy.knowledge.deleted);
      refreshAppViews();
      await reload({ keepNotice: copy.knowledge.deleted });
    } finally {
      setBusy(false);
    }
  }

  async function retryDb(src: KnowledgeSourceRecord, file: File) {
    const validation = validateKnowledgeFile({ name: file.name, size: file.size, type: file.type });
    if (validation) {
      setError(fileErrorMessage(validation, copy));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await retryFailedKnowledgeFile(src.id, fd);
      if (result.data) {
        setSources((prev) => prev.map((s) => (s.id === src.id ? result.data! : s)));
      }
      if (!result.ok) {
        if (result.message?.startsWith("UPLOAD_OK_EXTRACT_FAILED:")) {
          const code = result.message.slice("UPLOAD_OK_EXTRACT_FAILED:".length);
          setError(
            `${copy.knowledge.uploadOkExtractFailed}${reasonText(code, copy) ? ` (${reasonText(code, copy)})` : ""}`,
          );
          return;
        }
        if (result.message === "OBJECT_MISSING") {
          setError(copy.knowledge.objectMissing);
          return;
        }
        setError(result.message ?? copy.knowledge.fileUploadFailed);
        return;
      }
      if (result.data.status === "failed") {
        setError(
          `${copy.knowledge.uploadOkExtractFailed}${
            reasonText(result.data.failure_code, copy) ? ` (${reasonText(result.data.failure_code, copy)})` : ""
          }`,
        );
        return;
      }
      setNotice(copy.knowledge.uploadDone);
      refreshAppViews();
      await reload({ keepNotice: copy.knowledge.uploadDone });
    } finally {
      setBusy(false);
      setRetryId(null);
    }
  }

  async function prepareAgain(src: KnowledgeSourceRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await retryKnowledgePrepare(src.id);
      if (result.data) {
        setSources((prev) => prev.map((s) => (s.id === src.id ? result.data! : s)));
      }
      if (!result.ok) {
        if (result.message === "OBJECT_MISSING") {
          setError(copy.knowledge.objectMissing);
          return;
        }
        if (result.message === "storage_unavailable") {
          setError(copy.knowledge.storageUnavailable);
          return;
        }
        setError(reasonText(result.message, copy) ?? result.message ?? copy.knowledge.reasons.extract_failed);
        return;
      }
      if (result.data.status === "failed") {
        setError(reasonText(result.data.failure_code, copy));
        return;
      }
      setNotice(statusLabel(result.data.status, copy));
      refreshAppViews();
      await reload({ keepNotice: statusLabel(result.data.status, copy) });
    } finally {
      setBusy(false);
    }
  }

  async function repairDb(src: KnowledgeSourceRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await repairStoredKnowledgeFile(src.id);
      if (result.data) {
        setSources((prev) => prev.map((s) => (s.id === src.id ? result.data! : s)));
      }
      if (!result.ok) {
        if (result.message === "OBJECT_MISSING") {
          setError(copy.knowledge.objectMissing);
          return;
        }
        setError(result.message === "storage_unavailable"
          ? copy.knowledge.storageUnavailable
          : (result.message ?? copy.knowledge.cleanupFailed));
        return;
      }
      if (result.data.status === "failed") {
        setError(reasonText(result.data.failure_code, copy) ?? copy.knowledge.cleanupFailed);
        return;
      }
      setNotice(copy.knowledge.uploadDone);
      refreshAppViews();
      await reload({ keepNotice: copy.knowledge.uploadDone });
    } finally {
      setBusy(false);
    }
  }

  async function setApproval(src: KnowledgeSourceRecord, approved: boolean) {
    if (approvalFoundation !== "ready") {
      setError(copy.knowledge.approvalFoundationUnavailable);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setViewRefreshFailed(false);
    try {
      const result = await setKnowledgeSourceApproval(src.id, approved);
      if (!result.ok) {
        if (result.message === "APPROVAL_FOUNDATION_UNAVAILABLE") {
          setApprovalFoundation("unavailable");
          setError(copy.knowledge.approvalFoundationUnavailable);
          return;
        }
        if (result.message === "version_changed") {
          setError(copy.knowledge.approveVersionChanged);
          refreshAppViews();
          await reload({ keepError: true });
          return;
        }
        setError(result.message ?? copy.knowledge.approveFailed);
        return;
      }
      setSources((prev) => prev.map((s) => (s.id === src.id ? result.data : s)));
      const okNotice = approved ? copy.knowledge.approveDone : copy.knowledge.revokeDone;
      setNotice(okNotice);
      refreshAppViews();
      await reload({ keepNotice: okNotice });
    } finally {
      setBusy(false);
    }
  }

  const statusStyle: Record<string, string> = {
    draft: "bg-[var(--color-hover-wash)] text-[var(--color-on-dark)] ring-1 ring-white/15",
    processing: "bg-[#d9a467]/20 text-[var(--color-warn-fg)] ring-1 ring-[#d9a467]/35",
    stored: "bg-[var(--color-hover-wash)] text-[var(--color-on-dark)] ring-1 ring-white/15",
    ready: "bg-[#38dc89]/18 text-[var(--color-success-fg)] ring-1 ring-[#38dc89]/35",
    failed: "bg-[#e07a5f]/18 text-[var(--color-danger-fg)] ring-1 ring-[#e07a5f]/40",
  };

  const readyCount = sources.filter((s) => s.status === "ready" && isApprovedForAnswers(s)).length;
  const healthPercent = sources.length === 0 ? 0 : Math.min(100, Math.round((readyCount / Math.max(1, sources.length)) * 100));

  return (
    <div className="grid gap-5">
      {/* 🧠 بطاقة جاهزية ومستوى ذكاء قاعدة المعرفة */}
      <section className="rounded-3xl border border-[#38dc89]/30 bg-gradient-to-r from-[#11241a] via-[#0d1c15] to-[#07110d] p-5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#38dc89] to-[#124b30] text-[#072317] text-2xl font-bold shadow-md">
              🧠
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-[#f7fbf8]">مستوى جاهزية المعرفة (Knowledge Score)</h2>
                <span className="inline-flex rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-2.5 py-0.5 text-xs font-semibold text-[#9af0c3]">
                  {healthPercent >= 70 ? "ممتازة للردود 🟢" : "تحتاج مزيداً من الملفات 🟡"}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#b7c6b9]">
                كلما رفعت ملفات أكثر، زادت قدرة الموظفة على الإجابة الدقيقة على استفسارات واتساب بدون أخطاء.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-extrabold text-[#9af0c3]">{healthPercent}%</span>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2ebd73] to-[#38dc89] shadow-[0_0_12px_rgba(56,220,137,0.5)] transition-all duration-700"
              style={{ width: `${Math.max(8, healthPercent)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#8aa394]">
            <span>{readyCount} مصادر معتمدة وجاهزة للإجابات</span>
            <span>الهدف: 3 مصادر على الأقل لإطلاق الموظفة بكفاءة</span>
          </div>
        </div>
      </section>

      {!compact ? <p className="app-muted max-w-2xl text-base leading-7">{copy.knowledge.body}</p> : null}
      <p className="app-muted-soft text-xs leading-5">{copy.knowledge.examples}</p>
      {!canWrite ? <Notice tone="info">{copy.knowledge.readOnly}</Notice> : null}
      {approvalFoundation === "unavailable" ? (
        <Notice tone="warn">{copy.knowledge.approvalFoundationUnavailable}</Notice>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {viewRefreshFailed ? (
        <div className="grid gap-2">
          <Notice tone="warn">{copy.knowledge.viewRefreshWarn}</Notice>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void reload()}>
            {copy.knowledge.retryViewOnly}
          </Button>
        </div>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {loadFailed && !viewRefreshFailed ? (
        <div className="grid gap-2">
          <Notice tone="error">{copy.knowledge.loadFailed}</Notice>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void reload()}>
            {copy.knowledge.retryViewOnly}
          </Button>
        </div>
      ) : null}
      {uploadResults.length ? (
        <ul className="grid gap-1 rounded-xl border border-[color:var(--color-line)] bg-[var(--color-panel)]/80 p-3 text-xs">
          {uploadResults.map((r) => (
            <li key={r.fileName} className={r.ok ? "text-[var(--color-warn-fg)]" : "text-[var(--color-danger-fg)]"}>
              <span dir="ltr">{r.fileName}</span>
              {" — "}
              {r.ok ? statusLabel(r.status ?? "stored", copy) : r.message}
            </li>
          ))}
        </ul>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "text" ? "primary" : "secondary"}
            busy={busy}
            onClick={() => { setMode("text"); setEditing(null); setUsageRole("knowledge"); setForm({ title: "", content: "", files: null }); }}
          >
            {copy.knowledge.addText}
          </Button>
          <Button
            variant={mode === "file" ? "primary" : "secondary"}
            busy={busy}
            onClick={() => { setMode("file"); setEditing(null); setUsageRole("knowledge"); setForm({ title: "", content: "", files: null }); }}
          >
            {copy.knowledge.addFile}
          </Button>
        </div>
      ) : null}

      {mode && canWrite ? (
        <form
          className="grid gap-3 rounded-2xl border border-[color:var(--color-line)] bg-[var(--color-panel)] p-4"
          noValidate
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          {mode === "text" ? (
            <>
              <Field label={copy.knowledge.sourceTitle} required error={titleError}>
                {(p) => <input {...p} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
              </Field>
              <Field label="نوع المعرفة / Knowledge purpose">
                {(p) => <select {...p} value={usageRole} onChange={(e) => setUsageRole(e.target.value as "knowledge" | "business_instructions")}>
                  <option value="knowledge">المنتجات والخدمات والأسعار والسياسات / Business facts</option>
                  <option value="business_instructions">أسلوب الشركة وتعليمات الرد المعتمدة / Approved business instructions</option>
                </select>}
              </Field>
              <Field label={copy.knowledge.sourceContent} required error={contentError}>
                {(p) => (
                  <textarea
                    {...p}
                    rows={4}
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    className={`${p.className} min-h-28 py-2`}
                  />
                )}
              </Field>
            </>
          ) : (
            <Field label={copy.knowledge.addFile} required hint={copy.knowledge.fileHint} error={fileError}>
              {(p) => (
                <input
                  {...p}
                  type="file"
                  multiple
                  accept={KNOWLEDGE_ACCEPT}
                  onChange={(e) => setForm({ ...form, files: e.target.files, title: e.target.files?.[0]?.name ?? form.title })}
                  className={`${p.className} py-2 file:me-3 file:rounded-lg file:border-0 file:bg-[#38dc89] file:px-3 file:py-1.5 file:text-[#072317]`}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={busy} busyLabel={mode === "file" ? copy.knowledge.uploading : copy.saving}>
              {copy.save}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={reset}>{copy.cancel}</Button>
          </div>
        </form>
      ) : null}

      {sources.length === 0 ? (
        <EmptyState title={copy.knowledge.empty} />
      ) : (
        <ul className="grid gap-1">
          {sources.map((src) => (
            <li key={src.id} className="grid gap-2 border-b border-[color:var(--color-line)] py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold tracking-tight text-[var(--color-on-dark)]">{src.title}</p>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusStyle[src.status]}`}>
                    {statusLabel(src.status, copy)}
                  </span>
                  {src.status === "ready" ? (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        isApprovedForAnswers(src)
                          ? "bg-[#38dc89]/22 text-[var(--color-success-fg)] ring-1 ring-[#38dc89]/40"
                          : "bg-white/8 text-[var(--color-muted-on-dark)] ring-1 ring-white/12"
                      }`}
                    >
                      {approvalFoundation === "unavailable"
                        ? copy.knowledge.approvalUnknown
                        : isApprovedForAnswers(src)
                          ? copy.knowledge.approved
                          : copy.knowledge.notApproved}
                    </span>
                  ) : null}
                </div>
                <p className="app-muted mt-1.5 line-clamp-2 text-sm leading-6">
                  {src.kind === "file" ? <span dir="ltr">{src.file_name}</span> : src.content}
                </p>
                {src.kind === "file" && src.status === "ready" && src.content ? (
                  <p className="app-muted mt-1 line-clamp-2 text-sm leading-6">{src.content}</p>
                ) : null}
                {src.failure_code ? (
                  <p className="mt-1 text-sm leading-6 text-[var(--color-danger-fg)]">{reasonText(src.failure_code, copy)}</p>
                ) : null}
                {src.status === "ready" && canWrite && approvalFoundation === "ready" ? (
                  <p className="app-muted-soft mt-1 text-xs leading-5">{copy.knowledge.approveHint}</p>
                ) : null}
              </div>
              {canWrite || canDelete ? (
                <div className="flex flex-wrap gap-1">
                  {canWrite && src.status === "ready" && src.content.trim() && approvalFoundation === "ready" ? (
                    <Button
                      variant="ghost"
                      busy={busy}
                      onClick={() => void setApproval(src, !isApprovedForAnswers(src))}
                    >
                      {isApprovedForAnswers(src) ? copy.knowledge.revokeApproval : copy.knowledge.approve}
                    </Button>
                  ) : null}
                  {src.kind === "file"
                    && src.storage_path
                    && isPreparableKnowledgeFile(src.file_name)
                    && src.status !== "draft" ? (
                    <Button variant="ghost" busy={busy} onClick={() => void prepareAgain(src)}>
                      {copy.knowledge.retry}
                    </Button>
                  ) : null}
                  {src.kind === "file"
                    && src.storage_path
                    && !isPreparableKnowledgeFile(src.file_name)
                    && (src.status === "failed" || src.status === "draft") ? (
                    <Button variant="ghost" busy={busy} onClick={() => void repairDb(src)}>
                      {copy.knowledge.repair}
                    </Button>
                  ) : null}
                  {src.kind === "file" && src.status !== "processing" ? (
                    <>
                      <input
                        id={`retry-${src.id}`}
                        type="file"
                        accept={KNOWLEDGE_ACCEPT}
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void retryDb(src, f);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        variant="ghost"
                        busy={busy && retryId === src.id}
                        onClick={() => {
                          setRetryId(src.id);
                          document.getElementById(`retry-${src.id}`)?.click();
                        }}
                      >
                        {src.storage_path || src.status === "ready" || src.status === "stored"
                          ? copy.knowledge.replaceFile
                          : copy.knowledge.retry}
                      </Button>
                    </>
                  ) : null}
                  {src.kind === "text" ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setMode("text");
                        setEditing(src.id);
                        setForm({ title: src.title, content: src.content, files: null });
                        setUsageRole(src.usage_role ?? "knowledge");
                      }}
                    >
                      {copy.edit}
                    </Button>
                  ) : null}
                  <Button variant="ghost" disabled={busy} onClick={() => setPendingDelete({ id: src.id, title: src.title })}>
                    {copy.delete}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="app-muted-soft text-xs leading-5">{copy.knowledge.statusNote}</p>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={copy.delete}
        body={pendingDelete ? fill(copy.knowledge.confirmDelete, { title: pendingDelete.title }) : undefined}
        confirmLabel={copy.delete}
        danger
        onConfirm={() => {
          if (pendingDelete) void removeDb(pendingDelete.id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
