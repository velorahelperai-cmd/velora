/**
 * Per-mounted /setup plan journey. Memory only: draft, labels, and the
 * client operation id die with this object. No global store.
 * Business facts never enter the order payload, and this module does not log them.
 * No metadata-only operation journal exists for this journey; an open UNKNOWN
 * lost with the browser is not resolved here. Paid-purchase recovery is not called.
 */

import {
  commercialPlan,
  type CommercialFeature,
  type CommercialPlan,
} from "@/components/app/subscription-commercial-catalog";
import type { SubscriptionPackage, SubscriptionPersona, SubscriptionTerm } from "@/components/app/subscription-offers-view";
import { beginAccountPaymentAction } from "@/lib/billing/es02/account-order-actions";
import { resolveEs02Offer, type Es02OfferSelection } from "@/lib/billing/es02/commercial-offer";
import {
  es02Uuid,
  type Es02AccountOrderView,
  type Es02ActionCode,
  type Es02ImmutableOffer,
  type Es02Result,
} from "@/lib/billing/es02/contracts";
import { buildPreparationCheckoutHandoff } from "@/lib/billing/es02/preparation-handoff";
import { emptyPreparation, validatePreparation, type Preparation, type PreparationDraft } from "@/lib/tenancy/prepayment-preparation";
import { normalizeOnboardingAnswers } from "@/lib/tenancy/onboarding-answers";

export const SETUP_PLAN_SLOT_MAX = 32;

/** Explicit payment intent only; the deferred provider creates no server order. */
export const setupPlanBeginPayment = beginAccountPaymentAction;

export type SetupPlanCreateOrder = (input: {
  expectedAccountId: string;
  selection: Es02OfferSelection;
  consentAccepted: boolean;
  clientOpId: string;
}) => Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>>;

export type SetupPlanActor = {
  accountId: string;
  /** Changes when the authenticated capture changes. Function identity is not the token. */
  captureToken: string;
  isCurrent: () => boolean;
};

export type SetupPlanLocalCode =
  | "DISCARDED"
  | "PREPARATION_INCOMPLETE"
  | "SLOT_COUNT"
  | "SELECTION_INCOMPLETE"
  | "CONSENT_REQUIRED"
  | "REVIEW_REQUIRED"
  | "ACTOR_NOT_CURRENT"
  | "WRITE_LOCKED"
  | "STALE_CAPTURE"
  | "INVALID_INPUT"
  | "OFFER_TAMPER"
  | "SLOT_MISMATCH";

export type BranchSlotChoice = {
  /** Local display only. Excluded from the order action. */
  label: { name: string; city: string; contactPhone?: string; localId?: string };
  persona: SubscriptionPersona | null;
  package: SubscriptionPackage | null;
};

export type SetupPlanWrite =
  | { kind: "idle" }
  | { kind: "inflight"; clientOpId: string; selection: Es02OfferSelection }
  | { kind: "unknown"; clientOpId: string; selection: Es02OfferSelection; code: "UNKNOWN" }
  | { kind: "denied"; clientOpId: string; selection: Es02OfferSelection; code: Es02ActionCode }
  | {
      kind: "unpaid";
      clientOpId: string;
      selection: Es02OfferSelection;
      order: Es02AccountOrderView;
      action: "insert" | "reuse";
      settlement: "UNPAID";
      serviceReady: false;
    };

export type LocalReviewSeam = {
  status: "ready";
  preview: Es02ImmutableOffer;
  consentAccepted: boolean;
  /** Plans must not invoke confirm from this seam. */
  confirmWired: false;
};

export type SetupPlanStepResult =
  | { ok: true; seam?: LocalReviewSeam }
  | { ok: false; code: SetupPlanLocalCode | Es02ActionCode; preparationErrors?: string[]; branchCount?: number };

export type SetupPlanConfirmResult =
  | {
      ok: true;
      settlement: "UNPAID";
      serviceReady: false;
      order: Es02AccountOrderView;
      action: "insert" | "reuse";
      clientOpId: string;
    }
  | { ok: false; code: SetupPlanLocalCode | Es02ActionCode; preparationErrors?: string[]; clientOpId?: string; branchCount?: number };

