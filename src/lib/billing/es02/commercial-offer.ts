/**
 * Server-side immutable offer resolution — per-branch persona/tier, one order term.
 * Twelve BASE offers (6 plans × monthly|yearly); order total = sum of slot base prices.
 */

import {
  commercialAmount,
  commercialCatalogRevision,
  commercialPlan,
  type CommercialPlan,
} from "@/components/app/subscription-commercial-catalog";
import type {
  SubscriptionPackage,
  SubscriptionPersona,
  SubscriptionTerm,
} from "@/components/app/subscription-offers-view";
import {
  ES02_CATALOG_REVISION,
  ES02_CURRENCY,
  ES02_PRODUCT_CODE,
  ES02_PURPOSE_INITIAL_SUBSCRIPTION,
  type Es02BranchSlotOffer,
  type Es02ImmutableOffer,
} from "./contracts";

const PERSONAS: readonly SubscriptionPersona[] = ["level_1", "level_2", "level_3"];
const PACKAGES: readonly SubscriptionPackage[] = ["basic", "premium"];
const TERMS: readonly SubscriptionTerm[] = ["monthly", "yearly"];

export type Es02SlotSelection = {
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
};

export type Es02OfferSelection = {
  term: SubscriptionTerm;
  /** One entry per purchased branch slot (not messaging channels). */
  slots: readonly Es02SlotSelection[];
  claimedAmountBaisa?: number;
  claimedCatalogRevision?: string;
  claimedBranchSlots?: number;
};

/** Compat: single persona/package/term → one slot. */
export type Es02LegacySingleSelection = {
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
  term: SubscriptionTerm;
  claimedAmountBaisa?: number;
  claimedCatalogRevision?: string;
  claimedBranchSlots?: number;
};

export function normalizeOfferSelection(value: unknown): Es02OfferSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.slots) && TERMS.includes(v.term as SubscriptionTerm)) {
    if (!v.slots.length || v.slots.length > 32) return null;
    const slots: Es02SlotSelection[] = [];
    for (const raw of v.slots) {
      if (!raw || typeof raw !== "object") return null;
      const s = raw as Record<string, unknown>;
      if (!PERSONAS.includes(s.persona as SubscriptionPersona) || !PACKAGES.includes(s.package as SubscriptionPackage)) {
        return null;
      }
      slots.push({ persona: s.persona as SubscriptionPersona, package: s.package as SubscriptionPackage });
    }
    return {
      term: v.term as SubscriptionTerm,
      slots,
      ...(typeof v.claimedAmountBaisa === "number" ? { claimedAmountBaisa: v.claimedAmountBaisa } : {}),
      ...(typeof v.claimedCatalogRevision === "string" ? { claimedCatalogRevision: v.claimedCatalogRevision } : {}),
      ...(typeof v.claimedBranchSlots === "number" ? { claimedBranchSlots: v.claimedBranchSlots } : {}),
    };
  }
  if (
    PERSONAS.includes(v.persona as SubscriptionPersona) &&
    PACKAGES.includes(v.package as SubscriptionPackage) &&
    TERMS.includes(v.term as SubscriptionTerm)
  ) {
    return {
      term: v.term as SubscriptionTerm,
      slots: [{ persona: v.persona as SubscriptionPersona, package: v.package as SubscriptionPackage }],
      ...(typeof v.claimedAmountBaisa === "number" ? { claimedAmountBaisa: v.claimedAmountBaisa } : {}),
      ...(typeof v.claimedCatalogRevision === "string" ? { claimedCatalogRevision: v.claimedCatalogRevision } : {}),
      ...(typeof v.claimedBranchSlots === "number" ? { claimedBranchSlots: v.claimedBranchSlots } : {}),
    };
  }
  return null;
}

export function isEs02OfferSelection(value: unknown): value is Es02OfferSelection | Es02LegacySingleSelection {
  return normalizeOfferSelection(value) !== null;
}

/** Twelve approved BASE terms (not every multi-slot combination). */
export function listApprovedEs02BaseOffers(): Es02ImmutableOffer[] {
  const out: Es02ImmutableOffer[] = [];
  for (const persona of PERSONAS) {
    for (const pack of PACKAGES) {
      for (const term of TERMS) {
        const resolved = resolveEs02Offer({ term, slots: [{ persona, package: pack }] });
        if (resolved.ok) out.push(resolved.offer);
      }
    }
  }
  return out;
}

export function resolveEs02Offer(
  selection: Es02OfferSelection | Es02LegacySingleSelection,
): { ok: true; offer: Es02ImmutableOffer } | { ok: false; code: "OFFER_TAMPER" | "INVALID_INPUT" } {
  const normalized = normalizeOfferSelection(selection);
  if (!normalized) return { ok: false, code: "INVALID_INPUT" };
  if (
    normalized.claimedCatalogRevision !== undefined &&
    normalized.claimedCatalogRevision !== commercialCatalogRevision &&
    normalized.claimedCatalogRevision !== ES02_CATALOG_REVISION
  ) {
    return { ok: false, code: "OFFER_TAMPER" };
  }
  const slots: Es02BranchSlotOffer[] = [];
  let amountBaisa = 0;
  let repliesPerMonth = 0;
  let employees = 0;
  let channels = 0;
  for (let i = 0; i < normalized.slots.length; i++) {
    const sel = normalized.slots[i]!;
    let plan: CommercialPlan;
    try {
      plan = commercialPlan(sel.persona, sel.package);
    } catch {
      return { ok: false, code: "INVALID_INPUT" };
    }
    const slotAmount = commercialAmount(plan, normalized.term);
    amountBaisa += slotAmount;
    repliesPerMonth += plan.replies;
    employees += plan.employees;
    channels += plan.channels;
    slots.push({
      slotIndex: i,
      persona: sel.persona,
      package: sel.package,
      amountBaisa: slotAmount,
      repliesPerMonth: plan.replies,
      employees: plan.employees,
      channels: plan.channels,
    });
  }
  const branchSlots = slots.length;
  if (normalized.claimedBranchSlots !== undefined && normalized.claimedBranchSlots !== branchSlots) {
    return { ok: false, code: "OFFER_TAMPER" };
  }
  if (normalized.claimedAmountBaisa !== undefined && normalized.claimedAmountBaisa !== amountBaisa) {
    return { ok: false, code: "OFFER_TAMPER" };
  }
  const primary = slots[0]!;
  return {
    ok: true,
    offer: {
      catalogRevision: ES02_CATALOG_REVISION,
      term: normalized.term,
      slots,
      branchSlots,
      amountBaisa,
      currency: ES02_CURRENCY,
      purpose: ES02_PURPOSE_INITIAL_SUBSCRIPTION,
      productCode: ES02_PRODUCT_CODE,
      repliesPerMonth,
      employees,
      channels,
      persona: primary.persona,
      package: primary.package,
    },
  };
}

export function offerFingerprint(offer: Es02ImmutableOffer): string {
  return JSON.stringify([
    offer.catalogRevision,
    offer.term,
    offer.branchSlots,
    offer.amountBaisa,
    offer.currency,
    offer.purpose,
    offer.productCode,
    offer.slots.map((s) => [s.slotIndex, s.persona, s.package, s.amountBaisa, s.repliesPerMonth, s.employees, s.channels]),
  ]);
}

export function offersEqual(a: Es02ImmutableOffer, b: Es02ImmutableOffer): boolean {
  return offerFingerprint(a) === offerFingerprint(b);
}
