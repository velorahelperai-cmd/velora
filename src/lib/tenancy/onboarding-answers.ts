/** Current-visit questionnaire contract. Not an entitlement, branch allocation, or integration. */

export const ONBOARDING_ANSWERS_VERSION = 1 as const;
const OTHER_TEXT_MAX = 80;
const WEBSITE_MAX = 200;
const EXACT_COUNT_MAX = 999;

const GOALS = ["support", "sales", "marketing", "bookings", "orders"] as const;
const CRM = ["Shopify", "WooCommerce", "HubSpot", "Salesforce", "Zoho", "Sheets", "other", "none"] as const;
const AI = ["ChatGPT", "Gemini", "Claude", "Copilot", "other", "exploring"] as const;
const PLATFORMS = ["BusinessApp", "Twilio", "Gupshup", "Infobip", "Sinch", "Bird", "360dialog", "other"] as const;
const RANGES = ["1-3", "4-10", "11-25", ">25"] as const;
const ANSWER_KEYS = new Set(["version", "allocation", "goals", "website", "crm", "ai", "channels", "whatsapp", "team"]);
const CHANNEL_KEYS = new Set(["whatsapp", "instagram"]);

export type OnboardingGoal = (typeof GOALS)[number];
export type OnboardingCrm = (typeof CRM)[number];
export type OnboardingAi = (typeof AI)[number];
export type OnboardingWhatsAppPlatform = (typeof PLATFORMS)[number];
export type OnboardingTeamRange = (typeof RANGES)[number];
export type OnboardingYesNo = "yes" | "no";
export type OnboardingVerification = "yes" | "no" | "unknown";

export type OnboardingWebsite = { kind: "none" } | { kind: "url"; value: string };
export type OnboardingChoice<T extends string> = { choice: T; other: string | null };
export type OnboardingWhatsApp = {
  existingUse: OnboardingYesNo | null;
  platform: OnboardingWhatsAppPlatform | null;
  platformOther: string | null;
  verification: OnboardingVerification | null;
  facebookBusinessAccount: OnboardingYesNo | null;
};
export type OnboardingTeam = { range: OnboardingTeamRange | null; exactCount: number | null };

/** Company-versus-branch scope is unresolved, so answers stay explicitly unallocated. */
export type OnboardingAnswers = {
  version: typeof ONBOARDING_ANSWERS_VERSION;
  allocation: "unallocated";
  goals: OnboardingGoal[];
  website: OnboardingWebsite | null;
  crm: OnboardingChoice<OnboardingCrm> | null;
  ai: OnboardingChoice<OnboardingAi> | null;
  channels: { whatsapp: boolean; instagram: boolean };
  whatsapp: OnboardingWhatsApp | null;
  team: OnboardingTeam | null;
};

export type OnboardingAnswersResult =
  | { ok: true; value: OnboardingAnswers | null }
  | { ok: false; code: "INVALID_ANSWERS" | "UNSUPPORTED_ALLOCATION" };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function boundedText(value: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  if (!text || text.length > OTHER_TEXT_MAX || /[\u0000-\u001f\u007f]/.test(text)) return { ok: false };
  return { ok: true, value: text };
}

function optionalOther(choice: string | null, raw: unknown): { ok: true; value: string | null } | { ok: false } {
  // Hidden text for a non-other choice is excluded, not validated.
  if (choice !== "other") return { ok: true, value: null };
  const text = boundedText(raw);
  return text.ok ? { ok: true, value: text.value } : { ok: false };
}

function claimed(value: unknown): boolean {
  return value != null && value !== "";
}

/** Syntax only. This does not fetch the address or apply a domain policy. */
function parseHttpUrl(text: string): string | null {
  if (!text || text.length > WEBSITE_MAX || /[\u0000-\u001f\u007f\s]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.href.length > WEBSITE_MAX) return null;
    return url.href;
  } catch {
    return null;
  }
}

function website(raw: unknown): { ok: true; value: OnboardingWebsite | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  const body = record(raw);
  if (!body) return { ok: false };
  if (body.kind != null && body.kind !== "none" && body.kind !== "url") return { ok: false };
  const noSite = body.noSite === true;
  const none = body.kind === "none" || noSite;
  const urlShaped = body.kind === "url" || claimed(body.url) || claimed(body.value);
  if (none && urlShaped) return { ok: false };
  if (none) return { ok: true, value: { kind: "none" } };
  const source = body.kind === "url" ? body.value : body.url ?? body.value;
  if (!claimed(source)) return { ok: true, value: null };
  if (typeof source !== "string") return { ok: false };
  const href = parseHttpUrl(source.trim());
  if (!href) return { ok: false };
  return { ok: true, value: { kind: "url", value: href } };
}

function choiceOf<T extends string>(raw: unknown, allowed: readonly T[]): { ok: true; value: OnboardingChoice<T> | null } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, value: null };
  const body = typeof raw === "string" ? { choice: raw } : record(raw);
  if (!body) return { ok: false };
  const choice = oneOf(body.choice, allowed);
  if (!choice) return { ok: false };
  const other = optionalOther(choice, body.other);
  if (!other.ok) return { ok: false };
  return { ok: true, value: { choice, other: other.value } };
}

