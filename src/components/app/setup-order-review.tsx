"use client";

import { SetupJourneyStepper } from "./setup-journey-stepper";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { SubscriptionPersona } from "@/components/app/subscription-offers-view";
import type { BranchSlotChoice, SetupPlanConfirmResult, SetupPlanWrite } from "@/components/app/setup-plan-journey";
import type { SubscriptionTerm } from "@/components/app/subscription-offers-view";
import {
  PERSONA_NAMES,
  PERSONA_POSTERS,
  PERSONA_VIDEOS,
  TIER_NAMES,
  FAILURE_COPY,
  actorKey,
  branchCountLabel,
  buildReviewModel,
  channelsLabel,
  classifyFailure,
  createLiveCell,
  createMotionBudget,
  createMotionController,
  createReviewController,
  formatCount,
  formatOmr,
  seatsLabel,
  type ReviewModel,
  type ReviewRow,
} from "./setup-order-review-model";
import styles from "./setup-order-review.module.css";

export type SetupOrderReviewProps = {
  /** Arabic (RTL) when true, English (LTR) otherwise. */
  ar: boolean;
  /** Journey snapshot.slots (labels stay local; never sent anywhere from here). */
  slots: readonly BranchSlotChoice[];
  /** Journey snapshot.term. */
  term: SubscriptionTerm | null;
  /** Journey snapshot.write. Drives inflight / unknown / denied / unpaid. */
  write: SetupPlanWrite;
  /** Journey snapshot.editingLocked. */
  editingLocked?: boolean;
  /** Authenticated capture of the journey (snapshot.accountId / captureToken). A change discards pending results. */
  actor: { accountId: string; captureToken: string };
  /** Controlled consent (snapshot.consentAccepted). Omit for internal state that starts false. */
  consentAccepted?: boolean;
  /** Called on every checkbox change. A controlled host should call journey.setConsent. */
  onConsentChange?: (accepted: boolean) => void;
  /** Explicit binding: journey.confirmReview. Never called on mount; called once per click. */
  confirmReview: (consentAccepted: boolean) => Promise<SetupPlanConfirmResult>;
  /**
   * Retry of the SAME operation after UNKNOWN (journey reuses the stored clientOpId/selection when
   * write.kind === "unknown"). Bind to () => journey.confirmReview(true). Omit to show no retry action.
   */
  retrySameOperation?: () => Promise<SetupPlanConfirmResult>;
  /** Fired once with the server result when an order was created (UNPAID, service not ready). */
  onConfirmed?: (result: Extract<SetupPlanConfirmResult, { ok: true }>) => void;
  onEditBranch: (index: number) => void;
  onBackToPlans: () => void;
  /** Motion toggle for the persona figures. Default true; motion still needs no reduced-motion preference and viewport presence. */
  motionEnabled?: boolean;
  /** Existing terms route. Default "/terms" (src/app/terms). Pass null to render the text without a link. */
  termsHref?: string | null;
};

type Local =
  | { kind: "none" }
  | { kind: "failed"; code: string; outcome: "UNKNOWN" | "FAILED"; clientOpId: string | null }
  | { kind: "created"; reference: string; result: Extract<SetupPlanConfirmResult, { ok: true }> };

export type Phase = "ready" | "confirming" | "unknown" | "created" | "failed" | "switched";

