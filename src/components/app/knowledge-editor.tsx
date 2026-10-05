"use client";

import { useEffect, useState } from "react";
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
import { isApprovedForAnswers, type KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { fill } from "@/lib/app-copy";
import {
  Button, ConfirmDialog, EmptyState, Field, FieldErrorKey, Notice,
  useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

type Props = {
  compact?: boolean;
  focusTitle?: string;
  canWrite: boolean;
  initialSources: KnowledgeSourceRecord[];
  /** True when the server failed to load sources (do not show empty state). */
  initialLoadFailed?: boolean;
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
  initialSources,
  initialLoadFailed = false,
  onSourcesChange,
  onLoadStateChange,
}: Props) {
  const copy = useAppCopy();
  const [sources, setSources] = useState<KnowledgeSourceRecord[]>(initialSources);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  const [mode, setMode] = useState<"text" | "file" | null>(focusTitle && !initialLoadFailed ? "text" : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ title: focusTitle ?? "", content: "", files: null as FileList | null });
  const [errors, setErrors] = useState<Partial<Record<"title" | "content" | "files", FieldErrorKey>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<{ fileName: string; ok: boolean; status?: string; message?: string }[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryId, setRetryId] = useState<string | null>(null);

  const dirty = mode !== null && Boolean(form.title || form.content || (form.files && form.files.length));
  useUnsavedWarning(dirty);
  const titleError = useErrorText(errors.title);
  const contentError = useErrorText(errors.content);
  const fileError = useErrorText(errors.files);

  useEffect(() => {
    onSourcesChange?.(sources);
  }, [sources, onSourcesChange]);

  function setLoadFailedState(failed: boolean) {
    setLoadFailed(failed);
    onLoadStateChange?.(failed);
  }

  function reset() {
    setMode(null);
    setEditing(null);
    setForm({ title: "", content: "", files: null });
    setErrors({});
  }

  async function reload() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await listKnowledgeSources();
      if (!result.ok) {
        setLoadFailedState(true);
        return;
      }
      setLoadFailedState(false);
      setSources(result.data);
    } finally {
      setBusy(false);
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
    try {
      const result = await saveTextKnowledgeSource({
        id: editing ?? undefined,
        title: form.title,
        content: form.content,
      });
      if (!result.ok) {
        setError(result.message ?? copy.knowledge.saveFailed);
        return;
      }
      setSources((prev) => {
        const others = prev.filter((s) => s.id !== result.data.id);
        return [result.data, ...others];
      });
      setNotice(copy.saved);
      reset();
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
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!canWrite || loadFailed) return;
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
    } finally {
      setBusy(false);
    }
  }

  async function setApproval(src: KnowledgeSourceRecord, approved: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setKnowledgeSourceApproval(src.id, approved);
      if (!result.ok) {
        setError(result.message ?? copy.knowledge.approveFailed);
        return;
      }
      setSources((prev) => prev.map((s) => (s.id === src.id ? result.data : s)));
      setNotice(approved ? copy.knowledge.approveDone : copy.knowledge.revokeDone);
    } finally {
      setBusy(false);
    }
  }

  const statusStyle: Record<string, string> = {
    draft: "bg-white/10 text-[#dfe9e2] ring-1 ring-white/15",
    processing: "bg-[#d9a467]/20 text-[#f0cf9d] ring-1 ring-[#d9a467]/35",
    stored: "bg-white/10 text-[#dfe9e2] ring-1 ring-white/15",
    ready: "bg-[#38dc89]/18 text-[#9af0c3] ring-1 ring-[#38dc89]/35",
    failed: "bg-[#e07a5f]/18 text-[#f3a08a] ring-1 ring-[#e07a5f]/40",
  };

  if (loadFailed) {
    return (
      <div className="grid gap-3">
        <Notice tone="error">{copy.knowledge.loadFailed}</Notice>
        <Button variant="secondary" busy={busy} onClick={() => void reload()}>
          {copy.knowledge.retryLoad}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {!compact ? <p className="app-muted max-w-2xl text-base leading-7">{copy.knowledge.body}</p> : null}
      <p className="app-muted-soft text-xs leading-5">{copy.knowledge.examples}</p>
      {!canWrite ? <Notice tone="info">{copy.knowledge.readOnly}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {uploadResults.length ? (
        <ul className="grid gap-1 rounded-xl border border-[color:var(--color-line)] bg-[#14221b]/80 p-3 text-xs">
          {uploadResults.map((r) => (
            <li key={r.fileName} className={r.ok ? "text-[#f0cf9d]" : "text-[#f3a08a]"}>
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
            onClick={() => { setMode("text"); setEditing(null); setForm({ title: "", content: "", files: null }); }}
          >
            {copy.knowledge.addText}
          </Button>
          <Button
            variant={mode === "file" ? "primary" : "secondary"}
            busy={busy}
            onClick={() => { setMode("file"); setEditing(null); setForm({ title: "", content: "", files: null }); }}
          >
            {copy.knowledge.addFile}
          </Button>
        </div>
      ) : null}

      {mode && canWrite ? (
        <form
          className="grid gap-3 rounded-2xl border border-[color:var(--color-line)] bg-[#14221b] p-4"
          noValidate
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          {mode === "text" ? (
            <>
              <Field label={copy.knowledge.sourceTitle} required error={titleError}>
                {(p) => <input {...p} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
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
                  <p className="font-semibold tracking-tight text-[#f7fbf8]">{src.title}</p>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusStyle[src.status]}`}>
                    {statusLabel(src.status, copy)}
                  </span>
                  {src.status === "ready" ? (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        isApprovedForAnswers(src)
                          ? "bg-[#38dc89]/22 text-[#9af0c3] ring-1 ring-[#38dc89]/40"
                          : "bg-white/8 text-[#adbeaf] ring-1 ring-white/12"
                      }`}
                    >
                      {isApprovedForAnswers(src) ? copy.knowledge.approved : copy.knowledge.notApproved}
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
                  <p className="mt-1 text-sm leading-6 text-[#f3a08a]">{reasonText(src.failure_code, copy)}</p>
                ) : null}
                {src.status === "ready" && canWrite ? (
                  <p className="app-muted-soft mt-1 text-xs leading-5">{copy.knowledge.approveHint}</p>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap gap-1">
                  {src.status === "ready" && src.content.trim() ? (
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
                  {src.kind === "file" && (src.status === "failed" || src.status === "draft") ? (
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
                        {src.storage_path ? copy.knowledge.replaceFile : copy.knowledge.retry}
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