function whatsapp(selected: boolean, raw: unknown): { ok: true; value: OnboardingWhatsApp | null } | { ok: false } {
  if (!selected || raw == null) return { ok: true, value: selected ? emptyWhatsApp() : null };
  const body = record(raw);
  if (!body) return { ok: false };
  const existingUse = body.existingUse == null || body.existingUse === "" ? null : oneOf(body.existingUse, ["yes", "no"] as const);
  if (body.existingUse != null && body.existingUse !== "" && !existingUse) return { ok: false };
  if (existingUse !== "yes") return { ok: true, value: { ...emptyWhatsApp(), existingUse } };
  const platform = body.platform == null || body.platform === "" ? null : oneOf(body.platform, PLATFORMS);
  if (body.platform != null && body.platform !== "" && !platform) return { ok: false };
  const platformOther = optionalOther(platform, body.platformOther);
  if (!platformOther.ok) return { ok: false };
  const verification = body.verification == null || body.verification === "" ? null : oneOf(body.verification, ["yes", "no", "unknown"] as const);
  if (body.verification != null && body.verification !== "" && !verification) return { ok: false };
  const facebook = body.facebookBusinessAccount == null || body.facebookBusinessAccount === "" ? null : oneOf(body.facebookBusinessAccount, ["yes", "no"] as const);
  if (body.facebookBusinessAccount != null && body.facebookBusinessAccount !== "" && !facebook) return { ok: false };
  return { ok: true, value: { existingUse, platform, platformOther: platformOther.value, verification, facebookBusinessAccount: facebook } };
}

function emptyWhatsApp(): OnboardingWhatsApp {
  return { existingUse: null, platform: null, platformOther: null, verification: null, facebookBusinessAccount: null };
}

function team(raw: unknown): { ok: true; value: OnboardingTeam | null } | { ok: false; code?: "UNSUPPORTED_ALLOCATION" } {
  if (raw == null) return { ok: true, value: null };
  const body = record(raw);
  if (!body) return { ok: false };
  if ("seats" in body || "ownerIncluded" in body || "qualification" in body) return { ok: false, code: "UNSUPPORTED_ALLOCATION" };
  const range = body.range == null || body.range === "" ? null : oneOf(body.range, RANGES);
  if (body.range != null && body.range !== "" && !range) return { ok: false };
  let exactCount: number | null = null;
  if (body.exactCount != null && body.exactCount !== "") {
    if (typeof body.exactCount !== "number" || !Number.isInteger(body.exactCount) || body.exactCount < 1 || body.exactCount > EXACT_COUNT_MAX) return { ok: false };
    exactCount = body.exactCount;
  }
  if (!range && exactCount === null) return { ok: true, value: null };
  return { ok: true, value: { range, exactCount } };
}

export function normalizeOnboardingAnswers(input: unknown): OnboardingAnswersResult {
  if (input == null) return { ok: true, value: null };
  const body = record(input);
  if (!body || body.version !== ONBOARDING_ANSWERS_VERSION) return { ok: false, code: "INVALID_ANSWERS" };
  if ([...Object.keys(body)].some((key) => !ANSWER_KEYS.has(key))) return { ok: false, code: "UNSUPPORTED_ALLOCATION" };
  if (body.allocation != null && body.allocation !== "unallocated") return { ok: false, code: "UNSUPPORTED_ALLOCATION" };
  const goals = Array.isArray(body.goals) ? body.goals : [];
  if (!Array.isArray(body.goals) && body.goals != null) return { ok: false, code: "INVALID_ANSWERS" };
  if (goals.some((goal) => !oneOf(goal, GOALS))) return { ok: false, code: "INVALID_ANSWERS" };
  const site = website(body.website);
  if (!site.ok) return { ok: false, code: "INVALID_ANSWERS" };
  const crm = choiceOf(body.crm, CRM);
  if (!crm.ok) return { ok: false, code: "INVALID_ANSWERS" };
  const ai = choiceOf(body.ai, AI);
  if (!ai.ok) return { ok: false, code: "INVALID_ANSWERS" };
  const channels = record(body.channels) ?? {};
  if (body.channels != null && !record(body.channels)) return { ok: false, code: "INVALID_ANSWERS" };
  if (Object.keys(channels).some((key) => !CHANNEL_KEYS.has(key))) return { ok: false, code: "UNSUPPORTED_ALLOCATION" };
  if ((channels.whatsapp != null && typeof channels.whatsapp !== "boolean") || (channels.instagram != null && typeof channels.instagram !== "boolean")) {
    return { ok: false, code: "INVALID_ANSWERS" };
  }
  const selectedWhatsApp = channels.whatsapp === true;
  const phone = whatsapp(selectedWhatsApp, body.whatsapp);
  if (!phone.ok) return { ok: false, code: "INVALID_ANSWERS" };
  const people = team(body.team);
  if (!people.ok) return { ok: false, code: people.code ?? "INVALID_ANSWERS" };
  return {
    ok: true,
    value: {
      version: ONBOARDING_ANSWERS_VERSION,
      allocation: "unallocated",
      goals: GOALS.filter((goal) => goals.includes(goal)),
      website: site.value,
      crm: crm.value,
      ai: ai.value,
      channels: { whatsapp: selectedWhatsApp, instagram: channels.instagram === true },
      whatsapp: phone.value,
      team: people.value,
    },
  };
}
