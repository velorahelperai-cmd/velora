/**
 * Pure view-model and confirm guard for the order review page (WP02B review step).
 * No pricing logic of its own: every amount comes from the commercial catalog.
 * Branch names/cities are never logged, serialized or put in URLs here.
 */

import {
  commercialAmount,
  commercialPlan,
  type CommercialPlan,
} from "@/components/app/subscription-commercial-catalog";
import type { Es02ImmutableOffer } from "@/lib/billing/es02/contracts";
import type {
  SubscriptionPackage,
  SubscriptionPersona,
  SubscriptionTerm,
} from "@/components/app/subscription-offers-view";

export type ReviewSlot = {
  label: { name: string; city: string; contactPhone?: string; localId?: string };
  persona: SubscriptionPersona | null;
  package: SubscriptionPackage | null;
};

export type ReviewRow = {
  index: number;
  name: string;
  city: string;
  contactPhone?: string;
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
  plan: CommercialPlan;
  amountBaisa: number;
};

export type ReviewModel = {
  rows: ReviewRow[];
  /** Indexes of slots with no complete persona+package choice. */
  incomplete: number[];
  term: SubscriptionTerm | null;
  totalBaisa: number;
  branchCount: number;
  complete: boolean;
  /**
   * "order": amounts are the confirmed server order (order.offer, authoritative).
   * "preview": local catalog preview before an order exists; never quote authority.
   */
  source: "preview" | "order";
};

/**
 * Slots + term -> rows and totals.
 * Without `orderOffer` the amounts are a catalog preview. With `orderOffer` (Es02AccountOrderView.offer of an
 * existing order) every amount, the term and the total come from that immutable offer; the catalog is only used
 * for the features/quotas display (replies, seats, channels).
 */
export function buildReviewModel(
  slots: readonly ReviewSlot[],
  term: SubscriptionTerm | null,
  orderOffer?: Es02ImmutableOffer | null,
): ReviewModel {
  if (orderOffer) return buildOrderModel(slots, orderOffer);
  const rows: ReviewRow[] = [];
  const incomplete: number[] = [];
  let totalBaisa = 0;
  slots.forEach((slot, index) => {
    if (!slot.persona || !slot.package || !term) {
      incomplete.push(index);
      return;
    }
    const plan = commercialPlan(slot.persona, slot.package);
    if (!plan) {
      incomplete.push(index);
      return;
    }
    const amountBaisa = commercialAmount(plan, term);
    totalBaisa += amountBaisa;
    rows.push({
      index,
      name: slot.label.name,
      city: slot.label.city,
      ...(slot.label.contactPhone ? { contactPhone: slot.label.contactPhone } : {}),
      persona: slot.persona,
      package: slot.package,
      plan,
      amountBaisa,
    });
  });
  return {
    rows,
    incomplete,
    term,
    totalBaisa,
    branchCount: slots.length,
    complete: !!term && slots.length > 0 && incomplete.length === 0,
    source: "preview",
  };
}

function buildOrderModel(slots: readonly ReviewSlot[], offer: Es02ImmutableOffer): ReviewModel {
  const rows: ReviewRow[] = [];
  const incomplete: number[] = [];
  for (const s of offer.slots) {
    const plan = commercialPlan(s.persona, s.package);
    const label = slots[s.slotIndex]?.label ?? { name: "", city: "" };
    if (!plan) {
      incomplete.push(s.slotIndex);
      continue;
    }
    // Prefer frozen offer-slot feature snapshot over live marketing catalog copy.
    const planForDisplay =
      s.features.length > 0
        ? { ...plan, features: s.features.map((feature) => ({ id: feature.id, label: { ...feature.label } })) }
        : plan;
    rows.push({
      index: s.slotIndex,
      name: label.name,
      city: label.city,
      ...(label.contactPhone ? { contactPhone: label.contactPhone } : {}),
      persona: s.persona,
      package: s.package,
      plan: planForDisplay,
      amountBaisa: s.amountBaisa,
    });
  }
  return {
    rows,
    incomplete,
    term: offer.term,
    totalBaisa: offer.amountBaisa,
    branchCount: offer.branchSlots,
    complete: incomplete.length === 0 && offer.slots.length > 0,
    source: "order",
  };
}

