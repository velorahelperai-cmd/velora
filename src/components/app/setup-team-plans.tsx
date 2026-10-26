"use client";

import { useEffect, useId, useRef, useState } from "react";
import { annualDiscountPercent, commercialAmount } from "@/components/app/subscription-commercial-catalog";
import type { SetupPlanJourney, SetupPlanJourneySnapshot } from "@/components/app/setup-plan-journey";
import type { SubscriptionFeatureView, SubscriptionPersona } from "@/components/app/subscription-offers-view";
import styles from "./setup-team-plans.module.css";

export type SetupTeamPlansProps = {
  initialBranchIndex?: number;
  ar: boolean;
  state: SetupPlanJourneySnapshot;
  onSelect: SetupPlanJourney["setSlot"];
  onTerm: SetupPlanJourney["setTerm"];
  onBack: SetupPlanJourney["backToPreparation"];
  onContinue: SetupPlanJourney["localReview"];
  readPlan: SetupPlanJourney["readPlan"];
  presentAddons: SetupPlanJourney["presentAddons"];
  /** Header motion toggle. Reduced motion still forces the static poster. */
  motionEnabled?: boolean;
  /** Optional published catalog readiness overlay (A11 feature_availability projection). */
  featureAvailability?: Readonly<Record<string, SubscriptionFeatureView["availability"]>>;
};

/** Dana/Lina alpha exports match the previously verified named GIF identities.
 * Noura retains her original source until a full-body alpha identity is confirmed. */
const PEOPLE = [
  {
    id: "level_1" as const,
    ar: "نورا",
    en: "Noura",
    roleAr: "تستقبل استفسارات عملائك وتساعد فريقك على تنظيم خدمة العملاء",
    roleEn: "Answers customer questions and helps your team organize service",
    video: "/media/setup/noura-studio.mp4",
    poster: "/media/setup/noura-studio-poster.png",
  },
  {
    id: "level_2" as const,
    ar: "لينا",
    en: "Lina",
    roleAr: "تفهم احتياجات العملاء وتساعد فريقك على متابعة فرص البيع",
    roleEn: "Understands what customers need and helps your team follow sales",
    video: "/media/setup/lina-team-alpha.webm",
    poster: "/media/setup/lina-team-alpha-poster.png",
  },
  {
    id: "level_3" as const,
    ar: "دانا",
    en: "Dana",
    roleAr: "تنظّم طلبات العملاء وتساعد فريقك على متابعة التنفيذ",
    roleEn: "Organizes customer requests and helps your team follow the work",
    video: "/media/setup/dana-team-alpha.webm",
    poster: "/media/setup/dana-team-alpha-poster.png",
  },
];

const PERSONA_ROLES = {
  level_1: { ar: "خدمة العملاء", en: "Customer service" },
  level_2: { ar: "فرص البيع والمتابعة", en: "Sales and follow-up" },
  level_3: { ar: "الطلبات والتشغيل", en: "Orders and operations" },
};
const EXAMPLE_QUESTIONS = {
  level_1: { ar: "ما تفاصيل الخدمة وسعرها؟", en: "What are the service details and price?" },
  level_2: { ar: "أي خدمة تناسب احتياجي؟", en: "Which service fits my needs?" },
  level_3: { ar: "كيف أتابع طلبي؟", en: "How can I follow my request?" },
};

const SCENARIO_TITLES = {
  level_1: [
    { ar: "إجابة وتسجيل الاستفسار", en: "Answer and record" },
    { ar: "توجيه ومتابعة حالة", en: "Route a case" },
    { ar: "فهم رسالة صوتية", en: "Voice-message allowance" },
  ],
  level_2: [
    { ar: "فهم الاحتياج وعرض خدمة", en: "Explore a need" },
    { ar: "متابعة سلة متروكة", en: "Cart follow-up" },
    { ar: "مكالمات مستقبلية", en: "Future calls" },
  ],
  level_3: [
    { ar: "متابعة طلب العميل", en: "Track a request" },
    { ar: "تنبيه ومتابعة التأخير", en: "Delay follow-up" },
    { ar: "متابعة عربون مسجل", en: "Deposit status" },
  ],
};

