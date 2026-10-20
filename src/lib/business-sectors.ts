import { businessTypeLabel } from "@/lib/business-types";

/**
 * Screen 1 broad industries. These are not detailed business-type IDs.
 * `restaurant` is not implied by food, and `retail` is not implied by e-commerce.
 * Stored only in Preparation.type as `broad:<id>` after an explicit chip choice.
 */
export const broadSectors = [
  { id: "retail_ecommerce", ar: "التجارة الإلكترونية والتجزئة", en: "E-commerce and retail" },
  { id: "health", ar: "الرعاية الصحية", en: "Healthcare" },
  { id: "education", ar: "التعليم والتدريب", en: "Education and training" },
  { id: "agency", ar: "وكالة رقمية", en: "Digital agency" },
  { id: "finance", ar: "البنوك والتقنية المالية", en: "Banking and fintech" },
  { id: "food", ar: "المطاعم والأغذية", en: "Restaurants and food" },
  { id: "travel", ar: "السفر والسياحة", en: "Travel and tourism" },
  { id: "technology", ar: "التقنية والإلكترونيات", en: "Technology and electronics" },
  { id: "logistics", ar: "اللوجستيات وسلاسل الإمداد", en: "Logistics and supply chains" },
  { id: "creative", ar: "الإبداع والفنون والأزياء", en: "Creative arts and fashion" },
  { id: "nonprofit", ar: "غير ربحي أو أثر اجتماعي", en: "Nonprofit or social impact" },
  { id: "community", ar: "مجتمع ديني أو محلي", en: "Religious or local community" },
  { id: "other", ar: "أخرى", en: "Other" },
] as const;

export type BroadSectorId = (typeof broadSectors)[number]["id"];

const byId = new Map(broadSectors.map((item) => [item.id, item]));

export function broadSectorStorageId(id: BroadSectorId): string {
  return `broad:${id}`;
}

/** Reads an explicit broad choice. Detailed IDs, legacy `store`, and custom text return null. */
export function broadSectorFromType(type: string): BroadSectorId | null {
  if (!type.startsWith("broad:")) return null;
  const id = type.slice("broad:".length);
  return byId.has(id as BroadSectorId) ? (id as BroadSectorId) : null;
}

export function broadSectorLabel(type: string, ar: boolean): string | null {
  const id = broadSectorFromType(type);
  if (!id) return null;
  const item = byId.get(id)!;
  return ar ? item.ar : item.en;
}

/**
 * A non-empty type that is not a known broad chip. The stored string is unchanged.
 * `store` still displays through the existing retail label while remaining `store`.
 */
export function preservedDetailedTypeLabel(type: string, ar: boolean): string | null {
  if (!type.trim() || broadSectorFromType(type)) return null;
  return businessTypeLabel(type, ar);
}