/** OMR with up to three decimals, Latin digits, no trailing zeros. */
export function formatOmr(baisa: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(baisa / 1000);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export const PERSONA_NAMES: Record<SubscriptionPersona, { ar: string; en: string }> = {
  level_1: { ar: "نورا", en: "Noura" },
  level_2: { ar: "لينا", en: "Lina" },
  level_3: { ar: "دانا", en: "Dana" },
};

export const TIER_NAMES: Record<SubscriptionPackage, { ar: string; en: string }> = {
  basic: { ar: "القياسية", en: "Standard" },
  premium: { ar: "المميزة", en: "Premium" },
};

/** Existing approved static posters under public/media/setup (no new binaries). */
export const PERSONA_POSTERS: Record<SubscriptionPersona, string> = {
  level_1: "/media/setup/noura-studio-poster.png",
  level_2: "/media/setup/lina-team-alpha-poster.png",
  level_3: "/media/setup/dana-team-alpha-poster.png",
};

/** Verified Dana/Lina alpha exports; Noura retains her original identity pending a matching full-body alpha source. */
export const PERSONA_VIDEOS: Record<SubscriptionPersona, string> = {
  level_1: "/media/setup/noura-studio.mp4",
  level_2: "/media/setup/lina-team-alpha.webm",
  level_3: "/media/setup/dana-team-alpha.webm",
};

export type MotionInputs = {
  enabled: boolean;
  supported: boolean;
  reduced: boolean;
  inView: boolean;
  pageVisible: boolean;
  failed: boolean;
};

/** Motion plays only when every condition holds; otherwise the static poster is the whole story. */
export function shouldPlayMotion(i: MotionInputs): boolean {
  return i.enabled && i.supported && !i.reduced && i.inView && i.pageVisible && !i.failed;
}

/** A page-wide decoder budget. Waiting figures stay on their static poster. */
export function createMotionBudget(limit = 2) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("INVALID_MOTION_BUDGET");
  const active = new Set<object>();
  const waiting: Array<{ owner: object; grant: () => void }> = [];
  return {
    request(onGranted: () => void) {
      const owner = {};
      let released = false;
      if (active.size < limit) active.add(owner);
      else waiting.push({ owner, grant: onGranted });
      return {
        granted: () => !released && active.has(owner),
        release() {
          if (released) return;
          released = true;
          const index = waiting.findIndex((entry) => entry.owner === owner);
          if (index >= 0) waiting.splice(index, 1);
          active.delete(owner);
          while (active.size < limit && waiting.length) {
            const next = waiting.shift()!;
            active.add(next.owner);
            next.grant();
          }
        },
      };
    },
  };
}

export type MotionEnv = {
  budget?: ReturnType<typeof createMotionBudget>;
  /** null/absent matchMedia => treated as reduced (safe default). */
  reducedQuery: {
    matches: boolean;
    addEventListener: (type: "change", cb: () => void) => void;
    removeEventListener: (type: "change", cb: () => void) => void;
  } | null;
  /** null/absent IntersectionObserver => motion unsupported, poster only. */
  createObserver: ((cb: (inView: boolean) => void) => { observe: (el: unknown) => void; disconnect: () => void }) | null;
  isPageVisible: () => boolean;
  subscribeVisibility: (cb: () => void) => () => void;
};

/**
 * Motion controller with injectable environment (testable without a DOM). Calls onChange(play) only when
 * the computed play flag changes. Starts paused (poster). dispose() unobserves and unsubscribes everything.
 */
export function createMotionController(env: MotionEnv, enabled: boolean, onChange: (play: boolean) => void) {
  const state = {
    enabled,
    supported: !!env.createObserver && !!env.reducedQuery,
    reduced: env.reducedQuery ? env.reducedQuery.matches : true,
    inView: false,
    pageVisible: env.isPageVisible(),
    failed: false,
  };
  let play = false;
  let disposed = false;
  let ticket: ReturnType<ReturnType<typeof createMotionBudget>["request"]> | null = null;
  const emit = () => {
    if (disposed) return;
    const eligible = shouldPlayMotion(state);
    if (!eligible && ticket) {
      if (play) {
        play = false;
        onChange(false);
      }
      const old = ticket;
      ticket = null;
      old.release();
    }
    if (eligible && env.budget && !ticket) ticket = env.budget.request(emit);
    const next = eligible && (!env.budget || Boolean(ticket?.granted()));
    if (next !== play) {
      play = next;
      onChange(next);
    }
  };
  const onReduced = () => {
    state.reduced = env.reducedQuery ? env.reducedQuery.matches : true;
    emit();
  };
  const onVisibility = () => {
    state.pageVisible = env.isPageVisible();
    emit();
  };
  env.reducedQuery?.addEventListener("change", onReduced);
  const unsubscribeVisibility = env.subscribeVisibility(onVisibility);
  const observer = env.createObserver
    ? env.createObserver((inView) => {
        state.inView = inView;
        emit();
      })
    : null;
  return {
    isPlaying: () => play,
    observe(el: unknown) {
      observer?.observe(el);
    },
    setEnabled(value: boolean) {
      state.enabled = value;
      emit();
    },
    reportError() {
      state.failed = true;
      emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      play = false;
      ticket?.release();
      ticket = null;
      observer?.disconnect();
      env.reducedQuery?.removeEventListener("change", onReduced);
      unsubscribeVisibility();
    },
  };
}