const SCENARIOS: Record<SubscriptionPersona, { mark: "standard" | "premium" | "addon"; ar: string; en: string }[]> = {
  level_1: [
    {
      mark: "standard",
      ar: "عميل يسأل عن خدمة وسعرها وسياسة النشاط. توضّح نورا المعلومات المعتمدة، وتسجّل الاستفسار أو تحوّله للفريق عند الحاجة.",
      en: "A customer asks about a service, its price, and the business policy. Noura explains the approved information and records the question or hands it to the team.",
    },
    {
      mark: "premium",
      ar: "استفسار يحتاج متابعة فرع. تصنّف نورا الحالة وتوجّهها للفريق وتجهّز ملخصًا. هذا شرح للتوجيه وتتبع الحالة، وليس إغلاقًا آليًا.",
      en: "A question needs one branch to follow it. Noura classifies the case, routes it, and prepares a summary. This explains routing, not automatic closure.",
    },
    {
      mark: "addon",
      ar: "رسالة صوتية تُشرح فقط ضمن إضافة فهم الرسائل الصوتية بحصة منفصلة. ليست ضمن Standard، ولا تعني أن قناة متصلة الآن.",
      en: "A voice message is explained only with the separate voice-message allowance. It is not part of Standard and does not show a connected channel.",
    },
  ],
  level_2: [
    {
      mark: "standard",
      ar: "عميل محتار بين خدمتين. تسأل لينا عن احتياجه، تقترح الأنسب من المعلومات المعتمدة، وتسجّل طلب عرض سعر للفريق. ليس تحصيلًا.",
      en: "A customer is choosing between two services. Lina asks what they need, suggests from approved information, and records a quote request for the team. No money is collected.",
    },
    {
      mark: "premium",
      ar: "عميل ترك سلته. تُشرح متابعة السلة فقط عند ربط المتجر وضمن الصلاحيات المحددة. المثال لا يشغّل استعادة السلال.",
      en: "A customer left a cart. Cart follow-up is explained only when a store is connected and within that permission. This example does not run cart recovery.",
    },
    {
      mark: "addon",
      ar: "إضافة مكالمات لاحقة، غير جاهزة للبيع: الطلب يوضح موعدًا لتأكيد الفريق. لا حجز نهائي، ولم تجرِ مكالمة في هذه المعاينة.",
      en: "A future phone-call add-on, not ready for sale: the example records an appointment for the team to confirm. No final booking and no live call.",
    },
  ],
  level_3: [
    {
      mark: "standard",
      ar: "عميل يسأل عن طلبه أو يريد تعديله. تعرض دانا الحالة من تحديث الفريق وتستقبل طلب التعديل للمراجعة. ليس إلغاءً نهائيًا.",
      en: "A customer asks about an order or a change. Dana shows the team’s update and records the change request for review. It is not a final cancellation.",
    },
    {
      mark: "premium",
      ar: "طلب يحتاج فرعًا آخر وتأخّر. يشرح المثال توزيع العمل والتنبيه وتقرير التشغيل، دون ادّعاء تكامل تشغيلي يعمل الآن.",
      en: "An order needs another branch and is late. The example explains assignment, a delay alert, and an operations report, not a live operations integration.",
    },
    {
      mark: "addon",
      ar: "إضافة الدفع منفصلة: متابعة العربون توضّح حالة موثّقة وتوجّه الغموض للفريق. ليست تحصيلًا ولا إثبات سداد.",
      en: "The payment add-on is separate: deposit follow-up explains a recorded status and sends uncertainty to the team. It does not collect money or prove payment.",
    },
  ],
};

function omr(baisa: number) {
  const major = baisa / 1000;
  return Number.isInteger(major) ? String(major) : major.toFixed(3);
}

/** One mounted video owns one playback result; gates/key reset its lifetime. */
function TeamPersonaPlayback({ video, poster, label }: { video: string; poster: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"pending" | "playing" | "blocked">("pending");

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    let cancelled = false;
    node.muted = true;
    node.defaultMuted = true;
    node.setAttribute("src", video);
    node.load();
    void node.play().then(() => {
      if (!cancelled) setStatus("playing");
    }).catch(() => {
      if (!cancelled) {
        setStatus("blocked");
        node.pause();
      }
    });
    return () => {
      cancelled = true;
      node.pause();
      node.removeAttribute("src");
      try { node.load(); } catch { /* detach best-effort */ }
    };
  }, [video]);

  return <>
    {status !== "playing" ? (
      // eslint-disable-next-line @next/next/no-img-element -- original static first frame
      <img className={styles.media} src={poster} alt="" decoding="async" data-team-poster="static" />
    ) : null}
    <video ref={videoRef} className={styles.media} muted playsInline loop controls={false}
      disablePictureInPicture aria-label={label} data-team-video="motion"
      style={status === "blocked" ? { opacity: 0, pointerEvents: "none" } : undefined} />
  </>;
}