export type SetupPlanJourneySnapshot = {
  accountId: string;
  captureToken: string;
  generation: number;
  discarded: boolean;
  step: "preparation" | "plans" | "localReview";
  preparation: Preparation;
  slots: BranchSlotChoice[];
  term: SubscriptionTerm | null;
  consentAccepted: boolean;
  preview: Es02ImmutableOffer | null;
  write: SetupPlanWrite;
  editingLocked: boolean;
};

export type SetupPlanAddonPresentation = {
  id: string;
  label: CommercialFeature["label"];
  included: false;
  sale: "OPTIONAL_SEPARATE" | "FUTURE_NOT_READY_FOR_SALE";
};

export type SetupPlanJourney = {
  snapshot: () => SetupPlanJourneySnapshot;
  replacePreparation: (preparation: PreparationDraft) => SetupPlanStepResult;
  openPlans: () => SetupPlanStepResult;
  backToPreparation: () => SetupPlanStepResult;
  setSlot: (index: number, choice: { persona: SubscriptionPersona; package: SubscriptionPackage }) => SetupPlanStepResult;
  setTerm: (term: SubscriptionTerm) => SetupPlanStepResult;
  setConsent: (accepted: boolean) => SetupPlanStepResult;
  localReview: () => SetupPlanStepResult;
  confirmReview: (consentAccepted: boolean) => Promise<SetupPlanConfirmResult>;
  bindActor: (actor: SetupPlanActor) => void;
  release: () => void;
  readPlan: (persona: SubscriptionPersona, pack: SubscriptionPackage) => CommercialPlan;
  presentAddons: (persona: SubscriptionPersona, pack: SubscriptionPackage) => SetupPlanAddonPresentation[];
};

const PERSONAS: readonly SubscriptionPersona[] = ["level_1", "level_2", "level_3"];
const PACKAGES: readonly SubscriptionPackage[] = ["basic", "premium"];
const TERMS: readonly SubscriptionTerm[] = ["monthly", "yearly"];

type WriteDecision =
  | { kind: "stop"; result: SetupPlanConfirmResult }
  | {
      kind: "write";
      clientOpId: string;
      selection: Es02OfferSelection;
      capturedGeneration: number;
      capturedAccountId: string;
    };

function clonePreparation(value: PreparationDraft): Preparation {
  const normalized = value.answers == null ? null : normalizeOnboardingAnswers(value.answers);
  const answers = normalized?.ok ? normalized.value : null;
  return {
    name: value.name,
    type: value.type,
    phone: value.phone,
    country: value.country,
    city: value.city,
    branches: value.branches.map((branch) => ({ name: branch.name, city: branch.city, ...(branch.contactPhone !== undefined ? { contactPhone: branch.contactPhone } : {}), ...(branch.localId ? { localId: branch.localId } : {}) })),
    ...(answers ? { answers } : {}),
  };
}

function deriveSlots(preparation: Preparation, previous: readonly BranchSlotChoice[]): BranchSlotChoice[] {
  // Positions are not branch identities: removing or reordering an earlier row
  // must not silently assign its purchase choice to another branch. Unchanged,
  // unique labels retain their choice; changed or ambiguous rows require selection.
  const key = (label: { name: string; city: string }) => JSON.stringify([
    label.name.trim().toLocaleLowerCase(), label.city.trim().toLocaleLowerCase(),
  ]);
  const previousByLabel = new Map<string, BranchSlotChoice[]>();
  for (const slot of previous) {
    const identity = key(slot.label);
    previousByLabel.set(identity, [...(previousByLabel.get(identity) ?? []), slot]);
  }
  const occurrences = new Map<string, number>();
  for (const branch of preparation.branches) {
    const identity = key(branch);
    occurrences.set(identity, (occurrences.get(identity) ?? 0) + 1);
  }
  return preparation.branches.map((branch) => {
    const identity = key(branch);
    const matches = previousByLabel.get(identity);
    const retained = matches?.length === 1 && occurrences.get(identity) === 1 ? matches[0] : undefined;
    return {
      label: { name: branch.name, city: branch.city, ...(branch.contactPhone ? { contactPhone: branch.contactPhone } : {}), ...(branch.localId ? { localId: branch.localId } : {}) },
      persona: retained?.persona ?? null,
      package: retained?.package ?? null,
    };
  });
}

