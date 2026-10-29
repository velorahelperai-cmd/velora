"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AccountMenu, useOptionalAccountSession } from "./account-chrome";
import { ApprovedAccountLoader } from "./approved-account-loader";
import { LangSwitch } from "./ui";
import { SetupStudioLangSwitch } from "./setup-studio-lang-switch";
import { useDemo } from "@/lib/demo-state";
import { createPreparationBranch, emptyPreparation, validatePreparation, type Preparation } from "@/lib/tenancy/prepayment-preparation";
import {
  accountPrepPayloadToFormState,
  preparationToAccountPrepPatch,
} from "@/lib/tenancy/account-prep-draft";
import {useAccountPrepDraft} from "./use-account-prep-draft";
import { BusinessNameSuggestions } from "./business-name-suggestions";
import { BusinessTypeCombobox } from "./business-type-combobox";
import { CountryCombobox } from "./country-combobox";
import { CityCombobox } from "./city-combobox";
import { countryLabel } from "./country-options";
import { cityKnownInCountry } from "./city-options";
import { BusinessPhoneField } from "./business-phone-field";
import { businessTypeLabel } from "@/lib/business-types";
import { broadSectorFromType, broadSectorStorageId, broadSectors, preservedDetailedTypeLabel, type BroadSectorId } from "@/lib/business-sectors";
import { applyScreen1Website, screen1WebsiteChange } from "@/lib/tenancy/screen1-website";
import type { OnboardingAnswers } from "@/lib/tenancy/onboarding-answers";
import { blankChannelDraft, clearHiddenChannelFields, commitChannelDraft, commitGoals, goalsContinueMissing, type ChannelDraft } from "@/lib/tenancy/setup-data-steps";
import { SetupActivityGoals, SetupWhatsAppExistingQuestion } from "./setup-data-screens";
import { businessNameSuggestions, rememberBusinessName, forgetBusinessNames } from "@/lib/field-suggestions";
import { recordPreparationValidationRejected } from "@/lib/logging/browser.mjs";
import { setupSubscriptionReturn } from "@/lib/auth/setup-return";
import { SetupStudioNoura } from "./setup-studio-noura";
import { SetupTeamPlans } from "./setup-team-plans";
import { SetupPaymentDialog } from "./setup-payment-dialog";
import { SetupJourneyStepper } from "./setup-journey-stepper";
import { createSetupPlanJourney, type SetupPlanConfirmResult, type SetupPlanJourney, type SetupPlanJourneySnapshot } from "@/components/app/setup-plan-journey";
import type { SubscriptionPackage, SubscriptionPersona, SubscriptionTerm } from "@/components/app/subscription-offers-view";
import styles from "./setup-entry.module.css";
import pageStyles from "./prepayment-preparation.module.css";
import studioStyles from "./setup-studio.module.css";
import planStyles from "./setup-team-plans.module.css";

export type PreparationVariant = "default" | "studio";

/** The authenticated actor is a mount boundary; unpaid prep draft loads only after identity match. */
export function PrepaymentPreparation({
  userId,
  preferredNext = "",
  variant = "default",
  checkoutNotice,
}: {
  userId: string;
  preferredNext?: string;
  checkoutNotice?: {ar:string;en:string};
  /** `studio` is /setup botanical presentation only; sibling routes keep default. */
  variant?: PreparationVariant;
}) {
  const session = useOptionalAccountSession();
  const { locale } = useDemo();
  if (session?.status !== "ready" || session.identity?.userId !== userId) {
    return <ApprovedAccountLoader label={locale === "ar" ? "جارٍ تأكيد الحساب…" : "Confirming your account…"} />;
  }
  const identity = session.identity;
  if (variant === "studio") {
    const live = session.liveSnapshot();
    return (
      <StudioShell
        userId={userId}
        preferredNext={preferredNext}
        checkoutNotice={checkoutNotice}
        ar={locale === "ar"}
        captureToken={live.boundaryFingerprint ?? ""}
        liveSnapshot={session.liveSnapshot}
        isCurrent={() => session.isCurrentUser(userId, identity)}
      />
    );
  }
  // Navigation intent only: query amounts never establish a trusted quote.
  return (
    <main
      data-service-theme=""
      className={pageStyles.page}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-plan-intent={preferredNext ? setupSubscriptionReturn(preferredNext) : undefined}
    >
      <header className={pageStyles.header}>
        <Link href="/">Velora</Link>
        <div>
          <LangSwitch />
          <AccountMenu compact />
        </div>
      </header>
      <PreparationForm key={`${userId}:${session.boundaryFingerprint??""}`} captureToken={session.boundaryFingerprint??""} ar={locale === "ar"} userId={userId} isCurrent={() => session.isCurrentUser(userId, identity)} />
    </main>
  );
}

