/**
 * Current product scope: ONE branch per business (activity).
 * Multi-branch support is deferred in docs/MASTER_PLAN.md — its tables,
 * columns, isolation and permission model are preserved, not removed.
 * This module is the single source for the server-side policy and the
 * user-facing message. It never converts, merges or hides existing rows.
 */
export const SECOND_BRANCH_DEFERRED = "SECOND_BRANCH_DEFERRED" as const;
export const SINGLE_BRANCH_MAX_BRANCHES = 1 as const;

export const SECOND_BRANCH_DEFERRED_MESSAGE = {
  ar: "حاليًا يدعم Velora فرعًا واحدًا لكل نشاط. دعم الفروع المتعددة مؤجَّل وسيُتاح لاحقًا؛ لم يُنشأ أي فرع إضافي ولم تُغيَّر بيانات فرعك الحالي.",
  en: "Velora currently supports one branch per business. Multi-branch support is deferred and will come later; no additional branch was created and your current branch data was not changed.",
} as const;

/** Pure check for a requested branch/slot count at a server boundary. */
export function singleBranchCountAllowed(count: unknown): boolean {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count <= SINGLE_BRANCH_MAX_BRANCHES;
}

/** Recognizes the native guard raised by private.es02_single_branch_guard(). */
export function isSecondBranchDeferredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return [row.message, row.details, row.hint, row.code].some(
    (value) => typeof value === "string" && value.includes(SECOND_BRANCH_DEFERRED),
  );
}

export function secondBranchDeferredMessage(locale: "ar" | "en"): string {
  return SECOND_BRANCH_DEFERRED_MESSAGE[locale];
}
