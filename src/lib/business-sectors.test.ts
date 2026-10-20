import { expect, it } from "vitest";
import { businessTypes } from "@/lib/business-types";
import {
  broadSectorFromType,
  broadSectorLabel,
  broadSectorStorageId,
  broadSectors,
  preservedDetailedTypeLabel,
} from "@/lib/business-sectors";

it("stores the thirteen image sectors under broad ids that do not collide with detailed types", () => {
  expect(broadSectors).toHaveLength(13);
  expect(broadSectors.map((item) => item.ar)).toEqual([
    "التجارة الإلكترونية والتجزئة",
    "الرعاية الصحية",
    "التعليم والتدريب",
    "وكالة رقمية",
    "البنوك والتقنية المالية",
    "المطاعم والأغذية",
    "السفر والسياحة",
    "التقنية والإلكترونيات",
    "اللوجستيات وسلاسل الإمداد",
    "الإبداع والفنون والأزياء",
    "غير ربحي أو أثر اجتماعي",
    "مجتمع ديني أو محلي",
    "أخرى",
  ]);
  const detailed = new Set(businessTypes.map((item) => item.id));
  for (const item of broadSectors) {
    const stored = broadSectorStorageId(item.id);
    expect(stored.startsWith("broad:")).toBe(true);
    expect(detailed.has(stored)).toBe(false);
    expect(detailed.has(item.id) && item.id !== "other").toBe(false);
    expect(broadSectorFromType(stored)).toBe(item.id);
  }
  expect(broadSectorStorageId("other")).not.toBe("other");
  expect(broadSectorStorageId("food")).not.toBe("restaurant");
  expect(broadSectorStorageId("retail_ecommerce")).not.toBe("retail");
  expect(broadSectorStorageId("retail_ecommerce")).not.toBe("store");
  expect(broadSectorStorageId("travel")).not.toBe("hotel");
  expect(broadSectorStorageId("travel")).not.toBe("travel_agency");
  expect(broadSectorLabel(broadSectorStorageId("travel"), true)).toBe("السفر والسياحة");
});

it("keeps legacy detailed ids and custom text unselected and unmigrated", () => {
  expect(broadSectorFromType("restaurant")).toBeNull();
  expect(broadSectorFromType("store")).toBeNull();
  expect(broadSectorFromType("other")).toBeNull();
  expect(broadSectorFromType("تنسيق زهور")).toBeNull();
  expect(broadSectorFromType("broad:unknown")).toBeNull();
  expect(broadSectorFromType("")).toBeNull();
  expect(preservedDetailedTypeLabel("restaurant", true)).toBe("مطعم");
  expect(preservedDetailedTypeLabel("store", true)).toBe("متجر تجزئة عام");
  expect(preservedDetailedTypeLabel("تنسيق زهور", false)).toBe("تنسيق زهور");
  expect(preservedDetailedTypeLabel(broadSectorStorageId("food"), true)).toBeNull();
  expect(broadSectorLabel(broadSectorStorageId("food"), true)).toBe("المطاعم والأغذية");
  expect(broadSectorLabel("restaurant", true)).toBeNull();
});
