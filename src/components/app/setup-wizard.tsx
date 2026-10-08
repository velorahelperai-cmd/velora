"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Activation, type Business, nowMs, useDemo } from "@/lib/demo-state";
import {
  type CompanyDraft,
  buildSetupTestKnowledgeKey,
  clearSetupTestProgress,
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
  getCustomerReadiness,
  listCompanyReviewEvents,
  resubmitCompanyReviewRequest,
  saveOwnerBusiness,
  submitCompanyReviewRequest,
} from "@/lib/tenancy/actions";
import { getWhatsappCompanyLink, saveWhatsappLinkRequest } from "@/lib/whatsapp/connection-actions";
import type { CustomerReadinessSnapshot } from "@/lib/tenancy/customer-readiness";
import type { WhatsappCompanyLink } from "@/lib/whatsapp/connection";
import { companyBusiness, finishCompanySave, hydrateOnboardingDraft, setupMilestones, whatsappUiState } from "./onboarding-contracts";
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

const MILESTONES_COPY = {
  ar: {
    steps: [
      "الملف التعريفي للشركة",
      "باقة الاشتراك والدفع",
      "أوقات العمل",
      "المنتجات والخدمات والسياسات",
      "شخصية نورا ونبرة الرد",
      "ربط واتساب التجاري",
      "تجربة نورا في بيئة الاختبار",
      "مراجعة الجاهزية وطلب الاعتماد",
    ],
    stepBodies: [
      "معلومات أساسية عن نشاطك، العنوان، وجهات الاتصال الرسمية.",
      "تأكيد باقة الاشتراك الحالية ومتابعة التأسيس بأمان.",
      "ساعات الدوام اليومية وكيفية تعامل نورا مع الاستفسارات خارج أوقات العمل.",
      "أضف الخدمات، المنيو، الأسعار، وسياسات التوصيل والاسترجاع ليتم تدريب نورا عليها.",
      "حدد أسلوب ونبرة ردود نورا (ودودة/رسمية/مختصرة) ورسالة الترحيب المعتمدة.",
      "تجهيز رقم واتساب التجاري عبر Meta Cloud API لاستقبال محادثات العملاء.",
      "اختبر كيف تجيب نورا على أسئلة عملائك في بيئة محاكاة آمنة قبل الانطلاق.",
      "مراجعة شاملة لجميع بنود التجهيز وتقديم طلب الاعتماد الإداري. اعتماد المراجعة لا يشغّل واتساب تلقائيًا.",
    ],
    milestoneProgress: "المحطة {n} من 8",
    afterHoursTitle: "سلوك نورا خارج أوقات العمل",
    afterHours247: "الرد التلقائي المستمر 24/7 مع توضيح ساعات الدوام الرسمية للزيارات أو الشحن",
    afterHoursQueue: "تسجيل طلب العميل وإبلاغه بأن الفريق سيتابع معه فور بدء أوقات الدوام التالية",
    toneTitle: "نبرة صوت نورا في الردود",
    toneFriendly: "ودودة ومرحبة (موصى بها لأغلب الأنشطة التجارية والمطاعم)",
    toneFormal: "مهنية ورسمية (مناسبة للمكاتب المهنية والخدمات المالية والقانونية)",
    toneDirect: "مباشرة ومختصرة (تركز على الإجابات السريعة والأسعار دون إطالة)",
    greetingTitle: "مثال توضيحي للترحيب",
    greetingDefault: "أهلاً وسهلاً بك في {name}! أنا نورا مساعدتك الذكية، كيف أقدر أساعدك اليوم؟",
    planNoticeTitle: "الاشتراك خطوة مستقلة عن إعداد النشاط",
    planNoticeBody: "يمكنك حفظ بيانات الشركة والمعرفة قبل الاشتراك. تفاصيل الباقة من الكتالوج المنشور؛ الدفع التجريبي يخضع لإعدادات الخادم، والإطلاق التجاري منفصل.",
    planButton: "متابعة خطوات التجهيز",
    planExplore: "استعراض تفاصيل الباقات والأسعار",
  },
  en: {
    steps: [
      "Company Profile",
      "Subscription Plan",
      "Working Hours",
      "Products, Services & Policies",
      "Reply Language & Instructions",
      "WhatsApp Business Connection",
      "Sandbox Testing",
      "Go-Live Readiness & Approval Request",
    ],
    stepBodies: [
      "Basic company profile, address, and official contact details.",
      "Confirm your subscription tier and proceed safely with setup.",
      "Save your actual operating hours. Business instructions are managed in Knowledge.",
      "Add services, menus, pricing, and return/shipping policies.",
      "Save reply language and manage tone through approved business instructions.",
      "Connect your WhatsApp Business number via Meta Cloud API.",
      "Test simulated questions to verify Noura's answers before go-live.",
      "Review all onboarding items and request administrative approval. Approval does not automatically enable live WhatsApp replies.",
    ],
    milestoneProgress: "Milestone {n} of 8",
    afterHoursTitle: "Noura Outside Hours Policy",
    afterHours247: "Continuous 24/7 replies while noting official business hours for visits",
    afterHoursQueue: "Record the customer request and notify them staff will follow up next morning",
    toneTitle: "Tone of Voice",
    toneFriendly: "Friendly & welcoming (Recommended for retail, restaurants, and hospitality)",
    toneFormal: "Formal & professional (Ideal for corporate, financial, and legal services)",
    toneDirect: "Direct & concise (Fast answers and pricing without extra words)",
    greetingTitle: "Illustrative Greeting",
    greetingDefault: "Welcome to {name}! I am Noura, your automated assistant. How can I assist you today?",
    planNoticeTitle: "Subscription is separate from company setup",
    planNoticeBody: "Company and knowledge setup can continue before subscription. Offers come from the published catalog; Test checkout requires server configuration and commercial rollout remains separate.",
    planButton: "Continue Onboarding",
    planExplore: "Explore Packages and Pricing",
  },
} as const;

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

