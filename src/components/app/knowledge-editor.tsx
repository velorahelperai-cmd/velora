"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useDemo } from "@/lib/demo-state";
import {
  Button, ConfirmDialog, EmptyState, Field, FieldErrorKey, Notice,
  useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

type Props = {
  compact?: boolean;
  focusTitle?: string;
  companyId: string;
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

type KnowledgeCategory = "all" | "profile" | "products" | "pricing" | "policies" | "faq";

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

const TEMPLATES = {
  products: { title: "منتجات وخدمات النشاط", content: "" },
  policies: { title: "سياسات الاسترجاع والتوصيل الفعلية", content: "" },
  pricing: { title: "الأسعار وطرق الدفع المعتمدة", content: "" },
  faq: { title: "الأسئلة الشائعة وإجابات النشاط", content: "" },
};

/** Company knowledge editor (setup + /app/knowledge). Always persists to DB when rendered. */
export function KnowledgeEditor({
  compact,
  focusTitle,
  companyId,
  canWrite,
  canDelete = canWrite,
  initialSources,
  initialLoadFailed = false,
  approvalFoundation: initialApprovalFoundation = "ready",
  onSourcesChange,
  onLoadStateChange,
}: Props) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const localize = (arabic: string, english: string) => locale === "ar" ? arabic : english;
  const router = useRouter();
  const [sources, setSources] = useState<KnowledgeSourceRecord[]>(initialSources);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  const [approvalFoundation, setApprovalFoundation] = useState<KnowledgeApprovalFoundation>(initialApprovalFoundation);
  const [mode, setMode] = useState<"text" | "file" | null>(focusTitle && !initialLoadFailed ? "text" : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory>("all");
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

  // Adopt newer SSR props after router.refresh
  if (
    trackedProps.sources !== initialSources ||
    trackedProps.failed !== initialLoadFailed ||
    trackedProps.foundation !== initialApprovalFoundation
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

  function applyTemplate(key: keyof typeof TEMPLATES) {
    const tpl = TEMPLATES[key];
    setUsageRole("knowledge");
    setMode("text");
    setEditing(null);
    setForm({ title: tpl.title, content: tpl.content, files: null });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
      const result = await listKnowledgeSources({ expectedCompanyId: companyId });
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
        expectedCompanyId: companyId,
        id: editing ?? undefined,
        title: form.title,
        content: form.content,
        usageRole,
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
      refreshAppViews();
      await reload({ keepNotice: copy.saved });
    } catch {
      setError(copy.knowledge.saveFailed);
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
      fd.set("expectedCompanyId", companyId);
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
        setError(fileErrorMessage(result.message, copy) || result.message || copy.knowledge.saveFailed);
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
        setError(
          result.message === "storage_unavailable"
            ? copy.knowledge.storageUnavailable
            : (result.message ?? copy.knowledge.cleanupFailed),
        );
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
  const approvalEvidenceUnavailable = loadFailed || approvalFoundation !== "ready";
  const healthPercent = sources.length === 0 ? 0 : Math.min(100, Math.round((readyCount / Math.max(1, sources.length)) * 100));

  // Intelligent detection of missing critical knowledge areas
  const allTextCorpus = useMemo(
    () => sources.map((s) => `${s.title} ${s.content}`).join(" ").toLowerCase(),
    [sources],
  );

  const missingPolicies = !/استرجاع|استبدال|توصيل|شحن|return|refund|shipping|delivery/.test(allTextCorpus);
  const missingProducts = !/منتج|خدم|منيو|قائمة|product|service|menu/.test(allTextCorpus);
  const missingPricing = !/سعر|أسعار|باق|ر\.ع|price|pricing|omr|rate/.test(allTextCorpus);

  // Filter sources by category
  const filteredSources = useMemo(() => {
    if (activeCategory === "all") return sources;
    return sources.filter((s) => {
      const text = `${s.title} ${s.content}`.toLowerCase();
      if (activeCategory === "policies") return /استرجاع|استبدال|توصيل|شحن|سياسة|policy|return|delivery/.test(text);
      if (activeCategory === "products") return /منتج|خدم|منيو|product|service|menu/.test(text);
      if (activeCategory === "pricing") return /سعر|أسعار|باق|ر\.ع|price|omr/.test(text);
      if (activeCategory === "faq") return /سؤال|أسئلة|شائع|استفسار|faq|question/.test(text);
      return true;
    });
  }, [sources, activeCategory]);

  return (
    <div className="grid gap-5">
      {/* Knowledge Score & Readiness Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-[#38dc89]/30 bg-[var(--color-panel-deep)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[var(--color-on-dark)]">{localize("اعتماد مصادر المعرفة (Approved Sources)", "Approved sources")}</h2>
                <span className="inline-flex rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-success-fg)]">
                  {approvalEvidenceUnavailable ? localize("تعذر تأكيد حالة الاعتماد", "Approval evidence unavailable") : localize("نسبة المصادر المعتمدة", "Approved source coverage")}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted-on-dark)]">{localize("المعلومات المعتمدة فقط هي التي تستخدمها نورا للرد على العملاء عبر واتساب.", "Approved information is the only source used for customer answers.")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-3xl font-extrabold text-[var(--color-success-fg)]">{approvalEvidenceUnavailable ? "—" : `${healthPercent}%`}</span>
            <Link
              href="/app/test"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-4 text-xs font-semibold text-[var(--color-success-fg)] transition hover:bg-[#38dc89]/25 hover:shadow-[0_0_12px_rgba(56,220,137,0.3)]"
            >{localize("اختبر الردود في المحاكاة ↗", "Try Noura with this knowledge")}</Link>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2ebd73] to-[#38dc89]  transition-all duration-200"
              style={{ width: `${approvalEvidenceUnavailable ? 0 : healthPercent}%` }}
            />
          </div>
          <div className="mt-2 flex items-start justify-between gap-3 text-[11px] text-[var(--color-muted-soft)]">
            <span className="shrink-0 whitespace-nowrap">{approvalEvidenceUnavailable ? localize("الدليل غير متاح", "Evidence unavailable") : `${readyCount} / ${sources.length}`}</span>
            <span>{localize("اعتماد المصدر لا يفعّل الردود الحية أو يضمن جودة الإجابة", "Source approval does not activate live replies or guarantee answer quality.")}</span>
          </div>
        </div>
      </section>

      {/* Missing Information Alerts Card */}
      {(missingPolicies || missingProducts || missingPricing) && canWrite ? (
        <section className="rounded-2xl border border-[#d9a467]/40 bg-[var(--color-panel-deep)] p-4 text-xs">
          <div className="flex items-center gap-2 font-bold text-[var(--color-warn-fg)] mb-1.5">

            <span>{localize("اقتراحات لتنظيم معرفة النشاط؛ أدخل معلومات شركتك الفعلية فقط:", "Suggested areas; enter actual company information only.")}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2.5">
            {missingPolicies ? (
              <button
                type="button"
                onClick={() => applyTemplate("policies")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9a467]/50 bg-[#d9a467]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-warn-fg)] transition hover:bg-[#d9a467]/25"
              >{localize("+ أضف سياسة الاسترجاع والتوصيل", "Add return and delivery policy")}</button>
            ) : null}
            {missingProducts ? (
              <button
                type="button"
                onClick={() => applyTemplate("products")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9a467]/50 bg-[#d9a467]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-warn-fg)] transition hover:bg-[#d9a467]/25"
              >{localize("+ أضف قائمة المنتجات والخدمات", "Add products and services")}</button>
            ) : null}
            {missingPricing ? (
              <button
                type="button"
                onClick={() => applyTemplate("pricing")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9a467]/50 bg-[#d9a467]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-warn-fg)] transition hover:bg-[#d9a467]/25"
              >{localize("+ أضف الأسعار وطرق الدفع", "Add prices and payment details")}</button>
            ) : null}
          </div>
        </section>
      ) : null}

      {!compact ? <p className="app-muted max-w-2xl text-base leading-7">{copy.knowledge.body}</p> : null}
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

      {/* Action Bar: Quick-Add Templates and Buttons */}
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border-soft)] pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={mode === "text" ? "primary" : "secondary"}
              busy={busy}
              onClick={() => {
                setMode("text");
                setEditing(null);
                setUsageRole("knowledge");
                setForm({ title: "", content: "", files: null });
              }}
            >
               {copy.knowledge.addText}
            </Button>
            <Button
              variant={mode === "file" ? "primary" : "secondary"}
              busy={busy}
              onClick={() => {
                setMode("file");
                setEditing(null);
                setUsageRole("knowledge");
                setForm({ title: "", content: "", files: null });
              }}
            >
               {copy.knowledge.addFile}
            </Button>
          </div>

          {/* Quick-add templates shortcuts */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--color-muted-soft)] me-1">{localize("عناوين لإضافة معلوماتك:", "Start with a template:")}</span>
            <button
              type="button"
              onClick={() => applyTemplate("products")}
              className="rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] px-2.5 py-1 text-[var(--color-muted-on-dark)] transition hover:text-[var(--color-on-dark)]"
            >{localize("المنتجات", "Products")}</button>
            <button
              type="button"
              onClick={() => applyTemplate("policies")}
              className="rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] px-2.5 py-1 text-[var(--color-muted-on-dark)] transition hover:text-[var(--color-on-dark)]"
            >{localize("السياسات", "Policies")}</button>
            <button
              type="button"
              onClick={() => applyTemplate("pricing")}
              className="rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] px-2.5 py-1 text-[var(--color-muted-on-dark)] transition hover:text-[var(--color-on-dark)]"
            >{localize("الأسعار", "Pricing")}</button>
            <button
              type="button"
              onClick={() => applyTemplate("faq")}
              className="rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] px-2.5 py-1 text-[var(--color-muted-on-dark)] transition hover:text-[var(--color-on-dark)]"
            >{localize("أسئلة شائعة", "FAQ")}</button>
          </div>
        </div>
      ) : null}

      {/* Editor Modal / Form */}
      {mode && canWrite ? (
        <form
          className="grid gap-3 rounded-2xl border border-[#38dc89]/30 bg-[var(--color-panel)] p-5 shadow-sm"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-center justify-between border-b border-[color:var(--color-border-soft)] pb-2.5">
            <h3 className="font-bold text-[var(--color-on-dark)] text-sm">
              {editing ? copy.edit : mode === "text" ? copy.knowledge.addText : copy.knowledge.addFile}
            </h3>
            <span className="text-xs text-[var(--color-muted-soft)]">
              {mode === "text" ? copy.knowledge.addText : "PDF, DOCX, TXT"}
            </span>
          </div>

          {mode === "text" ? (
            <>
              <Field label={copy.knowledge.sourceTitle} required error={titleError}>
                {(p) => (
                  <input
                    {...p}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="مثال: قائمة الأسعار · سياسة التوصيل · أوقات العمل"
                  />
                )}
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
                    rows={6}
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="اكتب المعلومات بالتفصيل كما تريد أن تفهمها نورا وتجيب بها العملاء..."
                    className={`${p.className} min-h-36 py-2.5 leading-6`}
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
                  onChange={(e) =>
                    setForm({
                      ...form,
                      files: e.target.files,
                      title: e.target.files?.[0]?.name ?? form.title,
                    })
                  }
                  className={`${p.className} py-2 file:me-3 file:rounded-lg file:border-0 file:bg-[#38dc89] file:px-3 file:py-1.5 file:text-[#072317]`}
                />
              )}
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="submit"
              busy={busy}
              busyLabel={mode === "file" ? copy.knowledge.uploading : copy.saving}
            >
              {copy.save}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={reset}>
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {/* Category Filter Tabs */}
      {sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[color:var(--color-border-soft)] pb-3 text-xs">
          {(
            [
              ["all", localize("جميع المصادر", "All sources")],
              ["products", localize("المنتجات والخدمات", "Products and services")],
              ["policies", localize("السياسات والشحن", "Policies")],
              ["pricing", localize("الأسعار والعروض", "Pricing")],
              ["faq", localize("الأسئلة الشائعة", "FAQ")],
            ] as const
          ).map(([cat, label]) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                activeCategory === cat
                  ? "bg-[#38dc89]/20 text-[var(--color-success-fg)] border border-[#38dc89]/40"
                  : "text-[var(--color-muted-on-dark)] hover:bg-[var(--color-hover-wash)] border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Sources List */}
      {loadFailed && sources.length === 0 ? <Notice tone="error">{copy.knowledge.loadFailed}</Notice> : filteredSources.length === 0 ? (
        <EmptyState
          title={sources.length === 0 ? copy.knowledge.empty : "لا توجد مصادر في هذا التصنيف"}
          body={localize("أضف معلومات جديدة أو اختر قالباً جاهزاً من الأعلى لتبدأ نورا بفهم نشاطك.", "Add actual company information or choose a template to start a draft.")}
        />
      ) : (
        <ul className="grid gap-3">
          {filteredSources.map((src) => {
            const approved = isApprovedForAnswers(src);
            return (
              <li
                key={src.id}
                className={`rounded-2xl border p-4 transition ${
                  approved
                    ? "border-[#38dc89]/30 bg-[var(--color-panel-deep)] hover:border-[#38dc89]/60"
                    : "border-[color:var(--color-border-soft)] bg-[var(--color-panel)] hover:border-white/20"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold tracking-tight text-[var(--color-on-dark)] text-base">{src.title}</p>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusStyle[src.status]}`}>
                        {statusLabel(src.status, copy)}
                      </span>
                      {src.status === "ready" ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            approved
                              ? "bg-[#38dc89]/20 text-[var(--color-success-fg)] border border-[#38dc89]/40"
                              : "bg-[#d9a467]/15 text-[var(--color-warn-fg)] border border-[#d9a467]/30"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${approved ? "bg-[#38dc89]" : "bg-[#d9a467]"}`} />
                          {approvalFoundation === "unavailable"
                            ? copy.knowledge.approvalUnknown
                            : approved
                              ? " معتمد لإجابات نورا"
                              : "⏳ مسودة بانتظار الاعتماد"}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 text-xs leading-5 text-[var(--color-muted-on-dark)] line-clamp-3">
                      {src.kind === "file" ? <span dir="ltr" className="font-mono">{src.file_name}</span> : src.content}
                    </p>
                    {src.kind === "file" && src.status === "ready" && src.content ? (
                      <p className="mt-1 text-xs leading-5 text-[var(--color-muted-soft)] line-clamp-2">
                        {src.content}
                      </p>
                    ) : null}
                    {src.kind === "file" && src.status === "ready" && (!src.prepared_file_sha256 || src.prepared_content_version !== src.content_version) ? (
                      <p className="mt-1 text-xs text-[var(--color-warn-fg)]">
                        {locale === "ar" ? "إثبات نسخة الاستخراج غير متاح. أعد تجهيز هذا الملف ثم اعتمده لتقديم مراجعة موثقة؛ سيُحفظ المصدر القديم." : "Extraction-version evidence is missing. Explicitly re-prepare and approve this file for verified review; its source is retained."}
                      </p>
                    ) : null}
                    {src.failure_code ? (
                      <p className="mt-1 text-xs text-[var(--color-danger-fg)]">
                        {reasonText(src.failure_code, copy)}
                      </p>
                    ) : null}
                  </div>

                  {canWrite || canDelete ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canWrite && src.status === "ready" && src.content.trim() && approvalFoundation === "ready" ? (
                        <Button
                          variant={approved ? "ghost" : "primary"}
                          className="text-xs min-h-9 px-3"
                          busy={busy}
                          onClick={() => void setApproval(src, !approved)}
                        >
                          {approved ? "إلغاء الاعتماد" : " اعتماد للإجابات"}
                        </Button>
                      ) : null}

                      {src.kind === "file" &&
                      src.storage_path &&
                      isPreparableKnowledgeFile(src.file_name) &&
                      src.status !== "draft" ? (
                        <Button variant="ghost" className="text-xs min-h-9 px-3" busy={busy} onClick={() => void prepareAgain(src)}>
                          {copy.knowledge.retry}
                        </Button>
                      ) : null}

                      {src.kind === "file" &&
                      src.storage_path &&
                      !isPreparableKnowledgeFile(src.file_name) &&
                      (src.status === "failed" || src.status === "draft") ? (
                        <Button variant="ghost" className="text-xs min-h-9 px-3" busy={busy} onClick={() => void repairDb(src)}>
                          {copy.knowledge.repair}
                        </Button>
                      ) : null}

                      {canWrite && src.kind === "file" && src.status !== "processing" ? (
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
                            className="text-xs min-h-9 px-3"
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

                      {canWrite && src.kind === "text" ? (
                        <Button
                          variant="ghost"
                          className="text-xs min-h-9 px-3"
                          disabled={busy}
                          onClick={() => {
                            setMode("text");
                            setEditing(src.id);
                            setUsageRole(src.usage_role ?? "knowledge");
                            setForm({ title: src.title, content: src.content, files: null });
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          {copy.edit}
                        </Button>
                      ) : null}

                      {canDelete ? <Button
                        variant="ghost"
                        className="text-xs min-h-9 px-3 text-[#e07a5f] hover:bg-[#e07a5f]/10"
                        disabled={busy}
                        onClick={() => setPendingDelete({ id: src.id, title: src.title })}
                      >
                        {copy.delete}
                      </Button> : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
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