export function seatsLabel(n: number, ar: boolean): string {
  if (!ar) return `${formatCount(n)} staff seat${n === 1 ? "" : "s"}`;
  if (n === 1) return "مقعد واحد للموظفين";
  if (n === 2) return "مقعدان للموظفين";
  return `${formatCount(n)} ${n >= 3 && n <= 10 ? "مقاعد" : "مقعداً"} للموظفين`;
}

export function channelsLabel(n: number, ar: boolean): string {
  if (!ar) return `${formatCount(n)} channel${n === 1 ? "" : "s"}`;
  if (n === 1) return "قناة واحدة";
  if (n === 2) return "قناتان";
  return `${formatCount(n)} ${n >= 3 && n <= 10 ? "قنوات" : "قناة"}`;
}

export function branchCountLabel(n: number, ar: boolean): string {
  if (!ar) return `${formatCount(n)} branch${n === 1 ? "" : "es"}`;
  if (n === 1) return "فرع واحد";
  if (n === 2) return "فرعان";
  return `${formatCount(n)} ${n >= 3 && n <= 10 ? "فروع" : "فرعاً"}`;
}

export type ReviewFailureKind = "session" | "unknown" | "selection" | "consent" | "unavailable" | "locked" | "generic";

const SESSION_CODES = new Set(["UNAUTHENTICATED", "ACTOR_NOT_CURRENT", "STALE_CAPTURE", "DISCARDED"]);
const SELECTION_CODES = new Set([
  "REVIEW_REQUIRED",
  "SELECTION_INCOMPLETE",
  "PREPARATION_INCOMPLETE",
  "SLOT_COUNT",
  "SLOT_MISMATCH",
  "INVALID_INPUT",
  "OFFER_TAMPER",
]);
const UNAVAILABLE_CODES = new Set(["UNAVAILABLE", "UNCONFIGURED", "SYNTHETIC_DISABLED", "PAYMOB_EXTERNAL_DEFERRED"]);

/** Code -> presentation class. Raw codes and server text are never shown. */
export function classifyFailure(code: string): ReviewFailureKind {
  if (code === "UNKNOWN") return "unknown";
  if (SESSION_CODES.has(code)) return "session";
  if (SELECTION_CODES.has(code)) return "selection";
  if (code === "CONSENT_REQUIRED") return "consent";
  if (UNAVAILABLE_CODES.has(code)) return "unavailable";
  if (code === "WRITE_LOCKED") return "locked";
  return "generic";
}

export const FAILURE_COPY: Record<Exclude<ReviewFailureKind, "unknown">, { ar: string; en: string }> = {
  session: {
    ar: "انتهت الجلسة أو تغيّر الحساب. لم يتأكد لنا ناتج العملية وقد يكون الطلب قد أُنشئ بالفعل. لا تنشئ طلباً جديداً قبل التحقق من الحالة بعد تسجيل الدخول من جديد.",
    en: "Your session ended or the account changed. The outcome was not confirmed and the order may exist. Do not create a new order before you sign in again and check the status.",
  },
  selection: {
    ar: "تعذّر التحقق من اختياراتك. ارجع إلى الباقات وراجعها ثم حاول مرة أخرى.",
    en: "We could not verify your choices. Go back to the plans, review them and try again.",
  },
  consent: {
    ar: "يلزم الموافقة على شروط الاشتراك قبل المتابعة للدفع.",
    en: "You need to accept the subscription terms before continuing to payment.",
  },
  unavailable: {
    ar: "الدفع غير متاح حاليًا. تظل اختياراتك قابلة للتعديل.",
    en: "Payment is not available right now. Your choices remain editable.",
  },
  locked: {
    ar: "هناك عملية سابقة قيد التنفيذ. انتظر قليلاً ثم تحقق من الحالة.",
    en: "A previous operation is still running. Wait a moment, then check the status.",
  },
  generic: {
    ar: "تعذّر إنشاء الطلب. حاول مرة أخرى.",
    en: "We could not create the order. Please try again.",
  },
};

export type ReviewConfirmResult =
  | { ok: true; order: { specialReference: string }; settlement: "UNPAID"; serviceReady: false }
  | { ok: false; code: string };

