/** Reply languages currently enforced by the answer prompt and worker. */
export const AI_REPLY_LANGUAGE_CODES = ["ar", "en"] as const;
export type AiReplyLanguageCode = (typeof AI_REPLY_LANGUAGE_CODES)[number];
/** Legacy company/branch confirmation contract retained for compatibility. */
export type ReplyLanguageContract = "ar" | "en" | "both";

export type ReplyLanguageScope = {
  expectedAccountId: string;
  companyId: string;
  branchId: string;
};

export type ReplyLanguageSnapshot = {
  scope: ReplyLanguageScope;
  version: number;
  companyLabel: string;
  branchLabel: string;
  replyLanguage: ReplyLanguageContract | null;
  confirmation: "confirmed" | "unconfirmed" | "unknown";
  canConfirm: boolean | null;
};

const LABELS: Record<AiReplyLanguageCode, { ar: string; en: string }> = {
  ar: { ar: "العربية", en: "Arabic" },
  en: { ar: "الإنجليزية", en: "English" },
};

export function isAiReplyLanguageCode(value: unknown): value is AiReplyLanguageCode {
  return value === "ar" || value === "en";
}

export function isReplyLanguageContract(value: unknown): value is ReplyLanguageContract {
  return value === "ar" || value === "en" || value === "both";
}

/** Maps a non-empty multi-select to the persisted company contract. Never invents `both` for a single language. */
export function languagesToReplyContract(languages: readonly string[]): ReplyLanguageContract | null {
  const unique = [...new Set(languages.filter(isAiReplyLanguageCode))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2 && unique.includes("ar") && unique.includes("en")) return "both";
  return null;
}

export function replyContractToLanguages(value: ReplyLanguageContract | null | undefined): AiReplyLanguageCode[] {
  if (value === "ar") return ["ar"];
  if (value === "en") return ["en"];
  if (value === "both") return ["ar", "en"];
  return [];
}

export function replyLanguageLabel(code: AiReplyLanguageCode, locale: "ar" | "en"): string {
  return LABELS[code][locale];
}

/**
 * Customer-language detection used by trial/worker when contract is `both`.
 * Arabic script → ar; otherwise → en. Single-language contracts ignore detection.
 */
export function resolveReplyLocale(
  contract: ReplyLanguageContract,
  customerText: string,
): AiReplyLanguageCode {
  if (contract === "ar") return "ar";
  if (contract === "en") return "en";
  return /[\u0600-\u06ff]/.test(customerText) ? "ar" : "en";
}
