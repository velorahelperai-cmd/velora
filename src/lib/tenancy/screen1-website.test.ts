import { expect, it } from "vitest";
import type { OnboardingAnswers } from "@/lib/tenancy/onboarding-answers";
import { applyScreen1Website, screen1WebsiteChange } from "@/lib/tenancy/screen1-website";

const existing: OnboardingAnswers = {
  version: 1,
  allocation: "unallocated",
  goals: ["support", "sales"],
  website: null,
  crm: { choice: "Shopify", other: null },
  ai: null,
  channels: { whatsapp: true, instagram: false },
  whatsapp: {
    existingUse: "yes",
    platform: "Twilio",
    platformOther: null,
    verification: "unknown",
    facebookBusinessAccount: "no",
  },
  team: { range: "1-3", exactCount: null },
};

it("leaves answers absent until a website choice exists", () => {
  expect(screen1WebsiteChange(null, false, "  ")).toEqual({ ok: true, answers: null });
  expect(screen1WebsiteChange(undefined, false, "")).toEqual({ ok: true, answers: null });
});

it("stores no-site or a canonical http(s) url and preserves the other answers", () => {
  const none = screen1WebsiteChange(existing, true, "");
  expect(none.ok).toBe(true);
  if (!none.ok) return;
  expect(none.answers?.website).toEqual({ kind: "none" });
  expect(none.answers?.goals).toEqual(["support", "sales"]);
  expect(none.answers?.crm).toEqual({ choice: "Shopify", other: null });
  expect(none.answers?.whatsapp?.platform).toBe("Twilio");
  expect(none.answers?.team).toEqual({ range: "1-3", exactCount: null });

  const url = screen1WebsiteChange(existing, false, "https://example.com?ref=1");
  expect(url.ok).toBe(true);
  if (!url.ok || !url.answers) return;
  expect(url.answers.website).toEqual({ kind: "url", value: "https://example.com/?ref=1" });
  expect(url.answers.goals).toEqual(existing.goals);
  expect(url.answers.channels).toEqual(existing.channels);
});

it("rejects contradiction and invalid syntax without replacing stored answers", () => {
  expect(screen1WebsiteChange(existing, true, "https://example.com")).toEqual({ ok: false, code: "CONTRADICTION" });
  expect(screen1WebsiteChange(existing, false, "https://example.com:999999")).toEqual({ ok: false, code: "INVALID_URL" });
  expect(screen1WebsiteChange(existing, false, "notaurl")).toEqual({ ok: false, code: "INVALID_URL" });
  const cleared = screen1WebsiteChange(existing, false, "");
  expect(cleared.ok).toBe(true);
  if (!cleared.ok) return;
  expect(cleared.answers?.website).toBeNull();
  expect(cleared.answers?.goals).toEqual(["support", "sales"]);
});

it("derives the website error and the kept answers before a deferred commit", () => {
  const invalid = applyScreen1Website(existing, false, "notaurl");
  expect(invalid.error).toBe("INVALID_URL");
  expect(invalid.answers).toBe(existing);
  const saved = applyScreen1Website(invalid.answers, false, "https://example.com/a");
  expect(saved.error).toBeNull();
  expect(saved.answers?.website).toEqual({ kind: "url", value: "https://example.com/a" });
  expect(saved.answers?.goals).toEqual(["support", "sales"]);
  const blocked = applyScreen1Website(saved.answers, true, "https://example.com/a");
  expect(blocked.error).toBe("CONTRADICTION");
  expect(blocked.answers).toBe(saved.answers);
  const chained = applyScreen1Website(blocked.answers, false, "https://example.com/b");
  expect(chained.error).toBeNull();
  expect(chained.answers?.website).toEqual({ kind: "url", value: "https://example.com/b" });
  expect(chained.answers?.crm).toEqual(existing.crm);
});