const T = {
  title: { ar: "راجع تفاصيل اشتراكك", en: "Review your subscription" },
  subtitle: { ar: "راجع اختياراتك قبل الانتقال للدفع.", en: "Check your choices before continuing to payment." },
  detailsTitle: { ar: "تفاصيل الاشتراك", en: "Subscription details" },
  detailsSub: { ar: "فيما يلي الفروع والباقة التي اخترتها.", en: "These are the branches and plans you chose." },
  edit: { ar: "تعديل", en: "Edit" },
  monthly: { ar: "شهرياً", en: "per month" },
  yearly: { ar: "سنوياً", en: "per year" },
  omr: { ar: "ر.ع", en: "OMR" },
  repliesPerMonth: { ar: "رد شهرياً", en: "replies per month" },
  featuresTitle: { ar: "مميزات الباقة", en: "Plan features" },
  termLabel: { ar: "المدة", en: "Term" },
  termMonthly: { ar: "شهرية", en: "Monthly" },
  termYearly: { ar: "سنوية", en: "Yearly" },
  summaryTitle: { ar: "ملخص الطلب", en: "Order summary" },
  totalMonthly: { ar: "الإجمالي الشهري", en: "Monthly total" },
  totalYearly: { ar: "الإجمالي السنوي", en: "Yearly total" },
  unpaid: { ar: "لم يتم الدفع", en: "Not paid" },
  consentPre: { ar: "أوافق على ", en: "I agree to the " },
  consentLink: { ar: "شروط الاشتراك", en: "subscription terms" },
  confirm: { ar: "المتابعة للدفع", en: "Continue to payment" },
  confirming: { ar: "جارٍ التحقق من توفر الدفع…", en: "Checking payment availability…" },
  back: { ar: "العودة للباقات", en: "Back to plans" },
  infoTitle: { ar: "الدفع الإلكتروني غير متاح حالياً", en: "Online payment is not available right now" },
  infoBody: { ar: "اختياراتك محلية ولم يبدأ الدفع. يمكنك إدخالها مجددًا إذا أُغلق المتصفح.", en: "Your choices stay local and payment has not started. You can enter them again if the browser closes." },
  incomplete: {
    ar: "اختياراتك غير مكتملة. ارجع إلى الباقات لاختيار باقة ومدة لكل فرع.",
    en: "Your choices are incomplete. Go back to the plans to pick a plan and term for every branch.",
  },
  notChosen: { ar: "لم تُختر باقة", en: "No plan chosen" },
  switched: {
    ar: "تغيّر الحساب. أُهملت أي نتيجة سابقة. إن كانت هناك عملية قيد التنفيذ فلم يتأكد ناتجها وقد يكون الطلب قد أُنشئ بالفعل. لا تنشئ طلباً جديداً قبل التحقق من الحالة.",
    en: "The account changed. Any earlier result was discarded. If an operation was in progress, its outcome is not confirmed and the order may already exist. Do not create a new order before checking the status.",
  },
  priceOrder: { ar: "المبالغ من الطلب المؤكد في الخادم.", en: "Amounts are from the confirmed server order." },
  pricePreview: { ar: "معاينة الباقات؛ يؤكد الخادم المبلغ عند بدء الدفع.", en: "Plan preview; the server validates the amount at payment initiation." },
  unknownTitle: { ar: "لم يتأكد لنا ناتج العملية", en: "We could not confirm the outcome" },
  unknownBody: {
    ar: "قد يكون الطلب قد أُنشئ بالفعل. لا تنشئ طلباً جديداً؛ تحقق من الحالة بنفس العملية.",
    en: "The order may already exist. Do not create a new one; check the status of the same operation.",
  },
  unknownRetry: { ar: "التحقق من حالة الطلب", en: "Check order status" },
  createdTitle: { ar: "تم إنشاء الطلب", en: "Order created" },
  createdBody: { ar: "الطلب غير مدفوع والخدمة غير مفعّلة بعد.", en: "The order is unpaid and the service is not active yet." },
  reference: { ar: "مرجع الطلب", en: "Order reference" },
  branchAria: { ar: "تعديل الفرع", en: "Edit branch" },
} as const;

type Key = { ar: string; en: string };
const tx = (ar: boolean, k: Key) => (ar ? k.ar : k.en);

