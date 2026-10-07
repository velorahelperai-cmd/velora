"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./phone-messages.module.css";
import { PhoneStatusBar } from "./conversation-stage";
import type { LandingCopy } from "@/lib/landing-copy";

type Msg = { id: string; from: "bot" | "user"; text: string };

function replyFor(input: string, copy: LandingCopy): string {
  const q = input.trim().toLowerCase();
  if (!q) return copy.chat.fallback;
  if (/سعر|باق|plan|price|pack/.test(q)) return copy.chat.replyPlans;
  if (/واتس|whatsapp|رقم|number/.test(q)) return copy.chat.replyWhatsapp;
  if (/كيف|عمل|how|work/.test(q)) return copy.chat.replyHow;
  if (/ابدأ|سجل|start|sign/.test(q)) return copy.chat.replyStart;
  return copy.chat.fallback;
}

export function LandingChatbot({ copy }: { copy: LandingCopy }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { id: "welcome", from: "bot", text: copy.chat.welcome },
  ]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    seqRef.current += 1;
    const userMsg: Msg = { id: `u-${seqRef.current}`, from: "user", text: value };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setBusy(true);
    window.setTimeout(() => {
      seqRef.current += 1;
      const botId = `b-${seqRef.current}`;
      setMessages((prev) => [
        ...prev,
        { id: botId, from: "bot", text: replyFor(value, copy) },
      ]);
      setBusy(false);
    }, 520);
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-start gap-3 sm:inset-x-auto sm:bottom-4 sm:start-4">
      {open ? (
        <section
          id={panelId}
          role="dialog"
          aria-label={copy.chat.title}
          className="pointer-events-auto flex w-full max-w-[22rem] flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#0d1a14]/96 text-[#f7fbf8] shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur sm:w-[min(22rem,calc(100vw-2rem))]"
        >
          <PhoneStatusBar />
          <header className={`${styles.guideHeader} flex items-center gap-3 border-b border-white/10 px-3 py-3`}>
            <Image
              src="/assets/velora/chat-girl.jpg"
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 rounded-full object-cover ring-2 ring-[#38dc89]/50"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{copy.chat.name}</p>
              <p className="truncate text-xs text-[#9af0c3]">{copy.chat.online}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full text-sm text-[#adbeaf] hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]"
              aria-label={copy.close}
            >
              ✕
            </button>
          </header>

          <div ref={listRef} className={`${styles.guideMessages} flex max-h-72 flex-col gap-2 overflow-y-auto px-3 py-3`} aria-live="polite">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.guideBubble} max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                  m.from === "user"
                    ? `${styles.outgoing}`
                    : `${styles.incoming}`
                }`}
              >
                {m.text}
              </div>
            ))}
            {busy ? (
              <p className="me-auto text-xs text-[#8da195]">{copy.chat.typing}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-3 py-2">
            {copy.chat.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => send(s)}
                className="min-h-9 max-w-full rounded-full border border-white/15 px-3 text-start text-xs text-[#dfe9e2] hover:bg-white/5 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          <form
            className={`${styles.guideComposer} flex gap-2 border-t border-white/10 p-3`}
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={copy.chat.placeholder}
              aria-label={copy.chat.placeholder}
              className={`${styles.guideInput} min-h-11 min-w-0 flex-1 rounded-full px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]`}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-[#38dc89] px-4 text-sm font-medium text-[#072317] disabled:opacity-50"
            >
              {copy.chat.send}
            </button>
          </form>
          <p className="px-3 pb-3 text-[11px] leading-4 text-[#8da195]">{copy.chat.note}</p>
        </section>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="landing-chat-float pointer-events-auto group relative inline-flex items-end gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]"
      >
        {!open ? (
          <span className="mb-1 hidden max-w-[9.5rem] rounded-2xl rounded-es-md border border-white/10 bg-[#0d1a14]/95 px-3 py-2 text-xs leading-5 text-[#f7fbf8] shadow-lg sm:mb-2 sm:inline-block">
            {copy.chat.bubble}
          </span>
        ) : null}
        <span className="relative inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-[#38dc89]/70 bg-[#14221b] shadow-[0_12px_28px_rgba(0,0,0,0.4)] transition group-hover:-translate-y-0.5 sm:h-[4.5rem] sm:w-[4.5rem]">
          <Image
            src="/assets/velora/chat-girl.jpg"
            alt={copy.chat.openLabel}
            width={72}
            height={72}
            className="h-full w-full object-cover"
            priority={false}
          />
        </span>
      </button>
    </div>
  );
}
