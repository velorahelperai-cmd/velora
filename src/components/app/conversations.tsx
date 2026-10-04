"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { type Conversation, type ConversationStatus, nowMs, uid, useDemo } from "@/lib/demo-state";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { Button, EmptyState, Notice, SimTag, useAppCopy } from "@/components/app/ui";

const statusStyle: Record<ConversationStatus, string> = {
  open: "bg-white/10 text-[#dfe9e2]",
  follow_up: "bg-[#d9a467]/15 text-[#f0cf9d]",
  handed_over: "bg-[#38dc89]/15 text-[#9af0c3]",
  resolved: "bg-white/5 text-[#8da195]",
};

export function ConversationsPage() {
  const copy = useAppCopy();
  const { state, update, locale } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get("c");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.conversations.filter((c) => (filter === "all" || c.status === filter) && (!q || `${c.customer} ${c.topic} ${c.summary}`.toLowerCase().includes(q)));
  }, [state.conversations, query, filter]);
  const selected = state.conversations.find((c) => c.id === selectedId) ?? null;
  const select = (id: string | null) => router.replace(id ? `/app/conversations?c=${id}` : "/app/conversations");
  const patch = (id: string, fn: (c: Conversation) => Partial<Conversation>) =>
    update((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...fn(c) } : c)) }));
  const me = state.account?.name ?? copy.app.you;
  const time = (at: number) => new Date(at).toLocaleTimeString(locale === "ar" ? "ar-OM" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  function send(c: Conversation) {
    const text = draft.trim();
    if (!text) return;
    patch(c.id, (cur) => ({ messages: [...cur.messages, { id: uid(), from: "staff", text, at: nowMs() }], owner: me, assistantPaused: true, status: cur.status === "resolved" ? "handed_over" : cur.status }));
    setDraft("");
    setNotice(copy.app.sentNote);
  }

  const detail = selected ? (
    <section className="flex min-h-[70svh] flex-col rounded-2xl border border-white/10 bg-[#0d1a14] lg:min-h-[60svh]" aria-label={selected.customer}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0d1a14]/95 p-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => select(null)} className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-white/20 px-3 text-xs lg:hidden">{copy.app.backToList}</button>
          <div className="min-w-0">
            <h2 className="truncate font-bold">{selected.customer} · {selected.topic}</h2>
            <p className="text-xs text-[#8da195]">{copy.app.ownerLabel}: {selected.owner === "assistant" ? copy.app.assistant : selected.owner === "staff" ? copy.app.staff : selected.owner} · <span className={`rounded-full px-2 py-0.5 ${statusStyle[selected.status]}`}>{copy.app.statuses[selected.status]}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.assistantPaused ? (
            <Button variant="secondary" onClick={() => { patch(selected.id, () => ({ assistantPaused: false, owner: "assistant", status: selected.status === "handed_over" ? "open" : selected.status })); setNotice(copy.app.resumed); }}>{copy.app.resume}</Button>
          ) : (
            <Button variant="secondary" onClick={() => patch(selected.id, () => ({ assistantPaused: true, owner: me, status: "handed_over" }))}>{copy.app.takeOver}</Button>
          )}
          {selected.status !== "resolved" ? <Button variant="ghost" onClick={() => patch(selected.id, () => ({ status: "resolved", assistantPaused: false }))}>{copy.app.markResolved}</Button> : null}
        </div>
      </header>
      {selected.assistantPaused ? <div className="border-b border-[#d9a467]/30 bg-[#d9a467]/10 px-4 py-2 text-sm text-[#f0cf9d]">{copy.app.pausedBanner}</div> : null}
      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_260px]">
        <div className="flex min-h-0 flex-col" dir={locale === "ar" ? "rtl" : "ltr"}>
          <p className="mb-2 text-xs text-[#8da195]">{copy.app.history}</p>
          <div className="flex min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto pb-3">
            {selected.messages.map((m) => (
              <div key={m.id} className={`max-w-[85%] ${m.from === "customer" ? "me-auto" : "ms-auto"}`}>
                <div className={`rounded-2xl px-3 py-2 text-[15px] leading-6 ${m.from === "customer" ? "rounded-ss-md bg-white/10 text-[#f7fbf8]" : m.from === "staff" ? "rounded-es-md bg-[#38dc89] text-[#072317]" : "rounded-es-md bg-[#def5e7] text-[#101b16]"}`}>
                  {m.text}
                </div>
                <p className="mt-1 text-[11px] text-[#8da195]">{m.from === "customer" ? selected.customer : m.from === "staff" ? copy.app.staff : copy.app.assistant} · <span dir="ltr">{time(m.at)}</span>{m.source ? ` · ${copy.tester.source}: ${m.source}` : ""}</p>
              </div>
            ))}
            {notice ? <Notice tone="info">{notice}</Notice> : null}
          </div>
          <form className="sticky bottom-0 -mx-1 mt-auto flex gap-2 border-t border-white/10 bg-[#0d1a14] px-1 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]" onSubmit={(e) => { e.preventDefault(); send(selected); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={copy.app.reply} aria-label={copy.app.reply} className="min-h-11 flex-1 rounded-xl border border-white/15 bg-[#07110d] px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]" />
            <Button type="submit" disabled={!draft.trim()} className="shrink-0">{copy.app.sendReply}</Button>
          </form>
        </div>
        <aside className="grid content-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <h3 className="font-bold">{copy.app.customerDetails}</h3>
          <p>{selected.customer}</p>
          <p dir="ltr" className="text-[#adbeaf]">{selected.phone}</p>
          <h3 className="mt-2 font-bold">{copy.app.summary}</h3>
          <p className="leading-6 text-[#adbeaf]">{selected.summary}</p>
          {selected.needsInfo ? (
            <div className="grid gap-2">
              <p className="rounded-lg bg-[#e07a5f]/10 px-2 py-1 text-xs text-[#f3a08a]">{copy.app.needsInfoTag}: {selected.needsInfo}</p>
              <Link href={`/app/knowledge?topic=${encodeURIComponent(selected.needsInfo)}`} className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#38dc89] px-3 text-xs font-medium text-[#072317]">{copy.app.addKnowledge}</Link>
            </div>
          ) : null}
          <SimTag />
        </aside>
      </div>
    </section>
  ) : (
    <EmptyState
      title={copy.app.selectConversation}
      action={list[0] ? <Button variant="secondary" onClick={() => select(list[0].id)}>{copy.app.openConversation}</Button> : undefined}
    />
  );

  return (
    <WorkspaceShell title={copy.app.conversationsTitle}>
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className={`${selected ? "hidden lg:block" : ""}`}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.app.search} aria-label={copy.app.search} className="min-h-11 w-full rounded-xl border border-white/15 bg-[#0d1a14] px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]" />
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {(["all", "open", "follow_up", "handed_over", "resolved"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={`min-h-9 shrink-0 rounded-full px-3 text-xs ${filter === f ? "bg-[#38dc89] text-[#072317]" : "border border-white/15 text-[#dfe9e2]"}`}>
                {f === "all" ? copy.app.filterAll : copy.app.statuses[f]}
              </button>
            ))}
          </div>
          <ul className="mt-3 grid gap-2">
            {list.length === 0 ? <li><EmptyState title={copy.app.noResults} /></li> : null}
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => select(c.id)} aria-current={c.id === selectedId ? "true" : undefined} className={`grid w-full gap-1 rounded-xl border p-3 text-start text-sm transition ${c.id === selectedId ? "border-[#38dc89] bg-[#38dc89]/10" : "border-white/10 hover:bg-white/5"}`}>
                  <span className="flex items-center justify-between gap-2"><strong>{c.customer}</strong><span className={`rounded-full px-2 py-0.5 text-[11px] ${statusStyle[c.status]}`}>{copy.app.statuses[c.status]}</span></span>
                  <span className="truncate text-[#adbeaf]">{c.topic} · {c.messages[c.messages.length - 1]?.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={`${selected ? "" : "hidden lg:block"}`}>{detail}</div>
      </div>
    </WorkspaceShell>
  );
}
