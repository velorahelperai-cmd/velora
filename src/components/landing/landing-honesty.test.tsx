import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { landingCopy } from "@/lib/landing-copy";
import { CinematicOnboarding } from "./cinematic-onboarding";

describe.each(["ar", "en"] as const)("landing examples (%s)", locale => {
  const copy = landingCopy(locale);
  it("does not seed prices or message quotas into a preview without catalog data", () => {
    const plans = JSON.stringify(copy.onboardingStory.previewUI.plans);
    expect(plans).not.toMatch(/80|45|1,000/);
  });
  it("does not attest connection or launch readiness from static example data", () => {
    const ui = copy.onboardingStory.previewUI;
    expect(ui.previewBadge).not.toMatch(/Live|(?:^|\s)حية(?:\s|$)/);
    expect(ui.chatTest.onlineStatus).not.toMatch(/Online now|متصلة الآن/);
    expect(ui.chatTest.readinessList.every(item => item.done === false)).toBe(true);
    const markup = renderToStaticMarkup(createElement(CinematicOnboarding, { copy }));
    expect(markup).not.toContain(">Ready<");
    expect(markup).not.toContain(">مكتمل<");
  });
  it("labels the setup showcase as a fictional example using official personas", () => {
    const markup = renderToStaticMarkup(createElement(CinematicOnboarding, { copy }));
    expect(markup).toContain(copy.exampleNote);
    expect(markup).toContain('data-persona="noura"');
    expect(markup).toContain('data-persona="lina"');
    expect(markup).toContain('data-persona="dana"');
    expect(markup).toContain('data-character="noura"');
    expect(markup.split(copy.exampleNote).length - 1).toBe(1);
  });
  it("keeps booking, reservation and dispatch examples pending staff confirmation", () => {
    const replies = [...copy.scenes.map(scene => scene.example.answer), copy.sampleFor("retail").a, copy.sampleFor("services").a].join(" ");
    expect(replies).not.toMatch(/Earbuds reserved|Booked for|Session booked|dispatch scheduling visit now|تم حجز السماعة|الفريق يجدول الزيارة فورًا/i);
  });
});
