/**
 * Pure account-order mapping and fencing helpers (no I/O).
 */

import {
  ES02_CATALOG_REVISION,
  ES02_CURRENCY,
  ES02_PRODUCT_CODE,
  ES02_PURPOSE_INITIAL_SUBSCRIPTION,
  es02Uuid,
  type Es02AccountOrderView,
  type Es02BranchSlotOffer,
  type Es02ImmutableOffer,
  type Es02OrderStatus,
  type Es02OwnedRecoveryView,
} from "./contracts";
import { offersEqual, resolveRecordedEs02Offer } from "./commercial-offer";
import { commercialCatalogRevision } from "@/components/app/subscription-commercial-catalog";

const ORDER_STATUSES: readonly Es02OrderStatus[] = [
  "open",
  "collection_pending",
  "settled",
  "provisioning",
  "provisioned",
  "failed",
  "cancelled",
];

function parseSlots(value: unknown, term: "monthly" | "yearly", revision: string): Es02BranchSlotOffer[] | null {
  const resolveRecorded = (selection: Parameters<typeof resolveRecordedEs02Offer>[0]) => resolveRecordedEs02Offer(selection, revision);
  if (!Array.isArray(value) || !value.length) return null;
  const slots: Es02BranchSlotOffer[] = [];
  for (let i = 0; i < value.length; i++) {
    const s = value[i];
    if (!s || typeof s !== "object") return null;
    const row = s as Record<string, unknown>;
    const persona = row.persona;
    const pack = row.package;
    if (
      !["level_1", "level_2", "level_3"].includes(String(persona)) ||
      !["basic", "premium"].includes(String(pack))
    ) {
      return null;
    }
    const resolved = resolveRecorded({
      term,
      slots: [{ persona: persona as Es02BranchSlotOffer["persona"], package: pack as Es02BranchSlotOffer["package"] }],
    });
    if (!resolved.ok) return null;
    const base = resolved.offer.slots[0]!;
    if (
      row.amountBaisa !== undefined &&
      (!Number.isSafeInteger(row.amountBaisa) || row.amountBaisa !== base.amountBaisa)
    ) {
      return null;
    }
    slots.push({
      slotIndex: typeof row.slotIndex === "number" ? row.slotIndex : i,
      persona: base.persona,
      package: base.package,
      amountBaisa: base.amountBaisa,
      repliesPerMonth: base.repliesPerMonth,
      employees: base.employees,
      channels: base.channels,
      // Rebuild features from the recorded catalog revision (legacy rows without features stay compatible).
      features: base.features,
    });
  }
  return slots;
}

export function parseOfferRow(value: unknown): Es02ImmutableOffer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    (v.catalogRevision !== ES02_CATALOG_REVISION && v.catalogRevision !== commercialCatalogRevision) ||
    v.currency !== ES02_CURRENCY ||
    v.purpose !== ES02_PURPOSE_INITIAL_SUBSCRIPTION ||
    v.productCode !== ES02_PRODUCT_CODE ||
    !["monthly", "yearly"].includes(String(v.term))
  ) {
    return null;
  }
  const term = v.term as "monthly" | "yearly";
  const resolveRecorded = (selection: Parameters<typeof resolveRecordedEs02Offer>[0]) => resolveRecordedEs02Offer(selection, String(v.catalogRevision));
  let slots = parseSlots(v.slots, term, String(v.catalogRevision));
  if (!slots) {
    if (
      !["level_1", "level_2", "level_3"].includes(String(v.persona)) ||
      !["basic", "premium"].includes(String(v.package))
    ) {
      return null;
    }
    const resolved = resolveRecorded({
      term,
      slots: [
        {
          persona: v.persona as Es02BranchSlotOffer["persona"],
          package: v.package as Es02BranchSlotOffer["package"],
        },
      ],
    });
    if (!resolved.ok) return null;
    slots = [...resolved.offer.slots];
  }
  const recomputed = resolveRecorded({
    term,
    slots: slots.map((s) => ({ persona: s.persona, package: s.package })),
  });
  if (!recomputed.ok) return null;
  if (
    !Number.isSafeInteger(v.amountBaisa) ||
    v.amountBaisa !== recomputed.offer.amountBaisa ||
    !Number.isSafeInteger(v.branchSlots) ||
    v.branchSlots !== recomputed.offer.branchSlots
  ) {
    return null;
  }
  return recomputed.offer;
}

export function parseAccountOrderRow(value: unknown, expectedAccountId: string): Es02AccountOrderView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.accountId !== expectedAccountId || !es02Uuid(v.orderId) || !es02Uuid(v.paymentAttemptId)) return null;
  if (!ORDER_STATUSES.includes(v.status as Es02OrderStatus)) return null;
  if (typeof v.specialReference !== "string" || !es02Uuid(v.originalOrderGroupId)) return null;
  if (v.environment !== "test" && v.environment !== "live") return null;
  const offer = parseOfferRow(v.offer);
  if (!offer) return null;
  if (!(v.settledAt === null || (typeof v.settledAt === "string" && Number.isFinite(Date.parse(v.settledAt))))) {
    return null;
  }
  if (!(v.provisionedCompanyId === null || es02Uuid(v.provisionedCompanyId))) return null;
  return {
    orderId: v.orderId as string,
    accountId: expectedAccountId,
    status: v.status as Es02OrderStatus,
    offer,
    specialReference: v.specialReference as string,
    paymentAttemptId: v.paymentAttemptId as string,
    environment: v.environment as "test" | "live",
    settledAt: v.settledAt as string | null,
    provisionedCompanyId: v.provisionedCompanyId as string | null,
    originalOrderGroupId: v.originalOrderGroupId as string,
  };
}

/** Reject contradictory RPC identity — never overwrite foreign accountId with actor. */
export function parseOwnedRecoveryRow(
  value: unknown,
  expectedAccountId: string,
): Es02OwnedRecoveryView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!es02Uuid(v.accountId) || v.accountId !== expectedAccountId) return null;
  if (!es02Uuid(v.orderId)) return null;
  if (v.status !== "settled_unprovisioned" && v.status !== "provisioned") return null;
  const offer = parseOfferRow(v.offer);
  if (!offer || typeof v.specialReference !== "string") return null;
  if (!(v.companyId === null || es02Uuid(v.companyId))) return null;
  return {
    orderId: v.orderId as string,
    accountId: expectedAccountId,
    status: v.status,
    specialReference: v.specialReference as string,
    offer,
    companyId: v.companyId as string | null,
  };
}

export function assertOfferMatchesOrder(
  order: Es02AccountOrderView,
  claimed: Es02ImmutableOffer,
): boolean {
  return offersEqual(order.offer, claimed);
}

export function foreignOwnershipDenied(actorAccountId: string, orderAccountId: string): boolean {
  return actorAccountId !== orderAccountId;
}
