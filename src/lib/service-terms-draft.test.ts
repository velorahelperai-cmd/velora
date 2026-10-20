import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { serviceTermsDraft, termsDraftPreviewEnabled } from "./service-terms-draft";

describe("approved service terms local review boundary", () => {
  it("requires development preview and cannot be treated as effective terms", () => {
    expect(termsDraftPreviewEnabled("development")).toBe(true);
    expect(termsDraftPreviewEnabled("production")).toBe(false);
    expect(termsDraftPreviewEnabled("test")).toBe(false);
    expect(serviceTermsDraft.effective).toBe(false);
    expect(serviceTermsDraft.acceptanceVersion).toBeNull();
    expect(serviceTermsDraft.source.sha256).toBe("63e1015d730567887c7c7aa5dfc163fa074f94464ce992f41abfcf9ba4723dc1");
  });
  it("has all eighteen approved clauses and equivalent unresolved fields in both languages", () => {
    for (const language of [serviceTermsDraft.ar, serviceTermsDraft.en]) {
      expect(language.sections.map(section => section.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
      expect(language.sections.every(section => section.heading.trim() && section.paragraphs.every(p => p.trim()))).toBe(true);
      expect(language.operator).toContain("TAG CITY TRAD LLC");
      expect(language.operator).toContain("[");
      expect(language.sections.find(section => section.number === 16)?.paragraphs.join(" ")).toContain("[");
      expect(language.sections.find(section => section.number === 18)?.paragraphs.join(" ")).toContain("[");
    }
    expect(serviceTermsDraft.en.sections[5].paragraphs.join(" ")).toContain("does not start automatically");
    expect(serviceTermsDraft.en.sections[6].paragraphs.join(" ")).toContain("each month");
    expect(serviceTermsDraft.en.sections[7].paragraphs.join(" ")).toContain("three days");
  });
  it("keeps every material pending choice visible with its draft clause references", () => {
    const pending = serviceTermsDraft.pending;
    expect(pending).toHaveLength(7);
    for (const item of pending) {
      expect(item.ar).toBeTruthy(); expect(item.en).toBeTruthy();
      expect(item.sections.length).toBeGreaterThan(0);
    }
    expect(pending.flatMap(item => item.sections)).toEqual(expect.arrayContaining([1, 4, 5, 6, 7, 8, 12, 14, 15, 16, 17, 18]));
  });
  it("keeps draft routing explicit and checkout acceptance files untouched", () => {
    const route = readFileSync("src/app/terms/page.tsx", "utf8");
    expect(route).toContain("draftTerms={termsDraftPreviewEnabled(process.env.NODE_ENV)}");
    expect(route).toContain('kind="terms"');
    const component = readFileSync("src/components/app/service-terms-draft.tsx", "utf8");
    expect(component).toContain('data-terms-effective="false"');
    expect(component).not.toContain("مسودة محلية للمراجعة — غير نافذة");
    expect(component).not.toContain("Local review draft — not effective");
    expect(component).not.toContain("DRAFT NOT FOR PUBLICATION");
    const copy = JSON.stringify(serviceTermsDraft);
    expect(copy).not.toContain("مسودة محلية للمراجعة — غير نافذة");
    expect(copy).not.toContain("مسودة غير معتمدة وغير صالحة للنشر أو القبول التعاقدي");
    expect(copy).not.toContain("Local review draft — not effective");
    expect(copy).not.toContain("not finally approved");
    expect(copy).not.toContain("DRAFT NOT FOR PUBLICATION");
    expect(component).not.toMatch(/<form|type="submit"|setConsent|acceptTerms|termsVersion/);
  });
});