const companyToBusiness = companyBusiness;

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
  const ar = locale === "ar";
  const mCopy = MILESTONES_COPY[locale];

  const leaveGuardRef = useRef<(() => boolean) | null>(null);
  const [savedCompany, setSavedCompany] = useState<CompanyRecord | null>(initialCompany ?? null);
  const [trackedCompany, setTrackedCompany] = useState(initialCompany ?? null);
  if (trackedCompany !== (initialCompany ?? null)) {
    setTrackedCompany(initialCompany ?? null);
    setSavedCompany(initialCompany ?? null);
  }
  const companyId = savedCompany?.id ?? null;
  const [readiness, setReadiness] = useState<CustomerReadinessSnapshot | null>(null);
  const [whatsappLink, setWhatsappLink] = useState<WhatsappCompanyLink | null>(null);
  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      setReadiness(null); setWhatsappLink(null);
      if (!companyId) return;
      void Promise.all([getCustomerReadiness(), getWhatsappCompanyLink()]).then(([r, w]) => {
        if (cancelled) return;
        setReadiness(r.ok && r.data.companyId === companyId ? r.data : null);
        setWhatsappLink(w.ok && w.data.companyId === companyId ? w.data : null);
      }).catch(() => { if (!cancelled) { setReadiness(null); setWhatsappLink(null); } });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [companyId, savedCompany?.updated_at]);
  const [draft, setDraft] = useState<CompanyDraft>(() => emptyCompanyDraft(userId));
  const [ready, setReady] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState(initialKnowledge);
  const [knowledgeFailed, setKnowledgeFailed] = useState(knowledgeLoadFailed);

  const knowledgeProgress = useMemo(
    () =>
      evaluateSetupKnowledgeProgress({
        loadFailed: knowledgeFailed,
        sources: knowledgeSources,
        approvalFoundation,
      }),
    [knowledgeFailed, knowledgeSources, approvalFoundation],
  );

  const setupTestKnowledgeKey = useMemo(
    () =>
      buildSetupTestKnowledgeKey(
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

  function serverSetupDone(knowledgeComplete: boolean): boolean[] {
    return setupMilestones({ company: savedCompany, knowledgeComplete, readiness, link: whatsappLink,
      review: initialReview, reviewLoadFailed });
  }

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const stored = readCompanyDraft(userId);
      const next = hydrateOnboardingDraft(stored, userId, savedCompany);
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
      const computedDone = serverSetupDone(kp.detail === "knowledge_ready");
      next.setupDone = computedDone;
      const firstOpen = computedDone.findIndex((d) => !d);
      next.setupStep = firstOpen === -1 ? 7 : Math.min(7, firstOpen);
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
    savedCompany?.id,
    savedCompany?.updated_at,
    initialKnowledge.length,
    knowledgeLoadFailed,
    approvalFoundation,
    initialReview?.status,
    initialReview?.revision,
    reviewLoadFailed,
  ]);

  const persist = (patch: Partial<CompanyDraft> | ((d: CompanyDraft) => CompanyDraft)) => {
    setDraft((prev) => {
      const next =
        typeof patch === "function"
          ? patch(prev)
          : { ...prev, ...patch, userId, companyId: patch.companyId ?? prev.companyId };
      next.userId = userId;
      writeCompanyDraft(next);
      return next;
    });
  };

  const step = Math.max(0, Math.min(7, draft.setupStep));
  const go = (n: number, opts?: { skipGuard?: boolean }) => {
    const next = Math.max(0, Math.min(7, n));
    if (next === step) return;
    if (!opts?.skipGuard && leaveGuardRef.current && !leaveGuardRef.current()) return;
    persist({ setupStep: next });
  };
  const markDone = (n: number) =>
    persist((d) => {
      const arr = [...d.setupDone];
      while (arr.length < 8) arr.push(false);
      arr[n] = true;
      return { ...d, setupDone: arr };
    });

  const effectiveSetupDone = serverSetupDone(knowledgeProgress.detail === "knowledge_ready");

  useEffect(() => {
    if (!ready) return;
    if (!draft.setupTestPassed) return;
    if (setupTestValid) return;
    const frame = window.requestAnimationFrame(() => {
      persist((d) => {
        const cleared = clearSetupTestProgress(d);
        const arr = [...cleared.setupDone];
        if (arr.length > 6) arr[6] = false;
        return { ...cleared, setupDone: arr };
      });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate on binding drift only
  }, [ready, setupTestValid, draft.setupTestPassed]);

  if (!ready) {
    return <main className="app-shell" aria-busy="true" />;
  }

  const completedCount = effectiveSetupDone.filter(Boolean).length;
  const progressPercent = Math.round((completedCount / 8) * 100);

  return (
    <main className="app-shell overflow-x-hidden px-4 py-6 pb-28">
      {/* Top Brand & Navigation Header */}
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-2xl font-bold tracking-tight">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#38dc89] text-base text-[#072317]">
            V
          </span>
          {copy.brand}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <PreviewBadge note />
          <LangSwitch />
          <LinkButton href="/app" variant="secondary">
            {copy.app.nav.dashboard}
          </LinkButton>
          <AccountMenu compact />
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1100px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="app-title text-3xl break-words lg:text-4xl">{copy.setup.title}</h1>
          <span className="text-xs font-semibold text-[#9af0c3] bg-[#38dc89]/15 border border-[#38dc89]/30 rounded-full px-3 py-1">
            {completedCount} / 8 {ar ? "محطات مؤكدة من السجلات" : "milestones confirmed from records"}
          </span>
        </div>
        <p className="app-muted mt-2 text-sm leading-6">
          {fill(mCopy.milestoneProgress, { n: step + 1 })} · {copy.setup.resume}
        </p>

        <SetupJourneyNotice
          company={initialCompany ?? null}
          review={initialReview}
          reviewLoadFailed={reviewLoadFailed}
        />

        {/* 8-Milestone Stepper Grid */}
        <ol
          className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8"
          aria-label={copy.setup.title}
        >
          {mCopy.steps.map((label, i) => {
            const active = i === step;
            const done = effectiveSetupDone[i];
            return (
              <li key={label} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={active ? "step" : undefined}
                  className={`flex min-h-14 w-full flex-col justify-center items-start gap-1 rounded-xl border p-2.5 text-start text-xs transition ${
                    active
                      ? "border-[#38dc89] bg-[#38dc89]/15 shadow-[0_0_12px_rgba(56,220,137,0.2)]"
                      : "border-[color:var(--color-border-soft)] hover:bg-[var(--color-hover-wash)]"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        done
                          ? "bg-[#38dc89] text-[#072317]"
                          : active
                            ? "border border-[#38dc89] text-[#9af0c3]"
                            : "border border-white/30 text-[var(--color-on-dark)]"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    {active ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#38dc89] animate-pulse" />
                    ) : null}
                  </div>
                  <span className="line-clamp-2 leading-4 font-medium text-[#f7fbf8] mt-1">
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Smooth Gradient Progress Bar */}
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10 p-0.5" aria-hidden="true">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#2ebd73] via-[#38dc89] to-[#9af0c3] shadow-[0_0_14px_rgba(56,220,137,0.6)] transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Active Step Panel */}
        <section className="app-panel mt-6 min-w-0 rounded-3xl p-5 sm:p-6 lg:p-8 border border-[color:var(--color-border-soft)] shadow-[0_16px_40px_rgba(0,0,0,0.4)] backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#38dc89]/15 border border-[#38dc89]/30 text-sm font-bold text-[#9af0c3]">
              {step + 1}
            </span>
            <h2 className="app-title text-2xl font-bold break-words text-[#f7fbf8]">
              {mCopy.steps[step]}
            </h2>
          </div>
          <p className="app-muted mt-2 text-sm leading-6 text-[#b7c6b9]">{mCopy.stepBodies[step]}</p>
          {step === 6 ? <Notice tone="info">{ar ? "نجاح الاختبار علامة محلية مرتبطة بمعرفة النشاط، ولا يُحتسب كتفعيل محفوظ أو دليل جودة شامل." : "A successful trial is local progress bound to company knowledge. It is not persisted activation or comprehensive quality evidence."}</Notice> : null}

          <div className="mt-6 min-w-0">
            {/* Milestone 0: Company Profile */}
            {step === 0 ? (
              <BusinessStep
                companyId={companyId}
                onCompanySaved={setSavedCompany}
                draft={draft}
                onDraft={persist}
                leaveGuardRef={leaveGuardRef}
                onDone={() => {
                  markDone(0);
                  go(1, { skipGuard: true });
                }}
              />
            ) : null}

            {/* Milestone 1: Subscription Plan */}
            {step === 1 ? (
              <PlanStep
                onBack={() => go(0)}
                onNext={() => {
                  markDone(1);
                  go(2);
                }}
              />
            ) : null}

            {/* Milestone 2: Working Hours & Operations */}
            {step === 2 ? (
              <HoursStep
                companyId={companyId}
                onCompanySaved={setSavedCompany}
                company={savedCompany}
                onDraft={persist}
                leaveGuardRef={leaveGuardRef}
                onBack={() => go(1)}
                onNext={() => {
                  markDone(2);
                  go(3, { skipGuard: true });
                }}
              />
            ) : null}

            {/* Milestone 3: Products, Services & Policies */}
            {step === 3 ? (
              <StepFrame
                onBack={() => go(2)}
                onNext={() => {
                  if (!knowledgeProgress.canAdvance) return;
                  markDone(3);
                  go(4);
                }}
                nextDisabled={!companyId || !knowledgeProgress.canAdvance}
                nextHint={
                  !companyId
                    ? copy.knowledge.needCompanyFirst
                    : !knowledgeProgress.canAdvance
                      ? copy.app.readinessDetails[knowledgeProgress.detail]
                      : undefined
                }
              >
                {companyId ? (
                  <KnowledgeEditor
                    key={companyId}
                    companyId={companyId!}
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

            {/* Milestone 4: Noura AI Persona & Tone */}
            {step === 4 ? (
              <PersonaStep
                companyId={companyId}
                onCompanySaved={setSavedCompany}
                company={savedCompany}
                onDraft={persist}
                onBack={() => go(3)}
                onNext={() => {
                  markDone(4);
                  go(5);
                }}
              />
            ) : null}

            {/* Milestone 5: WhatsApp Business Meta Connection */}
            {step === 5 ? (
              <WhatsAppStep
                companyId={companyId}
                onLinkSaved={setWhatsappLink}
                draft={draft}
                onBack={() => go(4)}
                onNext={() => {
                  markDone(5);
                  go(6);
                }}
              />
            ) : null}

            {/* Milestone 6: Sandbox Testing */}
            {step === 6 ? (
              <StepFrame
                onBack={() => go(5)}
                onNext={() => {
                  if (!setupTestValid || !companyId) return;
                  markDone(6);
                  go(7);
                }}
                nextDisabled={!setupTestValid}
                nextHint={!setupTestValid ? copy.setup.testRequiredHint : undefined}
              >
                <div className="mb-4 rounded-xl border border-[#38dc89]/30 bg-[#38dc89]/10 p-3.5 text-xs leading-relaxed text-[#c5d4cc]">
                  <div className="flex items-start gap-2.5">
                    <span className="text-base shrink-0">🧪</span>
                    <div>
                      <strong className="font-semibold text-[#f7fbf8]">
                        {locale === "ar"
                          ? "بيئة محاكاة واختبار داخلية (Sandbox Simulation)"
                          : "Internal trial; WhatsApp activation is separate"}
                      </strong>
                      <p className="mt-1">
                        {locale === "ar"
                          ? "هذه بيئة محاكاة تجريبية مخصصة لفحص دقة إجابات نورا وتدريبها على معرفة الشركة. الإجابات هنا لا تُرسل لعملاء حقيقيين ولا تعني تفعيل الردود الحية على واتساب."
                          : "This is a dedicated test simulation to verify Noura's response accuracy. Answers here are never sent to real customers and do not mean live WhatsApp automation is active."}
                      </p>
                    </div>
                  </div>
                </div>
                <AssistantTester
                  compact
                  onImprove={() => go(3)}
                  onAnswerResult={(result) => {
                    if (!result.ok) {
                      persist((d) => {
                        const cleared = clearSetupTestProgress(d);
                        const arr = [...cleared.setupDone];
                        if (arr.length > 6) arr[6] = false;
                        return { ...cleared, setupDone: arr };
                      });
                      return;
                    }
                    if (!companyId) {
                      persist((d) => {
                        const cleared = clearSetupTestProgress(d);
                        const arr = [...cleared.setupDone];
                        if (arr.length > 6) arr[6] = false;
                        return { ...cleared, setupDone: arr };
                      });
                      return;
                    }
                    persist((d) => {
                      const marked = markSetupTestPassed(d, companyId, setupTestKnowledgeKey);
                      const arr = [...marked.setupDone];
                      while (arr.length < 8) arr.push(false);
                      arr[6] = true;
                      return { ...marked, setupDone: arr };
                    });
                  }}
                />
                <p className="mt-3 text-xs leading-5 text-[var(--color-muted-soft)]">
                  {copy.setup.missingInfo}{" "}
                  <button type="button" onClick={() => go(3)} className="text-[#38dc89] underline">
                    {copy.setup.addInfo}
                  </button>
                </p>
              </StepFrame>
            ) : null}

            {/* Milestone 7: Go-Live Readiness & Launch */}
            {step === 7 ? (
              <ActivationStep
                leaveGuardRef={leaveGuardRef}
                onBack={() => go(6)}
                onDone={() => markDone(7)}
                setupDone={effectiveSetupDone}
                businessName={savedCompany?.display_name ?? ""}
                sectorLabel={
                  landingCopy(locale).sectors.find((s) => s.id === savedCompany?.business_type)?.label ??
                  copy.setup.typeOther
                }
                knowledgeCount={knowledgeSources.length}
                companyId={companyId}
                localTrialPassed={setupTestValid}
                readiness={readiness}
                whatsappLink={whatsappLink}
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

function StepFrame({
  children,
  onBack,
  onNext,
  nextDisabled,
  nextHint,
}: {
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextHint?: string;
}) {
  const copy = useAppCopy();
  return (
    <div className="grid min-w-0 gap-5">
      <div className="min-w-0">{children}</div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-soft)] bg-[#0d1a14]/95 px-4 py-4 backdrop-blur sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <Button variant="secondary" onClick={onBack}>
          {copy.back}
        </Button>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          {nextHint ? (
            <span className="max-w-full text-xs leading-5 text-[var(--color-muted-soft)] sm:max-w-[28ch]">
              {nextHint}
            </span>
          ) : null}
          <Button onClick={onNext} disabled={nextDisabled}>
            {copy.next}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Milestone 0: Company Profile Step                                         */
/* ========================================================================= */

function BusinessStep({
  draft,
  companyId,
  onCompanySaved,
  onDraft,
  onDone,
  leaveGuardRef,
}: {
  draft: CompanyDraft;
  companyId: string | null;
  onCompanySaved: (company: CompanyRecord) => void;
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
    return () => {
      leaveGuardRef.current = null;
    };
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
        expectedCompanyId: companyId,
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
      if (!finishCompanySave(result, companyId, (company) => {
        const saved = companyToBusiness(company);
        onCompanySaved(company);
        onDraft({ business: saved, businessSaved: true, companyId: company.id });
        setBaseline(JSON.stringify(saved));
        leaveGuardRef.current = () => true;
        router.refresh();
      }, onDone)) window.alert(copy.errors.authFailed);
    });
  }

  const select =
    "min-h-11 w-full min-w-0 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 text-[15px] text-[var(--color-on-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]";
  const nameError = useErrorText(errors.name);
  const hoursError = useErrorText(errors.hours);
  const phoneError = useErrorText(errors.contactPhone);
  const emailError = useErrorText(errors.contactEmail);

  return (
    <form className="grid min-w-0 gap-4 lg:grid-cols-2" noValidate onSubmit={submit}>
      <Field label={copy.setup.businessName} required error={nameError}>
        {(p) => (
          <input
            {...p}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            autoComplete="organization"
          />
        )}
      </Field>
      <Field label={copy.setup.businessType} required>
        {(p) => (
          <select
            {...p}
            value={form.type}
            onChange={(e) => set("type", e.target.value as Business["type"])}
            className={select}
          >
            {landing.sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="other">{copy.setup.typeOther}</option>
          </select>
        )}
      </Field>
      <Field label={copy.setup.country} required>
        {(p) => (
          <select
            {...p}
            value={form.country}
            onChange={(e) => set("country", e.target.value)}
            className={select}
          >
            <option value="OM">{copy.setup.oman}</option>
            <option value="OTHER">{copy.setup.otherCountry}</option>
          </select>
        )}
      </Field>
      <Field label={copy.setup.city}>
        {(p) => (
          <input
            {...p}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            autoComplete="address-level2"
          />
        )}
      </Field>
      <Field label={copy.setup.hours} required error={hoursError}>
        {(p) => <input {...p} value={form.hours} placeholder={copy.setup.hoursPlaceholder} onChange={(e) => set("hours", e.target.value)} />}
      </Field>
      <Field label={copy.setup.contactPhone} error={phoneError} hint="+968 …">
        {(p) => (
          <input
            {...p}
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={form.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
        )}
      </Field>
      <Field label={copy.setup.contactEmail} error={emailError}>
        {(p) => (
          <input
            {...p}
            dir="ltr"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--color-border-soft)] pt-4 lg:col-span-2">
        <Button type="submit" busy={busy} busyLabel={copy.saving}>
          {copy.setup.continue}
        </Button>
        {draft.businessSaved && !dirty ? (
          <span className="text-sm text-[var(--color-success-fg)]">{copy.saved}</span>
        ) : null}
      </div>
    </form>
  );
}

/* ========================================================================= */
/* Milestone 1: Plan & Subscription Step                                     */
/* ========================================================================= */

function PlanStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const ar = locale === "ar";
  const mCopy = MILESTONES_COPY[locale];

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1a14] to-[#07110d] p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#38dc89]/20 text-xl">
            ✨
          </span>
          <div>
            <h3 className="font-bold text-[#f7fbf8] text-base">{mCopy.planNoticeTitle}</h3>
            <p className="text-xs text-[#b7c6b9] mt-1">{mCopy.planNoticeBody}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-5 text-sm">
        <h4 className="font-bold text-[#f7fbf8]">
          {ar ? "مسارات إعداد النشاط" : "Setup areas"}
        </h4>
        <ul className="mt-3 grid gap-2.5 text-xs text-[#b7c6b9]">
          <li className="flex items-center gap-2">
            <span className="text-[#38dc89]">✓</span>
            {ar ? "ربط واتساب التجاري عبر Meta Cloud API الرسمي" : "Official Meta WhatsApp Cloud API connection"}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[#38dc89]">✓</span>
            {ar ? "قاعدة معرفة ذكية وتدريب نورا على سياسات النشاط" : "Smart knowledge base trained on your business policies"}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[#38dc89]">✓</span>
            {ar ? "صندوق محادثات موحد وتدخل بشري لحظي عند الحاجة" : "Unified inbox with seamless human handover"}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[#38dc89]">✓</span>
            {ar ? "بيئة محاكاة واختبار الردود قبل إطلاق الخدمة للعملاء" : "Full testing sandbox prior to customer rollout"}
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
        <Button variant="secondary" onClick={onBack}>
          {copy.back}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/settings?tab=plan"
            className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-4 text-xs font-medium text-[#b7c6b9] hover:text-[#f7fbf8]"
          >
            {mCopy.planExplore} ↗
          </Link>
          <Button onClick={onNext}>{mCopy.planButton}</Button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Milestone 2: Working Hours & Operations Step                              */
/* ========================================================================= */

function HoursStep({
  company,
  companyId,
  onCompanySaved,
  onDraft,
  onBack,
  onNext,
  leaveGuardRef,
}: {
  company: CompanyRecord | null;
  companyId: string | null;
  onCompanySaved: (company: CompanyRecord) => void;
  onDraft: (patch: Partial<CompanyDraft> | ((d: CompanyDraft) => CompanyDraft)) => void;
  onBack: () => void;
  onNext: () => void;
  leaveGuardRef: React.MutableRefObject<(() => boolean) | null>;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const form = company ? companyBusiness(company) : null;
  const [hours, setHours] = useState(form?.hours ?? "");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !companyId || !hours.trim()) {
      setError(copy.required);
      return;
    }
    setError(null);
    void run(async () => {
      const result = await saveOwnerBusiness({
        expectedCompanyId: companyId,
        displayName: form.name,
        businessType: form.type,
        replyLanguage: form.replyLanguage,
        country: form.country,
        city: form.city,
        hours: hours.trim(),
        contactPhone: form.contactPhone,
        contactEmail: form.contactEmail,
      });
      if (!result.ok) {
        setError(result.message ?? copy.errors.authFailed);
        return;
      }
      if (!finishCompanySave(result, companyId, (company) => {
        onCompanySaved(company);
        onDraft((d) => ({ ...d, business: companyBusiness(company) }));
        leaveGuardRef.current = () => true;
      }, onNext)) setError(copy.errors.authFailed);
    });
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <Field label={copy.setup.hours} required error={error ?? undefined}>
        {(p) => (
          <input
            {...p}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder={copy.setup.hoursPlaceholder}
          />
        )}
      </Field>

      <Notice tone="info">{locale === "ar" ? "سياسة الرد خارج الدوام لا تُحفظ هنا. أضف تعليمات نشاط معتمدة في المعرفة؛ الإطلاق الحي منفصل." : "After-hours behavior is not saved here. Add approved business instructions in Knowledge; live rollout is separate."}</Notice>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
        <Button variant="secondary" type="button" onClick={onBack}>
          {copy.back}
        </Button>
        <Button type="submit" busy={busy}>
          {copy.setup.continue}
        </Button>
      </div>
    </form>
  );
}

/* ========================================================================= */
/* Milestone 4: Noura AI Persona & Tone Step                                 */
/* ========================================================================= */

function PersonaStep({
  company,
  companyId,
  onCompanySaved,
  onDraft,
  onBack,
  onNext,
}: {
  company: CompanyRecord | null;
  companyId: string | null;
  onCompanySaved: (company: CompanyRecord) => void;
  onDraft: (patch: Partial<CompanyDraft> | ((d: CompanyDraft) => CompanyDraft)) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const mCopy = MILESTONES_COPY[locale];
  const form = company ? companyBusiness(company) : null;

  const [saveError, setSaveError] = useState<string | null>(null);
  const [lang, setLang] = useState<Business["replyLanguage"]>(form?.replyLanguage ?? "both");
  const { busy, run } = useAction();

  const select =
    "min-h-11 w-full min-w-0 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 text-[15px] text-[var(--color-on-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !companyId) return;
    setSaveError(null);
    void run(async () => {
      const result = await saveOwnerBusiness({
        expectedCompanyId: companyId,
        displayName: form.name,
        businessType: form.type,
        replyLanguage: lang,
        country: form.country,
        city: form.city,
        hours: form.hours,
        contactPhone: form.contactPhone,
        contactEmail: form.contactEmail,
      });
      if (!result.ok) { setSaveError(result.message ?? copy.errors.authFailed); return; }
      if (!finishCompanySave(result, companyId, (company) => {
        onCompanySaved(company);
        onDraft((d) => ({ ...d, business: companyBusiness(company) }));
      }, onNext)) setSaveError(copy.errors.authFailed);
    });
  }

  const sampleGreeting = mCopy.greetingDefault.replace("{name}", form?.name || copy.brand);

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <Notice tone="info">{locale === "ar" ? "لغة الرد تحفظ في ملف النشاط. النبرة تضبط عبر تعليمات نشاط معتمدة في المعرفة." : "Reply language is saved to the company profile. Set tone through approved business instructions in Knowledge."}</Notice>
      {saveError ? <Notice tone="error">{saveError}</Notice> : null}

      <Field label={copy.setup.replyLanguage} required>
        {(p) => (
          <select
            {...p}
            value={lang}
            onChange={(e) => setLang(e.target.value as Business["replyLanguage"])}
            className={select}
          >
            <option value="both">{copy.setup.langBoth}</option>
            <option value="ar">{copy.setup.langAr}</option>
            <option value="en">{copy.setup.langEn}</option>
          </select>
        )}
      </Field>

      <div className="rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-4">
        <label className="text-xs font-semibold text-[#9af0c3] block mb-1">
          {mCopy.greetingTitle}
        </label>
        <p className="text-sm text-[#f7fbf8] font-medium" dir="rtl">
          «{sampleGreeting}»
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
        <Button variant="secondary" type="button" onClick={onBack}>
          {copy.back}
        </Button>
        <Button type="submit" busy={busy}>
          {copy.setup.continue}
        </Button>
      </div>
    </form>
  );
}

/* ========================================================================= */
/* Milestone 5: WhatsApp Business Meta Connection Step                       */
/* ========================================================================= */

function WhatsAppStep({
  draft,
  companyId,
  onLinkSaved,
  onBack,
  onNext,
}: {
  draft: CompanyDraft;
  companyId: string | null;
  onLinkSaved: (link: WhatsappCompanyLink) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [ownership, setOwnership] = useState<"own" | "new">("own");
  const [number, setNumber] = useState(draft.business.contactPhone || "");
  const [keepOnPhone, setKeepOnPhone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ownership === "own" && !isPhone(number.trim())) {
      setError(copy.errors.phone);
      return;
    }
    if (!companyId) { setError(copy.knowledge.needCompanyFirst); return; }
    setError(null);

    void run(async () => {
      if (ownership === "own" && number.trim()) {
        const result = await saveWhatsappLinkRequest({
          expectedCompanyId: companyId,
          requestedDisplayNumber: number.trim(),
          keepOnPhone,
        });
        if (!result.ok && result.code !== "ALREADY_VERIFIED") {
          setError(result.message ?? copy.app.waLinkSaveFailed);
          return;
        }
        if (result.ok) onLinkSaved(result.data);
      }
      onNext();
    });
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <div className="rounded-2xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1a14] to-[#07110d] p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25d366]/20 border border-[#25d366]/40 text-xl">
            📱
          </span>
          <div>
            <h3 className="font-bold text-[#f7fbf8] text-sm">
              {ar ? "ربط واتساب التجاري (Meta Cloud API)" : "WhatsApp Cloud API Connection"}
            </h3>
            <p className="text-xs text-[#b7c6b9] mt-0.5">
              {ar
                ? "يمكنك استخدام رقم هاتفك الحالي أو طلب رقم عُماني مخصص لنشاطك."
                : "Connect your existing number or request a new dedicated WhatsApp number."}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#d9a467]/40 bg-[#d9a467]/10 p-3.5 text-xs leading-relaxed text-[#f0cf9d]">
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 text-base">⚠️</span>
          <div>
            <strong className="font-semibold">
              {ar ? "تنبيه هام حول توثيق واتساب:" : "Important WhatsApp Verification Notice:"}
            </strong>
            <p className="mt-1">
              {ar
                ? "تسجيل رقم الهاتف هنا هو حفظ لطلب ربط مبدئي فقط (Request Saved). توثيق الرقم يتم رسميًا عبر ربط Meta Cloud API وتأكيد ملكية النشاط التجاري. كتابة الرقم لا تعني أبدًا توثيق واتساب أو بدء الردود الحية."
                : "Entering your phone number here only saves an initial link request. Formal verification is executed through Meta Cloud API authentication and business verification. Entering a phone number is not verification and does not activate live AI replies."}
            </p>
          </div>
        </div>
      </div>

      <Field label={copy.setup.numberOwnership} required>
        {(p) => (
          <div className="grid gap-2 sm:grid-cols-2">
            {(["own", "new"] as const).map((v) => (
              <label
                key={v}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm leading-5 ${
                  ownership === v
                    ? "border-[#38dc89] bg-[#38dc89]/10"
                    : "border-[color:var(--color-border-soft)]"
                }`}
              >
                <input
                  type="radio"
                  name={p.id}
                  checked={ownership === v}
                  onChange={() => setOwnership(v)}
                  className="accent-[#38dc89]"
                />
                <span className="min-w-0 break-words">
                  {v === "own" ? copy.setup.ownNumber : copy.setup.newNumber}
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>

      {ownership === "new" ? <Notice tone="info">{ar ? "لم يُنشأ رقم جديد. اطلبه ضمن المراجعة الإدارية؛ هذه الخطوة لا توفر رقمًا أو توثيقًا." : "No number is provisioned here. Request one through administrative review; this step creates no number or verification."}</Notice> : null}
      {ownership === "own" ? (
        <>
          <Field label={copy.setup.whatsappNumber} required error={error ?? undefined} hint="+968 …">
            {(p) => (
              <input
                {...p}
                dir="ltr"
                inputMode="tel"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+968 91234567"
              />
            )}
          </Field>
          <label className="flex items-start gap-3 text-xs text-[#b7c6b9]">
            <input
              type="checkbox"
              checked={keepOnPhone}
              onChange={(e) => setKeepOnPhone(e.target.checked)}
              className="mt-0.5 accent-[#38dc89]"
            />
            <span>{copy.app.waLinkKeepOnPhone}</span>
          </label>
        </>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
        <Button variant="secondary" type="button" onClick={onBack}>
          {copy.back}
        </Button>
        <Button type="submit" busy={busy}>
          {copy.setup.continue}
        </Button>
      </div>
    </form>
  );
}

/* ========================================================================= */
/* Milestone 7: Go-Live Readiness & Launch Step                              */
/* ========================================================================= */

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
    status: review.status === "pending_review" ? "pending_review" : "not_requested",
    requestedAt: Date.parse(review.requested_at) || nowMs(),
  };
}

function DecoupledPillarsNotice({
  readiness,
  whatsappLink,
  locale,
  setupDone,
  reviewStatus,
}: {
  locale: "ar" | "en";
  setupDone: boolean[];
  readiness: CustomerReadinessSnapshot | null;
  whatsappLink: WhatsappCompanyLink | null;
  reviewStatus: CompanyReviewRequest["status"] | null;
}) {
  const ar = locale === "ar";
  const isProfileDone = Boolean(setupDone[0] && setupDone[2]);
  const isKnowledgeDone = Boolean(setupDone[3]);
  const isSetupDone = isProfileDone && isKnowledgeDone;
  const subscriptionActive = readiness?.items.some(i => i.id === "subscription" && i.detail === "subscription_active" && i.tone === "complete") ?? false;
  const meta = whatsappUiState(whatsappLink, false);

  const pillars = [
    {
      id: "state_1_subscription",
      title: ar ? "1. باقة الاشتراك" : "1. Subscription",
      statusText: subscriptionActive ? (ar ? "اشتراك ساري من السجلات" : "Active recorded subscription") : (ar ? "لا يوجد اشتراك ساري مؤكد" : "No confirmed active subscription"),
      detail: ar ? "التسوية المالية عبر Paymob" : "Paymob Billing Settlement",
      state: subscriptionActive ? ("complete" as const) : ("pending" as const),
    },
    {
      id: "state_2_setup",
      title: ar ? "2. إعداد النشاط والمعرفة" : "2. Company Setup & Knowledge",
      statusText: isSetupDone ? (ar ? "مكتمل" : "Completed") : (ar ? "قيد الإعداد" : "In Progress"),
      detail: ar ? "الملف، ساعات العمل، ومصادر المعرفة" : "Profile, hours, and knowledge",
      state: isSetupDone ? ("complete" as const) : ("pending" as const),
    },
    {
      id: "state_3_whatsapp",
      title: ar ? "3. توثيق واتساب ميتا" : "3. Meta WhatsApp Verification",
      statusText: meta.verified ? (ar ? "ربط موثق؛ التفويض والإطلاق منفصلان" : "Verified; authorization and rollout separate") : (ar ? "لا يوجد توثيق مؤكد" : "No confirmed Meta verification"),
      detail: ar ? "كتابة الرقم طلب ربط فقط وليست توثيقًا" : "Number entry is not verification",
      state: meta.verified ? ("complete" as const) : ("pending" as const),
    },
    {
      id: "state_4_review",
      title: ar ? "4. طلب المراجعة الإدارية" : "4. Admin Review Request",
      statusText:
        reviewStatus === "approved"
          ? ar ? "معتمد إداريًا" : "Approved"
          : reviewStatus === "pending_review"
            ? ar ? "قيد التدقيق" : "Pending Review"
            : ar ? "بانتظار التقديم" : "Awaiting Submission",
      detail: ar ? "فحص الجاهزية والسياسات من الإدارة" : "Readiness audit by platform admins",
      state: reviewStatus === "approved" ? ("complete" as const) : ("pending" as const),
    },
    {
      id: "state_5_live_ai",
      title: ar ? "5. تفعيل الردود الحية" : "5. Live AI Automation",
      statusText: ar ? "معطل — بانتظار استيفاء الشروط" : "Disabled — Pending Conditions",
      detail: ar ? "لا يُستنتج من الإعداد أو المراجعة" : "Never inferred from setup or review",
      state: "blocked" as const,
    },
  ];

  return (
    <div className="rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-4">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border-soft)] pb-3">
        <h4 className="text-xs font-bold text-[#f7fbf8] sm:text-sm">
          {ar ? "حالات التفعيل الخمس المستقلة (5 Decoupled Pillars)" : "5 Independent Activation States"}
        </h4>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-[#b7c6b9]">
          {ar ? "فصل صارم لمنع الإطلاق المبكر" : "Strict Pre-Launch Decoupling"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {pillars.map((p) => (
          <div
            key={p.id}
            className="flex flex-col justify-between rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs"
          >
            <div>
              <span className="font-semibold text-[#f7fbf8] block leading-tight">{p.title}</span>
              <span
                className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  p.state === "complete"
                    ? "bg-[#38dc89]/20 text-[#38dc89]"
                    : p.state === "pending"
                      ? "bg-[#d9a467]/20 text-[#f0cf9d]"
                      : "bg-[#e07a7a]/20 text-[#e07a7a]"
                }`}
              >
                {p.statusText}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-[#9aada0] leading-normal">{p.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-[#d9a467]/30 bg-[#d9a467]/10 p-2.5 text-xs leading-relaxed text-[#f0cf9d]">
        <span className="font-semibold">⚠️ {ar ? "تنبيه حاسم:" : "Crucial Rule:"}</span>{" "}
        {ar
          ? "تقديم المراجعة أو اعتمادها خطوة إدارية بحتة، ولا يعني أبدًا أن نورا بدأت بالرد على رسائل الزبائن. الرد الحي على واتساب يتطلب ربط Meta Cloud API الفعلي، اشتراكًا ماليًا ساريًا، وتفعيلًا تقنيًا صريحًا دون إيقاف."
          : "Submitting or approving a review is purely administrative and never means Noura is answering customers. Live WhatsApp replies strictly require official Meta Cloud API verification, an active settled subscription, and unpaused live automation."}
      </div>
    </div>
  );
}

function ActivationStep({
  localTrialPassed,
  readiness,
  whatsappLink,
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
  localTrialPassed: boolean;
  readiness: CustomerReadinessSnapshot | null;
  whatsappLink: WhatsappCompanyLink | null;
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
  const { state, update, locale } = useDemo();
  const [loadFailed, setLoadFailed] = useState(initialReviewLoadFailed);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [review, setReview] = useState<CompanyReviewRequest | null>(
    initialReviewLoadFailed ? null : initialReview,
  );
  const [events, setEvents] = useState<CompanyReviewEvent[]>([]);
  const [form, setForm] = useState<Activation>(() => {
    if (!initialReviewLoadFailed && initialReview) return activationFromReview(initialReview);
    return {
      whatsappNumber: "",
      numberOwnership: "own",
      ready: true,
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

  const readyToRequest = Boolean(
    companyId &&
      setupDone[0] &&
      setupDone[2] &&
      setupDone[3] &&
      localTrialPassed,
  );

  const dirty = canEdit && JSON.stringify(form) !== baseline;
  useUnsavedWarning(dirty && !busy);

  useEffect(() => {
    leaveGuardRef.current = () => {
      if (!dirty) return true;
      return window.confirm(copy.unsaved);
    };
    return () => {
      leaveGuardRef.current = null;
    };
  }, [dirty, copy.unsaved, leaveGuardRef]);

  useEffect(() => {
    if (loadFailed || !companyId) return;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const result = await listCompanyReviewEvents({ expectedCompanyId: companyId });
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
    if (nextReview.company_id !== companyId) {
      setLoadFailed(true);
      setViewRefreshFailed(true);
      setInfoNotice(copy.setup.reviewLoadFailed);
      return;
    }
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
    if (!companyId) { setLoadFailed(true); return; }
    try {
      const refreshed = await getCompanyReviewRequest({ expectedCompanyId: companyId });
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
      const hist = await listCompanyReviewEvents({ expectedCompanyId: companyId });
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
    if (!companyId) { setLoadFailed(true); return; }
    void run(async () => {
      try {
        const outcome = resolveReviewRefresh(await getCompanyReviewRequest({ expectedCompanyId: companyId }));
        if (outcome.kind === "keep_snapshot") {
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
    if (ownership === "own" && !isPhone(form.whatsappNumber)) {
      setError("phone");
      return;
    }
    setError(undefined);
    setSaveError(null);
    setInfoNotice(null);
    setViewRefreshFailed(false);

    void run(async () => {
      try {
        const result =
          status === "changes_requested" && review
            ? await resubmitCompanyReviewRequest({
                expectedCompanyId: companyId,
                numberOwnership: ownership,
                whatsappNumber: form.whatsappNumber,
                ready: form.ready === true,
                expectedRevision: review.revision,
              })
            : await submitCompanyReviewRequest({
                expectedCompanyId: companyId,
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
          <strong>{copy.setup.changesRequested}</strong>
          <br />
          {review.owner_note}
        </Notice>
      ) : null}
      <Field label={copy.setup.numberOwnership} required>
        {(p) => (
          <div className="grid gap-2 sm:grid-cols-2">
            {(["own", "new"] as const).map((v) => (
              <label
                key={v}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm leading-5 ${
                  form.numberOwnership === v
                    ? "border-[#38dc89] bg-[#38dc89]/10"
                    : "border-[color:var(--color-border-soft)]"
                }`}
              >
                <input
                  type="radio"
                  name={p.id}
                  checked={form.numberOwnership === v}
                  onChange={() => patch({ numberOwnership: v })}
                  className="accent-[#38dc89]"
                />
                <span className="min-w-0 break-words">
                  {v === "own" ? copy.setup.ownNumber : copy.setup.newNumber}
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>
      {form.numberOwnership === "own" ? (
        <Field label={copy.setup.whatsappNumber} required error={phoneError} hint="+968 …">
          {(p) => (
            <input
              {...p}
              dir="ltr"
              inputMode="tel"
              value={form.whatsappNumber}
              onChange={(e) => patch({ whatsappNumber: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      <label className="flex min-h-11 items-start gap-2 text-sm leading-5">
        <input
          type="checkbox"
          checked={form.ready}
          onChange={(e) => patch({ ready: e.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 accent-[#38dc89]"
        />
        <span className="min-w-0 break-words">{copy.setup.readiness}</span>
      </label>
      {saveError ? <Notice tone="error">{saveError}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--color-border-soft)] pt-4">
        <Button variant="secondary" type="button" onClick={onBack}>
          {copy.back}
        </Button>
        <Button
          type="submit"
          busy={busy}
          busyLabel={copy.loading}
          disabled={!readyToRequest || !form.numberOwnership || !form.ready}
        >
          {status === "changes_requested" ? copy.setup.resubmit : copy.setup.requestHelp}
        </Button>
        {!readyToRequest ? (
          <span className="text-xs text-[var(--color-warn-fg)]">{copy.setup.notReady}</span>
        ) : null}
      </div>
    </form>
  );

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid min-w-0 gap-4">
        <DecoupledPillarsNotice locale={locale} setupDone={setupDone} reviewStatus={status} readiness={readiness} whatsappLink={whatsappLink} />
        {saveError && !canEdit ? <Notice tone="error">{saveError}</Notice> : null}
        {infoNotice ? <Notice tone="warn">{infoNotice}</Notice> : null}
        {viewRefreshFailed ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              busy={busy}
              busyLabel={copy.loading}
              onClick={() => {
                void run(() => refreshViewOnly());
              }}
            >
              {copy.setup.reviewRetryView}
            </Button>
          </div>
        ) : null}
        {loadFailed ? (
          <>
            <Notice tone="error">{copy.setup.reviewLoadFailed}</Notice>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                busy={busy}
                busyLabel={copy.loading}
                onClick={reloadReview}
              >
                {copy.setup.reviewRetryLoad}
              </Button>
              <Button variant="secondary" onClick={onBack}>
                {copy.back}
              </Button>
            </div>
          </>
        ) : waiting && review ? (
          <>
            <Notice tone="warn">
              <strong>{copy.setup.pending}</strong>
              <br />
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
              <Button variant="secondary" onClick={onBack}>
                {copy.back}
              </Button>
            </div>
          </>
        ) : approved && review ? (
          <>
            <Notice tone="success">
              <strong>{copy.setup.approved}</strong>
              <br />
              {copy.setup.approvedBody}
              {review.owner_note ? (
                <>
                  <br />
                  {review.owner_note}
                </>
              ) : null}
              <br />
              <span className="text-xs text-[var(--color-muted-on-dark)]">
                {copy.setup.reviewRevision}: {review.revision}
              </span>
            </Notice>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/app">{copy.setup.goToApp}</LinkButton>
              <Button variant="secondary" onClick={onBack}>
                {copy.back}
              </Button>
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
                      if (!companyId) { setHistoryFailed(true); return; }
                      const hist = await listCompanyReviewEvents({ expectedCompanyId: companyId });
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
                <li
                  key={`${ev.action}-${ev.created_at}-${i}`}
                  className="border-b border-[color:var(--color-border-soft)] pb-2"
                >
                  <strong className="text-[var(--color-on-dark)]">{ev.action}</strong>
                  {" · "}r{ev.revision}
                  {" · "}
                  {new Date(ev.created_at).toLocaleString()}
                  {ev.owner_note ? <p className="mt-1">{ev.owner_note}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-muted-soft)]">
              {copy.setup.reviewHistoryEmpty}
            </p>
          )}
        </section>
      </div>
      <aside className="min-w-0 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4">
        <h3 className="font-bold">{copy.setup.review}</h3>
        <dl className="mt-3 grid gap-3 text-sm">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between gap-3 border-b border-[color:var(--color-border-soft)] pb-2"
            >
              <dt className="shrink-0 text-[var(--color-muted-on-dark)]">{k}</dt>
              <dd
                className="min-w-0 text-end break-words"
                dir={k === copy.setup.reviewRows[3] ? "ltr" : undefined}
              >
                {v}
              </dd>
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
