/** Pure preview classification. Does not contact providers, verify actions or transfer conversations.
 * Keywords, order and substring matching are extracted unchanged from the existing router policy.
 * A null previewReason means no policy keyword matched; it is not evidence that a request is safe.
 */
// These requests need authoritative business state, not a more capable language model.
// This conservative local guard complements (and cannot replace) the shared action verifier.
const SENSITIVE_KEYWORDS = [
  "استرجاع", "تعويض", "تحويل بنكي", "حوالة", "تأكيد الدفع", "استلام الدفع", "تم الدفع",
  "بيانات البطاقة", "كلمة المرور", "رمز التحقق", "تشخيص", "استشارة قانونية",
  "refund", "compensation", "bank transfer", "payment received", "payment confirmed",
  "credit card", "password", "otp", "diagnosis", "legal advice",
];
export const DEFAULT_RISK_KEYWORDS: readonly string[] = [
    "شكوى",
    "استرجاع",
    "غش",
    "نصب",
    "احتيال",
    "سرقة",
    "محامي",
    "قضية",
    "تعويض",
    "شرطة",
    "حماية المستهلك",
    "سيء جدا",
    "غير راضي",
    "ارفع شكوى",
    "اريد المدير",
    "المدير المسؤول",
    "تالف",
    "خربان",
    "متضرر",
    "خصم خاص",
    "تفاوض",
    "استثناء",
    "complaint",
    "refund",
    "fraud",
    "scam",
    "lawyer",
    "compensation",
    "police",
    "consumer protection",
    "unacceptable",
    "manager",
    "damaged",
    "negotiate",
  ];

export type HandoffPreviewReason = "human_request" | "sensitive";
export type HandoffPolicyClassification = {
 matchedRisk: string | undefined;
 verificationRequired: boolean;
 previewReason: HandoffPreviewReason | null;
};
export function classifyHandoffPolicy(question: string, riskKeywords: readonly string[] = DEFAULT_RISK_KEYWORDS): HandoffPolicyClassification {
 const lower = (question || "").toLowerCase();
 const verificationRequired = SENSITIVE_KEYWORDS.some(keyword => lower.includes(keyword));
 const matchedRisk = riskKeywords.find(keyword => lower.includes(keyword.toLowerCase()));
 // These manager requests already belong to the existing risk list; no new trigger is added.
 const humanRequest = matchedRisk !== undefined && ["اريد المدير", "المدير المسؤول", "manager"].includes(matchedRisk.toLowerCase());
 return {matchedRisk, verificationRequired, previewReason: matchedRisk || verificationRequired ? humanRequest && !verificationRequired ? "human_request" : "sensitive" : null};
}
