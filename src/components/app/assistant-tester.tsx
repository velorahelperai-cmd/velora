"use client";

import { useState } from "react";
import { askCompanyAnswer } from "@/lib/answers/ask";
import type { AnswerFailureCode } from "@/lib/answers/types";
import { type Message, nowMs, uid, useDemo } from "@/lib/demo-state";
import { landingCopy } from "@/lib/landing-copy";
import { Button, Notice, useAppCopy } from "@/components/app/ui";

/**
 * Internal test chat wired to the shared server answer path.
 * No keyword simulation, no fake AI when the provider is missing.
 */
export function AssistantTester({ onImprove, compact }: { onImprove?: (topic: string) => void; compact?: boolean }) {
  const copy = useAppCopy();
  const { state, update, locale } = useDemo();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<{ code: AnswerFailureCode; question: string } | null>(null);
  const landing = landingCopy(locale);
  const sector = state.business.type === "other" ? "services" : state.business.type;
  const suggestions = [
    landing.sampleFor(sector).q,
    ...(locale === "ar" ? ["ما هي أوقات العمل؟", "هل عندكم خيارات نباتية؟"] : ["What are your working hours?", "Do you have vegetarian options?"]),
  ];

  function errorText(code: AnswerFailureCode) {
    if (code === "NEEDS_SETUP") return copy.tester.needsSetup;
    if (code === "NO_KNOWLEDGE") return copy.tester.noKnowledge;
    if (code === "CONTEXT_OVERFLOW") return copy.tester.contextOverflow;
    if (code === "FORBIDDEN" || code === "UNAUTHENTICATED" || code === "UNVERIFIED") {
      return copy.tester.forbidden;
    }
    if (code === "INVALID_INPUT") return copy.tester.fallback;
    return copy.tester.unavailable;
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setLastError(null);
    const customer: Message = { id: uid(), from: "customer", text, at: nowMs() };
    update((s) => ({ testHistory: [...s.testHistory, customer] }));
    setDraft("");

    try {
      const result = await askCompanyAnswer({ question: text, locale });
      if (!result.ok) {
        setLastError({ code: result.code, question: text });
        const assistant: Message = {
          id: uid(),
          from: "assistant",
          text: errorText(result.code),
          at: nowMs(),
          source: result.code === "NEEDS_SETUP" ? "NEEDS_SETUP" : undefined,
        };
        update((s) => ({ testHistory: [...s.testHistory, assistant] }));
        return;
      }

      const sourceLabel = result.citations.length
        ? result.citations.map((c) => `${c.title} (v${c.contentVersion})`).join(" · ")
        : undefined;
      const assistant: Message = {
        id: uid(),
        from: "assistant",
        text: result.text,
        at: nowMs(),
        source: sourceLabel,
      };
      update((s) => ({ testHistory: [...s.testHistory, assistant] }));
    } catch {
      setLastError({ code: "UNAVAILABLE", question: text });
      update((s) => ({
        testHistory: [
          ...s.testHistory,
          { id: uid(), from: "assistant", text: copy.tester.unavailable, at: nowMs() },
        ],
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 overflow-x-hidden">
      {!compact ? <Notice tone="warn">{copy.tester.body}</Notice> : <p className="text-sm leading-6 text-[#adbeaf]">{copy.setup.testIntro}</p>}
      {lastError ? (
        <Notice tone="error">
          <span className="flex flex-wrap items-center gap-2">
            <span>{errorText(lastError.code)}</span>
            <button
              type="button"
              className="min-h-8 text-[#38dc89] underline"
              disabled={busy}
              onClick={() => void ask(lastError.question)}
            >
              {copy.tester.retry}
            </button>
          </span>
        </Notice>
      ) : null}
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#0d1a14]">
        <div className="flex min-h-[260px] flex-col gap-3 overflow-x-hidden p-3 sm:p-4" aria-live="polite">
          {state.testHistory.length === 0 ? <p className="m-auto text-sm text-[#8da195]">{copy.tester.empty}</p> : null}
          {state.testHistory.map((m) => (
            <div key={m.id} className={`max-w-[min(85%,100%)] min-w-0 ${m.from === "customer" ? "ms-auto" : "me-auto"}`}>
              <div className={`break-words rounded-2xl px-3 py-2 text-[15px] leading-6 ${m.from === "customer" ? "rounded-es-md bg-[#def5e7] text-[#101b16]" : "rounded-ss-md border border-white/10 bg-white/5 text-[#f7fbf8]"}`}>
                {m.text}
              </div>
              {m.from === "assistant" ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#8da195]">
                  <span className="min-w-0 break-words">
                    {copy.tester.source}: {m.source ?? copy.tester.noSource}
                  </span>
                  {!m.source && onImprove ? (
                    <button
                      type="button"
                      onClick={() => onImprove(state.testHistory.find((x) => x.from === "customer" && x.at <= m.at)?.text ?? "")}
                      className="min-h-8 text-[#38dc89] underline"
                    >
                      {copy.tester.improve}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {busy ? (
            <span className="typing !static !inline-flex !opacity-100" aria-label={copy.tester.loading}>
              <i /><i /><i />
            </span>
          ) : null}
        </div>
        <form className="flex flex-col gap-2 border-t border-white/10 p-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={copy.tester.placeholder}
            aria-label={copy.tester.placeholder}
            disabled={busy}
            className="min-h-11 min-w-0 w-full flex-1 rounded-xl border border-white/15 bg-[#07110d] px-3 text-[15px] text-[#f7fbf8] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] disabled:opacity-60"
          />
          <Button type="submit" busy={busy} busyLabel={copy.tester.loading} disabled={!draft.trim()} className="w-full shrink-0 sm:w-auto">
            {copy.tester.send}
          </Button>
        </form>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs text-[#8da195]">{copy.tester.suggestions}</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className="min-h-10 max-w-full break-words rounded-full border border-white/15 px-3 text-start text-sm leading-5 text-[#dfe9e2] hover:bg-white/5 disabled:opacity-50 sm:px-4"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