function TeamPersonaMotion({
  video,
  poster,
  label,
  motionEnabled,
}: {
  video: string;
  poster: string;
  label: string;
  motionEnabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [inView, setInView] = useState(true);
  const [visibleDoc, setVisibleDoc] = useState(true);
  const [criticalDone, setCriticalDone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setVisibleDoc(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.2 });
    io.observe(host);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
    let cancelled = false;
    let outer = 0;
    let inner = 0;
    outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        if (!cancelled) setCriticalDone(true);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, []);

  const allowMotion = motionEnabled && !reducedMotion && inView && visibleDoc;
  const attachVideo = allowMotion && criticalDone;

  return (
    <div ref={hostRef} className={styles.stage}>
      {attachVideo ? <TeamPersonaPlayback key={video} video={video} poster={poster} label={label} /> : (
        // eslint-disable-next-line @next/next/no-img-element -- original static first frame, not a generated asset
        <img className={styles.media} src={poster} alt={label} decoding="async" data-team-poster="static" />
      )}
    </div>
  );
}

export function SetupTeamPlans({
  initialBranchIndex = 0,
  ar,
  state,
  onSelect,
  onTerm,
  onBack,
  onContinue,
  readPlan,
  presentAddons,
  motionEnabled = true,
  featureAvailability,
}: SetupTeamPlansProps) {
  const id = useId();
  const [focus, setFocus] = useState<SubscriptionPersona>(state.slots[initialBranchIndex]?.persona ?? "level_1");
  const [branchIndex, setBranchIndex] = useState(initialBranchIndex);
  const [scenario, setScenario] = useState(0);
  const [seamNote, setSeamNote] = useState("");
  const t = (a: string, e: string) => (ar ? a : e);
  const person = PEOPLE.find((item) => item.id === focus) ?? PEOPLE[0]!;
  const activeIndex = state.slots[branchIndex] ? branchIndex : 0;
  const active = state.slots[activeIndex];
  // UI identities are optional on legacy drafts. Only unique nonempty IDs are
  // suitable React keys; purchase choices remain owned by the journey's slots.
  const localIdCounts = new Map<string, number>();
  for (const slot of state.slots) {
    const localId = slot.label.localId;
    if (localId) localIdCounts.set(localId, (localIdCounts.get(localId) ?? 0) + 1);
  }
  const slotKeys = state.slots.map((slot, index) => {
    const localId = slot.label.localId;
    return localId && localIdCounts.get(localId) === 1 ? `local:${localId}` : `legacy:${index}`;
  });
  const basic = readPlan(focus, "basic");
  const premium = readPlan(focus, "premium");
  const sharedFeatureIds = new Set(readPlan("level_1", "basic").features.map((feature) => feature.id));
  const basicHighlights = focus === "level_1" ? basic.features : basic.features.filter((feature) => !sharedFeatureIds.has(feature.id));
  const premiumOnly = premium.features.filter((feature) => !basic.features.some((item) => item.id === feature.id));
  const addons = presentAddons(focus, "premium");
  const stories = SCENARIOS[focus];
  const story = stories[scenario] ?? stories[0]!;
  const selected = state.slots.filter((slot) => slot.persona && slot.package);
  const priced = state.term ? selected.reduce((sum, slot) => sum + commercialAmount(readPlan(slot.persona!, slot.package!), state.term!), 0) : null;
  const ready = state.step === "localReview" && state.preview ? state.preview : null;

  function choose(pack: "basic" | "premium") {
    onSelect(activeIndex, { persona: focus, package: pack });
    setSeamNote("");
  }

  function showBranch(index: number) {
    setBranchIndex(index);
    const slot = state.slots[index];
    if (slot?.persona) {
      setFocus(slot.persona);
      setScenario(0);
    }
  }

  function continueLocal() {
    const result = onContinue();
    if (!result.ok) {
      setSeamNote(
        result.code === "SELECTION_INCOMPLETE" || result.code === "SLOT_COUNT"
          ? t("اختر باقة لكل فرع ومدة واحدة قبل المتابعة. لم يُنشأ أمر.", "Choose a plan for every branch and one term before continuing. No order was created.")
          : t("المراجعة المحلية لم تكتمل. لم يُنشأ أمر.", "Local review is not ready. No order was created."),
      );
      return;
    }
    setSeamNote(
      t(
        "المراجعة المحلية جاهزة. الربط المالي غير مفعّل، ولم يُنشأ أمر ولم يُحصَّل مبلغ.",
        "Local review is ready. Financial confirmation is not connected. No order was created and nothing was collected.",
      ),
    );
  }

  return (
    <section className={styles.page} dir={ar ? "rtl" : "ltr"} data-setup-team-plans="true" data-confirm-wired="false" aria-labelledby={`${id}-title`}>
      <div className={styles.heading}>
        <h2 id={`${id}-title`}>{t("قابل فريقك", "Meet your team")}</h2>
        <p>{t("شاهد مثالًا، ثم اختر من يناسب نشاطك.", "Watch an example, then choose who fits your business.")}</p>
      </div>

      <div className={styles.personas} data-plans-region="personas" role="group" aria-label={t("شخصيات الفريق", "Team characters")}>
        {PEOPLE.map((item) => {
          const focused = item.id === focus;
          const label = `${ar ? item.ar : item.en}. ${ar ? item.roleAr : item.roleEn}`;
          return (
            <button
              key={item.id}
              type="button"
              className={styles.persona}
              aria-pressed={focused}
              data-persona={item.id}
              data-media-format={item.id === "level_1" ? "original-plate" : "alpha"}
              data-preview={focused ? "true" : "false"}
              onClick={() => {
                setFocus(item.id);
                setScenario(0);
              }}
            >
              {focused ? (
                <span className={styles.personaHint} data-persona-hint="true" aria-hidden="true">
                  <span className={styles.personaHintCloud}>
                    {t("اضغط على الشخصية لاختيار الباقة", "Tap a persona to choose the plan")}
                  </span>
                  <span className={styles.personaHintDots}>
                    <span /><span /><span />
                  </span>
                </span>
              ) : null}
              {focused ? (
                <TeamPersonaMotion video={item.video} poster={item.poster} label={label} motionEnabled={motionEnabled} />
              ) : (
                <div className={styles.stage}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- original first-frame poster */}
                  <img className={styles.media} src={item.poster} alt="" data-team-poster="static" />
                </div>
              )}
              <span className={styles.name}>{ar ? item.ar : item.en}</span>
              <span className={styles.role}>{ar ? PERSONA_ROLES[item.id].ar : PERSONA_ROLES[item.id].en}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.panel} data-plans-region="example">
        <h3>{t(`ماذا تنجز ${person.ar}؟`, `What does ${person.en} do?`)}</h3>
        <p>{t("اختر أحد السيناريوهات لمشاهدة مثال توضيحي لقدرات الشخصية.", "Choose a scenario to see an illustrative example of this persona's capabilities.")}</p>
        <div className={styles.scenarioButtons} role="tablist" aria-label={t("أمثلة توضيحية", "Illustrative examples")}>
          {stories.map((item, index) => (
            <button key={item.mark} type="button" role="tab" aria-selected={scenario === index} data-scenario-mark={item.mark} onClick={() => setScenario(index)}>
              <span>{ar ? SCENARIO_TITLES[focus][index]!.ar : SCENARIO_TITLES[focus][index]!.en}</span>
              <small>{item.mark === "standard" ? t("القياسية", "Standard") : item.mark === "premium" ? t("المميزة", "Premium") : t("إضافة مشروطة", "Conditional add-on")}</small>
            </button>
          ))}
        </div>
        <div className={styles.exampleConversation}>
          <span className={styles.exampleBadge}>{t("مثال توضيحي", "Illustrative example")}</span>
          <div className={styles.customerRow}><span className={styles.customerIcon} aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3Z" /></svg></span><div className={styles.customerQuestion}>{ar ? EXAMPLE_QUESTIONS[focus].ar : EXAMPLE_QUESTIONS[focus].en}</div></div>
          <div className={styles.employeeAnswer}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local approved persona poster */}
            <span className={styles.employeeAvatar} aria-hidden="true"><img src={person.poster} alt="" width={54} height={54} /></span>
            <p data-example-illustrative="true">{ar ? story.ar : story.en}</p>
          </div>
        </div>
        <p className={styles.illustrativeNote}>{t("مثال توضيحي. ليس محادثة تعمل الآن، ولا قناة متصلة، ولا حجزًا أو تحصيلًا.", "Illustrative example. Not a live conversation, a connected channel, a final booking, or a collection.")}</p>
      </div>

      <div className={styles.branchBlock} data-plans-region="branches">
        <h3>{t(`أين ستعمل ${person.ar}؟`, `Where will ${person.en} work?`)}</h3>
        <select className={styles.mobileBranches} data-mobile-branch-select="true" value={activeIndex} aria-label={t("الفرع الذي ستعمل به الموظفة", "Branch for this persona")} onChange={(event) => showBranch(Number(event.currentTarget.value))}>
          {state.slots.map((slot, index) => <option key={slotKeys[index]} value={index}>{slot.label.name} - {slot.label.city}</option>)}
        </select>
        <div className={styles.branches} role="group" aria-label={t("فروع الطلب", "Order branches")}>
          {state.slots.map((slot, index) => {
            const picked = slot.persona && slot.package;
            const who = PEOPLE.find((item) => item.id === slot.persona);
            return (
              <button key={slotKeys[index]} type="button" className={styles.branch} aria-pressed={index === activeIndex} data-branch-index={index} data-branch-local-id={slot.label.localId ?? ""} onClick={() => showBranch(index)}>
                <strong>
                  {slot.label.name} — {slot.label.city}
                </strong>
                <span>
                  {picked && who
                    ? `${ar ? who.ar : who.en} · ${slot.package === "premium" ? t("المميزة", "Premium") : t("القياسية", "Standard")}`
                    : t("لم يُختر بعد", "Not chosen yet")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.summary} data-plans-region="summary" aria-live="polite">
        <h3>{t("ملخص طلبك", "Your order")}</h3>
        <ul className={styles.summaryLines}>
          {state.slots.map((slot, index) => {
            const who = PEOPLE.find((item) => item.id === slot.persona);
            const amount = state.term && slot.persona && slot.package ? commercialAmount(readPlan(slot.persona, slot.package), state.term) : null;
            return (
              <li key={slotKeys[index]} data-summary-branch={index} data-branch-local-id={slot.label.localId ?? ""}>
                {who && slot.package ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- verified local persona portrait */}
                    <span className={styles.summaryAvatar} aria-hidden="true" data-selected-persona={slot.persona}><img src={who.poster} alt="" width={44} height={44} /></span>
                    <span className={styles.summaryChoice}>
                      <strong>{ar ? who.ar : who.en}</strong>
                      <span>{slot.package === "premium" ? t("المميزة", "Premium") : t("القياسية", "Standard")}{amount !== null ? ` · ${omr(amount)} ${t("ر.ع", "OMR")}` : ""}</span>
                      <small>{slot.label.name} — {slot.label.city}</small>
                    </span>
                  </>
                ) : <span>{slot.label.name} — {slot.label.city}: {t("لم يُختر بعد", "Not chosen yet")}</span>}
              </li>
            );
          })}
        </ul>
        {selected.length < state.slots.length ? <p>
          {t("فروع بلا اختيار", "Branches still unchosen")}: {state.slots.length - selected.length}
        </p> : null}
        <p className={styles.total} data-selection-total={ready ? String(ready.amountBaisa) : priced === null ? "" : String(priced)}>
          {ready
            ? `${state.term === "yearly" ? t("المجموع السنوي", "Yearly total") : t("المجموع الشهري", "Monthly total")} ${omr(ready.amountBaisa)} ${t("ر.ع", "OMR")} · ${ready.repliesPerMonth.toLocaleString("en-OM")} ${t("رد شهريًا", "replies each month")}`
            : priced === null
              ? t("اختر المدة ليظهر مجموع الفروع المختارة.", "Choose a term to total the branches you have chosen.")
              : `${state.term === "yearly" ? t("المجموع السنوي", "Yearly total") : t("المجموع الشهري", "Monthly total")} ${omr(priced)} ${t("ر.ع", "OMR")}`}
        </p>
        {seamNote ? (
          <p role="status" className={styles.status} data-local-seam={ready ? "ready" : "blocked"}>
            {seamNote}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={styles.back} data-plans-back="true" onClick={() => onBack()}>
            <span aria-hidden="true">{ar ? "\u2192" : "\u2190"}</span>
            {t("رجوع لتعديل البيانات", "Back to edit details")}
          </button>
          <button type="button" className={styles.continue} data-plans-continue="true" onClick={continueLocal}>
            {t("مراجعة الطلب", "Review order")} <span aria-hidden="true">{ar ? "←" : "→"}</span>
          </button>
        </div>
      </div>

      <div className={styles.planBlock} data-plans-region="plans">
      <h3>{t("اختر الباقة المناسبة", "Choose the right plan")}</h3>
      <div className={styles.terms} role="group" aria-label={t("مدة كل الفروع", "Term for every branch")}>
        <button type="button" className={styles.term} aria-pressed={state.term === "monthly"} data-term="monthly" onClick={() => onTerm("monthly")}>
          {t("شهري", "Monthly")}
        </button>
        <button type="button" className={styles.term} aria-pressed={state.term === "yearly"} data-term="yearly" onClick={() => onTerm("yearly")}>
          <span>{t("سنوي", "Yearly")}</span>
          <span className={styles.termSave}>{t(`−${annualDiscountPercent}%`, `−${annualDiscountPercent}%`)}</span>
        </button>
      </div>

      <div className={styles.tiers}>
        {(["basic", "premium"] as const).map((pack) => {
          const plan = pack === "basic" ? basic : premium;
          const chosen = active?.persona === focus && active.package === pack;
          const features = pack === "basic" ? plan.features : premium.features;
          return (
            <article key={pack} className={styles.tier} data-tier={pack} data-persona-tier={focus}>
              <button type="button" aria-pressed={Boolean(chosen)} onClick={() => choose(pack)}>
                <strong>{pack === "basic" ? t("القياسية", "Standard") : t("المميزة", "Premium")}</strong>
                <span className={styles.price} data-active-term={state.term ?? "monthly"}>
                  <span>
                    <strong>{omr(commercialAmount(plan, "monthly"))}</strong> {t("ر.ع شهريًا", "OMR monthly")}
                  </span>
                  <span>
                    <strong>{omr(commercialAmount(plan, "yearly"))}</strong> {t("ر.ع سنويًا", "OMR yearly")}
                  </span>
                </span>
                <span className={styles.quota}>
                  <span>
                    {plan.replies.toLocaleString("en-OM")} {t("رد شهريًا", "replies each month")}
                  </span>
                  <span>
                    {plan.employees} {t("مقاعد", "seats")} · {plan.channels} {t(plan.channels === 1 ? "قناة" : "قنوات", plan.channels === 1 ? "channel" : "channels")}
                  </span>
                </span>
              </button>
              <p className={styles.featureHeading}>{pack === "premium" ? t(`كل مزايا القياسية، بالإضافة إلى:`, "Everything in Standard, plus:") : t(`مميزات دور ${person.ar} في هذه الباقة:`, `${person.en}’s role in this plan:`)}</p>
              <ul className={styles.keyFeatures} aria-label={t("أبرز مميزات الباقة", "Plan highlights")}>
                {(pack === "basic" ? basicHighlights.slice(0, 3) : premiumOnly.slice(0, 2)).map((feature) => (
                  <li key={feature.id}><span aria-hidden="true">✓</span>{ar ? feature.label.ar : feature.label.en}</li>
                ))}
              </ul>
              <details className={styles.details}>
                <summary
                  data-features-toggle={pack}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {t("عرض جميع المميزات", "Show all features")}
                </summary>
                <ul className={styles.featureList}>
                  {features.map((feature) => {
                    const availability = featureAvailability?.[feature.id];
                    return (
                      <li key={feature.id} data-feature={feature.id} data-availability={availability ?? undefined}>
                        <span>
                          {pack === "premium" && premiumOnly.some((item) => item.id === feature.id) ? t("إضافة المميزة: ", "Premium addition: ") : null}
                          {ar ? feature.label.ar : feature.label.en}
                        </span>
                        {availability ? (
                          <small className={styles.featureState} data-availability={availability}>
                            {availability === "planned"
                              ? t("مخططة", "Planned")
                              : availability === "not_verified"
                                ? t("غير متحققة", "Not verified")
                                : availability === "ready"
                                  ? t("جاهزة", "Ready")
                                  : t("تحتاج إعدادًا", "Configuration required")}
                          </small>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {pack === "premium" ? (
                  <ul className={styles.addonList}>
                    {addons.map((addon) => (
                      <li key={addon.id} className={styles.addon} data-addon={addon.id} data-addon-sale={addon.sale} data-addon-included="false">
                        <strong>{ar ? addon.label.ar : addon.label.en}</strong>
                        <p className={addon.sale === "FUTURE_NOT_READY_FOR_SALE" ? styles.future : undefined}>
                          {addon.sale === "FUTURE_NOT_READY_FOR_SALE"
                            ? t("معلومة مستقبلية. غير مشمولة وغير جاهزة للبيع.", "Future information. Not included and not ready for sale.")
                            : t("إضافة منفصلة غير مشمولة. لا سعر لها هنا ولا إجراء شراء.", "Separate add-on, not included. No price and no purchase action here.")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>
            </article>
          );
        })}
      </div>
      </div>


    </section>
  );
}