export function PreparationForm({
  ar,
  userId,
  isCurrent,
  captureToken="",
}: {
  ar: boolean;
  userId: string;
  isCurrent: () => boolean;
  captureToken?: string;
}) {
  const id = useId();
  const form = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(emptyPreparation);
  const [review, setReview] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState("");
  const t = (a: string, e: string) => (ar ? a : e);
  const draft=useAccountPrepDraft({accountId:userId,captureToken,isCurrent,localOnly:true,restore:payload=>setValue(accountPrepPayloadToFormState(payload).preparation)});
  const {checkpoint,hydrated}=draft;
  useEffect(()=>{if(!hydrated)return;const {website:_w,whatsappExisting:_e,goals:_g,...patch}=preparationToAccountPrepPatch({preparation:value,website:null,whatsappExisting:null,goals:[]});checkpoint(patch);},[value,hydrated,checkpoint]);
  function change(key: Exclude<keyof Preparation, "branches">, next: string) {
    if (isCurrent()) {
      draft.markEdited();
      setValue((old) => ({ ...old, [key]: next }));
      setErrors([]);
    }
  }
  function branch(index: number, key: "name" | "city", next: string) {
    draft.markEdited();
    if (isCurrent())
      setValue((old) => ({
        ...old,
        branches: old.branches.map((row, i) => (i === index ? { ...row, [key]: next } : row)),
      }));
  }
  async function submit() {
    if (!isCurrent() || review || !draft.hydrated) return;
    const rejected = validatePreparation(value);
    if (form.current?.querySelector("input:invalid")) rejected.push("input");
    setErrors(rejected);
    if (rejected.length) recordPreparationValidationRejected({ userId });
    else {
      // This presentation edits only these fields; keep unseen website/channel/goal data intact.
      const full=preparationToAccountPrepPatch({preparation:value,website:null,whatsappExisting:null,goals:[]});
      const {website:_website,whatsappExisting:_whatsapp,goals:_goals,...patch}=full;
      void draft.save(patch);if(isCurrent())setReview(true);
    }
  }
  function suggestion(remove: boolean) {
    if (!isCurrent()) return;
    try {
      const store = window.localStorage;
      if (remove) forgetBusinessNames(store, userId);
      else rememberBusinessName(store, userId, value.name);
      const names = businessNameSuggestions(store, userId);
      const ok = remove ? names.length === 0 : names.includes(value.name.trim());
      setSuggestionStatus(
        ok
          ? t(
              remove ? "حُذفت اقتراحات الاسم لهذا الحساب." : "حُفظ الاسم كاقتراح محلي فقط.",
              remove ? "Name suggestions removed for this account." : "Name saved as a local suggestion only.",
            )
          : t("تعذّر تحديث الاقتراحات المحلية.", "Local suggestions could not be updated."),
      );
    } catch {
      setSuggestionStatus(t("التخزين المحلي غير متاح.", "Local storage is unavailable."));
    }
  }
  const labels = {
    name: t("اسم النشاط", "Business name"),
    city: t("مدينة النشاط", "Business city"),
    type: t("نوع النشاط", "Business type"),
    country: t("الدولة", "Country"),
    phone: t("هاتف النشاط", "Business phone"),
  };
  const input = (key: "name" | "city", label = labels[key]) => (
    <div className={styles.field}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        value={value[key]}
        maxLength={120}
        required
        autoComplete="off"
        onChange={(e) => change(key, e.target.value)}
      />
    </div>
  );
  if (!isCurrent()) return null;
  return (
    <section className={styles.entry} dir={ar ? "rtl" : "ltr"} aria-labelledby={`${id}-heading`}>
      <div className={styles.formColumn}>
        <div className={styles.intro}>
          <h2 id={`${id}-heading`}>{t("جهّز نشاطك قبل الدفع", "Prepare your business before payment")}</h2>
          <p>
            {t(
              "تُحفظ مسودة التجهيز لهذا الحساب عند المراجعة، وتظل صالحة أربعة أشهر من إنشائها. لا يُنشأ نشاط أو فرع قبل تأكيد الدفع.",
              "Review saves an account-owned preparation draft for four calendar months from creation. No business or branch is created before verified payment.",
            )}
          </p>
        </div>
        {review ? (
          <div className={styles.form}>
            <h3>{t("مراجعة محلية", "Local review")}</h3>
            <dl>
              {(["name", "type", "country", "city", "phone"] as const).map((key) => (
                <div key={key}>
                  <dt>{labels[key]}</dt>
                  <dd>{key === "type" ? businessTypeLabel(value[key], ar) : value[key]}</dd>
                </div>
              ))}
            </dl>
            <ol>
              {value.branches.map((row, index) => (
                <li key={index}>
                  {row.name} — {row.city}
                </li>
              ))}
            </ol>
            <p role="status">
              {t(
                "تم التحقق من اكتمال البيانات محليًا ولم تُرسل. اختيار الباقة والدفع غير متاحين حاليًا.",
                "Details checked locally and have not been sent. Plan selection and payment are currently unavailable.",
              )}
            </p>
            <button
              type="button"
              className={styles.submit}
              onClick={() => {
                if (isCurrent()) setReview(false);
              }}
            >
              {t("تعديل البيانات", "Edit details")}
            </button>
          </div>
        ) : (
          <div ref={form} role="form" aria-label={t("بيانات التجهيز المحلية", "Local preparation details")} className={styles.form}>
            <fieldset disabled={!draft.hydrated} onChangeCapture={draft.markEdited} style={{display:"contents",border:0,margin:0,padding:0,minWidth:0}}>
            <div className={styles.field}>
              <label htmlFor={`${id}-name`}>{labels.name}</label>
              <BusinessNameSuggestions
                id={`${id}-name`}
                value={value.name}
                ar={ar}
                userId={userId}
                isCurrent={isCurrent}
                onChange={(next) => change("name", next)}
              />
            </div>
            <div className={styles.fieldRow}>
              <button type="button" disabled={!value.name.trim()} onClick={() => suggestion(false)}>
                {t("تذكّر الاسم كاقتراح محلي", "Remember name as a local suggestion")}
              </button>
              <button type="button" onClick={() => suggestion(true)}>
                {t("حذف اقتراحات الاسم لهذا الحساب", "Delete name suggestions for this account")}
              </button>
            </div>
            {suggestionStatus ? <p role="status">{suggestionStatus}</p> : null}
            <div className={styles.field}>
              <label htmlFor={`${id}-type`}>{labels.type}</label>
              <BusinessTypeCombobox id={`${id}-type`} value={value.type} ar={ar} onChange={(next) => change("type", next)} />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-country`}>{labels.country}</label>
              <CountryCombobox id={`${id}-country`} value={value.country} ar={ar} disabled={false} onChange={(next) => change("country", next)} />
            </div>
            {input("city")}
            <BusinessPhoneField
              id={`${id}-phone`}
              label={labels.phone}
              value={value.phone}
              businessCountry={value.country}
              ar={ar}
              isCurrent={isCurrent}
              onChange={(next) => change("phone", next)}
            />
            <h3>{t("الفروع", "Branches")}</h3>
            {value.branches.map((row, index) => (
              <fieldset key={index} className={styles.form}>
                <legend>
                  {t("الفرع", "Branch")} {index + 1}
                </legend>
                {(["name", "city"] as const).map((key) => (
                  <div className={styles.field} key={key}>
                    <label htmlFor={`${id}-branch-${index}-${key}`}>
                      {key === "name" ? t("اسم الفرع", "Branch name") : t("مدينة الفرع", "Branch city")}
                    </label>
                    <input
                      id={`${id}-branch-${index}-${key}`}
                      value={row[key]}
                      maxLength={120}
                      required
                      autoComplete="off"
                      onChange={(e) => branch(index, key, e.target.value)}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  disabled={value.branches.length === 1}
                  onClick={() => {
                    draft.markEdited();
                    if (isCurrent())
                      setValue((old) => ({
                        ...old,
                        branches: old.branches.length > 1 ? old.branches.filter((_, i) => i !== index) : old.branches,
                      }));
                  }}
                >
                  {t("إزالة الفرع", "Remove branch")}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() => {
                draft.markEdited();
                if (isCurrent()) setValue((old) => ({ ...old, branches: [...old.branches, { name: "", city: "" }] }));
              }}
            >
              {t("إضافة فرع", "Add branch")}
            </button>
            {errors.length ? (
              <p className={styles.error} role="alert">
                {t(
                  "راجع الحقول المطلوبة وصحة الهاتف، وتأكد من عدم تكرار اسم الفرع ومدينته.",
                  "Check required fields and the phone number; branch name and city pairs must be unique.",
                )}
              </p>
            ) : null}
            <button type="button" onClick={submit} className={styles.submit}>
              {t("حفظ المسودة ومراجعة البيانات", "Save draft and review details")}
            </button>
          </fieldset>
            <AccountPrepDraftStatus draft={draft} ar={ar}/>
          </div>
        )}
      </div>
      <aside className={styles.guide}>
        <h3>{t("قبل المتابعة", "Before continuing")}</h3>
        <p>
          {t(
            "حفظ مسودة التجهيز لا يثبت الدفع ولا يفعّل الخدمة.",
            "Saving the preparation draft does not prove payment or activate service.",
          )}
        </p>
      </aside>
    </section>
  );
}

function StudioIcon({ kind, forward = "left" }: { kind: "store" | "pin" | "phone" | "pencil" | "chevron" | "arrow" | "plus"; forward?: "left" | "right" }) {
  if (kind === "plus") return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  if (kind === "store") return <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M4 3h16l2 6v2a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2V9l2-6Zm1.4 2L4 9h16l-1.4-4H5.4ZM4 15h2v6h4v-5h4v5h4v-6h2v8H4v-8Z" /></svg>;
  if (kind === "pin") return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8Zm0 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></svg>;
  if (kind === "phone") return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6.6 3.2c.5-.5 1.3-.5 1.8 0l2 2c.5.5.5 1.3 0 1.8L9 8.4a12.4 12.4 0 0 0 6.6 6.6l1.4-1.4c.5-.5 1.3-.5 1.8 0l2 2c.5.5.5 1.3 0 1.8l-1.5 1.5c-.5.5-1.2.7-1.9.5A17.5 17.5 0 0 1 4.6 6.6c-.2-.7 0-1.4.5-1.9L6.6 3.2Z" /></svg>;
  const arrow = forward === "right" ? <path d="M5 12h14m-6-6 6 6-6 6" /> : <path d="M19 12H5m6-6-6 6 6 6" />;
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "pencil" ? <><path d="m15 4 5 5M4 16 16 4a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L8 20l-5 1 1-5Z" /></> : kind === "chevron" ? <path d="m7 10 5 5 5-5" /> : arrow}</svg>;
}

function StudioShell({
  userId,
  preferredNext,
  checkoutNotice,
  ar,
  captureToken,
  liveSnapshot,
  isCurrent,
}: {
  userId: string;
  preferredNext: string;
  checkoutNotice?: {ar:string;en:string};
  ar: boolean;
  captureToken: string;
  liveSnapshot: () => { ready: boolean; userId: string | null; boundaryFingerprint: string | null };
  isCurrent: () => boolean;
}) {
  // Each media component follows reduced-motion, visibility and viewport automatically.
  const motionEnabled = true;
  return (
    <main
      data-service-theme=""
      data-setup-studio="true"
      className={studioStyles.studio}
      dir={ar ? "rtl" : "ltr"}
      data-plan-intent={preferredNext ? setupSubscriptionReturn(preferredNext) : undefined}
    >
      <header className={studioStyles.header}>
        <Link href="/" className={studioStyles.brand}>
          Velora
        </Link>
        <div className={studioStyles.headerTools}>
          <SetupStudioLangSwitch />
          <div className={studioStyles.accountControl}><AccountMenu compact /></div>
        </div>
      </header>
      <StudioPreparationForm
        key={`${userId}:${captureToken}:${isCurrent() ? "live" : "blocked"}`}
        ar={ar}
        checkoutNotice={checkoutNotice}
        userId={userId}
        captureToken={captureToken}
        liveSnapshot={liveSnapshot}
        isCurrent={isCurrent}
        motionEnabled={motionEnabled}
      />
    </main>
  );
}

/** Repair only missing primary identity; never transfer its role to an added row. */
function withAutomaticPrimaryBranch(preparation: Preparation, originalId: string | undefined): Preparation {
  const primary = preparation.branches.find((row, index) => originalId ? row.localId === originalId : index === 0);
  if (primary) {
    if (preparation.branches[0] === primary) return preparation;
    return { ...preparation, branches: [primary, ...preparation.branches.filter(row => row !== primary)] };
  }
  return {
    ...preparation,
    branches: [
      { localId: originalId, name: preparation.name, city: preparation.city },
      // An orphaned empty editor has no entered facts to preserve. Meaningful
      // added rows retain their own IDs, phone and overrides after the primary.
      ...preparation.branches.filter(row => row.name.trim() || row.city.trim() || row.contactPhone?.trim()),
    ],
  };
}

function StudioPreparationForm({
  ar,
  userId,
  captureToken,
  liveSnapshot,
  isCurrent,
  motionEnabled,
  checkoutNotice,
}: {
  ar: boolean;
  userId: string;
  captureToken: string;
  liveSnapshot: () => { ready: boolean; userId: string | null; boundaryFingerprint: string | null };
  isCurrent: () => boolean;
  motionEnabled: boolean;
  checkoutNotice?: {ar:string;en:string};
}) {
  const id = useId();
  const form = useRef<HTMLDivElement>(null);
  const journeyRef = useRef<SetupPlanJourney | null>(null);
  const [value, setValue] = useState(emptyPreparation);
  const [originalBranchLocalId] = useState(() => value.branches[0]?.localId);
  const firstBranchDefaults = useRef({ attached: true, name: true, city: true });
  const [journeyForView, setJourneyForView] = useState<SetupPlanJourney | null>(null);
  const [phase, setPhase] = useState<"form" | "plans" | "review">("form");
  const [planBranchFocus, setPlanBranchFocus] = useState(0);
  const [planSnap, setPlanSnap] = useState<SetupPlanJourneySnapshot | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [openSection, setOpenSection] = useState<"identity" | "branches">("identity");
  const [branchMode, setBranchMode] = useState<"single" | "multiple">("single");
  const [editingBranches, setEditingBranches] = useState(true);
  const [siteUrl, setSiteUrl] = useState("");
  const [noSite, setNoSite] = useState(false);
  const [siteError, setSiteError] = useState<"CONTRADICTION" | "INVALID_URL" | null>(null);
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>(blankChannelDraft);
  const [goalsDraft, setGoalsDraft] = useState<string[]>([]);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const answersRef = useRef<OnboardingAnswers | null>(null);
  useEffect(() => {
    answersRef.current = value.answers ?? null;
  }, [value.answers]);
  const preparedValue = useMemo(()=>{
    const allBranches=withAutomaticPrimaryBranch(value,originalBranchLocalId);
    return branchMode === "single" && allBranches.branches.length > 1
      ? {...allBranches,branches:allBranches.branches.slice(0,1)} : allBranches;
  },[value,originalBranchLocalId,branchMode]);
  const t = (a: string, e: string) => (ar ? a : e);

  /** Bound to this render's account and capture. Live session is read at call time. */
  const actorNow = useCallback(() => {
    if (!captureToken) return false;
    if (!isCurrent()) return false;
    const live = liveSnapshot();
    if (!live.ready || live.userId !== userId) return false;
    if (!live.boundaryFingerprint || live.boundaryFingerprint !== captureToken) return false;
    return true;
  }, [captureToken, isCurrent, liveSnapshot, userId]);
  const currentActorValidator = useRef(actorNow);

  // Refresh the live validator after a same-boundary identity/profile refresh.
  // A real account or opaque-boundary change still fails actorNow and remounts.
  useEffect(() => {
    currentActorValidator.current = actorNow;
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return;
    journey.bindActor({ accountId: userId, captureToken, isCurrent: actorNow });
  }, [actorNow, captureToken, userId]);

  const draft=useAccountPrepDraft({accountId:userId,captureToken,isCurrent:actorNow,localOnly:true,restore:payload=>{
    const restored=accountPrepPayloadToFormState(payload);
    setBranchMode(restored.preparation.branches.length > 1 ? "multiple" : "single");
    const primary = restored.preparation.branches[0];
    if (primary) primary.localId = originalBranchLocalId;
    firstBranchDefaults.current = {
      attached: true,
      name: !primary?.name || primary.name === restored.preparation.name,
      city: !primary?.city || primary.city === restored.preparation.city,
    };
    setValue(restored.preparation);setNoSite(restored.website?.kind==='none');setSiteUrl(restored.website?.kind==='url'?restored.website.value:'');
    setGoalsDraft(restored.goals);setChannelDraft({...blankChannelDraft(),whatsapp:true,existingUse:restored.whatsappExisting??""});
  }});

  const {checkpoint,hydrated}=draft;
  useEffect(()=>{
    if(!hydrated)return;
    checkpoint(preparationToAccountPrepPatch({preparation:preparedValue,website:noSite?{kind:'none'}:siteUrl?{kind:'url',value:siteUrl}:null,whatsappExisting:channelDraft.existingUse||null,goals:goalsDraft as OnboardingAnswers['goals']}));
  },[preparedValue,noSite,siteUrl,channelDraft.existingUse,goalsDraft,hydrated,checkpoint]);


  function remember(journey: SetupPlanJourney) {
    setJourneyForView(journey);
    setPlanSnap(journey.snapshot());
  }

  useEffect(() => {
    return () => {
      journeyRef.current?.release();
      journeyRef.current = null;
    };
  }, []);

  function change(key: Exclude<keyof Preparation, "branches">, next: string) {
    if (!isCurrent()) return;
    draft.markEdited();
    restoreRecoveredDefaults();
    const followName = key === "name" && firstBranchDefaults.current.attached && firstBranchDefaults.current.name;
    const followCity = key === "city" && firstBranchDefaults.current.attached && firstBranchDefaults.current.city;
    setValue((previous) => {
      const old = withAutomaticPrimaryBranch(previous, originalBranchLocalId);
      if (key === "country") {
        const keepCity = cityKnownInCountry(next, old.city) ? old.city : "";
        return {
          ...old,
          country: next,
          city: keepCity,
          branches: firstBranchDefaults.current.attached && firstBranchDefaults.current.city
            ? old.branches.map((row) =>
                row.localId === originalBranchLocalId ? { ...row, city: keepCity } : row,
              )
            : old.branches,
        };
      }
      return {
      ...old,
      [key]: next,
      branches: followName || followCity
        ? old.branches.map((row) => row.localId === originalBranchLocalId ? {
            ...row,
            ...(followName ? { name: next } : {}),
            ...(followCity ? { city: next } : {}),
          } : row)
        : old.branches,
    };
    });
    setErrors([]);
  }
  function branch(index: number, key: "name" | "city" | "contactPhone", next: string) {
    if (!isCurrent()) return;
    draft.markEdited();
    restoreRecoveredDefaults();
    const rowId = preparedValue.branches[index]?.localId;
    if (rowId === originalBranchLocalId && key !== "contactPhone" && firstBranchDefaults.current.attached) firstBranchDefaults.current[key] = false;
    setValue((previous) => { const old = withAutomaticPrimaryBranch(previous, originalBranchLocalId); return ({
      ...old,
      branches: old.branches.map((row, i) => ((rowId ? row.localId === rowId : i === index) ? { ...row, [key]: next } : row)),
    }); });
  }
  function restoreRecoveredDefaults() {
    if (!value.branches.some(row => row.localId === originalBranchLocalId)) {
      firstBranchDefaults.current = { attached: true, name: true, city: true };
    }
  }
  function removeBranch(index: number) {
    if (!isCurrent() || preparedValue.branches.length <= 1) return;
    const rowId = preparedValue.branches[index]?.localId;
    if (rowId === originalBranchLocalId || index === 0) return;
    draft.markEdited();
    restoreRecoveredDefaults();
    setValue((previous) => { const old = withAutomaticPrimaryBranch(previous, originalBranchLocalId); return ({
      ...old,
      branches: old.branches.length > 1 ? old.branches.filter((row, i) => rowId ? row.localId !== rowId : i !== index) : old.branches,
    }); });
  }
  function setMode(mode: "single" | "multiple") {
    if (!isCurrent()) return;
    draft.markEdited();
    restoreRecoveredDefaults();
    setBranchMode(mode);
    setEditingBranches(true);
    // Single mode selects the primary without deleting additional local drafts.
    setValue(old => withAutomaticPrimaryBranch(old, originalBranchLocalId));
  }
  function addBranch() {
    if (!actorNow()) return;
    draft.markEdited();
    restoreRecoveredDefaults();
    setOpenSection("branches");
    setEditingBranches(true);
    setBranchMode("multiple");
    setValue(previous => {
      const old = withAutomaticPrimaryBranch(previous, originalBranchLocalId);
      return branchMode === "single" && old.branches.length > 1 ? old : { ...old, branches: [...old.branches, createPreparationBranch()] };
    });
  }
  function storeAnswers(next: OnboardingAnswers | null) {
    answersRef.current = next;
    setValue((current) => ({ ...current, answers: next }));
  }
  function applySite(nextNoSite: boolean, nextUrl: string) {
    if (!isCurrent()) return;
    draft.markEdited();
    const next = applyScreen1Website(answersRef.current, nextNoSite, nextUrl);
    answersRef.current = next.answers;
    setNoSite(next.noSite);
    setSiteUrl(next.url);
    setSiteError(next.error);
    const stored = next.answers;
    setValue((current) => ({ ...current, answers: stored }));
  }
  function editChannels(next: ChannelDraft) {
    if (!isCurrent()) return;
    draft.markEdited();
    const clean = clearHiddenChannelFields(next);
    setChannelDraft(clean);
    const result = commitChannelDraft(answersRef.current, clean);
    if (!result.ok) return;
    storeAnswers(result.answers);
    setStepErrors([]);
  }
  function chooseSector(id: BroadSectorId) {
    change("type", broadSectorStorageId(id));
  }
  function toggleGoal(goal: string) {
    if (!isCurrent()) return;
    draft.markEdited();
    const next = goalsDraft.includes(goal) ? goalsDraft.filter((item) => item !== goal) : [...goalsDraft, goal];
    setGoalsDraft(next);
    const result = commitGoals(answersRef.current, next);
    if (!result.ok) return;
    storeAnswers(result.answers);
    setStepErrors([]);
  }
  function openLocalPlans() {
    if (!actorNow() || phase !== "form" || !draft.hydrated) return;
    const rejected = validatePreparation(preparedValue);
    const website = screen1WebsiteChange(answersRef.current, noSite, siteUrl);
    if (!website.ok) rejected.push("website");
    if (form.current?.querySelector("input:invalid")) rejected.push("input");
    const whatsappDraft = { ...channelDraft, whatsapp: true as const };
    // C09 asks only whether WhatsApp is already used. Provider/readiness details
    // belong to the later channel setup and are not present on this form.
    const channelMissing = whatsappDraft.existingUse ? [] : ["existingUse"];
    if (channelMissing.length) rejected.push("whatsappExisting");
    const goalsMissing = goalsContinueMissing(goalsDraft);
    if (goalsMissing.length) rejected.push(...goalsMissing);
    if (rejected.length || !website.ok) {
      setErrors(rejected);
      setStepErrors([...channelMissing, ...goalsMissing]);
      recordPreparationValidationRejected({ userId });
      return;
    }
    const channelResult = commitChannelDraft(website.answers, whatsappDraft);
    if (!channelResult.ok) {
      setErrors(["whatsappExisting"]);
      setStepErrors(["answers"]);
      return;
    }
    const goalsResult = commitGoals(channelResult.answers, goalsDraft);
    if (!goalsResult.ok) {
      setStepErrors(["answers"]);
      return;
    }
    storeAnswers(goalsResult.answers);
    setChannelDraft(clearHiddenChannelFields(whatsappDraft));
    const preparation = { ...preparedValue, answers: goalsResult.answers };
    const invalid = validatePreparation(preparation);
    if (invalid.length) {
      setErrors(invalid);
      recordPreparationValidationRejected({ userId });
      return;
    }

    const patch = preparationToAccountPrepPatch({
      preparation,
      website: goalsResult.answers.website,
      whatsappExisting: whatsappDraft.existingUse || null,
      goals: goalsResult.answers.goals,
    });
    // Navigate immediately after field validation; persist only when eligible fields changed.
    void draft.save(patch);

    const existing = journeyRef.current;
    const journey =
      existing && !existing.snapshot().discarded
        ? existing
        : createSetupPlanJourney({
            actor: { accountId: userId, captureToken, isCurrent: actorNow },
            preparation,
          });
    journeyRef.current = journey;
    const bound = journey.snapshot();
    if (bound.discarded || bound.accountId !== userId || bound.captureToken !== captureToken) {
      journey.bindActor({ accountId: userId, captureToken, isCurrent: actorNow });
    }
    journey.replacePreparation(preparation);
    const opened = journey.openPlans();
    if (opened.ok && journey.snapshot().term === null) journey.setTerm("monthly");
    remember(journey);
    if (!opened.ok) {
      setErrors(opened.code === "SLOT_COUNT" ? ["slot-count"] : (opened.preparationErrors ?? [opened.code]));
      return;
    }
    setErrors([]);
    setStepErrors([]);
    setPhase("plans");
  }
  function onSelect(index: number, choice: { persona: SubscriptionPersona; package: SubscriptionPackage }) {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return { ok: false as const, code: "ACTOR_NOT_CURRENT" as const };
    const result = journey.setSlot(index, choice);
    remember(journey);
    return result;
  }
  function onTerm(term: SubscriptionTerm) {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return { ok: false as const, code: "ACTOR_NOT_CURRENT" as const };
    const result = journey.setTerm(term);
    remember(journey);
    return result;
  }
  function onBack() {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return { ok: false as const, code: "ACTOR_NOT_CURRENT" as const };
    const result = journey.backToPreparation();
    remember(journey);
    setPhase("form");
    return result;
  }
  function onContinue() {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return { ok: false as const, code: "ACTOR_NOT_CURRENT" as const };
    const result = journey.localReview();
    remember(journey);
    if (result.ok) setPhase("review");
    return result;
  }
  function reviewConsent(accepted: boolean) {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return;
    journey.setConsent(accepted);
    remember(journey);
  }
  async function reviewConfirm(accepted: boolean): Promise<SetupPlanConfirmResult> {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return { ok: false, code: "ACTOR_NOT_CURRENT" };
    const snap = journey.snapshot();
    const prepPatch = preparationToAccountPrepPatch({
      preparation: snap.preparation,
      website: snap.preparation.answers?.website ?? null,
      whatsappExisting: snap.preparation.answers?.whatsapp?.existingUse ?? null,
      goals: snap.preparation.answers?.goals ?? [],
    });
    // The payment boundary has its own durable, authenticated checkout binding.
    // Preparation itself remains local until the user starts that boundary.
    await draft.save(prepPatch);
    if (!currentActorValidator.current() || journeyRef.current !== journey) return { ok: false, code: "STALE_CAPTURE" };
    const pending = journey.confirmReview(accepted);
    remember(journey);
    const result = await pending;
    if (currentActorValidator.current() && journeyRef.current === journey && !journey.snapshot().discarded) remember(journey);
    return result;
  }
  function reviewBack(index = 0) {
    const journey = journeyRef.current;
    if (!journey || !actorNow()) return;
    const result = journey.openPlans();
    remember(journey);
    if (result.ok) {
      setPlanBranchFocus(index);
      setPhase("plans");
    }
  }

  const labels = {
    name: t("اسم النشاط", "Business name"),
    city: t("المدينة", "City"),
    type: t("قطاع نشاطك", "Your sector"),
    country: t("الدولة", "Country"),
    phone: t("هاتف التواصل التجاري", "Business contact phone"),
  };

  const filledBranches = preparedValue.branches.filter((b) => b.name.trim() || b.city.trim());
  const summaryName = preparedValue.name.trim() || t("أضف اسم النشاط", "Add your business name");
  const summaryPlace =
    [preparedValue.city.trim(), countryLabel(preparedValue.country, ar)].filter(Boolean).join(" · ") || t("الموقع لاحقًا", "Location later");
  const summaryPhone = preparedValue.phone.trim() || t("أضف هاتف النشاط", "Add business phone");
  const summaryBranches =
    filledBranches.length === 0
      ? t("لا فروع بعد", "No branches yet")
      : ar
        ? filledBranches.length === 1
          ? "فرع واحد"
          : `${filledBranches.length} فروع`
        : filledBranches.length === 1
          ? "1 branch"
          : `${filledBranches.length} branches`;

  if (!isCurrent()) return null;
  const activeJourney =
    phase !== "form" && planSnap && !planSnap.discarded
      ? journeyForView
      : null;

  return (
    <div className={phase !== "form" ? planStyles.stack : studioStyles.shell}>
      {/* Fail-only draft notice stays mounted across form/plans/review; silent saves never surface here. */}
      <AccountPrepDraftStatus draft={draft} ar={ar}/>
      {/*
        Shell uses physical LTR grid tracks so stage+summary stay visually left and
        form right (approved), while each region restores logical RTL/LTR text.
        Mobile grid places compact stage beside intro; summary is a later track.
      */}
      {phase === "form" ? (
      <aside className={studioStyles.stageColumn}>
        <SetupStudioNoura ar={ar} motionEnabled={motionEnabled} />
      <div className={studioStyles.summaryCard} data-setup-summary="true" aria-live="polite">
        <div className={studioStyles.summaryIcon} aria-hidden="true"><StudioIcon kind="store" /></div>
        <div className={studioStyles.summaryDetails}>
          <span className={studioStyles.summaryLabel}>{t("ملخص نشاطك", "Business summary")}</span>
          <strong>{summaryName}</strong>
          <p><StudioIcon kind="pin" />{summaryPlace}</p>
          <p><StudioIcon kind="phone" />{summaryPhone}</p>
          <p><StudioIcon kind="store" />{summaryBranches}</p>
        </div>
      </div>
      </aside>
      ) : null}

      {phase === "form" ? (
      <div className={studioStyles.mainColumn}>
      <header className={studioStyles.intro}>
        <h1 id={`${id}-heading`} className={studioStyles.headline} data-setup-hero="true">
          <span>{t("لنمنح نشاطك", "Let's give your business")}</span>{" "}
          <span className={studioStyles.headlineAccent}>{t("بداية مختلفة", "a different start")}</span>
        </h1>
        <p className={studioStyles.subtitle}>
          {t("أدخل بيانات نشاطك التجاري وفروعه للمتابعة.", "Enter your business details and branches to continue.")}
        </p>
      </header>
      <SetupJourneyStepper ar={ar} activeStep={1} className={studioStyles.steps} />
          <div
            ref={form}
            role="form"
            aria-label={t("بيانات التجهيز المحلية", "Local preparation details")}
            aria-labelledby={`${id}-heading`}
            className={`${studioStyles.panel} ${studioStyles.formBody}`}
          >
            <fieldset disabled={!draft.hydrated} onChangeCapture={draft.markEdited} style={{display:"contents",border:0,margin:0,padding:0,minWidth:0}}>
            <div className={studioStyles.stepStack} data-setup-step="activity">
            <div className={studioStyles.accordion} data-open={openSection === "identity"}>
              <button
                type="button"
                className={studioStyles.accordionHeader}
                aria-expanded={openSection === "identity"}
                aria-controls={`${id}-identity-panel`}
                id={`${id}-identity-tab`}
                onClick={() => setOpenSection("identity")}
              >
                <span className={studioStyles.accordionHeading}>
                  <span className={studioStyles.sectionNumber} aria-hidden="true">01</span>
                  <span className={studioStyles.accordionTitle}>
                    <strong>{t("هوية نشاطك", "Your business identity")}</strong>
                    <span>{t("أدخل بيانات نشاطك التجاري الأساسية.", "Enter your essential business details.")}</span>
                  </span>
                </span>
                <span className={studioStyles.chevron} aria-hidden="true"><StudioIcon kind="chevron" /></span>
              </button>
              {openSection === "identity" ? (
                <div className={`${studioStyles.accordionBody} ${studioStyles.identityGrid}`} id={`${id}-identity-panel`} role="region" aria-labelledby={`${id}-identity-tab`}>
                  <div className={`${studioStyles.field} ${studioStyles.nameField}`}>
                    <label htmlFor={`${id}-name`}>
                      {labels.name}
                      <span className={studioStyles.req} aria-hidden="true">
                        *
                      </span>
                    </label>
                    <BusinessNameSuggestions
                      id={`${id}-name`}
                      value={preparedValue.name}
                      ar={ar}
                      userId={userId}
                      isCurrent={isCurrent}
                      onChange={(next) => change("name", next)}
                    />
                  </div>
                  <div className={`${studioStyles.field} ${studioStyles.siteField}`}>
                    <label htmlFor={`${id}-website`}>
                      {t("موقعك الإلكتروني (اختياري)", "Your website (optional)")}
                    </label>
                    <div className={studioStyles.siteRow}>
                      <input
                        id={`${id}-website`}
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        maxLength={200}
                        value={siteUrl}
                        disabled={noSite && !siteUrl.trim()}
                        aria-invalid={siteError ? true : undefined}
                        onChange={(e) => applySite(noSite, e.target.value)}
                      />
                      <label className={studioStyles.siteCheck} htmlFor={`${id}-no-site`}>
                        <input
                          id={`${id}-no-site`}
                          type="checkbox"
                          data-setup-no-site="true"
                          checked={noSite}
                          onChange={(e) => applySite(e.target.checked, siteUrl)}
                        />
                        <span>{t("لا يتوفر موقع", "No website available")}</span>
                      </label>
                    </div>
                    {siteError ? (
                      <p className={studioStyles.error} role="alert" data-setup-website-error={siteError}>
                        {siteError === "CONTRADICTION"
                          ? t("أزل الرابط أو ألغِ «لا يتوفر موقع».", "Remove the link or turn off “no website”.")
                          : t("استخدم رابط http أو https صالحًا.", "Use a valid http or https link.")}
                      </p>
                    ) : null}
                  </div>
                  <div className={studioStyles.fieldRow}>
                    <div className={studioStyles.field}>
                      <label htmlFor={`${id}-country`}>
                        {labels.country}
                        <span className={studioStyles.req} aria-hidden="true">
                          *
                        </span>
                      </label>
                      <CountryCombobox
                        id={`${id}-country`}
                        value={preparedValue.country}
                        ar={ar}
                        disabled={false}
                        onChange={(next) => change("country", next)}
                      />
                    </div>
                    <div className={studioStyles.field}>
                      <label htmlFor={`${id}-city`}>
                        {labels.city}
                        <span className={studioStyles.req} aria-hidden="true">
                          *
                        </span>
                      </label>
                      <CityCombobox
                        id={`${id}-city`}
                        value={preparedValue.city}
                        country={preparedValue.country}
                        ar={ar}
                        onChange={(next) => change("city", next)}
                      />
                    </div>
                  </div>
                  <div className={studioStyles.contactRow}>
                    <div className={studioStyles.phoneField}>
                      <BusinessPhoneField
                        groupLabel
                        id={`${id}-phone`}
                        label={labels.phone}
                        value={preparedValue.phone}
                        businessCountry={preparedValue.country}
                        ar={ar}
                        isCurrent={isCurrent}
                        onChange={(next) => change("phone", next)}
                      />
                    </div>
                    <div className={studioStyles.sectorBlock}>
                      <label htmlFor={`${id}-type`} className={studioStyles.sectorLabel} id={`${id}-sector-label`}>
                        {labels.type}
                        <span className={studioStyles.req} aria-hidden="true">*</span>
                      </label>
                      <select
                        id={`${id}-type`}
                        data-sector-select="true"
                        data-field="type"
                        required
                        aria-required="true"
                        aria-invalid={errors.includes("type") || undefined}
                        aria-labelledby={`${id}-sector-label`}
                        value={broadSectorFromType(preparedValue.type) ?? ""}
                        onChange={(e) => {
                          const next = e.target.value as BroadSectorId | "";
                          if (next) chooseSector(next);
                        }}
                      >
                        <option value="">{t("اختر القطاع", "Choose a sector")}</option>
                        {broadSectors.map((item) => (
                          <option key={item.id} value={item.id} data-sector={item.id}>
                            {ar ? item.ar : item.en}
                          </option>
                        ))}
                      </select>
                      {preservedDetailedTypeLabel(preparedValue.type, ar) ? (
                        <p className={studioStyles.legacyType} data-preserved-type={preparedValue.type}>
                          {t("النوع التفصيلي المحفوظ:", "Saved detailed type:")} {preservedDetailedTypeLabel(preparedValue.type, ar)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <SetupWhatsAppExistingQuestion
                    ar={ar}
                    draft={channelDraft}
                    onDraft={editChannels}
                    error={stepErrors.includes("existingUse") || errors.includes("whatsappExisting")}
                  />
                  <SetupActivityGoals
                    ar={ar}
                    goals={goalsDraft}
                    errors={stepErrors}
                    onGoal={toggleGoal}
                  />

                </div>
              ) : null}
            </div>

            <div className={studioStyles.accordion} data-open={openSection === "branches"}>
              <button
                type="button"
                className={studioStyles.accordionHeader}
                aria-expanded={openSection === "branches"}
                aria-controls={`${id}-branches-panel`}
                id={`${id}-branches-tab`}
                onClick={() => setOpenSection("branches")}
              >
                <span className={studioStyles.accordionHeading}>
                  <span className={studioStyles.sectionNumber} aria-hidden="true">02</span>
                  <span className={studioStyles.accordionTitle}>
                    <strong>{t("فروعك", "Your branches")}</strong>
                    <span>{t("أضف فروع نشاطك التجاري.", "Add your business branches.")}</span>
                  </span>
                </span>
                <span className={studioStyles.chevron} aria-hidden="true"><StudioIcon kind="chevron" /></span>
              </button>
              {openSection !== "branches" ? (
                <div className={studioStyles.branchPreview} data-branch-preview="true">
                  {preparedValue.branches.map((row, index) => (
                    <div className={studioStyles.branchPreviewCard} key={index}>
                      <span className={studioStyles.branchPreviewIcon} aria-hidden="true"><StudioIcon kind="store" /></span>
                      <div>
                        <div className={studioStyles.branchTitle}><strong>{row.name.trim() || `${t("الفرع", "Branch")} ${index + 1}`}</strong>{index === 0 ? <span className={studioStyles.mainBranch}>{t("رئيسي", "Main")}</span> : null}</div>
                        <span>{row.city.trim() || t("أضف مدينة الفرع", "Add the branch city")}</span>
                      </div>
                    </div>
                  ))}
                  <button type="button" className={studioStyles.branchEdit} data-setup-add-branch="true" onClick={addBranch}><StudioIcon kind="plus" />{t("أضف فرع", "Add branch")}</button>
                </div>
              ) : null}
              {openSection === "branches" ? (
                <div className={studioStyles.accordionBody} id={`${id}-branches-panel`} role="region" aria-labelledby={`${id}-branches-tab`}>
                  <div className={studioStyles.branchMode} role="group" aria-label={t("نمط الفروع", "Branch mode")}>
                    <button type="button" aria-pressed={branchMode === "single"} onClick={() => setMode("single")}>
                      {t("فرع واحد", "Single branch")}
                    </button>
                    <button type="button" aria-pressed={branchMode === "multiple"} onClick={() => setMode("multiple")}>
                      {t("عدة فروع", "Multiple branches")}
                    </button>
                  </div>

                  {!editingBranches && filledBranches.length > 0 ? (
                    <>
                      <div className={studioStyles.branchChips}>
                        {preparedValue.branches.map((row, index) => (
                          <span key={index} className={studioStyles.chip}>
                            {(row.name.trim() || t("فرع", "Branch")) +
                              (row.city.trim() ? ` · ${row.city.trim()}` : "")}
                          </span>
                        ))}
                      </div>
                      <button type="button" className={studioStyles.ghostBtn} onClick={addBranch}>
                        {t("أضف فرع", "Add branch")}
                      </button>
                    </>
                  ) : (
                    <>
                      {preparedValue.branches.map((row, index) => (
                        <fieldset key={row.localId ?? index} className={studioStyles.branchCard} data-branch-local-id={row.localId}>
                          <legend>
                            {t("الفرع", "Branch")} {index + 1}
                          </legend>
                          <div className={studioStyles.field}>
                            <label htmlFor={`${id}-branch-${index}-name`}>
                              {t("اسم الفرع", "Branch name")}
                              <span className={studioStyles.req} aria-hidden="true">*</span>
                            </label>
                            <input
                              id={`${id}-branch-${index}-name`}
                              value={row.name}
                              maxLength={120}
                              required
                              autoComplete="off"
                              onChange={(e) => branch(index, "name", e.target.value)}
                            />
                          </div>
                          <div className={studioStyles.field}>
                            <label htmlFor={`${id}-branch-${index}-city`}>
                              {t("مدينة الفرع", "Branch city")}
                              <span className={studioStyles.req} aria-hidden="true">*</span>
                            </label>
                            <CityCombobox
                              id={`${id}-branch-${index}-city`}
                              value={row.city}
                              country={preparedValue.country}
                              ar={ar}
                              onChange={(next) => branch(index, "city", next)}
                            />
                          </div>
                          {row.localId !== originalBranchLocalId ? (
                            <div className={studioStyles.phoneField} data-branch-contact-field="true">
                              <BusinessPhoneField id={`${id}-branch-${row.localId ?? index}-phone`} label={t("هاتف الفرع (اختياري)", "Branch phone (optional)")} value={row.contactPhone ?? ""} businessCountry={preparedValue.country} ar={ar} isCurrent={actorNow} groupLabel onChange={(next) => branch(index, "contactPhone", next)} />
                            </div>
                          ) : null}
                          <div className={studioStyles.branchActions}>
                            <button
                              type="button"
                              disabled={index === 0 || preparedValue.branches.length === 1}
                              onClick={() => removeBranch(index)}
                            >
                              {t("إزالة الفرع", "Remove branch")}
                            </button>
                          </div>
                        </fieldset>
                      ))}
                      {branchMode === "multiple" ? (
                        <button
                          type="button"
                          className={studioStyles.ghostBtn}
                          onClick={addBranch}
                        >
                          {t("إضافة فرع", "Add branch")}
                        </button>
                      ) : null}
                      {filledBranches.length > 0 ? (
                        <button type="button" className={studioStyles.ghostBtn} onClick={() => setEditingBranches(false)}>
                          {t("طيّ الفروع", "Collapse branches")}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {errors.length ? (
              <p className={studioStyles.error} role="alert">
                {t(
                  "راجع الحقول المطلوبة وصحة الهاتف، وتأكد من عدم تكرار اسم الفرع ومدينته.",
                  "Check required fields and the phone number; branch name and city pairs must be unique.",
                )}
              </p>
            ) : null}

            <button
              type="button"
              className={studioStyles.primary}
              onClick={() => openLocalPlans()}
              disabled={!draft.hydrated}
              data-setup-continue="true"
              data-setup-review-action="true"
              data-setup-destination="plans"
            >
              {t("التالي: قابل فريقك", "Next: Meet your team")}
              <span aria-hidden="true"><StudioIcon kind="arrow" forward={ar ? "left" : "right"} /></span>
            </button>
            </div>
          </fieldset>
          </div>
      </div>
      ) : activeJourney && planSnap ? (
          <>
            <SetupJourneyStepper ar={ar} activeStep={2} className={studioStyles.steps} />
            <SetupTeamPlans
              ar={ar}
              state={planSnap}
              onSelect={onSelect}
              onTerm={onTerm}
              onBack={onBack}
              onContinue={onContinue}
              readPlan={activeJourney.readPlan}
              presentAddons={activeJourney.presentAddons}
              motionEnabled={motionEnabled}
              initialBranchIndex={planBranchFocus}
            />
            {phase === "review" && <SetupPaymentDialog
              qaPreparation={preparedValue}
              ar={ar}
              checkoutNotice={checkoutNotice}
              slots={planSnap.slots}
              term={planSnap.term}
              write={planSnap.write}
              editingLocked={planSnap.editingLocked}
              actor={{ accountId: planSnap.accountId, captureToken: planSnap.captureToken }}
              consentAccepted={planSnap.consentAccepted}
              onConsentChange={reviewConsent}
              confirmReview={reviewConfirm}
              retrySameOperation={() => reviewConfirm(true)}
              onEditBranch={reviewBack}
              onBackToPlans={() => reviewBack()}
              motionEnabled={motionEnabled}
              isCurrent={actorNow}
            />}
          </>
        ) : null}


    </div>
  );
}

/** Background sync is silent when local recovery is safe; actionable failures remain visible. */
function AccountPrepDraftStatus({draft,ar}:{draft:ReturnType<typeof useAccountPrepDraft>;ar:boolean}){
 if(draft.saveStatus!=='fail' || (draft.code==='UNAVAILABLE' && draft.localSaved))return null;
 const conflict=draft.code==='CONFLICT';
 const message=conflict
  ?(ar?'تغيّرت المسودة في مكان آخر. أعد تحميل النسخة المحفوظة وراجعها.':'The draft changed elsewhere. Reload and review the saved version.')
  :draft.localSaved
   ?(ar?'مسودتك محفوظة على هذا الجهاز. تعذّرت المزامنة مؤقتًا؛ يمكنك متابعة التجهيز.':'Your draft is saved on this device. Sync is temporarily unavailable; you can keep editing.')
   :(ar?'تعذّر الحفظ على هذا الجهاز. لا تغلق الصفحة قبل إعادة المحاولة.':'Saving on this device failed. Do not close this page before retrying.');
 return (
  <div role="alert" data-prep-draft-status="fail" className="space-y-2 text-sm" aria-live="polite">
   <p>{message}</p>
   <button
    type="button"
    className="font-semibold underline"
    data-prep-draft-retry={conflict?'reload':'save'}
    onClick={()=>{if(conflict)void draft.reload();else void draft.retrySave();}}
   >
    {conflict?(ar?'إعادة تحميل المسودة المحفوظة':'Reload saved draft'):(ar?'إعادة المحاولة':'Retry')}
   </button>
  </div>
 );
}
