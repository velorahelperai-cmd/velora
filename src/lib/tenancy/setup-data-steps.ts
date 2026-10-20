import {
  normalizeOnboardingAnswers,
  type OnboardingAi,
  type OnboardingAnswers,
  type OnboardingCrm,
  type OnboardingGoal,
  type OnboardingTeamRange,
  type OnboardingWhatsAppPlatform,
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

export type ChannelDraft = {
  whatsapp: boolean;
  instagram: boolean;
  existingUse: "yes" | "no" | "";
  platform: OnboardingWhatsAppPlatform | "";
  platformOther: string;
  verification: "yes" | "no" | "unknown" | "";
  facebook: "yes" | "no" | "";
};

export function blankChannelDraft(): ChannelDraft {
  return { whatsapp: false, instagram: false, existingUse: "", platform: "", platformOther: "", verification: "", facebook: "" };
}

/** Hidden WhatsApp dependents are removed here, before normalization. */
export function clearHiddenChannelFields(draft: ChannelDraft): ChannelDraft {
  if (!draft.whatsapp) return { ...blankChannelDraft(), instagram: draft.instagram };
  if (draft.existingUse !== "yes") return { ...draft, platform: "", platformOther: "", verification: "", facebook: "" };
  if (draft.platform !== "other") return { ...draft, platformOther: "" };
  return draft;
}

export function channelContinueMissing(draft: ChannelDraft): string[] {
  const clean = clearHiddenChannelFields(draft);
  if (!clean.whatsapp) return [];
  const missing: string[] = [];
  if (!clean.existingUse) missing.push("existingUse");
  if (clean.existingUse !== "yes") return missing;
  if (!clean.platform) missing.push("platform");
  if (clean.platform === "other" && !clean.platformOther.trim()) missing.push("platformOther");
  if (!clean.verification) missing.push("verification");
  if (!clean.facebook) missing.push("facebook");
  return missing;
}

export function commitChannelDraft(
  current: OnboardingAnswers | null | undefined,
  draft: ChannelDraft,
): { ok: true; answers: OnboardingAnswers } | { ok: false; code: "INVALID_ANSWERS" } {
  const clean = clearHiddenChannelFields(draft);
  const normalized = normalizeOnboardingAnswers({
    ...(current ?? emptyAnswers),
    channels: { whatsapp: clean.whatsapp, instagram: clean.instagram },
    whatsapp: clean.whatsapp
      ? {
          existingUse: clean.existingUse || null,
          platform: clean.platform || null,
          platformOther: clean.platformOther,
          verification: clean.verification || null,
          facebookBusinessAccount: clean.facebook || null,
        }
      : null,
  });
  if (!normalized.ok || !normalized.value) return { ok: false, code: "INVALID_ANSWERS" };
  return { ok: true, answers: normalized.value };
}

const GOALS: readonly OnboardingGoal[] = ["support", "sales", "marketing", "bookings", "orders"];

export function commitGoals(
  current: OnboardingAnswers | null | undefined,
  goals: readonly string[],
): { ok: true; answers: OnboardingAnswers } | { ok: false; code: "INVALID_ANSWERS" } {
  const allowed = new Set<string>(GOALS);
  const normalized = normalizeOnboardingAnswers({ ...(current ?? emptyAnswers), goals: goals.filter((goal) => allowed.has(goal)) });
  if (!normalized.ok || !normalized.value) return { ok: false, code: "INVALID_ANSWERS" };
  return { ok: true, answers: normalized.value };
}

export function commitTeamRange(
  current: OnboardingAnswers | null | undefined,
  range: OnboardingTeamRange | null,
): { ok: true; answers: OnboardingAnswers } | { ok: false; code: "INVALID_ANSWERS" } {
  const normalized = normalizeOnboardingAnswers({
    ...(current ?? emptyAnswers),
    team: range ? { range, exactCount: null } : null,
  });
  if (!normalized.ok || !normalized.value) return { ok: false, code: "INVALID_ANSWERS" };
  return { ok: true, answers: normalized.value };
}

export function commitOptionalChoice(
  current: OnboardingAnswers | null | undefined,
  field: "crm" | "ai",
  choice: OnboardingCrm | OnboardingAi | null,
  other: string,
): { ok: true; answers: OnboardingAnswers } | { ok: false; code: "INVALID_ANSWERS" } {
  const normalized = normalizeOnboardingAnswers({
    ...(current ?? emptyAnswers),
    [field]: choice ? { choice, other: choice === "other" ? other : null } : null,
  });
  if (!normalized.ok || !normalized.value) return { ok: false, code: "INVALID_ANSWERS" };
  return { ok: true, answers: normalized.value };
}

export function goalsContinueMissing(goals: readonly string[]): string[] {
  return goals.length ? [] : ["goals"];
}

export function teamContinueMissing(range: OnboardingTeamRange | null): string[] {
  return range ? [] : ["team"];
}

export function otherTextMissing(choice: string | null, other: string): string[] {
  return choice === "other" && !other.trim() ? ["other"] : [];
}

/** Workforce badge only. Goals and channels are intentionally not inputs. */
export function workforceBadge(range: OnboardingTeamRange | null): "level_1" | "level_2" | "level_3" | null {
  if (range === "1-3") return "level_1";
  if (range === "4-10") return "level_2";
  if (range === "11-25" || range === ">25") return "level_3";
  return null;
}
