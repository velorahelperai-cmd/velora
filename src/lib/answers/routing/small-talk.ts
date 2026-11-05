/** Pure social small-talk classifier and courteous response resolver.
 * Distinguishes pure greetings, thanks, and courtesy from business inquiries.
 * Does not contact external providers or fabricate business facts.
 */

export type SmallTalkKind = "greeting" | "thanks" | "acknowledgment";

export type SmallTalkClassification = {
  isPureSocial: boolean;
  kind?: SmallTalkKind;
  responseText?: string;
};

const SOCIAL_THANKS_AR = [
  "شكرا", "شكرا جزيلا", "مشكور", "مشكورة", "مشكورين",
  "تسلم", "تسلمي", "تسلمون", "تسلم ايدك", "يعطيك العافيه", "يعطيكم العافيه",
  "الله يعافيك", "جزاك الله خيرا", "جزاكم الله خيرا", "بارك الله فيك",
  "الف شكر", "كل الشكر", "ممنون", "ما قصرت", "ما قصرتوا", "اشكرك", "تسلم يا غالي"
];

const SOCIAL_GREETINGS_AR = [
  "مرحبا", "مرحبتين", "اهلا", "اهلا وسهلا", "السلام عليكم",
  "السلام عليكم ورحمه الله", "السلام عليكم ورحمه الله وبركاته", "سلام عليكم",
  "صباح الخير", "مساء الخير", "صباح الورد", "مساء الورد", "صباح النور", "مساء النور",
  "هلا", "يا هلا", "اهلين", "حياك الله", "حياك", "هلا والله"
];

const SOCIAL_ACKS_AR = [
  "تمام", "اوك", "اوكي", "ممتاز", "حسنا", "واضح", "طيب", "حاضر"
];

const SOCIAL_THANKS_EN = [
  "thanks", "thank you", "thank you so much", "thanks a lot", "thx", "ty",
  "appreciate it", "much appreciated"
];

const SOCIAL_GREETINGS_EN = [
  "hi", "hello", "hey", "good morning", "good afternoon", "good evening"
];

const SOCIAL_ACKS_EN = [
  "ok", "okay", "perfect", "got it", "great", "alright"
];

// Commercial/business keywords that require approved knowledge
const COMMERCIAL_KEYWORDS_AR = [
  "سعر", "اسعار", "تكلف", "خدم", "حجز", "احجز", "طلب", "اطلب",
  "منيو", "كتالوج", "قائم", "عرض", "عروض", "تخفيض", "خصم",
  "موقع", "فرع", "فروع", "ساعات", "دوام", "اوقات", "اشتراك",
  "باق", "شراء", "اشتري", "رقم", "تواصل", "اتصال", "عنوان",
  "تفاصيل", "معلومات", "وظائف", "توظيف", "بكم", "كام",
];

// Short question particles that must match on word boundaries so they don't match substrings like "اهلا" (containing "هل")
const QUESTION_PARTICLES_AR = [
  "هل", "كم", "ما", "ماذا", "اين", "وين", "فين", "كيف", "شلون",
  "ازاي", "متي", "متى", "ليه", "ليش", "ايش", "شو", "شنو", "مين",
  "اقدر", "ممكن", "عندكم", "لديكم",
];

function hasCommercialOrQuestionAr(text: string): boolean {
  // Check root keywords
  if (COMMERCIAL_KEYWORDS_AR.some((kw) => text.includes(kw))) return true;

  // Check word-bounded particles
  const words = text.split(/\s+/);
  if (words.some((w) => QUESTION_PARTICLES_AR.includes(w))) return true;

  return false;
}

const COMMERCIAL_PATTERN_EN = /\b(?:price|prices|cost|costs|service|services|book|booking|order|orders|menu|catalog|catalogue|offer|offers|discount|discounts|location|branch|branches|hours|time|contact|phone|buy|info|information|details|what|where|how|when|why|who|which|can|could|is|are|do|does|have|has)\b/i;