function projectSelection(slots: readonly BranchSlotChoice[], term: SubscriptionTerm | null): Es02OfferSelection | null {
  if (!term || !slots.length || slots.length > SETUP_PLAN_SLOT_MAX) return null;
  const projected: { persona: SubscriptionPersona; package: SubscriptionPackage }[] = [];
  for (const slot of slots) {
    if (!slot.persona || !slot.package) return null;
    projected.push({ persona: slot.persona, package: slot.package });
  }
  return { term, slots: projected };
}

function cloneSelection(selection: Es02OfferSelection): Es02OfferSelection {
  return {
    term: selection.term,
    slots: selection.slots.map((slot) => ({ persona: slot.persona, package: slot.package })),
  };
}

/** Internal retry identity. Callers receive copies and cannot retarget this object. */
function freezeSelection(selection: Es02OfferSelection): Es02OfferSelection {
  const copy = cloneSelection(selection);
  copy.slots.forEach((slot) => Object.freeze(slot));
  Object.freeze(copy.slots);
  return Object.freeze(copy);
}

function cloneOffer(offer: Es02ImmutableOffer): Es02ImmutableOffer {
  return {
    catalogRevision: offer.catalogRevision,
    term: offer.term,
    slots: offer.slots.map((slot) => ({
      slotIndex: slot.slotIndex,
      persona: slot.persona,
      package: slot.package,
      amountBaisa: slot.amountBaisa,
      repliesPerMonth: slot.repliesPerMonth,
      employees: slot.employees,
      channels: slot.channels,
      features: slot.features.map((feature) => ({
        id: feature.id,
        label: { ar: feature.label.ar, en: feature.label.en },
      })),
    })),
    branchSlots: offer.branchSlots,
    amountBaisa: offer.amountBaisa,
    currency: offer.currency,
    purpose: offer.purpose,
    productCode: offer.productCode,
    repliesPerMonth: offer.repliesPerMonth,
    employees: offer.employees,
    channels: offer.channels,
    persona: offer.persona,
    package: offer.package,
  };
}

function cloneOrder(order: Es02AccountOrderView): Es02AccountOrderView {
  return {
    orderId: order.orderId,
    accountId: order.accountId,
    status: order.status,
    offer: cloneOffer(order.offer),
    specialReference: order.specialReference,
    paymentAttemptId: order.paymentAttemptId,
    environment: order.environment,
    settledAt: order.settledAt,
    provisionedCompanyId: order.provisionedCompanyId,
    originalOrderGroupId: order.originalOrderGroupId,
  };
}

function cloneWrite(value: SetupPlanWrite): SetupPlanWrite {
  if (value.kind === "idle") return { kind: "idle" };
  const selection = cloneSelection(value.selection);
  const clientOpId = value.clientOpId;
  if (value.kind === "inflight") return { kind: "inflight", clientOpId, selection };
  if (value.kind === "unknown") return { kind: "unknown", clientOpId, selection, code: "UNKNOWN" };
  if (value.kind === "denied") return { kind: "denied", clientOpId, selection, code: value.code };
  return {
    kind: "unpaid",
    clientOpId,
    selection,
    order: cloneOrder(value.order),
    action: value.action,
    settlement: "UNPAID",
    serviceReady: false,
  };
}

