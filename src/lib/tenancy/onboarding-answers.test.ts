import { describe, expect, it } from "vitest";
import { normalizeOnboardingAnswers, type OnboardingAnswers } from "./onboarding-answers";

const base = {
  version: 1,
  goals: ["orders", "support", "support"],
  website: { noSite: true },
  crm: "none",
  ai: "exploring",
  channels: { whatsapp: true, instagram: true },
  whatsapp: {
    existingUse: "yes",
    platform: "BusinessApp",
    verification: "unknown",
    facebookBusinessAccount: "yes",
  },
  team: { range: "1-3", exactCount: 3 },
};

function value(): OnboardingAnswers {
  const result = normalizeOnboardingAnswers(base);
  if (!result.ok || !result.value) throw new Error("fixture");
  return result.value;
}

describe("onboarding answers", () => {
  it("normalizes settled enums and keeps allocation unmapped", () => {
    const answers = value();
    expect(answers.allocation).toBe("unallocated");
    expect(answers.goals).toEqual(["support", "orders"]);
    expect(answers.website).toEqual({ kind: "none" });
    expect(answers.crm).toEqual({ choice: "none", other: null });
    expect(answers.ai).toEqual({ choice: "exploring", other: null });
    expect(answers.channels).toEqual({ whatsapp: true, instagram: true });
    expect(answers.whatsapp).toMatchObject({ existingUse: "yes", platform: "BusinessApp", verification: "unknown", facebookBusinessAccount: "yes" });
    expect(answers.team).toEqual({ range: "1-3", exactCount: 3 });
    expect(answers).not.toHaveProperty("seats");
    expect(answers).not.toHaveProperty("connected");
    expect(JSON.stringify(answers)).not.toMatch(/entitlement|eligible|integration/i);
  });

  it("clears hidden WhatsApp dependents and rejects a no-site contradiction", () => {
    const deselected = normalizeOnboardingAnswers({ ...base, channels: { whatsapp: false }, whatsapp: base.whatsapp });
    expect(deselected.ok && deselected.value?.whatsapp).toBeNull();
    const unused = normalizeOnboardingAnswers({ ...base, whatsapp: { ...base.whatsapp, existingUse: "no", platform: "Twilio", platformOther: "kept" } });
    expect(unused.ok && unused.value?.whatsapp).toEqual({ existingUse: "no", platform: null, platformOther: null, verification: null, facebookBusinessAccount: null });
    expect(normalizeOnboardingAnswers({ ...base, website: { noSite: true, url: "https://example.com" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, website: { kind: "none", value: "https://example.com" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, website: { kind: "none", url: "https://example.com" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, website: { kind: "url", value: "https://example.com", noSite: true } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
  });

  it("rejects invalid enums and unbounded other text without storing them", () => {
    expect(normalizeOnboardingAnswers({ ...base, goals: ["loyalty"] })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, crm: "Pipedrive" })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, ai: "Grok" })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, whatsapp: { ...base.whatsapp, platform: "MessageBird" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, whatsapp: { ...base.whatsapp, verification: "pending" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, crm: { choice: "other", other: "x".repeat(81) } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, crm: { choice: "other", other: "" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, website: { url: "notaurl" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ ...base, team: { exactCount: 1.5 } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
  });

  it("keeps optional answers absent and drops other text that the choice does not use", () => {
    expect(normalizeOnboardingAnswers(null)).toEqual({ ok: true, value: null });
    expect(normalizeOnboardingAnswers(undefined)).toEqual({ ok: true, value: null });
    const idle = normalizeOnboardingAnswers({ version: 1 });
    expect(idle.ok && idle.value).toMatchObject({ goals: [], website: null, crm: null, ai: null, whatsapp: null, team: null, channels: { whatsapp: false, instagram: false } });
    const cleared = normalizeOnboardingAnswers({ ...base, crm: { choice: "Shopify", other: "x".repeat(81) } });
    expect(cleared.ok && cleared.value?.crm).toEqual({ choice: "Shopify", other: null });
    const hiddenType = normalizeOnboardingAnswers({ ...base, ai: { choice: "exploring", other: { stale: true } }, whatsapp: { ...base.whatsapp, platform: "BusinessApp", platformOther: 81 } });
    expect(hiddenType.ok && hiddenType.value?.ai).toEqual({ choice: "exploring", other: null });
    expect(hiddenType.ok && hiddenType.value?.whatsapp?.platformOther).toBeNull();
    const query = "https://example.com?ref=1";
    const site = normalizeOnboardingAnswers({ version: 1, website: { url: query } });
    const canonical = new URL(query).href;
    expect(site.ok && site.value?.website).toEqual({ kind: "url", value: canonical });
    expect(normalizeOnboardingAnswers(site.ok ? site.value : null)).toEqual(site);
    expect(normalizeOnboardingAnswers({ version: 1, website: { url: "https://instagram.com/velora" } }).ok).toBe(true);
    expect(normalizeOnboardingAnswers({ version: 1, website: { url: "https://example.com:999999" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
    expect(normalizeOnboardingAnswers({ version: 1, website: { kind: "url", value: "https://example.com:999999" } })).toEqual({ ok: false, code: "INVALID_ANSWERS" });
  });

  it("does not accept sector, channel, seat, or branch allocation as an entitlement mapping", () => {
    expect(normalizeOnboardingAnswers({ ...base, sector: "retail" })).toEqual({ ok: false, code: "UNSUPPORTED_ALLOCATION" });
    expect(normalizeOnboardingAnswers({ ...base, allocation: "branch" })).toEqual({ ok: false, code: "UNSUPPORTED_ALLOCATION" });
    expect(normalizeOnboardingAnswers({ ...base, channels: { whatsapp: true, messenger: true } })).toEqual({ ok: false, code: "UNSUPPORTED_ALLOCATION" });
    expect(normalizeOnboardingAnswers({ ...base, team: { range: "1-3", seats: 2 } })).toEqual({ ok: false, code: "UNSUPPORTED_ALLOCATION" });
    expect(normalizeOnboardingAnswers({ ...base, team: { range: ">25", ownerIncluded: true } })).toEqual({ ok: false, code: "UNSUPPORTED_ALLOCATION" });
    const rangeOnly = normalizeOnboardingAnswers({ version: 1, team: { range: "1-3" } });
    expect(rangeOnly.ok && rangeOnly.value?.team).toEqual({ range: "1-3", exactCount: null });
    expect(rangeOnly.ok && rangeOnly.value?.team).not.toHaveProperty("seats");
  });
});
