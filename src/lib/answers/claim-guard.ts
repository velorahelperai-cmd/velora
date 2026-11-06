/**
 * Grounding & Claim Guard for Assistant Answers.
 * Validates that responses:
 * - Do NOT make ungrounded prices, discounts, or commercial rates.
 * - Do NOT make fake booking or payment confirmations.
 * - Do NOT falsely claim human handover when not executed.
 * - Do NOT claim unverified shipping, delivery terms, or delivery durations
 *   (e.g., free shipping or delivery timeline) without backing knowledge sources.
 * When violations occur, safely answers with the grounded portion while explicitly
 * stating that the unsupported detail is unavailable, without breaking the conversation.
 */

const UNGROUNDED_PRICE_AR = /(?:(?:^|[^\p{L}\p{N}])\d+(?:\.\d+)?\s*(?:ر\.ع|ريال(?:ات)?|بيسة|درهم|دراهم|جنيه|دولار|OMR|USD|\$|SAR|AED)(?=$|[^\p{L}\p{N}]))|(?:(?:سعرها|سعره|قيمته|تبدأ من|يبدأ من|تكلفته|التكلفة)\s*[:=]?\s*\d+)/iu;
const UNGROUNDED_PRICE_EN = /(?:[\$£€]|USD|OMR|AED|SAR)\s*\d+|\b\d+(?:\.\d+)?\s*(?:dollars?|omr|usd|aed|sar|rials?|riyals?)\b/i;

const UNGROUNDED_ACTION_AR = /(?:تم الحجز|تم تأكيد موعدك|حجزنا لك|تم تأكيد حجزك|تم الدفع|تم تأكيد الدفع|تم الاسترداد)/u;
const UNGROUNDED_ACTION_EN = /\b(?:booking(?: is)? confirmed|reservation(?: is)? confirmed|payment(?: is)? confirmed|refund(?: is)? processed)\b/i;

const UNGROUNDED_HANDOVER_AR = /(?:سيتواصل معك الموظف|تم تحويلك للموظف|سيقوم موظفنا بالتواصل|تمت إحالتك للموظف)/u;
const UNGROUNDED_HANDOVER_EN = /\b(?:agent will (?:call|contact|reach out)|representative will contact you|transferred to an agent)\b/i;

const UNGROUNDED_DELIVERY_AR = /(?:شحن مجاني|توصيل مجاني|شحن سريع|توصيل سريع|خلال يومين|خلال \d+ (?:يوم|أيام|ساعة|ساعات)|شحن إلى صلالة|توصيل لصلالة)/iu;
const UNGROUNDED_DELIVERY_EN = /\b(?:free shipping|free delivery|delivered within \d+ days?|shipping to \w+ within \d+ days?)\b/i;