export function createSetupPlanJourney(input: {
  actor: SetupPlanActor;
  preparation?: PreparationDraft;
  /** Test seam for uncertain payment-boundary outcomes; never supplied by /setup. */
  createOrder?: SetupPlanCreateOrder;
  newClientOpId?: () => string;
}): SetupPlanJourney {
  let accountId = input.actor.accountId;
  let captureToken = input.actor.captureToken;
  let isCurrent = input.actor.isCurrent;
  let generation = 0;
  let discarded = false;
  let step: SetupPlanJourneySnapshot["step"] = "preparation";
  const supplied = input.preparation ?? emptyPreparation();
  let answerFault = supplied.answers != null && !normalizeOnboardingAnswers(supplied.answers).ok;
  let preparation = clonePreparation(answerFault ? { ...supplied, answers: undefined } : supplied);
  let slots = deriveSlots(preparation, []);
  let term: SubscriptionTerm | null = null;
  let consentAccepted = false;
  let preview: Es02ImmutableOffer | null = null;
  let write: SetupPlanWrite = { kind: "idle" };
  let inflight: Promise<SetupPlanConfirmResult> | null = null;
  const injectedCreateOrder = input.createOrder;
  const createOrder: SetupPlanCreateOrder = injectedCreateOrder
    ? injectedCreateOrder
    : (orderInput) => setupPlanBeginPayment(orderInput);
  const newClientOpId = input.newClientOpId ?? (() => globalThis.crypto.randomUUID());

  function locked(): boolean {
    return write.kind !== "idle";
  }

  function clearOfferPreview() {
    preview = null;
    consentAccepted = false;
    if (step === "localReview") step = "plans";
  }

  function clearMemory() {
    answerFault = false;
    preparation = emptyPreparation();
    slots = deriveSlots(preparation, []);
    term = null;
    consentAccepted = false;
    preview = null;
    write = { kind: "idle" };
    step = "preparation";
  }

  function fail(code: SetupPlanLocalCode | Es02ActionCode, extra?: { preparationErrors?: string[]; branchCount?: number }): SetupPlanStepResult {
    return { ok: false, code, ...extra };
  }

  function assess(): { ok: true; selection: Es02OfferSelection; offer: Es02ImmutableOffer } | { ok: false; result: SetupPlanStepResult } {
    if (discarded) return { ok: false, result: fail("DISCARDED") };
    if (answerFault) return { ok: false, result: fail("PREPARATION_INCOMPLETE", { preparationErrors: ["answers"] }) };
    const preparationErrors = validatePreparation(preparation);
    if (preparationErrors.length) return { ok: false, result: fail("PREPARATION_INCOMPLETE", { preparationErrors }) };
    const branchCount = preparation.branches.length;
    if (branchCount < 1 || branchCount > SETUP_PLAN_SLOT_MAX || slots.length !== branchCount) {
      return { ok: false, result: fail("SLOT_COUNT", { branchCount }) };
    }
    const selection = projectSelection(slots, term);
    if (!selection) return { ok: false, result: fail("SELECTION_INCOMPLETE", { branchCount }) };
    const resolved = resolveEs02Offer(selection);
    if (!resolved.ok) return { ok: false, result: fail(resolved.code, { branchCount }) };
    return { ok: true, selection, offer: resolved.offer };
  }

  function snapshot(): SetupPlanJourneySnapshot {
    return {
      accountId,
      captureToken,
      generation,
      discarded,
      step,
      preparation: clonePreparation(preparation),
      slots: slots.map((slot) => ({ label: { ...slot.label }, persona: slot.persona, package: slot.package })),
      term,
      consentAccepted,
      preview: preview ? cloneOffer(preview) : null,
      write: cloneWrite(write),
      editingLocked: locked(),
    };
  }

  function replacePreparation(next: PreparationDraft): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    if (next.answers != null && !normalizeOnboardingAnswers(next.answers).ok) return fail("INVALID_INPUT");
    answerFault = false;
    preparation = clonePreparation(next);
    slots = deriveSlots(preparation, slots);
    clearOfferPreview();
    return { ok: true };
  }

  function openPlans(): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    slots = deriveSlots(preparation, slots);
    if (answerFault) return fail("PREPARATION_INCOMPLETE", { preparationErrors: ["answers"] });
    const preparationErrors = validatePreparation(preparation);
    if (preparationErrors.length) return fail("PREPARATION_INCOMPLETE", { preparationErrors });
    const branchCount = preparation.branches.length;
    if (branchCount < 1 || branchCount > SETUP_PLAN_SLOT_MAX) return fail("SLOT_COUNT", { branchCount });
    step = "plans";
    clearOfferPreview();
    return { ok: true };
  }

  function backToPreparation(): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    step = "preparation";
    clearOfferPreview();
    return { ok: true };
  }

  function setSlot(index: number, choice: { persona: SubscriptionPersona; package: SubscriptionPackage }): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    const slot = slots[index];
    if (!slot || !PERSONAS.includes(choice.persona) || !PACKAGES.includes(choice.package)) return fail("INVALID_INPUT");
    slots[index] = { label: slot.label, persona: choice.persona, package: choice.package };
    clearOfferPreview();
    return { ok: true };
  }

  function setTerm(next: SubscriptionTerm): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    if (!TERMS.includes(next)) return fail("INVALID_INPUT");
    term = next;
    clearOfferPreview();
    return { ok: true };
  }

  function setConsent(accepted: boolean): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    if (accepted !== true) {
      consentAccepted = false;
      return { ok: true };
    }
    const ready = assess();
    if (!ready.ok) return ready.result;
    consentAccepted = true;
    return { ok: true };
  }

  function localReview(): SetupPlanStepResult {
    if (discarded) return fail("DISCARDED");
    if (locked()) return fail("WRITE_LOCKED");
    const ready = assess();
    if (!ready.ok) return ready.result;
    preview = ready.offer;
    step = "localReview";
    const seam: LocalReviewSeam = { status: "ready", preview: ready.offer, consentAccepted, confirmWired: false };
    return { ok: true, seam };
  }

  function liveActor(): SetupPlanConfirmResult | null {
    if (discarded) return { ok: false, code: "DISCARDED" };
    if (!isCurrent()) return { ok: false, code: "ACTOR_NOT_CURRENT" };
    return null;
  }

  function decide(consentFlag: boolean): WriteDecision {
    const closed = liveActor();
    if (closed) return { kind: "stop", result: closed };
    if (write.kind === "unpaid") {
      return {
        kind: "stop",
        result: {
          ok: true,
          settlement: "UNPAID",
          serviceReady: false,
          order: cloneOrder(write.order),
          action: write.action,
          clientOpId: write.clientOpId,
        },
      };
    }
    if (write.kind === "denied") return { kind: "stop", result: { ok: false, code: write.code, clientOpId: write.clientOpId } };
    if (write.kind !== "unknown" && step !== "localReview") return { kind: "stop", result: { ok: false, code: "REVIEW_REQUIRED" } };
    if (consentFlag !== true || consentAccepted !== true) return { kind: "stop", result: { ok: false, code: "CONSENT_REQUIRED" } };
    if (!isCurrent()) return { kind: "stop", result: { ok: false, code: "ACTOR_NOT_CURRENT" } };
    if (!es02Uuid(accountId)) return { kind: "stop", result: { ok: false, code: "INVALID_INPUT" } };

    const retry = write.kind === "unknown" ? write : null;
    let frozen: Es02OfferSelection;
    if (retry) frozen = retry.selection;
    else {
      const assessed = assess();
      if (!assessed.ok) {
        const blocked = assessed.result;
        if (!blocked.ok) {
          return {
            kind: "stop",
            result: {
              ok: false,
              code: blocked.code,
              ...(blocked.preparationErrors ? { preparationErrors: blocked.preparationErrors } : {}),
              ...(blocked.branchCount !== undefined ? { branchCount: blocked.branchCount } : {}),
            },
          };
        }
        return { kind: "stop", result: { ok: false, code: "SELECTION_INCOMPLETE" } };
      }
      frozen = assessed.selection;
    }
    frozen = retry ? retry.selection : freezeSelection(frozen);
    if (frozen.slots.length < 1 || frozen.slots.length > SETUP_PLAN_SLOT_MAX) {
      return { kind: "stop", result: { ok: false, code: "SLOT_COUNT", branchCount: frozen.slots.length } };
    }
    const clientOpId = retry?.clientOpId ?? newClientOpId();
    if (!es02Uuid(clientOpId)) return { kind: "stop", result: { ok: false, code: "INVALID_INPUT" } };
    const handoff = buildPreparationCheckoutHandoff({
      accountId,
      preparation,
      selection: frozen,
      consentAccepted: true,
      clientOpId,
    });
    if (!handoff.ok) {
      return {
        kind: "stop",
        result: {
          ok: false,
          code: handoff.code,
          ...(handoff.preparationErrors ? { preparationErrors: handoff.preparationErrors } : {}),
        },
      };
    }
    write = { kind: "inflight", clientOpId, selection: frozen };
    return { kind: "write", clientOpId, selection: frozen, capturedGeneration: generation, capturedAccountId: accountId };
  }

  function stale(decision: Extract<WriteDecision, { kind: "write" }>): SetupPlanConfirmResult {
    if (!discarded && generation === decision.capturedGeneration) release();
    return { ok: false, code: "STALE_CAPTURE", clientOpId: decision.clientOpId };
  }

  async function perform(decision: Extract<WriteDecision, { kind: "write" }>): Promise<SetupPlanConfirmResult> {
    try {
      if (discarded || generation !== decision.capturedGeneration || accountId !== decision.capturedAccountId || !isCurrent()) {
        return stale(decision);
      }
      const attemptSelection = cloneSelection(decision.selection);
      const attemptOpId = decision.clientOpId;
      const result = await createOrder({
        expectedAccountId: decision.capturedAccountId,
        selection: attemptSelection,
        consentAccepted: true,
        clientOpId: attemptOpId,
      });
      if (discarded || generation !== decision.capturedGeneration || accountId !== decision.capturedAccountId || !isCurrent()) {
        return stale(decision);
      }
      const retainedSelection = decision.selection;
      const retainedOpId = decision.clientOpId;
      if (!result.ok) {
        // Known preflight rejections cannot have created an order.
        // Preserve conservative UNKNOWN fencing and injected financial-adapter denials.
        if (result.code === "PAYMOB_EXTERNAL_DEFERRED" || (!injectedCreateOrder && result.code !== "UNKNOWN")) write = { kind: "idle" };
        else if (result.code === "UNKNOWN") write = { kind: "unknown", clientOpId: retainedOpId, selection: retainedSelection, code: "UNKNOWN" };
        else write = { kind: "denied", clientOpId: retainedOpId, selection: retainedSelection, code: result.code };
        return { ok: false, code: result.code, clientOpId: retainedOpId };
      }
      const retainedOrder = cloneOrder(result.data.order);
      write = {
        kind: "unpaid",
        clientOpId: retainedOpId,
        selection: retainedSelection,
        order: retainedOrder,
        action: result.data.action,
        settlement: "UNPAID",
        serviceReady: false,
      };
      return {
        ok: true,
        settlement: "UNPAID",
        serviceReady: false,
        order: cloneOrder(retainedOrder),
        action: result.data.action,
        clientOpId: retainedOpId,
      };
    } catch {
      if (discarded || generation !== decision.capturedGeneration || accountId !== decision.capturedAccountId || !isCurrent()) {
        return stale(decision);
      }
      // The current product boundary is read-only and provider-deferred. A lost
      // preflight response cannot have started payment and must not lock a draft.
      if (!injectedCreateOrder) {
        write = { kind: "idle" };
        return { ok: false, code: "UNAVAILABLE" };
      }
      write = { kind: "unknown", clientOpId: decision.clientOpId, selection: decision.selection, code: "UNKNOWN" };
      return { ok: false, code: "UNKNOWN", clientOpId: decision.clientOpId };
    }
  }

  function detachInflight() {
    inflight = null;
  }

  function confirmReview(consentFlag: boolean): Promise<SetupPlanConfirmResult> {
    const closed = liveActor();
    if (closed) return Promise.resolve(closed);
    if (inflight) return inflight;
    const decision = decide(consentFlag);
    if (decision.kind === "stop") return Promise.resolve(decision.result);
    const ownerGeneration = generation;
    const promise = perform(decision).finally(() => {
      if (inflight === promise && generation === ownerGeneration) inflight = null;
    });
    inflight = promise;
    return promise;
  }

  function bindActor(next: SetupPlanActor) {
    if (discarded) return;
    if (next.accountId !== accountId || next.captureToken !== captureToken) {
      generation += 1;
      accountId = next.accountId;
      captureToken = next.captureToken;
      isCurrent = next.isCurrent;
      detachInflight();
      clearMemory();
      return;
    }
    isCurrent = next.isCurrent;
  }

  function release() {
    generation += 1;
    discarded = true;
    detachInflight();
    clearMemory();
  }

  return {
    snapshot,
    replacePreparation,
    openPlans,
    backToPreparation,
    setSlot,
    setTerm,
    setConsent,
    localReview,
    confirmReview,
    bindActor,
    release,
    readPlan: commercialPlan,
    presentAddons(persona, pack) {
      return commercialPlan(persona, pack).addons.map((addon) => ({
        id: addon.id,
        label: addon.label,
        included: false as const,
        sale: addon.id === "calls" ? ("FUTURE_NOT_READY_FOR_SALE" as const) : ("OPTIONAL_SEPARATE" as const),
      }));
    },
  };
}
