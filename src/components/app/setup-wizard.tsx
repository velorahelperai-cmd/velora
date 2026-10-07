"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Activation, type Business, nowMs, useDemo } from "@/lib/demo-state";
import {
  type CompanyDraft,
  buildSetupTestKnowledgeKey,
  clearSetupTestProgress,
  draftAllowedFor,
  emptyCompanyDraft,
  isSetupTestStillValid,
  markSetupTestPassed,
  readCompanyDraft,
  writeCompanyDraft,
} from "@/lib/company-draft";
import { fill } from "@/lib/app-copy";
import type { KnowledgeApprovalFoundation, KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { landingCopy } from "@/lib/landing-copy";
import {
  getCompanyReviewRequest,
  listCompanyReviewEvents,
  resubmitCompanyReviewRequest,
  saveOwnerBusiness,
  submitCompanyReviewRequest,
} from "@/lib/tenancy/actions";
import { evaluateSetupKnowledgeProgress } from "@/lib/tenancy/customer-readiness";
import { resolveReviewRefresh } from "@/lib/tenancy/review-refresh";
import type { CompanyRecord, CompanyReviewEvent, CompanyReviewRequest } from "@/lib/tenancy/types";
import { AccountMenu } from "@/components/app/account-chrome";
import { AssistantTester } from "@/components/app/assistant-tester";
import { KnowledgeEditor } from "@/components/app/knowledge-editor";
import {
  Button, Field, FieldErrorKey, LangSwitch, LinkButton, Notice, PreviewBadge,
  isEmail, isPhone, useAction, useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

function SetupJourneyNotice({
  company,
  review,
  reviewLoadFailed,
}: {
  company: CompanyRecord | null;
  review: CompanyReviewRequest | null;
  reviewLoadFailed: boolean;
}) {
  const copy = useAppCopy();
  if (reviewLoadFailed) {
    return (
      <div className="mt-4">
        <Notice tone="error">{copy.errors.unavailableBody}</Notice>
      </div>
    );
  }
  if (!company) {
    return (
      <div className="mt-4">
        <Notice tone="warn">{copy.setup.journeyNoCompany}</Notice>
      </div>
    );
  }
  if (company.status === "suspended") {
    return (
      <div className="mt-4">
        <Notice tone="warn">{copy.setup.journeySuspended}</Notice>
      </div>
    );
  }
  if (review?.status === "pending_review") {
    return (
      <div className="mt-4">
        <Notice tone="warn">{copy.setup.journeyReviewPending}</Notice>
      </div>
    );
  }
  if (review?.status === "changes_requested") {
    return (
      <div className="mt-4">
        <Notice tone="warn">{copy.setup.journeyReviewChanges}</Notice>
      </div>
    );
  }
  if (review?.status === "approved") {
    return (
      <div className="mt-4">
        <Notice tone="success">{copy.setup.journeyReviewApproved}</Notice>
      </div>
    );
  }
  if (company.status === "setup") {
    return (
      <div className="mt-4">
        <Notice tone="warn">{copy.setup.journeySetup}</Notice>
      </div>
    );
  }
  return null;
}

function companyToBusiness(company: CompanyRecord): Business {
  return {
    name: company.display_name,
    type: (company.business_type as Business["type"]) || "restaurant",
    replyLanguage: company.reply_language,
    country: company.country,
    city: company.city,
    hours: company.hours,
    contactPhone: company.contact_phone,
    contactEmail: company.contact_email,
  };
}

export function SetupWizard({
  userId,
  initialCompany,
  initialKnowledge = [],
  knowledgeLoadFailed = false,
  approvalFoundation = "ready",
  initialReview = null,
  reviewLoadFailed = false,
}: {
  userId: string;
  initialCompany?: CompanyRecord | null;
  initialKnowledge?: KnowledgeSourceRecord[];
  knowledgeLoadFailed?: boolean;
  approvalFoundation?: KnowledgeApprovalFoundation;
  initialReview?: CompanyReviewRequest | null;
  reviewLoadFailed?: boolean;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const leaveGuardRef = useRef<(() => boolean) | null>(null);
  const companyId = initialCompany?.id ?? null;
  const [draft, setDraft] = useState<CompanyDraft>(() => emptyCompanyDraft(userId));
  const [ready, setReady] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState(initialKnowledge);
  const [knowledgeFailed, setKnowledgeFailed] = useState(knowledgeLoadFailed);
  const knowledgeProgress = useMemo(
    () => evaluateSetupKnowledgeProgress({
      loadFailed: knowledgeFailed,
      sources: knowledgeSources,
      approvalFoundation,
    }),
    [knowledgeFailed, knowledgeSources, approvalFoundation],
  );
  const setupTestKnowledgeKey = useMemo(
    () => buildSetupTestKnowledgeKey(
      companyId,
      approvalFoundation,
      knowledgeSources.map((s) => ({
        id: s.id,
        status: s.status,
        content_version: s.content_version,
        approved_version: s.approved_version,
        approved_for_answers: s.approved_for_answers,
      })),
    ),
    [companyId, approvalFoundation, knowledgeSources],
  );
  const setupTestValid = isSetupTestStillValid(draft, companyId, setupTestKnowledgeKey);
  const onKnowledgeSourcesChange = useCallback((sources: KnowledgeSourceRecord[]) => {
    setKnowledgeSources(sources);
  }, []);
  const onKnowledgeLoadStateChange = useCallback((failed: boolean) => {
    setKnowledgeFailed(failed);
  }, []);

  function serverSetupDone(
    draftBase: CompanyDraft,
    knowledgeStepComplete: boolean,
    testValid: boolean,
  ): boolean[] {
    return [
      Boolean(initialCompany),
      knowledgeStepComplete,
      // Local bound test marker only — never review request or “technically ready” files.
      testValid,
      !reviewLoadFailed && Boolean(initialReview),
    ];
  }

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const stored = readCompanyDraft(userId);
      const allowed = draftAllowedFor(stored, userId, companyId);
      const next = allowed ? stored : emptyCompanyDraft(userId);
      if (initialCompany) {
        next.companyId = initialCompany.id;
        if (!allowed || !next.businessSaved || next.companyId !== initialCompany.id) {
          next.business = companyToBusiness(initialCompany);
          next.businessSaved = true;
        }
      } else {
        next.companyId = null;
      }
      const kp = evaluateSetupKnowledgeProgress({
        loadFailed: knowledgeLoadFailed,
        sources: initialKnowledge,
        approvalFoundation,
      });
      const resumeKey = buildSetupTestKnowledgeKey(
        companyId,
        approvalFoundation,
        initialKnowledge.map((s) => ({
          id: s.id,
          status: s.status,
          content_version: s.content_version,
          approved_version: s.approved_version,
          approved_for_answers: s.approved_for_answers,
        })),
      );
      const testValid = isSetupTestStillValid(next, companyId, resumeKey);
      if (next.setupTestPassed && !testValid) {
        Object.assign(next, clearSetupTestProgress(next));
      }
      next.setupDone = serverSetupDone(next, kp.stepComplete, testValid);
      const firstOpen = next.setupDone.findIndex((d) => !d);
      next.setupStep = firstOpen === -1 ? 3 : firstOpen;
      next.userId = userId;
      writeCompanyDraft(next);
      setKnowledgeSources(initialKnowledge);
      setDraft(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial resume only
  }, [
    userId,
    companyId,
    initialCompany?.id,
    initialCompany?.updated_at,
    initialKnowledge.length,
    knowledgeLoadFailed,
    approvalFoundation,
    initialReview?.status,
    initialReview?.revision,
    reviewLoadFailed,
  ]);

  const persist = (patch: Partial<CompanyDraft> | ((d: CompanyDraft) => CompanyDraft)) => {
    setDraft((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch, userId, companyId: patch.companyId ?? prev.companyId };
      next.userId = userId;
      writeCompanyDraft(next);
      return next;
    });
  };

  const step = draft.setupStep;
  const go = (n: number, opts?: { skipGuard?: boolean }) => {
    const next = Math.max(0, Math.min(3, n));
    if (next === step) return;
    if (!opts?.skipGuard && leaveGuardRef.current && !leaveGuardRef.current()) return;
    persist({ setupStep: next });
  };
  const markDone = (n: number) =>
    persist((d) => ({ ...d, setupDone: d.setupDone.map((done, i) => (i === n ? true : done)) }));

  const effectiveSetupDone = useMemo(
    () => serverSetupDone(draft, knowledgeProgress.stepComplete, setupTestValid),
    [
      setupTestValid,
      knowledgeProgress.stepComplete,
      initialCompany,
      initialReview,
      reviewLoadFailed,
    ],
  );

  // Drop stale local test markers when company/knowledge binding drifts (keep business draft).
  useEffect(() => {
    if (!ready) return;
    if (!draft.setupTestPassed) return;
    if (setupTestValid) return;
    const frame = window.requestAnimationFrame(() => {
      persist((d) => clearSetupTestProgress(d));
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate on binding drift only
  }, [ready, setupTestValid, draft.setupTestPassed]);

  if (!ready) {
    return <main className="app-shell" aria-busy="true" />;
  }

  return (
    <main className="app-shell overflow-x-hidden px-4 py-6 pb-28">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-2xl font-bold tracking-tight">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#38dc89] text-base text-[#072317]">V</span>
          {copy.brand}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <PreviewBadge note />
          <LangSwitch />
          <LinkButton href="/app" variant="secondary">{copy.app.nav.dashboard}</LinkButton>
          <AccountMenu compact />
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1100px]">
        <h1 className="app-title text-3xl break-words lg:text-4xl">{copy.setup.title}</h1>
        <p className="app-muted mt-2 text-sm leading-6">{fill(copy.setup.progress, { n: step + 1 })} · {copy.setup.resume}</p>
        <SetupJourneyNotice
          company={initialCompany ?? null}
          review={initialReview}
          reviewLoadFailed={reviewLoadFailed}
        />
        <ol className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={copy.setup.title}>
          {copy.setup.steps.map((label, i) => {
            const active = i === step;
            const done = effectiveSetupDone[i];
            return (
              <li key={label} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={active ? "step" : undefined}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-start text-sm transition ${active ? "border-[#38dc89] bg-[#38dc89]/10" : "border-[color:var(--color-border-soft)] hover:bg-[var(--color-hover-wash)]"}`}
                >
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-[#38dc89] text-[#072317]" : "border border-white/30 text-[var(--color-on-dark)]"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0 leading-5 break-words">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--color-hover-wash)]" aria-hidden="true">
          <div className="h-full bg-[#38dc89] transition-all duration-500" style={{ width: `${(effectiveSetupDone.filter(Boolean).length / 4) * 100}%` }} />
        </div>

        <section className="app-panel mt-6 min-w-0 rounded-3xl p-4 sm:p-5 lg:p-8">
          <h2 className="app-title text-2xl break-words">{copy.setup.steps[step]}</h2>
          <p className="app-muted mt-2 text-sm leading-6">{copy.setup.stepBodies[step]}</p>
          <div className="mt-6 min-w-0">
            {step === 0 ? (
              <BusinessStep
                draft={draft}
                onDraft={persist}
                leaveGuardRef={leaveGuardRef}
                onDone={() => { markDone(0); go(1, { skipGuard: true }); }}
              />
            ) : null}
            {step === 1 ? (
              <StepFrame
                onBack={() => go(0)}
                onNext={() => {
                  if (!knowledgeProgress.canAdvance) return;
                  markDone(1);
                  go(2);
                }}
                nextDisabled={!draft.companyId || !knowledgeProgress.canAdvance}
                nextHint={
                  !draft.companyId
                    ? copy.knowledge.needCompanyFirst
                    : !knowledgeProgress.canAdvance
                      ? copy.app.readinessDetails[knowledgeProgress.detail]
                      : undefined
                }
              >
                {draft.companyId ? (
                  <KnowledgeEditor
                    compact
                    canWrite
                    initialSources={initialKnowledge}
                    initialLoadFailed={knowledgeLoadFailed}
                    approvalFoundation={approvalFoundation}
                    onSourcesChange={onKnowledgeSourcesChange}
                    onLoadStateChange={onKnowledgeLoadStateChange}
                  />
                ) : (
                  <Notice tone="warn">{copy.knowledge.needCompanyFirst}</Notice>
                )}
              </StepFrame>
            ) : null}
            {step === 2 ? (
              <StepFrame
                onBack={() => go(1)}
                onNext={() => {
                  if (!setupTestValid || !companyId) return;
                  markDone(2);
                  go(3);
                }}
                nextDisabled={!setupTestValid}
                nextHint={!setupTestValid ? copy.setup.testRequiredHint : undefined}
              >
                <AssistantTester
                  compact
                  onImprove={() => go(1)}
                  onAnswerResult={(result) => {
                    // NEEDS_SETUP / approval gaps stay failures — never local PASS.
                    if (!result.ok) {
                      persist((d) => clearSetupTestProgress(d));
                      return;
                    }
                    if (!companyId) {
                      persist((d) => clearSetupTestProgress(d));
                      return;
                    }
                    persist((d) => markSetupTestPassed(d, companyId, setupTestKnowledgeKey));
                  }}
                />
                <p className="mt-3 text-xs leading-5 text-[var(--color-muted-soft)]">{copy.setup.missingInfo} <button type="button" onClick={() => go(1)} className="text-[#38dc89] underline">{copy.setup.addInfo}</button></p>
              </StepFrame>
            ) : null}
            {step === 3 ? (
              <ActivationStep
                leaveGuardRef={leaveGuardRef}
                onBack={() => go(2)}
                onDone={() => markDone(3)}
                setupDone={effectiveSetupDone}
                businessName={draft.business.name}
                sectorLabel={landingCopy(locale).sectors.find((s) => s.id === draft.business.type)?.label ?? copy.setup.typeOther}
                knowledgeCount={knowledgeSources.length}
                companyId={draft.companyId}
                initialReview={initialReview}
                reviewLoadFailed={reviewLoadFailed}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function StepFrame({ children, onBack, onNext, nextDisabled, nextHint }: { children: React.ReactNode; onBack: () => void; onNext: () => void; nextDisabled?: boolean; nextHint?: string }) {
  const copy = useAppCopy();
  return (
    <div className="grid min-w-0 gap-5">
      <div className="min-w-0">{children}</div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-soft)] bg-[#0d1a14]/95 px-4 py-4 backdrop-blur sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <Button variant="secondary" onClick={onBack}>{copy.back}</Button>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          {nextHint ? <span className="max-w-full text-xs leading-5 text-[var(--color-muted-soft)] sm:max-w-[28ch]">{nextHint}</span> : null}
          <Button onClick={onNext} disabled={nextDisabled}>{copy.next}</Button>
        </div>
      </div>
    </div>
  );
}

function BusinessStep({
  draft,
  onDraft,
  onDone,
  leaveGuardRef,
}: {
  draft: CompanyDraft;
  onDraft: (patch: Partial<CompanyDraft> | ((d: CompanyDraft) => CompanyDraft)) => void;
  onDone: () => void;
  leaveGuardRef: React.MutableRefObject<(() => boolean) | null>;
}) {
  const copy = useAppCopy();
  const router = useRouter();
  const { locale } = useDemo();
  const landing = landingCopy(locale);
  const form = draft.business;
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft.business));
  const [errors, setErrors] = useState<Partial<Record<keyof Business, FieldErrorKey>>>({});
  const { busy, run } = useAction();
  const dirty = JSON.stringify(form) !== baseline;
  useUnsavedWarning(dirty && !busy);

  useEffect(() => {
    leaveGuardRef.current = () => {
      if (!dirty) return true;
      return window.confirm(copy.unsaved);
    };
    return () => { leaveGuardRef.current = null; };
  }, [dirty, copy.unsaved, leaveGuardRef]);

  const set = <K extends keyof Business>(k: K, v: Business[K]) => {
    onDraft((d) => ({ ...d, business: { ...d.business, [k]: v } }));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Partial<Record<keyof Business, FieldErrorKey>> = {};
    if (!form.name.trim()) next.name = "required";
    if (!form.hours.trim()) next.hours = "required";
    if (form.contactPhone && !isPhone(form.contactPhone)) next.contactPhone = "phone";
    if (form.contactEmail && !isEmail(form.contactEmail)) next.contactEmail = "email";
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(async () => {
      const result = await saveOwnerBusiness({
        displayName: form.name,
        businessType: form.type,
        replyLanguage: form.replyLanguage,
        country: form.country,
        city: form.city,
        hours: form.hours,
        contactPhone: form.contactPhone,
        contactEmail: form.contactEmail,
      });
      if (!result.ok) {
        window.alert(result.message ?? copy.errors.authFailed);
        return;
      }
      const saved = companyToBusiness(result.data);
      onDraft({
        business: saved,
        businessSaved: true,
        companyId: result.data.id,
      });
      setBaseline(JSON.stringify(saved));
      leaveGuardRef.current = () => true;
      router.refresh();
      onDone();
    });
  }

  const select = "min-h-11 w-full min-w-0 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 text-[15px] text-[var(--color-on-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]";
  const nameError = useErrorText(errors.name);
  const hoursError = useErrorText(errors.hours);
  const phoneError = useErrorText(errors.contactPhone);
  const emailError = useErrorText(errors.contactEmail);
  return (
    <form className="grid min-w-0 gap-4 lg:grid-cols-2" noValidate onSubmit={submit}>
      <Field label={copy.setup.businessName} required error={nameError}>
        {(p) => <input {...p} value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="organization" />}
      </Field>
      <Field label={copy.setup.businessType} required>
        {(p) => (
          <select {...p} value={form.type} onChange={(e) => set("type", e.target.value as Business["type"])} className={select}>
            {landing.sectors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value="other">{copy.setup.typeOther}</option>
          </select>
        )}
      </Field>
      <Field label={copy.setup.replyLanguage} required>
        {(p) => (
          <select {...p} value={form.replyLanguage} onChange={(e) => set("replyLanguage", e.target.value as Business["replyLanguage"])} className={select}>
            <option value="both">{copy.setup.langBoth}</option>
            <option value="ar">{copy.setup.langAr}</option>
            <option value="en">{copy.setup.langEn}</option>
          </select>
        )}
      </Field>
      <Field label={copy.setup.country} required>
        {(p) => (
          <select {...p} value={form.country} onChange={(e) => set("country", e.target.value)} className={select}>
            <option value="OM">{copy.setup.oman}</option>
            <option value="OTHER">{copy.setup.otherCountry}</option>
          </select>
        )}
      </Field>
      <Field label={copy.setup.city}>
        {(p) => <input {...p} value={form.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />}
      </Field>
      <Field label={copy.setup.hours} required error={hoursError}>
        {(p) => <input {...p} value={form.hours} onChange={(e) => set("hours", e.target.value)} placeholder={copy.setup.hoursPlaceholder} />}
      </Field>
      <Field label={copy.setup.contactPhone} error={phoneError} hint="+968 …">
        {(p) => <input {...p} dir="ltr" inputMode="tel" autoComplete="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />}
      </Field>
      <Field label={copy.setup.contactEmail} error={emailError}>
        {(p) => <input {...p} dir="ltr" type="email" inputMode="email" autoComplete="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--color-border-soft)] pt-4 lg:col-span-2">
        <Button type="submit" busy={busy} busyLabel={copy.saving}>{copy.setup.continue}</Button>
        {draft.businessSaved && !dirty ? <span className="text-sm text-[var(--color-success-fg)]">{copy.saved}</span> : null}
      </div>
    </form>
  );
}

function reviewStatusLabel(
  status: CompanyReviewRequest["status"],
  copy: ReturnType<typeof useAppCopy>,
) {
  if (status === "pending_review") return copy.setup.pending;
  if (status === "changes_requested") return copy.setup.changesRequested;
  if (status === "approved") return copy.setup.approved;
  return status;
}

function activationFromReview(review: CompanyReviewRequest): Activation {
  return {
    whatsappNumber: review.whatsapp_number,
    numberOwnership: review.number_ownership,
    ready: true,
    // Demo Activation only knows not_requested | pending_review — never collapse other statuses into pending.
    status: review.status === "pending_review" ? "pending_review" : "not_requested",
    requestedAt: Date.parse(review.requested_at) || nowMs(),
  };
}

function ActivationStep({
  onBack,
  onDone,
  sectorLabel,
  setupDone,
  businessName,
  knowledgeCount,
  leaveGuardRef,
  companyId,
  initialReview,
  reviewLoadFailed: initialReviewLoadFailed,
}: {
  onBack: () => void;
  onDone: () => void;
  sectorLabel: string;
  setupDone: boolean[];
  businessName: string;
  knowledgeCount: number;
  leaveGuardRef: React.MutableRefObject<(() => boolean) | null>;
  companyId: string | null;
  initialReview: CompanyReviewRequest | null;
  reviewLoadFailed: boolean;
}) {
  const copy = useAppCopy();
  const { state, update } = useDemo();
  const [loadFailed, setLoadFailed] = useState(initialReviewLoadFailed);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [review, setReview] = useState<CompanyReviewRequest | null>(
    initialReviewLoadFailed ? null : initialReview,
  );
  const [events, setEvents] = useState<CompanyReviewEvent[]>([]);
  const [form, setForm] = useState<Activation>(() => {
    if (!initialReviewLoadFailed && initialReview) return activationFromReview(initialReview);
    // Local draft only — never treat demo activation as server authority.
    return {
      whatsappNumber: "",
      numberOwnership: "",
      ready: false,
      status: "not_requested",
    };
  });
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const [error, setError] = useState<FieldErrorKey>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [viewRefreshFailed, setViewRefreshFailed] = useState(false);
  const { busy, run } = useAction();
  const status = review?.status ?? null;
  const canEdit = !loadFailed && (!review || status === "changes_requested");
  const waiting = status === "pending_review";
  const approved = status === "approved";
  const tests = state.testHistory.filter((m) => m.from === "customer").length;
  const readyToRequest = Boolean(companyId && setupDone[0] && setupDone[1] && setupDone[2]);
  const dirty = canEdit && JSON.stringify(form) !== baseline;
  useUnsavedWarning(dirty && !busy);

  useEffect(() => {
    leaveGuardRef.current = () => {
      if (!dirty) return true;
      return window.confirm(copy.unsaved);
    };
    return () => { leaveGuardRef.current = null; };
  }, [dirty, copy.unsaved, leaveGuardRef]);

  useEffect(() => {
    if (loadFailed || !companyId) return;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const result = await listCompanyReviewEvents();
          if (!result.ok) {
            setHistoryFailed(true);
            return;
          }
          setHistoryFailed(false);
          setEvents(result.data);
        } catch {
          setHistoryFailed(true);
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [companyId, loadFailed, review?.revision, review?.status]);

  const patch = (next: Partial<Activation>) => setForm((prev) => ({ ...prev, ...next }));
  const phoneError = useErrorText(error);

  function applyServerReview(nextReview: CompanyReviewRequest, opts?: { preserveDraft?: boolean }) {
    setReview(nextReview);
    const next = activationFromReview(nextReview);
    const keepDraft = Boolean(opts?.preserveDraft) && JSON.stringify(form) !== baseline;
    if (!keepDraft) {
      setForm(next);
      setBaseline(JSON.stringify(next));
    }
    update({ activation: next });
  }

  async function refreshViewOnly() {
    try {
      const refreshed = await getCompanyReviewRequest();
      const outcome = resolveReviewRefresh(refreshed);
      if (outcome.kind === "keep_snapshot") {
        setInfoNotice(copy.setup.reviewRefreshFailed);
        setViewRefreshFailed(true);
        return;
      }
      setViewRefreshFailed(false);
      setInfoNotice(null);
      setLoadFailed(false);
      if (outcome.kind === "adopt") applyServerReview(outcome.review, { preserveDraft: true });
      else setReview(null);
      const hist = await listCompanyReviewEvents();
      if (hist.ok) {
        setHistoryFailed(false);
        setEvents(hist.data);
      } else {
        setHistoryFailed(true);
      }
    } catch {
      setInfoNotice(copy.setup.reviewRefreshFailed);
      setViewRefreshFailed(true);
    }
  }

  function reloadReview() {
    void run(async () => {
      try {
        const outcome = resolveReviewRefresh(await getCompanyReviewRequest());
        if (outcome.kind === "keep_snapshot") {
          // Keep the last server snapshot visible; a failed read is not "no request".
          setLoadFailed(true);
          setViewRefreshFailed(true);
          setInfoNotice(copy.setup.reviewRefreshFailed);
          return;
        }
        setLoadFailed(false);
        setViewRefreshFailed(false);
        if (outcome.kind === "adopt") applyServerReview(outcome.review);
        else setReview(null);
      } catch {
        setLoadFailed(true);
        setViewRefreshFailed(true);
        setInfoNotice(copy.setup.reviewRefreshFailed);
      }
    });
  }

  function submitOrResubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) {
      setSaveError(copy.setup.reviewNeedCompany);
      return;
    }
    const ownership = form.numberOwnership;
    if (ownership !== "own" && ownership !== "new") return;
    if (ownership === "own" && !isPhone(form.whatsappNumber)) { setError("phone"); return; }
    setError(undefined);
    setSaveError(null);
    setInfoNotice(null);
    setViewRefreshFailed(false);
    void run(async () => {
      try {
        const result = status === "changes_requested" && review
          ? await resubmitCompanyReviewRequest({
            numberOwnership: ownership,
            whatsappNumber: form.whatsappNumber,
            ready: form.ready === true,
            expectedRevision: review.revision,
          })
          : await submitCompanyReviewRequest({
            numberOwnership: ownership,
            whatsappNumber: form.whatsappNumber,
            ready: form.ready === true,
          });
        if (!result.ok) {
          if (result.code === "CONFLICT" && result.data) {
            applyServerReview(result.data, { preserveDraft: true });
            setInfoNotice(copy.setup.reviewConflict);
            setSaveError(result.message ?? copy.setup.reviewSaveFailed);
            return;
          }
          setSaveError(result.message ?? copy.setup.reviewSaveFailed);
          return;
        }
        applyServerReview(result.data);
        leaveGuardRef.current = () => true;
        onDone();
        try {
          await refreshViewOnly();
        } catch {
          setInfoNotice(copy.setup.reviewRefreshFailed);
          setViewRefreshFailed(true);
        }
      } catch {
        setSaveError(copy.setup.reviewSaveFailed);
      }
    });
  }

  const rows: [string, string][] = [
    [copy.setup.reviewRows[0], businessName ? `${businessName} · ${sectorLabel}` : copy.setup.noneYet],
    [copy.setup.reviewRows[1], knowledgeCount > 0 ? fill(copy.setup.sourcesCount, { n: knowledgeCount }) : copy.setup.noneYet],
    [copy.setup.reviewRows[2], tests ? fill(copy.setup.testsCount, { n: tests }) : copy.setup.noneYet],
    [copy.setup.reviewRows[3], form.whatsappNumber || copy.setup.noneYet],
  ];

  const reviewForm = (
    <form className="grid min-w-0 gap-4" noValidate onSubmit={submitOrResubmit}>
      {status === "changes_requested" && review?.owner_note ? (
        <Notice tone="warn">
          <strong>{copy.setup.changesRequested}</strong><br />
          {review.owner_note}
        </Notice>
      ) : null}
      <Field label={copy.setup.numberOwnership} required>
        {(p) => (
          <div className="grid gap-2 sm:grid-cols-2">
            {(["own", "new"] as const).map((v) => (
              <label key={v} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm leading-5 ${form.numberOwnership === v ? "border-[#38dc89] bg-[#38dc89]/10" : "border-[color:var(--color-border-soft)]"}`}>
                <input type="radio" name={p.id} checked={form.numberOwnership === v} onChange={() => patch({ numberOwnership: v })} className="accent-[#38dc89]" />
                <span className="min-w-0 break-words">{v === "own" ? copy.setup.ownNumber : copy.setup.newNumber}</span>
              </label>
            ))}
          </div>
        )}
      </Field>
      {form.numberOwnership === "own" ? (
        <Field label={copy.setup.whatsappNumber} required error={phoneError} hint="+968 …">
          {(p) => <input {...p} dir="ltr" inputMode="tel" value={form.whatsappNumber} onChange={(e) => patch({ whatsappNumber: e.target.value })} />}
        </Field>
      ) : null}
      <label className="flex min-h-11 items-start gap-2 text-sm leading-5">
        <input type="checkbox" checked={form.ready} onChange={(e) => patch({ ready: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-[#38dc89]" />
        <span className="min-w-0 break-words">{copy.setup.readiness}</span>
      </label>
      {saveError ? <Notice tone="error">{saveError}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
        <Button variant="secondary" type="button" onClick={onBack}>{copy.back}</Button>
        <Button type="submit" busy={busy} busyLabel={copy.loading} disabled={!readyToRequest || !form.numberOwnership || !form.ready}>
          {status === "changes_requested" ? copy.setup.resubmit : copy.setup.requestHelp}
        </Button>
        {!readyToRequest ? <span className="text-xs text-[var(--color-warn-fg)]">{copy.setup.notReady}</span> : null}
      </div>
    </form>
  );

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid min-w-0 gap-4">
        {saveError && !canEdit ? <Notice tone="error">{saveError}</Notice> : null}
        {infoNotice ? <Notice tone="warn">{infoNotice}</Notice> : null}
        {viewRefreshFailed ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              busy={busy}
              busyLabel={copy.loading}
              onClick={() => { void run(() => refreshViewOnly()); }}
            >
              {copy.setup.reviewRetryView}
            </Button>
          </div>
        ) : null}
        {loadFailed ? (
          <>
            <Notice tone="error">{copy.setup.reviewLoadFailed}</Notice>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" busy={busy} busyLabel={copy.loading} onClick={reloadReview}>
                {copy.setup.reviewRetryLoad}
              </Button>
              <Button variant="secondary" onClick={onBack}>{copy.back}</Button>
            </div>
          </>
        ) : waiting && review ? (
          <>
            <Notice tone="warn">
              <strong>{copy.setup.pending}</strong><br />
              {copy.setup.pendingBody}
              <br />
              <span className="text-xs text-[var(--color-muted-on-dark)]">
                {copy.setup.reviewStatus}: {reviewStatusLabel(review.status, copy)}
                {" · "}
                {copy.setup.reviewRevision}: {review.revision}
                {" · "}
                {copy.setup.reviewRequestedAt}: {new Date(review.requested_at).toLocaleString()}
              </span>
            </Notice>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/app">{copy.setup.goToApp}</LinkButton>
              <Button variant="secondary" onClick={onBack}>{copy.back}</Button>
            </div>
          </>
        ) : approved && review ? (
          <>
            <Notice tone="success">
              <strong>{copy.setup.approved}</strong><br />
              {copy.setup.approvedBody}
              {review.owner_note ? <><br />{review.owner_note}</> : null}
              <br />
              <span className="text-xs text-[var(--color-muted-on-dark)]">
                {copy.setup.reviewRevision}: {review.revision}
              </span>
            </Notice>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/app">{copy.setup.goToApp}</LinkButton>
              <Button variant="secondary" onClick={onBack}>{copy.back}</Button>
            </div>
          </>
        ) : (
          reviewForm
        )}
        <section className="rounded-2xl border border-[color:var(--color-border-soft)] p-4">
          <h3 className="text-sm font-bold">{copy.setup.reviewHistory}</h3>
          {historyFailed ? (
            <div className="mt-2 grid gap-2">
              <Notice tone="error">{copy.setup.reviewHistoryFailed}</Notice>
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => {
                  void run(async () => {
                    try {
                      const hist = await listCompanyReviewEvents();
                      if (!hist.ok) {
                        setHistoryFailed(true);
                        return;
                      }
                      setHistoryFailed(false);
                      setEvents(hist.data);
                    } catch {
                      setHistoryFailed(true);
                    }
                  });
                }}
              >
                {copy.setup.reviewRetryLoad}
              </Button>
            </div>
          ) : events.length ? (
            <ul className="mt-2 grid gap-2 text-xs text-[var(--color-muted-on-dark)]">
              {events.map((ev, i) => (
                <li key={`${ev.action}-${ev.created_at}-${i}`} className="border-b border-[color:var(--color-border-soft)] pb-2">
                  <strong className="text-[var(--color-on-dark)]">{ev.action}</strong>
                  {" · "}r{ev.revision}
                  {" · "}
                  {new Date(ev.created_at).toLocaleString()}
                  {ev.owner_note ? <p className="mt-1">{ev.owner_note}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-muted-soft)]">{copy.setup.reviewHistoryEmpty}</p>
          )}
        </section>
      </div>
      <aside className="min-w-0 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4">
        <h3 className="font-bold">{copy.setup.review}</h3>
        <dl className="mt-3 grid gap-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-[color:var(--color-border-soft)] pb-2">
              <dt className="shrink-0 text-[var(--color-muted-on-dark)]">{k}</dt>
              <dd className="min-w-0 text-end break-words" dir={k === copy.setup.reviewRows[3] ? "ltr" : undefined}>{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-muted-on-dark)]">{copy.setup.reviewStatus}</dt>
            <dd className="rounded-full bg-[var(--color-hover-wash)] px-2 py-0.5 text-xs">
              {review ? reviewStatusLabel(review.status, copy) : copy.setup.notConnected}
            </dd>
          </div>
          {review ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.setup.reviewRevision}</dt>
              <dd>{review.revision}</dd>
            </div>
          ) : null}
        </dl>
      </aside>
    </div>
  );
}