function PinIcon() {
  return (
    <svg className={styles.pin} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function priceText(ar: boolean, row: ReviewRow, term: SubscriptionTerm) {
  return `${formatOmr(row.amountBaisa)} ${tx(ar, T.omr)} ${tx(ar, term === "yearly" ? T.yearly : T.monthly)}`;
}

function PlanLabel({ ar, row }: { ar: boolean; row: ReviewRow }) {
  return <>{`${tx(ar, PERSONA_NAMES[row.persona])} • ${tx(ar, TIER_NAMES[row.package])}`}</>;
}

/**
 * Persona figure: static poster by default (also for reduced motion, offscreen, loading, error, toggle off).
 * The approved original mp4 is mounted only while playing (visible, no reduced-motion, page visible) and is
 * unloaded again on pause/unmount. Muted, inline, looping, no controls/frame; full figure with object-fit contain.
 */
const reviewMotionBudget = createMotionBudget(2);

function StatIcon({ kind }: { kind: "messages" | "people" | "channels" }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {kind === "messages" ? <path d="M20 11a8 8 0 0 1-8 8H5l-3 3 1-7a8 8 0 1 1 17-4Z" /> : kind === "people" ? <><circle cx="9" cy="7" r="3" /><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a3 3 0 0 1 0 6M19 14a6 6 0 0 1 3 5v2" /></> : <><circle cx="5" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8 10 7-4M8 14l7 4" /></>}
  </svg>;
}

function PersonaFigure({ persona, alt, enabled }: { persona: SubscriptionPersona; alt: string; enabled: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof createMotionController> | null>(null);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof window === "undefined") return;
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const controller = createMotionController(
      {
        budget: reviewMotionBudget,
        reducedQuery: query,
        createObserver:
          typeof window.IntersectionObserver === "function"
            ? (cb) => {
                const io = new window.IntersectionObserver(
                  (entries) => {
                    const last = entries[entries.length - 1];
                    if (last) cb(last.isIntersecting);
                  },
                  { threshold: 0.25 },
                );
                return { observe: (el) => io.observe(el as Element), disconnect: () => io.disconnect() };
              }
            : null,
        isPageVisible: () => document.visibilityState !== "hidden",
        subscribeVisibility: (cb) => {
          document.addEventListener("visibilitychange", cb);
          return () => document.removeEventListener("visibilitychange", cb);
        },
      },
      enabled,
      setPlay,
    );
    controllerRef.current = controller;
    controller.observe(box);
    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- environment is built once per mount; `enabled` is pushed below
  }, []);

  useEffect(() => {
    controllerRef.current?.setEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    if (!play) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    video.muted = true;
    video.setAttribute("src", PERSONA_VIDEOS[persona]);
    video.load();
    const started = video.play();
    if (started && typeof started.catch === "function") started.catch(() => { if (!cancelled) controllerRef.current?.reportError(); });
    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [play, persona]);

  return (
    <div className={styles.figure} ref={boxRef} data-role="persona-figure" data-media-format={persona === "level_1" ? "original-plate" : "alpha"} data-motion={play ? "playing" : "poster"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- approved static poster, contain, uncropped */}
      <img src={PERSONA_POSTERS[persona]} alt={alt} width={692} height={388} decoding="async" loading="lazy" />
      {play ? (
        <video
          ref={videoRef}
          className={styles.motion}
          src={PERSONA_VIDEOS[persona]}
          poster={PERSONA_POSTERS[persona]}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload noremoteplayback nofullscreen"
          onPlaying={(event) => { event.currentTarget.dataset.playing = "true"; }}
          onEmptied={(event) => { event.currentTarget.dataset.playing = "false"; }}
          onError={() => controllerRef.current?.reportError()}
        />
      ) : null}
    </div>
  );
}
(PersonaFigure as unknown as { hooks: boolean }).hooks = true;

export type ViewProps = {
  ar: boolean;
  model: ReviewModel;
  slots: readonly BranchSlotChoice[];
  phase: Phase;
  consent: boolean;
  /** Edit/back/confirm interaction is closed (busy, unknown, created, locked or switched). */
  locked: boolean;
  failureCode: string | null;
  /** The outcome may have reached the server (UNKNOWN / STALE_CAPTURE after start). Same operation id is kept by the host. */
  outcomeUnknown?: boolean;
  motionEnabled?: boolean;
  reference: string | null;
  canRetry: boolean;
  termsHref: string | null;
  ids: { title: string; consent: string; status: string };
  onConsent: (accepted: boolean) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onEdit: (index: number) => void;
  onBack: () => void;
};

/** Hook-free presentation. Exported for tests. */
export function SetupOrderReviewView(p: ViewProps) {
  const { ar, model, phase } = p;
  const term = model.term;
  const yearly = term === "yearly";
  const busy = phase === "confirming";
  const confirmable = phase === "ready" && model.complete && p.consent && !p.locked;
  const showConfirm = phase === "ready" || phase === "confirming" || phase === "failed";
  const failureKind = p.failureCode ? classifyFailure(p.failureCode) : null;

  let statusNode: ReactNode = null;
  if (phase === "switched") {
    statusNode = <p className={styles.statusError} data-role="status-switched">{tx(ar, T.switched)}</p>;
  } else if (phase === "created") {
    statusNode = (
      <div className={styles.statusOk} data-role="status-created">
        <strong>{tx(ar, T.createdTitle)}</strong>
        <span>{tx(ar, T.createdBody)}</span>
        {p.reference ? (
          <span>
            {tx(ar, T.reference)}: <bdi dir="ltr" data-role="order-reference">{p.reference}</bdi>
          </span>
        ) : null}
      </div>
    );
  } else if (phase === "unknown") {
    statusNode = (
      <div className={styles.statusWarn} data-role="status-unknown">
        <strong>{tx(ar, T.unknownTitle)}</strong>
        <span>{tx(ar, T.unknownBody)}</span>
        {p.canRetry ? (
          <button type="button" className={styles.secondary} data-action="retry" onClick={p.onRetry}>
            {tx(ar, T.unknownRetry)}
          </button>
        ) : null}
      </div>
    );
  } else if (phase === "confirming") {
    statusNode = <p className={styles.statusInfo} data-role="status-confirming">{tx(ar, T.confirming)}</p>;
  } else if (!model.complete) {
    statusNode = <p className={styles.statusError} data-role="status-incomplete">{tx(ar, T.incomplete)}</p>;
  } else if (phase === "failed" && failureKind && failureKind !== "unknown") {
    statusNode = <p className={styles.statusError} data-role="status-error">{tx(ar, FAILURE_COPY[failureKind])}</p>;
  }

  return (
    <section className={styles.page} dir={ar ? "rtl" : "ltr"} lang={ar ? "ar" : "en"} aria-labelledby={p.ids.title} data-order-review="true">
      <SetupJourneyStepper ar={ar} activeStep={3} className={styles.stepper} />

      <header className={styles.head}>
        <h1 id={p.ids.title}>{tx(ar, T.title)}</h1>
        <p>{tx(ar, T.subtitle)}</p>
      </header>

      <div className={styles.mobileTeam} data-role="mobile-persona-gallery" aria-hidden="true">
        {[...new Set(model.rows.map((row) => row.persona))].map((persona) => (
          <PersonaFigure key={persona} persona={persona} alt="" enabled={p.motionEnabled !== false} />
        ))}
      </div>

      <div className={styles.layout}>
        <section className={styles.card} aria-labelledby={`${p.ids.title}-details`}>
          <h2 id={`${p.ids.title}-details`}>{tx(ar, T.detailsTitle)}</h2>
          <p className={styles.muted}>{tx(ar, T.detailsSub)}</p>
          <ul className={styles.branches} data-role="branch-list">
            {p.slots.map((slot, index) => {
              const row = model.rows.find((r) => r.index === index);
              return (
                <li key={index} className={styles.branch} data-role="branch-row" data-index={index}>
                  {row ? (
                    <PersonaFigure persona={row.persona} alt={tx(ar, PERSONA_NAMES[row.persona])} enabled={p.motionEnabled !== false} />
                  ) : (
                    <div className={styles.figure} />
                  )}
                  <div className={styles.branchBody}>
                    <div className={styles.branchTop}>
                      <div className={styles.branchTitle}>
                        <h3>
                          <PinIcon />
                          <span>{slot.label.name}</span>
                        </h3>
                        <p className={styles.muted}>
                          {row ? <PlanLabel ar={ar} row={row} /> : tx(ar, T.notChosen)}
                          {slot.label.city ? ` · ${slot.label.city}` : ""}
                        </p>
                        {slot.label.contactPhone ? <p className={styles.muted} data-role="branch-contact-phone"><bdi dir="ltr">{slot.label.contactPhone}</bdi></p> : null}
                      </div>
                      <button
                        type="button"
                        className={styles.editLink}
                        data-action="edit"
                        disabled={p.locked}
                        aria-label={`${tx(ar, T.branchAria)} ${slot.label.name}`}
                        onClick={() => p.onEdit(index)}
                      >
                        {tx(ar, T.edit)}
                        <span aria-hidden="true" className={styles.arrow}>{ar ? "←" : "→"}</span>
                      </button>
                    </div>
                    {row && term ? (
                      <>
                        <p className={styles.chip} data-role="branch-price">{priceText(ar, row, term)}</p>
                        <ul className={styles.stats}>
                          <li aria-label={`${formatCount(row.plan.replies)} ${tx(ar, T.repliesPerMonth)}`}>
                            <span className={styles.statIcon}><StatIcon kind="messages" /></span>
                            <strong>{formatCount(row.plan.replies)}</strong><span>{tx(ar, T.repliesPerMonth)}</span>
                          </li>
                          <li aria-label={seatsLabel(row.plan.employees, ar)}>
                            <span className={styles.statIcon}><StatIcon kind="people" /></span>
                            <strong>{row.plan.employees}</strong><span>{ar ? "مقاعد للموظفين" : "staff seats"}</span>
                          </li>
                          <li aria-label={channelsLabel(row.plan.channels, ar)}>
                            <span className={styles.statIcon}><StatIcon kind="channels" /></span>
                            <strong>{row.plan.channels}</strong><span>{ar ? "قنوات تواصل" : "channels"}</span>
                          </li>
                        </ul>
                        {row.plan.features.length ? (
                          <div className={styles.offerFeatures} data-role="offer-features" data-source={model.source}>
                            <p className={styles.offerFeaturesTitle}>{tx(ar, T.featuresTitle)}</p>
                            <ul>
                              {row.plan.features.map((feature) => (
                                <li key={feature.id} data-feature={feature.id}>
                                  {ar ? feature.label.ar : feature.label.en}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className={styles.footStrip}>
            <span>
              {tx(ar, T.termLabel)}: <strong data-role="term-label">{term ? tx(ar, yearly ? T.termYearly : T.termMonthly) : "—"}</strong>
            </span>
            <span data-role="branch-count">{branchCountLabel(model.branchCount, ar)}</span>
          </div>
        </section>

        <aside className={styles.card} aria-labelledby={`${p.ids.title}-summary`}>
          <h2 id={`${p.ids.title}-summary`}>{tx(ar, T.summaryTitle)}</h2>
          <ul className={styles.summaryRows}>
            {model.rows.map((row) => (
              <li key={row.index} data-role="summary-row">
                <span className={styles.avatar} aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element -- decorative face crop, small circle only */}
                  <img src={PERSONA_POSTERS[row.persona]} alt="" width={692} height={388} loading="lazy" decoding="async" />
                </span>
                <span className={styles.summaryName}>
                  <strong>{row.name}</strong>
                  <small><PlanLabel ar={ar} row={row} /></small>
                </span>
                <span className={styles.summaryPrice} data-role="summary-price">
                  {term ? `${formatOmr(row.amountBaisa)} ${tx(ar, T.omr)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.total}>
            <span>{tx(ar, yearly ? T.totalYearly : T.totalMonthly)}</span>
            <p data-role="total">
              <bdi dir="ltr" className={styles.totalNum}>{formatOmr(model.totalBaisa)}</bdi> <span>{tx(ar, T.omr)}</span>
            </p>
            <span className={styles.badge} data-role="unpaid-badge">{tx(ar, T.unpaid)}</span>
            <small className={styles.muted} data-role="price-source" data-source={model.source}>
              {tx(ar, model.source === "order" ? T.priceOrder : T.pricePreview)}
            </small>
          </div>

          {showConfirm ? (
            <label className={styles.consent} htmlFor={p.ids.consent}>
              <input
                id={p.ids.consent}
                type="checkbox"
                checked={p.consent}
                disabled={p.locked}
                onChange={(e: ChangeEvent<HTMLInputElement>) => p.onConsent(e.target.checked)}
                data-role="consent"
              />
              <span>
                {tx(ar, T.consentPre)}
                {p.termsHref ? (
                  <a href={p.termsHref} target="_blank" rel="noopener noreferrer" data-role="terms-link">{tx(ar, T.consentLink)}</a>
                ) : (
                  <span data-role="terms-text">{tx(ar, T.consentLink)}</span>
                )}
              </span>
            </label>
          ) : null}

          <div id={p.ids.status} className={styles.live} role="status" aria-live="polite" aria-atomic="true">
            {statusNode}
          </div>

          {showConfirm ? (
            <button
              type="button"
              className={styles.primary}
              data-action="confirm"
              disabled={!confirmable}
              aria-disabled={!confirmable}
              aria-busy={busy}
              onClick={p.onConfirm}
            >
              {busy ? tx(ar, T.confirming) : tx(ar, T.confirm)}
            </button>
          ) : null}
          <button type="button" className={styles.secondary} data-action="back" disabled={p.locked} onClick={p.onBack}>
            {tx(ar, T.back)}
          </button>

          <div className={styles.info} data-role="payment-info">
            <strong>{tx(ar, T.infoTitle)}</strong>
            <span>{tx(ar, T.infoBody)}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function SetupOrderReview(props: SetupOrderReviewProps) {
  const { ar, slots, term, write, actor } = props;
  const ids = { title: useId(), consent: useId(), status: useId() };
  const key = actorKey(actor);
  const [mountedKey] = useState(key);
  const [innerConsent, setInnerConsent] = useState(false);
  const [local, setLocal] = useState<Local>({ kind: "none" });
  const [busy, setBusy] = useState(false);

  const switched = mountedKey !== key;
  const orderOffer = local.kind === "created" ? local.result.order.offer : write.kind === "unpaid" ? write.order.offer : null;
  const model = buildReviewModel(slots, term, orderOffer);
  const consentValue = props.consentAccepted ?? innerConsent;
  const consent = consentValue && !switched;

  // Latest values for async/retained callbacks. The cell is synced synchronously during render (before any
  // effect) so a retained handler or a pending await can never observe a stale actor; `mounted` is flipped
  // by effects only. Kept in a plain cell object (not a ref) on purpose: this is the live source of truth.
  const [cell] = useState(() => createLiveCell<SetupOrderReviewProps>(props, key));
  cell.sync(props, key, consent, model.complete);
  const [controller] = useState(() =>
    createReviewController<SetupPlanConfirmResult>({
      live: () => cell.live,
      emit: (event) => {
        if (event.type === "busy") setBusy(true);
        else if (event.type === "created") {
          setBusy(false);
          setLocal({ kind: "created", reference: event.result.order.specialReference, result: event.result });
        } else {
          setBusy(false);
          setLocal({ kind: "failed", code: event.code, outcome: event.outcome, clientOpId: event.clientOpId });
        }
      },
      onConfirmed: (result) => cell.props.onConfirmed?.(result),
      currentOpId: () => {
        const w = cell.props.write;
        return w.kind === "idle" ? undefined : w.clientOpId;
      },
    }),
  );

  useEffect(() => {
    cell.setMounted(true);
    return () => cell.setMounted(false);
  }, [cell]);

  /** Live preflight shared by every handler: this render's actor must still be the live, mounted one. */
  function liveFor(handlerKey: string) {
    const live = cell.live;
    return live.mounted && live.key === handlerKey && handlerKey === mountedKey;
  }

  function setConsent(next: boolean) {
    if (!liveFor(key)) return;
    if (props.consentAccepted === undefined) setInnerConsent(next);
    cell.props.onConsentChange?.(next);
  }

  function onConfirm() {
    if (!liveFor(key) || controller.isBusy()) return;
    const live = cell.live;
    if (!live.complete || !live.consent || cell.props.write.kind === "inflight") return;
    void controller.start(key, () => {
      // Re-checked synchronously right before the bound callback fires.
      if (!liveFor(key)) return Promise.reject(new Error("stale"));
      return cell.props.confirmReview(true);
    });
  }

  function onRetry() {
    if (!liveFor(key) || controller.isBusy()) return;
    if (!cell.props.retrySameOperation) return;
    void controller.start(key, () => {
      const retry = cell.props.retrySameOperation;
      if (!liveFor(key) || !retry) return Promise.reject(new Error("stale"));
      return retry();
    });
  }

  let phase: Phase = "ready";
  let failureCode: string | null = null;
  let outcomeUnknown = false;
  let reference: string | null = null;
  if (switched) phase = "switched";
  else if (local.kind === "created") {
    phase = "created";
    reference = local.reference;
  } else if (write.kind === "unpaid") {
    phase = "created";
    reference = write.order.specialReference;
  } else if (busy || write.kind === "inflight") phase = "confirming";
  else if (local.kind === "failed") {
    failureCode = local.code;
    outcomeUnknown = local.outcome === "UNKNOWN";
    phase = local.code === "UNKNOWN" ? "unknown" : "failed";
  } else if (write.kind === "unknown") {
    phase = "unknown";
    outcomeUnknown = true;
  } else if (write.kind === "denied") {
    failureCode = write.code;
    phase = write.code === "UNKNOWN" ? "unknown" : "failed";
    outcomeUnknown = write.code === "UNKNOWN" || write.code === "STALE_CAPTURE";
  }
  // A session-class failure blocks confirm until the host rebinds a fresh journey.
  const sessionBlocked = phase === "failed" && !!failureCode && classifyFailure(failureCode) === "session";
  const locked = phase !== "ready" && phase !== "failed" ? true : sessionBlocked || !!props.editingLocked;

  return (
    <SetupOrderReviewView
      ar={ar}
      model={model}
      slots={slots}
      phase={phase}
      consent={consent}
      locked={locked}
      failureCode={failureCode}
      outcomeUnknown={outcomeUnknown}
      motionEnabled={props.motionEnabled !== false}
      reference={reference}
      canRetry={phase === "unknown" && !!props.retrySameOperation && !busy}
      termsHref={props.termsHref === undefined ? "/terms" : props.termsHref}
      ids={ids}
      onConsent={setConsent}
      onConfirm={onConfirm}
      onRetry={onRetry}
      onEdit={(i) => {
        if (!locked && liveFor(key)) cell.props.onEditBranch(i);
      }}
      onBack={() => {
        if (!locked && liveFor(key)) cell.props.onBackToPlans();
      }}
    />
  );
}
