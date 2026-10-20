import {
  normalizeOnboardingAnswers,
  type OnboardingAnswers,
  type OnboardingWebsite,
} from "@/lib/tenancy/onboarding-answers";

const emptyAnswers: OnboardingAnswers = {
  version: 1,
  allocation: "unallocated",
  goals: [],
  website: null,
  crm: null,
  ai: null,
  channels: { whatsapp: false, instagram: false },
  whatsapp: null,
  team: null,
};

export type Screen1WebsiteResult =
  | { ok: true; answers: OnboardingAnswers | null }
  | { ok: false; code: "CONTRADICTION" | "INVALID_URL" };

/**
 * Optional Screen 1 website editor.
 * Absence stays absent. A valid edit preserves every other answer field.
 * No-site plus any URL text is rejected and does not replace the stored answers.
 */
export function screen1WebsiteChange(
  current: OnboardingAnswers | null | undefined,
  noSite: boolean,
  url: string,
): Screen1WebsiteResult {
  const trimmed = url.trim();
  if (noSite && trimmed) return { ok: false, code: "CONTRADICTION" };
  if (!noSite && !trimmed) {
    if (current == null) return { ok: true, answers: null };
    const cleared = normalizeOnboardingAnswers({ ...current, website: null });
    if (!cleared.ok || !cleared.value) return { ok: false, code: "INVALID_URL" };
    return { ok: true, answers: cleared.value };
  }
  const website: OnboardingWebsite = noSite ? { kind: "none" } : { kind: "url", value: trimmed };
  const normalized = normalizeOnboardingAnswers({ ...(current ?? emptyAnswers), website });
  if (!normalized.ok || !normalized.value) return { ok: false, code: "INVALID_URL" };
  return { ok: true, answers: normalized.value };
}

export type Screen1WebsiteDraft = {
  noSite: boolean;
  url: string;
  error: "CONTRADICTION" | "INVALID_URL" | null;
  answers: OnboardingAnswers | null;
};

/**
 * Full editor result computed before any React state update.
 * A rejected edit keeps the previous answers reference.
 */
export function applyScreen1Website(
  current: OnboardingAnswers | null | undefined,
  noSite: boolean,
  url: string,
): Screen1WebsiteDraft {
  const result = screen1WebsiteChange(current, noSite, url);
  if (!result.ok) return { noSite, url, error: result.code, answers: current ?? null };
  return { noSite, url, error: null, answers: result.answers };
}
