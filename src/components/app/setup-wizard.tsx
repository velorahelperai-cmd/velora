"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Activation, type Business, nowMs, useDemo } from "@/lib/demo-state";
import {
  type CompanyDraft,
  draftAllowedFor,
  emptyCompanyDraft,
  readCompanyDraft,
  writeCompanyDraft,
} from "@/lib/company-draft";
import { fill } from "@/lib/app-copy";
import type { KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { landingCopy } from "@/lib/landing-copy";
import { saveOwnerBusiness } from "@/lib/tenancy/actions";
import type { CompanyRecord } from "@/lib/tenancy/types";
import { AssistantTester } from "@/components/app/assistant-tester";
import { KnowledgeEditor } from "@/components/app/knowledge-editor";
import {
  Button, Field, FieldErrorKey, LangSwitch, LinkButton, Notice, PreviewBadge,
  isEmail, isPhone, useAction, useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

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
}: {
  userId: string;
  initialCompany?: CompanyRecord | null;
  initialKnowledge?: KnowledgeSourceRecord[];
  knowledgeLoadFailed?: boolean;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const leaveGuardRef = useRef<(() => boolean) | null>(null);
  const companyId = initialCompany?.id ?? null;
  const [draft, setDraft] = useState<CompanyDraft>(() => emptyCompanyDraft(userId));
  const [ready, setReady] = useState(false);
  const [knowledgeCount, setKnowledgeCount] = useState(
    knowledgeLoadFailed ? 0 : initialKnowledge.length,
  );
  const [knowledgeFailed, setKnowledgeFailed] = useState(knowledgeLoadFailed);
  const onKnowledgeSourcesChange = useCallback((sources: KnowledgeSourceRecord[]) => {
    setKnowledgeCount(sources.length);
  }, []);
  const onKnowledgeLoadStateChange = useCallback((failed: boolean) => {
    setKnowledgeFailed(failed);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = readCompanyDraft(userId);
      const allowed = draftAllowedFor(stored, userId, companyId);
      const next = allowed ? stored : emptyCompanyDraft(userId);
      if (initialCompany) {
        next.companyId = initialCompany.id;
        next.business = companyToBusiness(initialCompany);
        next.businessSaved = true;
        if (!next.setupDone[0]) next.setupDone = [true, ...next.setupDone.slice(1)];
      } else {
        next.companyId = null;
      }
      next.userId = userId;
      writeCompanyDraft(next);
      setDraft(next);
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [userId, companyId, initialCompany]);

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

  if (!ready) {
    return <main className="min-h-svh bg-[#07110d]" aria-busy="true" />;
  }

  return (
    <main className="min-h-svh overflow-x-hidden bg-[#07110d] px-4 py-6 pb-28 text-[#f7fbf8]">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-2xl font-bold">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#38dc89] text-base text-[#072317]">V</span>
          {copy.brand}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <PreviewBadge note />
          <LangSwitch />
          <LinkButton href="/app" variant="secondary">{copy.app.nav.dashboard}</LinkButton>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-[1100px]">
        <h1 className="text-3xl font-bold break-words lg:text-4xl">{copy.setup.title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#adbeaf]">{fill(copy.setup.progress, { n: step + 1 })} · {copy.setup.resume}</p>
        <ol className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={copy.setup.title}>
          {copy.setup.steps.map((label, i) => {
            const active = i === step;
            const done = draft.setupDone[i];
            return (
              <li key={label} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={active ? "step" : undefined}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-start text-sm transition ${active ? "border-[#38dc89] bg-[#38dc89]/10" : "border-white/10 hover:bg-white/5"}`}
                >
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-[#38dc89] text-[#072317]" : "border border-white/30 text-[#dfe9e2]"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0 leading-5 break-words">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full bg-[#38dc89] transition-all duration-500" style={{ width: `${(draft.setupDone.filter(Boolean).length / 4) * 100}%` }} />
        </div>

        <section className="mt-6 min-w-0 rounded-3xl border border-white/10 bg-[#0d1a14] p-4 sm:p-5 lg:p-8">
          <h2 className="text-2xl font-bold break-words">{copy.setup.steps[step]}</h2>
          <p className="mt-2 text-sm leading-6 text-[#adbeaf]">{copy.setup.stepBodies[step]}</p>
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
                onNext={() => { markDone(1); go(2); }}
                nextDisabled={!draft.companyId || knowledgeFailed || knowledgeCount === 0}
                nextHint={
                  !draft.companyId
                    ? copy.knowledge.needCompanyFirst
                    : knowledgeFailed
                      ? copy.knowledge.loadFailed
                      : knowledgeCount === 0
                        ? copy.knowledge.empty
                        : undefined
                }
              >
                {draft.companyId ? (
                  <KnowledgeEditor
                    compact
                    canWrite
                    initialSources={initialKnowledge}
                    initialLoadFailed={knowledgeLoadFailed}
                    onSourcesChange={onKnowledgeSourcesChange}
                    onLoadStateChange={onKnowledgeLoadStateChange}
                  />
                ) : (
                  <Notice tone="warn">{copy.knowledge.needCompanyFirst}</Notice>
                )}
              </StepFrame>
            ) : null}
            {step === 2 ? (
              <StepFrame onBack={() => go(1)} onNext={() => { markDone(2); go(3); }}>
                <AssistantTester compact onImprove={() => go(1)} />
                <p className="mt-3 text-xs leading-5 text-[#8da195]">{copy.setup.missingInfo} <button type="button" onClick={() => go(1)} className="text-[#38dc89] underline">{copy.setup.addInfo}</button></p>
              </StepFrame>
            ) : null}
            {step === 3 ? (
              <ActivationStep
                leaveGuardRef={leaveGuardRef}
                onBack={() => go(2)}
                onDone={() => markDone(3)}
                setupDone={draft.setupDone}
                businessName={draft.business.name}
                sectorLabel={landingCopy(locale).sectors.find((s) => s.id === draft.business.type)?.label ?? copy.setup.typeOther}
                knowledgeCount={knowledgeCount}
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
      <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#0d1a14]/95 px-4 py-4 backdrop-blur sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <Button variant="secondary" onClick={onBack}>{copy.back}</Button>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          {nextHint ? <span className="max-w-full text-xs leading-5 text-[#8da195] sm:max-w-[28ch]">{nextHint}</span> : null}
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

  const select = "min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-[#0d1a14] px-3 text-[15px] text-[#f7fbf8] outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]";
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
      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 lg:col-span-2">
        <Button type="submit" busy={busy} busyLabel={copy.saving}>{copy.setup.continue}</Button>
        {draft.businessSaved && !dirty ? <span className="text-sm text-[#9af0c3]">{copy.saved}</span> : null}
      </div>
    </form>
  );
}

function ActivationStep({
  onBack,
  onDone,
  sectorLabel,
  setupDone,
  businessName,
  knowledgeCount,
  leaveGuardRef,
}: {
  onBack: () => void;
  onDone: () => void;
  sectorLabel: string;
  setupDone: boolean[];
  businessName: string;
  knowledgeCount: number;
  leaveGuardRef: React.MutableRefObject<(() => boolean) | null>;
}) {
  const copy = useAppCopy();
  const { state, update } = useDemo();
  const form = state.activation;
  const [baseline, setBaseline] = useState(() => JSON.stringify(state.activation));
  const [error, setError] = useState<FieldErrorKey>();
  const { busy, run } = useAction();
  const pending = state.activation.status === "pending_review";
  const tests = state.testHistory.filter((m) => m.from === "customer").length;
  const readyToRequest = Boolean(setupDone[0] && setupDone[1] && setupDone[2]);
  const dirty = !pending && JSON.stringify(form) !== baseline;
  useUnsavedWarning(dirty && !busy);

  useEffect(() => {
    leaveGuardRef.current = () => {
      if (!dirty) return true;
      return window.confirm(copy.unsaved);
    };
    return () => { leaveGuardRef.current = null; };
  }, [dirty, copy.unsaved, leaveGuardRef]);

  const patch = (next: Partial<Activation>) => update({ activation: { ...form, ...next } });
  const phoneError = useErrorText(error);

  function request(e: React.FormEvent) {
    e.preventDefault();
    if (form.numberOwnership === "own" && !isPhone(form.whatsappNumber)) { setError("phone"); return; }
    setError(undefined);
    void run(() => {
      const next = { ...form, ready: true, status: "pending_review" as const, requestedAt: nowMs() };
      update({ activation: next });
      setBaseline(JSON.stringify(next));
      leaveGuardRef.current = () => true;
      onDone();
    }, 900);
  }

  const rows: [string, string][] = [
    [copy.setup.reviewRows[0], businessName ? `${businessName} · ${sectorLabel}` : copy.setup.noneYet],
    [copy.setup.reviewRows[1], knowledgeCount > 0 ? fill(copy.setup.sourcesCount, { n: knowledgeCount }) : copy.setup.noneYet],
    [copy.setup.reviewRows[2], tests ? fill(copy.setup.testsCount, { n: tests }) : copy.setup.noneYet],
    [copy.setup.reviewRows[3], state.activation.whatsappNumber || copy.setup.noneYet],
  ];

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid min-w-0 gap-4">
        {pending ? (
          <>
            <Notice tone="warn"><strong>{copy.setup.pending}</strong><br />{copy.setup.pendingBody}</Notice>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/app">{copy.setup.goToApp}</LinkButton>
              <Button variant="secondary" onClick={onBack}>{copy.back}</Button>
            </div>
          </>
        ) : (
          <form className="grid min-w-0 gap-4" noValidate onSubmit={request}>
            <Field label={copy.setup.numberOwnership} required>
              {(p) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["own", "new"] as const).map((v) => (
                    <label key={v} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm leading-5 ${form.numberOwnership === v ? "border-[#38dc89] bg-[#38dc89]/10" : "border-white/15"}`}>
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
            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
              <Button variant="secondary" type="button" onClick={onBack}>{copy.back}</Button>
              <Button type="submit" busy={busy} busyLabel={copy.loading} disabled={!readyToRequest || !form.numberOwnership || !form.ready}>{copy.setup.requestHelp}</Button>
              {!readyToRequest ? <span className="text-xs text-[#f0cf9d]">{copy.setup.notReady}</span> : null}
            </div>
          </form>
        )}
      </div>
      <aside className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="font-bold">{copy.setup.review}</h3>
        <dl className="mt-3 grid gap-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt className="shrink-0 text-[#adbeaf]">{k}</dt>
              <dd className="min-w-0 text-end break-words" dir={k === copy.setup.reviewRows[3] ? "ltr" : undefined}>{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt className="text-[#adbeaf]">{copy.app.whatsappStatus}</dt>
            <dd className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{pending ? copy.setup.pending : copy.setup.notConnected}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
