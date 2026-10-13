"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { askCompanyAnswer } from "@/lib/answers/ask";
import type { AnswerFailureCode, AnswerResult } from "@/lib/answers/types";
import { useDemo } from "@/lib/demo-state";
import { readDashboardBilling } from "@/lib/customer/dashboard-billing-actions";
import type { DashboardBillingLoad } from "@/lib/customer/dashboard-billing-model";
import { useOptionalAccountSession } from "@/components/app/account-chrome";
import { runAssistantAskAttempt } from "@/components/app/assistant-tester-outcome";
import { Button, LinkButton, Notice, useAppCopy } from "@/components/app/ui";

/**
 * Internal test chat wired to the shared server answer path.
 * No keyword simulation, no fake AI when the provider is missing.
 */
export function AssistantTester({
  onImprove,
  compact,
  onAnswerResult,
}: {
  onImprove?: (topic: string) => void;
  compact?: boolean;
  onAnswerResult?: (result: AnswerResult) => void;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const session = useOptionalAccountSession();
  const companyId = session?.identity?.companyId ?? null;
  const userId = session?.identity?.userId ?? null;
  const scope = `${userId ?? ""}:${companyId ?? ""}`;
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = ""; };
  }, [scope]);
  const [answer, setAnswer] = useState<{ scope: string; question: string; result: Extract<AnswerResult, { ok: true }> } | null>(null);
  const [billing, setBilling] = useState<{ scope: string; result: DashboardBillingLoad } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const askPending = useRef(false);
  const [lastError, setLastError] = useState<{ scope: string; code: AnswerFailureCode; question: string } | null>(null);
  const suggestions = [
    ...(locale === "ar" ? ["ما هي أوقات العمل؟", "ما الخدمات التي تقدمونها؟"] : ["What are your working hours?", "What services do you offer?"]),
  ];
  const visibleAnswer = answer?.scope === scope ? answer : null;
  const visibleError = lastError?.scope === scope ? lastError : null;
  const visibleBilling = billing?.scope === scope ? billing.result : null;
  const guarded = locale === "ar" ? "إجابات النشاط غير مفعّلة بعد. الطلبات تمر بفحص الصلاحيات والمعرفة؛ الاشتراك وحده لا يفعّل الإجابات." : "Business answering is not enabled yet. Requests check access and approved knowledge; subscription status alone does not enable answering.";

  useEffect(() => {
    if (!userId || !companyId || session?.status !== "ready") return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void readDashboardBilling().then((result) => {
        if (!cancelled && (!("companyId" in result) || result.companyId === companyId)) setBilling({ scope, result });
      }).catch(() => { if (!cancelled) setBilling({ scope, result: { status: "unavailable" } }); });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [scope, companyId, userId, session?.status]);

  function errorText(code: AnswerFailureCode) {
    if (code === "NEEDS_SETUP") return copy.tester.needsSetup;
    if (code === "NO_KNOWLEDGE") return copy.tester.noKnowledge;
    if (code === "APPROVAL_INCOMPLETE") return copy.tester.approvalIncomplete;
    if (code === "APPROVAL_FOUNDATION_UNAVAILABLE") return copy.tester.approvalFoundationUnavailable;
    if (code === "CONTEXT_OVERFLOW") return copy.tester.contextOverflow;
    if (code === "FORBIDDEN" || code === "UNAUTHENTICATED" || code === "UNVERIFIED") {
      return copy.tester.forbidden;
    }
    if (code === "INVALID_INPUT") return locale === "ar" ? "أدخل سؤالًا صالحًا ضمن الحد المسموح." : "Enter a valid question within the allowed length.";
    return copy.tester.unavailable;
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || askPending.current) return;
    askPending.current = true;
    setBusy(true);
    setLastError(null);
    setAnswer(null);
    const requestScope = scope;
    setDraft("");

    try {
      const { result } = await runAssistantAskAttempt({
        ask: () => askCompanyAnswer({ question: text, locale }),
        onAnswerResult: (result) => { if (currentScope.current === requestScope) onAnswerResult?.(result); },
      });
      if (currentScope.current !== requestScope) return;
      if (!result.ok) {
        setLastError({ scope: requestScope, code: result.code, question: text });
        return;
      }
      setAnswer({ scope: requestScope, question: text, result });
    } finally {
      askPending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 overflow-x-hidden">
      {/* 🌟 هيدر شخصية الموظفة الذكية في وضع الاختبار */}
      <div className="relative overflow-hidden rounded-2xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1a14] to-[#07110d] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-[#38dc89]/40 bg-[#38dc89]/15 shadow-inner">
              <span className="text-2xl">👩‍💼</span>
              <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full bg-[#d9a467] ring-2 ring-[#0d1a14]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-[#f7fbf8] text-base">{copy.tester.title}</h3>
                <span className="inline-flex rounded-full bg-[#38dc89]/15 border border-[#38dc89]/30 px-2 py-0.5 text-[10px] font-semibold text-[#9af0c3]">
                  {locale === "ar" ? "غير مفعّل للعملاء" : "Customer answering off"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#b7c6b9]">{guarded}</p>
            </div>
          </div>
          <p className="text-xs text-[#b7c6b9]">
            {locale === "ar" ? "الاشتراك" : "Subscription"}: {visibleBilling?.status === "ready" ? visibleBilling.subscriptionStatus : visibleBilling?.status === "empty" ? (locale === "ar" ? "لا يوجد اشتراك" : "No subscription") : visibleBilling ? (locale === "ar" ? "تعذّر التحقق" : "Could not verify") : session?.status === "ready" && !companyId ? (locale === "ar" ? "اختر نشاطًا أولًا" : "Select a business first") : session?.status === "guest" || session?.status === "expired" ? copy.auth.login : copy.loading}
          </p>
        </div>
      </div>

      {!compact ? <Notice tone="warn">{copy.tester.body}</Notice> : <p className="text-sm leading-6 text-[var(--color-muted-on-dark)]">{copy.setup.testIntro}</p>}
      {session?.status === "ready" && session.identity?.isPlatformAdmin && session.identity.emailConfirmed ? <LinkButton href="/admin/ai" variant="secondary">{locale === "ar" ? "فتح تجارب الذكاء الاصطناعي الإدارية" : "Open administrative AI trials"}</LinkButton> : null}
      {visibleError ? (
        <Notice tone="error">
          <span className="flex flex-wrap items-center gap-2">
            <span>{errorText(visibleError.code)}</span>
            <button
              type="button"
              className="min-h-8 text-[#38dc89] underline"
              disabled={busy}
              onClick={() => void ask(visibleError.question)}
            >
              {copy.tester.retry}
            </button>
          </span>
        </Notice>
      ) : null}
      <div className="min-w-0 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] shadow-sm">
        <div className="flex min-h-[260px] flex-col gap-3 overflow-x-hidden p-3 sm:p-4" aria-live="polite">
          {!visibleAnswer ? <p className="m-auto text-sm text-[var(--color-muted-soft)]">{copy.tester.empty}</p> : (
            <>
              <div className="ms-auto max-w-[min(85%,100%)] break-words rounded-2xl rounded-es-md bg-[#def5e7] px-3 py-2 text-[15px] leading-6 text-[#101b16]">{visibleAnswer.question}</div>
              <div className="me-auto max-w-[min(85%,100%)] min-w-0">
                <div className="break-words rounded-2xl rounded-ss-md border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] px-3 py-2 text-[15px] leading-6 text-[var(--color-on-dark)]">{visibleAnswer.result.text}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-soft)]">
                  <span className="min-w-0 break-words">
                    {copy.tester.source}: {visibleAnswer.result.citations.map((citation) => `${citation.title} (v${citation.contentVersion})`).join(" · ") || copy.tester.noSource}
                  </span>
                  {!visibleAnswer.result.citations.length && onImprove ? (
                    <button
                      type="button"
                      onClick={() => onImprove(visibleAnswer.question)}
                      className="min-h-8 text-[#38dc89] underline"
                    >
                      {copy.tester.improve}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}
          {busy ? (
            <span className="typing !static !inline-flex !opacity-100" aria-label={copy.tester.loading}>
              <i /><i /><i />
            </span>
          ) : null}
        </div>
        <form className="flex flex-col gap-2 border-t border-[color:var(--color-border-soft)] p-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={copy.tester.placeholder}
            aria-label={copy.tester.placeholder}
            disabled={busy}
            className="min-h-11 min-w-0 w-full flex-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-3 text-[15px] text-[var(--color-on-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89] disabled:opacity-60"
          />
          <Button type="submit" busy={busy} busyLabel={copy.tester.loading} disabled={!draft.trim()} className="w-full shrink-0 sm:w-auto">
            {copy.tester.send}
          </Button>
        </form>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs text-[var(--color-muted-soft)]">{copy.tester.suggestions}</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className="min-h-10 max-w-full break-words rounded-full border border-[color:var(--color-border-soft)] px-3 text-start text-sm leading-5 text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)] disabled:opacity-50 sm:px-4"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
