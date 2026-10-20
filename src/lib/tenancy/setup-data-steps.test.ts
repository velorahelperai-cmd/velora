import { expect, it } from "vitest";
import type { OnboardingAnswers } from "@/lib/tenancy/onboarding-answers";
import {
  blankChannelDraft,
  channelContinueMissing,
  clearHiddenChannelFields,
  commitChannelDraft,
  commitGoals,
  commitOptionalChoice,
  commitTeamRange,
  goalsContinueMissing,
  otherTextMissing,
  teamContinueMissing,
  workforceBadge,
} from "@/lib/tenancy/setup-data-steps";

const visit: OnboardingAnswers = {
  version: 1,
  allocation: "unallocated",
  goals: ["support"],
  website: { kind: "url", value: "https://example.com/" },
  crm: null,
  ai: null,
  channels: { whatsapp: false, instagram: false },
  whatsapp: null,
  team: null,
};

it("accepts instagram alone and clears hidden whatsapp dependents", () => {
  const only = commitChannelDraft(visit, { ...blankChannelDraft(), instagram: true });
  expect(only.ok).toBe(true);
  if (!only.ok) return;
  expect(only.answers.channels).toEqual({ whatsapp: false, instagram: true });
  expect(only.answers.whatsapp).toBeNull();
  expect(only.answers.website).toEqual(visit.website);
  expect(only.answers.goals).toEqual(["support"]);
  expect(channelContinueMissing({ ...blankChannelDraft(), instagram: true })).toEqual([]);

  const hidden = clearHiddenChannelFields({
    whatsapp: false,
    instagram: true,
    existingUse: "yes",
    platform: "Twilio",
    platformOther: "secret",
    verification: "yes",
    facebook: "yes",
  });
  expect(hidden.platform).toBe("");
  const cleared = commitChannelDraft(only.answers, hidden);
  expect(cleared.ok).toBe(true);
  if (!cleared.ok) return;
  expect(cleared.answers.whatsapp).toBeNull();
  expect(JSON.stringify(cleared.answers)).not.toContain("Twilio");
  expect(JSON.stringify(cleared.answers)).not.toContain("secret");
});

it("requires only the whatsapp questions that are visible", () => {
  const selected = { ...blankChannelDraft(), whatsapp: true };
  expect(channelContinueMissing(selected)).toEqual(["existingUse"]);
  expect(channelContinueMissing({ ...selected, existingUse: "no", platform: "Twilio" })).toEqual([]);
  const noUse = commitChannelDraft(visit, { ...selected, existingUse: "no", platform: "Twilio", verification: "yes" });
  expect(noUse.ok).toBe(true);
  if (!noUse.ok) return;
  expect(noUse.answers.whatsapp).toEqual({
    existingUse: "no",
    platform: null,
    platformOther: null,
    verification: null,
    facebookBusinessAccount: null,
  });
  const yes = { ...selected, existingUse: "yes" as const };
  expect(channelContinueMissing(yes)).toEqual(["platform", "verification", "facebook"]);
  expect(channelContinueMissing({ ...yes, platform: "other", platformOther: "  ", verification: "unknown", facebook: "no" })).toEqual(["platformOther"]);
  const stored = commitChannelDraft(visit, { ...yes, platform: "BusinessApp", verification: "unknown", facebook: "yes" });
  expect(stored.ok).toBe(true);
  if (!stored.ok) return;
  expect(stored.answers.whatsapp?.platform).toBe("BusinessApp");
  expect(stored.answers.whatsapp?.platformOther).toBeNull();
});

it("keeps goals and workforce optional in the parser while the screen can require them", () => {
  expect(goalsContinueMissing([])).toEqual(["goals"]);
  expect(teamContinueMissing(null)).toEqual(["team"]);
  const goals = commitGoals(visit, ["orders", "support", "orders"]);
  expect(goals.ok).toBe(true);
  if (!goals.ok) return;
  expect(goals.answers.goals).toEqual(["support", "orders"]);
  expect(goals.answers.website).toEqual(visit.website);
  const team = commitTeamRange(goals.answers, "11-25");
  expect(team.ok).toBe(true);
  if (!team.ok) return;
  expect(team.answers.team).toEqual({ range: "11-25", exactCount: null });
  expect(team.answers.goals).toEqual(["support", "orders"]);
  expect(goalsContinueMissing(team.answers.goals)).toEqual([]);
  expect(teamContinueMissing("11-25")).toEqual([]);
});

it("stores one crm or ai choice and drops hidden other text", () => {
  const shop = commitOptionalChoice(visit, "crm", "Shopify", "x".repeat(90));
  expect(shop.ok).toBe(true);
  if (!shop.ok) return;
  expect(shop.answers.crm).toEqual({ choice: "Shopify", other: null });
  const none = commitOptionalChoice(shop.answers, "crm", "none", "kept");
  expect(none.ok).toBe(true);
  if (!none.ok) return;
  expect(none.answers.crm).toEqual({ choice: "none", other: null });
  expect(none.answers.website).toEqual(visit.website);
  const exploring = commitOptionalChoice(none.answers, "ai", "exploring", "draft");
  expect(exploring.ok).toBe(true);
  if (!exploring.ok) return;
  expect(exploring.answers.ai).toEqual({ choice: "exploring", other: null });
  expect(otherTextMissing("other", " ")).toEqual(["other"]);
  expect(otherTextMissing("none", "ignored")).toEqual([]);
  expect(commitOptionalChoice(exploring.answers, "ai", null, "draft").ok).toBe(true);
});

it("maps workforce ranges to a persona badge without using goals or channels", () => {
  expect(workforceBadge(null)).toBeNull();
  expect(workforceBadge("1-3")).toBe("level_1");
  expect(workforceBadge("4-10")).toBe("level_2");
  expect(workforceBadge("11-25")).toBe("level_3");
  expect(workforceBadge(">25")).toBe("level_3");
  expect(workforceBadge("1-3")).toBe(workforceBadge("1-3"));
});