// Sensitive/risk terms that demand human review
const RISK_PATTERN = /(?:شكوى|استرجاع|غش|نصب|احتيال|سرقة|محامي|قضية|تعويض|شرطة|حماية المستهلك|سيء جدا|غير راضي|ارفع شكوى|اريد المدير|المدير المسؤول|تالف|خربان|متضرر|خصم خاص|تفاوض|استثناء|complaint|refund|fraud|scam|lawyer|compensation|police|consumer protection|unacceptable|manager|damaged|negotiate)/i;

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove tashkeel/diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\u0621-\u064A0-9a-zA-Z\s]/g, " ") // replace punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEnglish(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyPureSocialSmallTalk(
  question: string,
  preferredLocale?: "ar" | "en"
): SmallTalkClassification {
  if (typeof question !== "string") return { isPureSocial: false };
  const raw = question.trim();
  if (!raw || raw.length > 80) return { isPureSocial: false };

  // Explicit question marks (Arabic or Latin) disqualify pure courtesy
  if (/[\?؟]/.test(raw)) return { isPureSocial: false };

  // Sensitive/risk terms must go to handoff policy, never pure courtesy
  if (RISK_PATTERN.test(raw)) return { isPureSocial: false };

  // Detect language
  const isArabic = /[\u0600-\u06FF]/.test(raw);
  const locale = preferredLocale ?? (isArabic ? "ar" : "en");

  if (isArabic) {
    const norm = normalizeArabic(raw);
    if (!norm) return { isPureSocial: false };

    // Check for commercial or question keywords
    if (hasCommercialOrQuestionAr(norm)) return { isPureSocial: false };

    // Match pure thanks
    if (SOCIAL_THANKS_AR.some((phrase) => norm === phrase || norm.startsWith(phrase + " ") || norm.endsWith(" " + phrase))) {
      return {
        isPureSocial: true,
        kind: "thanks",
        responseText: "العفو! في خدمتك دائماً.",
      };
    }

    // Match pure greeting
    if (SOCIAL_GREETINGS_AR.some((phrase) => norm === phrase || norm.startsWith(phrase + " ") || norm.endsWith(" " + phrase))) {
      return {
        isPureSocial: true,
        kind: "greeting",
        responseText: "أهلاً وسهلاً بك! كيف يمكنني مساعدتك اليوم؟",
      };
    }

    // Match pure acknowledgment
    if (SOCIAL_ACKS_AR.some((phrase) => norm === phrase)) {
      return {
        isPureSocial: true,
        kind: "acknowledgment",
        responseText: "العفو! في خدمتك دائماً، إذا كان لديك أي استفسار آخر يسعدني مساعدتك.",
      };
    }
  } else {
    const norm = normalizeEnglish(raw);
    if (!norm) return { isPureSocial: false };

    // Check for commercial or question keywords
    if (COMMERCIAL_PATTERN_EN.test(norm)) return { isPureSocial: false };

    // Match pure thanks
    if (SOCIAL_THANKS_EN.some((phrase) => norm === phrase || norm.startsWith(phrase + " ") || norm.endsWith(" " + phrase))) {
      return {
        isPureSocial: true,
        kind: "thanks",
        responseText: "You're welcome! Happy to help.",
      };
    }

    // Match pure greeting
    if (SOCIAL_GREETINGS_EN.some((phrase) => norm === phrase || norm.startsWith(phrase + " ") || norm.endsWith(" " + phrase))) {
      return {
        isPureSocial: true,
        kind: "greeting",
        responseText: "Hello! How can I help you today?",
      };
    }

    // Match pure acknowledgment
    if (SOCIAL_ACKS_EN.some((phrase) => norm === phrase)) {
      return {
        isPureSocial: true,
        kind: "acknowledgment",
        responseText: "You're welcome! Feel free to ask if you need anything else.",
      };
    }
  }

  return { isPureSocial: false };
}