export type RunOutcome<R> =
  | { kind: "ignored" }
  | { kind: "stale" }
  | { kind: "done"; result: R };

/**
 * Single-flight guard. A second run while one is pending is ignored (the bound
 * confirm is not called). A result is dropped as stale when the actor token
 * changed while the call was pending.
 */
export function createConfirmRunner<R>() {
  let busy = false;
  return {
    isBusy: () => busy,
    async run(
      call: () => Promise<R>,
      tokenAtStart: string,
      currentToken: () => string,
      onRejected: () => R,
    ): Promise<RunOutcome<R>> {
      if (busy) return { kind: "ignored" };
      busy = true;
      try {
        let result: R;
        try {
          result = await call();
        } catch {
          result = onRejected();
        }
        if (currentToken() !== tokenAtStart) return { kind: "stale" };
        return { kind: "done", result };
      } finally {
        busy = false;
      }
    },
  };
}

/** Minimal result shape the lifecycle controller needs (SetupPlanConfirmResult satisfies it). */
export type ControllerResult =
  | { ok: true; clientOpId?: string }
  | { ok: false; code: string; clientOpId?: string };

export type ReviewLive = { key: string; mounted: boolean };

export type ControllerEvent<R extends ControllerResult> =
  | { type: "busy" }
  | { type: "created"; result: Extract<R, { ok: true }> }
  | {
      type: "failed";
      code: string;
      /** UNKNOWN: the request may have reached the server (UNKNOWN, or STALE_CAPTURE after the call started). */
      outcome: "UNKNOWN" | "FAILED";
      /** The SAME operation id as the started operation. Never newly generated here. */
      clientOpId: string | null;
    };

export type StartOutcome = { kind: "blocked" } | { kind: "ignored" } | { kind: "dropped" } | { kind: "settled" };

/** Codes after which an already-started operation may still have been committed. */
const POSSIBLY_COMMITTED_CODES = new Set(["UNKNOWN", "STALE_CAPTURE"]);

/**
 * Lifecycle controller: live (not closure) actor + mount checks before the call and after every await,
 * single-flight, and truthful UNKNOWN mapping. `live` must read refs holding the latest values.
 * Nothing is emitted, and no callback runs, once the actor moved or the component unmounted.
 */
export function createReviewController<R extends ControllerResult>(deps: {
  live: () => ReviewLive;
  emit: (event: ControllerEvent<R>) => void;
  onConfirmed: (result: Extract<R, { ok: true }>) => void;
  /** Operation id currently known to the host (journey write state), used only as a fallback to report. */
  currentOpId?: () => string | undefined;
}) {
  let busy = false;
  const isLive = (startKey: string) => {
    const live = deps.live();
    return live.mounted && live.key === startKey;
  };
  return {
    isBusy: () => busy,
    isLive,
    async start(startKey: string, invoke: () => Promise<R>): Promise<StartOutcome> {
      if (!isLive(startKey)) return { kind: "blocked" };
      if (busy) return { kind: "ignored" };
      busy = true;
      try {
        deps.emit({ type: "busy" });
        let result: R;
        try {
          result = await invoke();
        } catch {
          result = { ok: false, code: "UNKNOWN" } as R;
        }
        if (!isLive(startKey)) return { kind: "dropped" };
        if (result.ok) {
          deps.emit({ type: "created", result: result as Extract<R, { ok: true }> });
          if (isLive(startKey)) deps.onConfirmed(result as Extract<R, { ok: true }>);
        } else {
          deps.emit({
            type: "failed",
            code: result.code,
            outcome: POSSIBLY_COMMITTED_CODES.has(result.code) ? "UNKNOWN" : "FAILED",
            clientOpId: result.clientOpId ?? deps.currentOpId?.() ?? null,
          });
        }
        return { kind: "settled" };
      } finally {
        busy = false;
      }
    },
  };
}

/**
 * Latest-value cell for the wrapper: holds the newest props plus the live actor key / consent / completeness /
 * mounted flag read by controller preflights. `sync` is called during render; `mounted` is set by effects.
 */
export function createLiveCell<P>(initialProps: P, initialKey: string) {
  const cell = {
    props: initialProps,
    live: { key: initialKey, mounted: false, consent: false, complete: false },
    setMounted(mounted: boolean) {
      cell.live.mounted = mounted;
    },
    sync(props: P, key: string, consent: boolean, complete: boolean) {
      cell.props = props;
      cell.live.key = key;
      cell.live.consent = consent;
      cell.live.complete = complete;
    },
  };
  return cell;
}

export function actorKey(actor: { accountId: string; captureToken: string }): string {
  return `${actor.accountId}\u0000${actor.captureToken}`;
}
