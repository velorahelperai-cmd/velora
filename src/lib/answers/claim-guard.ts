/**
 * Grounding & Claim Guard for Assistant Answers.
 * Validates that responses without citations ([]):
 * - Do NOT make specific commercial commitments, prices, or rates.
 * - Do NOT make fake booking or payment confirmations.
 * - Do NOT falsely claim human handover when not executed.
 * When violations occur, safely substitutes a neutral response within the same dispatch path.
 */

const UNGROUNDED_PRICE_AR = /(?:(?:^|[^\p{L}\p{N}])\d+(?:\.\d+)?\s*(?:ر\.ع|ريال(?:ات)?|بيسة|درهم|دراهم|جنيه|دولار|OMR|USD|\$|SAR|AED)(?=$|[^\p{L}\p{N}]))|(?:(?:سعرها|سعره|قيمته|تبدأ من|يبدأ من|تكلفته|التكلفة)\s*[:=]?\s*\d+)/iu;
const UNGROUNDED_PRICE_EN = /(?:[\$£€]|USD|OMR|AED|SAR)\s*\d+|\b\d+(?:\.\d+)?\s*(?:dollars?|omr|usd|aed|sar|rials?|riyals?)\b/i;

const UNGROUNDED_ACTION_AR = /(?:تم الحجز|تم تأكيد موعدك|حجزنا لك|تم تأكيد حجزك|تم الدفع|تم تأكيد الدفع|تم الاسترداد)/u;
const UNGROUNDED_ACTION_EN = /\b(?:booking(?: is)? confirmed|reservation(?: is)? confirmed|payment(?: is)? confirmed|refund(?: is)? processed)\b/i;

const UNGROUNDED_HANDOVER_AR = /(?:سيتواصل معك الموظف|تم تحويلك للموظف|سيقوم موظفنا بالتواصل|تمت إحالتك للموظف)/u;
const UNGROUNDED_HANDOVER_EN = /\b(?:agent will (?:call|contact|reach out)|representative will contact you|transferred to an agent)\b/i;

export type ClaimGuardResult = {
  valid: boolean;
  reason?: "UNGROUNDED_PRICE" | "UNGROUNDED_ACTION" | "UNGROUNDED_HANDOVER";
  sanitizedText: string;
};

const SAFE_NEUTRAL_REPLY_AR = "عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً في معلومات النشاط المعتمدة. يمكنك توضيح استفسارك لمساعدتك بأفضل شكل.";
const SAFE_NEUTRAL_REPLY_EN = "I apologize, these specific details are not available in our verified knowledge right now. Please clarify your request so I can assist you.";

export function guardResponseAgainstUngroundedClaims(
  text: string,
  hasCitations: boolean,
  locale: "ar" | "en" = "ar",
): ClaimGuardResult {
  const trimmed = text.trim();
  if (hasCitations) {
    return { valid: true, sanitizedText: trimmed };
  }

  // Citations are empty ([]). Check for ungrounded claims.
  const isAr = locale === "ar";
  const priceRegex = isAr ? UNGROUNDED_PRICE_AR : UNGROUNDED_PRICE_EN;
  const actionRegex = isAr ? UNGROUNDED_ACTION_AR : UNGROUNDED_ACTION_EN;
  const handoverRegex = isAr ? UNGROUNDED_HANDOVER_AR : UNGROUNDED_HANDOVER_EN;

  if (priceRegex.test(trimmed)) {
    return {
      valid: false,
      reason: "UNGROUNDED_PRICE",
      sanitizedText: isAr ? SAFE_NEUTRAL_REPLY_AR : SAFE_NEUTRAL_REPLY_EN,
    };
  }

  if (actionRegex.test(trimmed)) {
    return {
      valid: false,
      reason: "UNGROUNDED_ACTION",
      sanitizedText: isAr ? SAFE_NEUTRAL_REPLY_AR : SAFE_NEUTRAL_REPLY_EN,
    };
  }

  if (handoverRegex.test(trimmed)) {
    return {
      valid: false,
      reason: "UNGROUNDED_HANDOVER",
      sanitizedText: isAr ? SAFE_NEUTRAL_REPLY_AR : SAFE_NEUTRAL_REPLY_EN,
    };
  }

  return { valid: true, sanitizedText: trimmed };
}
