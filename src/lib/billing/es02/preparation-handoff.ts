/**
 * Area A — in-memory preparation → immutable offer handoff.
 * Business/branch facts stay page-local; handoff carries offer + consent only.
 * Branch count must equal purchased branch slot quantity.
 */

import { validatePreparation, type Preparation } from "@/lib/tenancy/prepayment-preparation";
import { es02Uuid, type Es02CheckoutHandoff, type Es02ImmutableOffer } from "./contracts";
import {
  isEs02OfferSelection,
  normalizeOfferSelection,
  resolveEs02Offer,
  type Es02LegacySingleSelection,
  type Es02OfferSelection,
} from "./commercial-offer";

export type PreparationHandoffInput = {
  accountId: string;
  preparation: Preparation;
  selection: Es02OfferSelection | Es02LegacySingleSelection;
  consentAccepted: boolean;
  clientOpId: string;
  /** @deprecated Not authority — ignored. */
  captureGeneration?: number;
};

export type PreparationHandoffResult =
  | {
      ok: true;
      handoff: Es02CheckoutHandoff;
      localPreparationComplete: true;
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "OFFER_TAMPER" | "PREPARATION_INCOMPLETE" | "CONSENT_REQUIRED" | "SLOT_MISMATCH";
      preparationErrors?: string[];
    };

export function buildPreparationCheckoutHandoff(
  input: PreparationHandoffInput,
): PreparationHandoffResult {
  if (!input || !es02Uuid(input.accountId) || !es02Uuid(input.clientOpId)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (!isEs02OfferSelection(input.selection)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const prepErrors = validatePreparation(input.preparation);
  if (prepErrors.length) {
    return { ok: false, code: "PREPARATION_INCOMPLETE", preparationErrors: prepErrors };
  }
  if (input.consentAccepted !== true) {
    return { ok: false, code: "CONSENT_REQUIRED" };
  }
  const normalized = normalizeOfferSelection(input.selection);
  if (!normalized) return { ok: false, code: "INVALID_INPUT" };
  if (input.preparation.branches.length !== normalized.slots.length) {
    return { ok: false, code: "SLOT_MISMATCH" };
  }
  const resolved = resolveEs02Offer(normalized);
  if (!resolved.ok) return { ok: false, code: resolved.code };
  if (resolved.offer.branchSlots < input.preparation.branches.length) {
    return { ok: false, code: "SLOT_MISMATCH" };
  }
  return {
    ok: true,
    localPreparationComplete: true,
    handoff: {
      accountId: input.accountId,
      offer: resolved.offer,
      consentAccepted: true,
      clientOpId: input.clientOpId,
    },
  };
}

export function sanitizeCheckoutPayload(value: unknown): {
  selection: Es02OfferSelection;
  consentAccepted: true;
  clientOpId: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.consentAccepted !== true || !es02Uuid(v.clientOpId)) return null;
  const selection = normalizeOfferSelection(v.selection ?? v);
  if (!selection) return null;
  for (const leak of ["preparation", "business", "branches", "name", "phone", "city", "draft"]) {
    if (leak in v) return null;
  }
  return {
    selection,
    consentAccepted: true,
    clientOpId: v.clientOpId as string,
  };
}

export function handoffOfferOnly(handoff: Es02CheckoutHandoff): Es02ImmutableOffer {
  return handoff.offer;
}