const SHIPPING_NEGATION_AR = /(?:لا\s*(?:نوفر|يوجد|نقدم|يتوفر|متاح|نقوم بـ?)\s*(?:الشحن|التوصيل|خدمة الشحن|خدمة التوصيل)|(?:الشحن|التوصيل)\s*غير\s*متاح)/u;
const SHIPPING_NEGATION_EN = /\b(?:do not|don't|no)\s*(?:offer|provide)?\s*(?:shipping|delivery)\b/i;

const PRICE_KEYWORDS_AR = ["سعر", "أسعار", "تكلفة", "تكاليف", "قيمته", "قيمة", "تبدأ", "يبدأ", "ر.ع", "ريال", "بيسة", "درهم", "جنيه", "دولار", "omr", "usd", "$", "sar", "aed"];
const PRICE_KEYWORDS_EN = ["price", "cost", "fee", "rate", "dollar", "omr", "usd", "$", "eur", "£", "€"];

export type ClaimGuardResult = {
  valid: boolean;
  reason?: "UNGROUNDED_PRICE" | "UNGROUNDED_ACTION" | "UNGROUNDED_HANDOVER" | "UNGROUNDED_DELIVERY";
  sanitizedText: string;
};

const SAFE_NEUTRAL_REPLY_AR = "عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً في معلومات النشاط المعتمدة. يمكنك توضيح استفسارك لمساعدتك بأفضل شكل.";
const SAFE_NEUTRAL_REPLY_EN = "I apologize, these specific details are not available in our verified knowledge right now. Please clarify your request so I can assist you.";

function checkPriceGrounded(text: string, sourceTexts: string, isAr: boolean): boolean {
  if (!sourceTexts.trim()) return false;
  const priceKeywords = isAr ? PRICE_KEYWORDS_AR : PRICE_KEYWORDS_EN;
  const sourceHasPriceKeywords = priceKeywords.some(kw => sourceTexts.includes(kw));
  if (!sourceHasPriceKeywords) return false;

  const numbersInText = text.match(/\d+(?:\.\d+)?/g);
  if (!numbersInText || numbersInText.length === 0) return true;

  return numbersInText.some(num => sourceTexts.includes(num));
}

function checkDeliveryGrounded(text: string, sourceTexts: string, isAr: boolean): boolean {
  if (!sourceTexts.trim()) return false;

  const negationRegex = isAr ? SHIPPING_NEGATION_AR : SHIPPING_NEGATION_EN;
  if (negationRegex.test(sourceTexts)) return false;

  const freeRegex = isAr ? /(?:مجاني|مجاناً|مجانية)/u : /\bfree\b/i;
  const textHasFree = freeRegex.test(text);
  if (textHasFree && !freeRegex.test(sourceTexts)) return false;

  const timelineRegexAr = /(?:يومين|\d+\s*(?:أيام|يوم|ساعات|ساعة))/u;
  const timelineRegexEn = /\b(?:\d+\s*days?|two days)\b/i;
  const timelineRegex = isAr ? timelineRegexAr : timelineRegexEn;
  const textHasTimeline = timelineRegex.test(text);
  if (textHasTimeline && !timelineRegex.test(sourceTexts)) return false;

  const shippingMention = isAr
    ? ["شحن", "توصيل"].some(kw => sourceTexts.includes(kw))
    : ["shipping", "delivery"].some(kw => sourceTexts.includes(kw));

  return shippingMention;
}

function buildSanitizedPartialText(
  fullText: string,
  isAr: boolean,
  reason: "UNGROUNDED_PRICE" | "UNGROUNDED_ACTION" | "UNGROUNDED_HANDOVER" | "UNGROUNDED_DELIVERY",
  priceRegex: RegExp,
  actionRegex: RegExp,
  handoverRegex: RegExp,
  deliveryRegex: RegExp,
  sourceTexts: string,
): string {
  const sentences = fullText.split(/(?<=[.!\n؟])\s+/);

  const cleanSentences: string[] = [];
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const hasAction = actionRegex.test(s);
    const hasHandover = handoverRegex.test(s);
    const hasPriceViolation = priceRegex.test(s) && !checkPriceGrounded(s, sourceTexts, isAr);
    const hasDeliveryViolation = deliveryRegex.test(s) && !checkDeliveryGrounded(s, sourceTexts, isAr);

    if (!hasAction && !hasHandover && !hasPriceViolation && !hasDeliveryViolation) {
      cleanSentences.push(s);
    }
  }

  const joinedClean = cleanSentences.join(" ").trim();
  if (joinedClean.length >= 15) {
    let note: string;
    if (isAr) {
      if (reason === "UNGROUNDED_PRICE") {
        note = "(ملاحظة: تفاصيل الأسعار غير متوفرة في معلومات النشاط المعتمدة حالياً.)";
      } else if (reason === "UNGROUNDED_DELIVERY") {
        note = "(ملاحظة: تفاصيل الشحن والتوصيل غير متوفرة في معلومات النشاط المعتمدة حالياً.)";
      } else if (reason === "UNGROUNDED_ACTION") {
        note = "(ملاحظة: تأكيد الحجز أو الدفع غير متاح آلياً دون تنفيذ موثوق.)";
      } else {
        note = "(ملاحظة: هذه التفاصيل غير متوفرة في معلومات النشاط المعتمدة حالياً.)";
      }
    } else {
      if (reason === "UNGROUNDED_PRICE") {
        note = "(Note: Pricing details are not specified in our verified knowledge at this time.)";
      } else if (reason === "UNGROUNDED_DELIVERY") {
        note = "(Note: Shipping and delivery details are not specified in our verified knowledge at this time.)";
      } else if (reason === "UNGROUNDED_ACTION") {
        note = "(Note: Booking or payment confirmation cannot be performed automatically without execution.)";
      } else {
        note = "(Note: These specific details are not available in our verified knowledge at this time.)";
      }
    }
    return `${joinedClean}\n\n${note}`;
  }

  return isAr ? SAFE_NEUTRAL_REPLY_AR : SAFE_NEUTRAL_REPLY_EN;
}

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

  // 1. Actions & Handovers: Static knowledge chunks can NEVER authorize action confirmations
  //    ("تم الحجز", "تم الدفع") or agent handover without real-time execution results.
  if (actionRegex.test(trimmed)) {
    return {
      valid: false,
      reason: "UNGROUNDED_ACTION",
      sanitizedText: buildSanitizedPartialText(trimmed, isAr, "UNGROUNDED_ACTION", priceRegex, actionRegex, handoverRegex, deliveryRegex, sourceTexts),
    };
  }

  if (handoverRegex.test(trimmed)) {
    return {
      valid: false,
      reason: "UNGROUNDED_HANDOVER",
      sanitizedText: buildSanitizedPartialText(trimmed, isAr, "UNGROUNDED_HANDOVER", priceRegex, actionRegex, handoverRegex, deliveryRegex, sourceTexts),
    };
  }

  // 2. Delivery & Shipping claims:
  //    Presence of a source or the word "شحن" alone does NOT authorize free shipping or delivery turnaround.
  //    Explicit negation in source ("لا نوفر الشحن") explicitly invalidates delivery claims.
  if (deliveryRegex.test(trimmed)) {
    const isDeliveryGrounded = hasCitations && checkDeliveryGrounded(trimmed, sourceTexts, isAr);
    if (!isDeliveryGrounded) {
      return {
        valid: false,
        reason: "UNGROUNDED_DELIVERY",
        sanitizedText: buildSanitizedPartialText(trimmed, isAr, "UNGROUNDED_DELIVERY", priceRegex, actionRegex, handoverRegex, deliveryRegex, sourceTexts),
      };
    }
  }

  // 3. Price & Commercial Rate claims:
  //    hasCitations alone does NOT authorize fabricated prices or rates.
  //    The source must contain the price terms and the specified numeric figures.
  if (priceRegex.test(trimmed)) {
    const isPriceGrounded = hasCitations && checkPriceGrounded(trimmed, sourceTexts, isAr);
    if (!isPriceGrounded) {
      return {
        valid: false,
        reason: "UNGROUNDED_PRICE",
        sanitizedText: buildSanitizedPartialText(trimmed, isAr, "UNGROUNDED_PRICE", priceRegex, actionRegex, handoverRegex, deliveryRegex, sourceTexts),
      };
    }
  }

  return { valid: true, sanitizedText: trimmed };
}
