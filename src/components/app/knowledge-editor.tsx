"use client";

import { useEffect, useRef, useState } from "react";
import { type KnowledgeSource, nowMs, uid, useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import {
  Button, ConfirmDialog, EmptyState, Field, FieldErrorKey, Notice, SimTag,
  useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

/** Shared between the setup wizard and the workspace knowledge page. */
export function KnowledgeEditor({ compact, focusTitle }: { compact?: boolean; focusTitle?: string }) {
  const copy = useAppCopy();
  const { state, update } = useDemo();
  const [mode, setMode] = useState<"text" | "file" | null>(focusTitle ? "text" : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ title: focusTitle ?? "", content: "", fileName: "" });
  const [errors, setErrors] = useState<Partial<Record<"title" | "content" | "fileName", FieldErrorKey>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeSource | null>(null);
  const timers = useRef<number[]>([]);
  const dirty = mode !== null && Boolean(form.title || form.content || form.fileName);
  useUnsavedWarning(dirty);
  const titleError = useErrorText(errors.title);
  const contentError = useErrorText(errors.content);
  const fileError = useErrorText(errors.fileName);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  /** Display-only lifecycle: processing → ready (or failed for a name containing "fail"). Nothing is actually processed. */
  function simulateProcessing(id: string, fileName: string) {
    const t = window.setTimeout(() => {
      update((s) => ({
        sources: s.sources.map((src) =>
          src.id === id ? { ...src, status: /fail/i.test(fileName) ? "failed" : "ready", updatedAt: nowMs() } : src,
        ),
      }));
    }, 1800);
    timers.current.push(t);
  }

  function reset() {
    setMode(null); setEditing(null); setForm({ title: "", content: "", fileName: "" }); setErrors({});
  }

  function save() {
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = "required";
    if (mode === "text" && !form.content.trim()) next.content = "required";
    if (mode === "file" && !form.fileName) next.fileName = "required";
    setErrors(next);
    if (Object.keys(next).length) return;
    const id = editing ?? uid();
    const source: KnowledgeSource = {
      id,
      kind: mode === "file" ? "file" : "text",
      title: form.title.trim(),
      content: form.content.trim(),
      fileName: mode === "file" ? form.fileName : undefined,
      status: mode === "file" ? "processing" : "ready",
      updatedAt: nowMs(),
    };
    update((s) => ({ sources: editing ? s.sources.map((x) => (x.id === id ? source : x)) : [...s.sources, source] }));
    if (mode === "file") simulateProcessing(id, form.fileName);
    setNotice(copy.saved);
    reset();
  }

  function remove(src: KnowledgeSource) {
    update((s) => ({ sources: s.sources.filter((x) => x.id !== src.id) }));
    setPendingDelete(null);
    setNotice(copy.knowledge.deleted);
  }

  function retry(src: KnowledgeSource) {
    update((s) => ({ sources: s.sources.map((x) => (x.id === src.id ? { ...x, status: "processing" } : x)) }));
    simulateProcessing(src.id, "retry");
  }

  const statusStyle: Record<KnowledgeSource["status"], string> = {
    draft: "bg-white/10 text-[#dfe9e2]",
    processing: "bg-[#d9a467]/15 text-[#f0cf9d]",
    ready: "bg-[#38dc89]/15 text-[#9af0c3]",
    failed: "bg-[#e07a5f]/15 text-[#f3a08a]",
  };

  return (
    <div className="grid gap-4">
      {!compact ? <p className="text-sm leading-6 text-[#adbeaf]">{copy.knowledge.body}</p> : null}
      <p className="text-xs leading-5 text-[#8da195]">{copy.knowledge.examples}</p>
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "text" ? "primary" : "secondary"} onClick={() => { setMode("text"); setEditing(null); }}>{copy.knowledge.addText}</Button>
        <Button variant={mode === "file" ? "primary" : "secondary"} onClick={() => { setMode("file"); setEditing(null); }}>{copy.knowledge.addFile}</Button>
        {state.sources.length === 0 ? (
          <Button variant="ghost" onClick={() => {
            const samples = copy.knowledge.quickSamples.map((q) => ({ id: uid(), kind: "text" as const, title: q.title, content: q.content, status: "ready" as const, updatedAt: nowMs() }));
            update((s) => ({ sources: [...s.sources, ...samples] }));
            setNotice(copy.saved);
          }}>{copy.knowledge.quickAdd}</Button>
        ) : null}
      </div>

      {mode ? (
        <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label={copy.knowledge.sourceTitle} required error={titleError}>
            {(p) => <input {...p} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
          </Field>
          {mode === "text" ? (
            <Field label={copy.knowledge.sourceContent} required error={contentError}>
              {(p) => <textarea {...p} rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className={`${p.className} min-h-28 py-2`} />}
            </Field>
          ) : (
            <Field label={copy.knowledge.addFile} required hint={copy.knowledge.fileHint} error={fileError}>
              {(p) => (
                <input
                  {...p}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx"
                  onChange={(e) => setForm({ ...form, fileName: e.target.files?.[0]?.name ?? "" })}
                  className={`${p.className} py-2 file:me-3 file:rounded-lg file:border-0 file:bg-[#38dc89] file:px-3 file:py-1.5 file:text-[#072317]`}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{copy.save}</Button>
            <Button type="button" variant="secondary" onClick={reset}>{copy.cancel}</Button>
          </div>
        </form>
      ) : null}

      {state.sources.length === 0 ? (
        <EmptyState title={copy.knowledge.empty} />
      ) : (
        <ul className="grid gap-2">
          {state.sources.map((src) => (
            <li key={src.id} className="grid gap-2 rounded-2xl border border-white/10 bg-[#0d1a14] p-4 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[#f7fbf8]">{src.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusStyle[src.status]}`}>{copy.knowledge.statuses[src.status]}</span>
                  {src.kind === "file" ? <SimTag /> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#adbeaf]">{src.kind === "file" ? <span dir="ltr">{src.fileName}</span> : src.content}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {src.status === "failed" ? <Button variant="ghost" onClick={() => retry(src)}>{copy.knowledge.retry}</Button> : null}
                {src.kind === "text" ? (
                  <Button variant="ghost" onClick={() => { setMode("text"); setEditing(src.id); setForm({ title: src.title, content: src.content, fileName: "" }); }}>{copy.edit}</Button>
                ) : null}
                <Button variant="ghost" onClick={() => setPendingDelete(src)}>{copy.delete}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-[#8da195]">{copy.knowledge.statusNote}</p>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={copy.delete}
        body={pendingDelete ? fill(copy.knowledge.confirmDelete, { title: pendingDelete.title }) : undefined}
        confirmLabel={copy.delete}
        danger
        onConfirm={() => pendingDelete && remove(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
