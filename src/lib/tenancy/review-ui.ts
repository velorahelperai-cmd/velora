import type { CompanyReviewRequest } from "./types";

export function canResubmitReview(review: Pick<CompanyReviewRequest, "status" | "proof_current"> | null): boolean {
  return Boolean(review && (review.status === "changes_requested" || review.proof_current !== true));
}

export function reviewFailureMessage(code: string, locale: string): string {
  const ar = locale === "ar";
  switch (code) {
    case "FILE_REPREPARE_REQUIRED": return ar ? "ملف معرفة يفتقد إثبات نسخة الاستخراج؛ يحتاج إعادة تجهيز ثم اعتماد صريح." : "A knowledge file needs explicit re-preparation and approval to prove its extraction version.";
    case "FILE_CHANGED": case "CONFLICT": return ar ? "تغيرت البيانات أو الصلاحيات أو نسخة الطلب. حدّث العرض ثم أعد تقديم المراجعة." : "Data, permissions or the request changed. Refresh and submit the current review again.";
    case "PROFILE_INCOMPLETE": return ar ? "احفظ بيانات النشاط ونوعه وساعات العمل أولًا." : "Save the business name, type and working hours first.";
    case "KNOWLEDGE_INCOMPLETE": return ar ? "تحتاج مصدر معرفة جاهزًا ومعتمدًا على نسخته الحالية." : "At least one ready knowledge source must be approved for its current version.";
    case "FILE_LIMIT": case "SOURCE_LIMIT": return ar ? "المعرفة تتجاوز حدود الفحص الآمن؛ راجع حجم الملفات وعدد المصادر المعتمدة." : "Knowledge exceeds the safe file/source verification limits.";
    default: return ar ? "تعذر إثبات جاهزية البيانات من السيرفر. حاول مجددًا؛ لم يُسجَّل نجاح." : "Server verification is unavailable. Retry; no success was recorded.";
  }
}
