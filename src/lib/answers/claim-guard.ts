/**
 * Grounding & Claim Guard for Assistant Answers.
 * Validates that responses:
 * - Do NOT make ungrounded prices, discounts, or commercial rates.
 * - Do NOT make fake booking or payment confirmations.
 * - Do NOT falsely claim human handover when not executed.
 * - Do NOT claim unverified shipping, delivery terms, or delivery durations
 *   (e.g., free shipping to Salalah in two days) without backing knowledge sources.
 * When violations occur, safely substitutes a neutral response within the same dispatch path.
 */

const UNGROUNDED_PRICE_AR = /(?:(?:^|[^\p{L}\p{N}])\d+(?:\.\d+)?\s*(?:ر\.ع|ريال(?:ات)?|بيسة|درهم|دراهم|جنيه|دولار|OMR|USD|\$|SAR|AED)(?=$|[^\p{L}\p{N}]))|(?:(?:سعرها|سعره|قيمته|تبدأ من|يبدأ من|تكلفته|التكلفة)\s*[:=]?\s*\d+)/iu;
const UNGROUNDED_PRICE_EN = /(?:[\$£€]|USD|OMR|AED|SAR)\s*\d+|\b\d+(?:\.\d+)?\s*(?:dollars?|omr|usd|aed|sar|rials?|riyals?)\b/i;

const UNGROUNDED_ACTION_AR = /(?:تم الحجز|تم تأكيد موعدك|حجزنا لك|تم تأكيد حجزك|تم الدفع|تم تأكيد الدفع|تم الاسترداد)/u;
const UNGROUNDED_ACTION_EN = /\b(?:booking(?: is)? confirmed|reservation(?: is)? confirmed|payment(?: is)? confirmed|refund(?: is)? processed)\b/i;

const UNGROUNDED_HANDOVER_AR = /(?:سيتواصل معك الموظف|تم تحويلك للموظف|سيقوم موظفنا بالتواصل|تمت إحالتك للموظف)/u;
const UNGROUNDED_HANDOVER_EN = /\b(?:agent will (?:call|contact|reach out)|representative will contact you|transferred to an agent)\b/i;

const UNGROUNDED_DELIVERY_AR = /(?:شحن مجاني|توصيل مجاني|شحن سريع|توصيل سريع|خلال يومين|خلال \d+ (?:يوم|أيام|ساعة|ساعات)|شحن إلى صلالة|توصيل لصلالة)/iu;
const UNGROUNDED_DELIVERY_EN = /\b(?:free shipping|free delivery|delivered within \d+ days?|shipping to \w+ within \d+ days?)\b/i;

const DELIVERY_KEYWORDS_AR = ["شحن", "توصيل", "صلالة", "يومين", "توصيل سريع"];
const DELIVERY_KEYWORDS_EN = ["shipping", "delivery", "salalah", "days", "express"];

export type ClaimGuardResult = {
  valid: boolean;
  reason?: "UNGROUNDED_PRICE" | "UNGROUNDED_ACTION" | "UNGROUNDED_HANDOVER" | "UNGROUNDED_DELIVERY";
  sanitizedText: string;
};

const SAFE_NEUTRAL_REPLY_AR = "عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً في معلومات النشاط المعتمدة. يمكنك توضيح استفسارك لمساعدتك بأفضل شكل.";
const SAFE_NEUTRAL_REPLY_EN = "I apologize, these specific details are not available in our verified knowledge right now. Please clarify your request so I can assist you.";

export function guardResponseAgainstUngroundedClaims(
  text: string,
  sources: Array<{ title?: string; text?: string }> | boolean,
  locale: "ar" | "en" = "ar",
): ClaimGuardResult {
  const trimmed = text.trim();
  const sourceTexts = Array.isArray(sources)
    ? sources.map(s => `${s.title ?? ""} ${s.text ?? ""}`.toLowerCase()).join(" ")
    : "";
  const hasCitations = Array.isArray(sources) ? sources.length > 0 : Boolean(sources);

  const isAr = locale === "ar";
  const priceRegex = isAr ? UNGROUNDED_PRICE_AR : UNGROUNDED_PRICE_EN;
  const actionRegex = isAr ? UNGROUNDED_ACTION_AR : UNGROUNDED_ACTION_EN;
  const handoverRegex = isAr ? UNGROUNDED_HANDOVER_AR : UNGROUNDED_HANDOVER_EN;
  const deliveryRegex = isAr ? UNGROUNDED_DELIVERY_AR : UNGROUNDED_DELIVERY_EN;

  // Check ungrounded delivery claims even if other topics have citations
  if (deliveryRegex.test(trimmed)) {
    const deliveryKeywords = isAr ? DELIVERY_KEYWORDS_AR : DELIVERY_KEYWORDS_EN;
    const sourcesHaveDelivery = deliveryKeywords.some(kw => sourceTexts.includes(kw));
    if (!sourcesHaveDelivery) {
      return {
        valid: false,
        reason: "UNGROUNDED_DELIVERY",
        sanitizedText: isAr ? SAFE_NEUTRAL_REPLY_AR : SAFE_NEUTRAL_REPLY_EN,
      };
    }
  }

  // If citations exist and no ungrounded delivery claims detected, accept
  if (hasCitations) {
    return { valid: true, sanitizedText: trimmed };
  }

  // Citations are empty ([]). Check all ungrounded claims.
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
