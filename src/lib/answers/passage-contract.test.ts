import { describe, expect, it } from "vitest";
import { validPassageEnvelope, PASSAGE_SEPARATOR } from "./passage-contract";
import { buildAnswerSystemPrompt, formatAnswerUserPrompt } from "./adapters/prompt";

const first = { start_char: 1001, end_char: 1007, text: "قهوة 😊" };
const second = { start_char: 9001, end_char: 9007, text: "2 OMR." };
const envelope = { retrieval_mode: "passages_v1", usage_role: "knowledge", passages: [first, second], content: first.text + PASSAGE_SEPARATOR + second.text };
describe("native passage contract", () => {
  it("preserves Unicode text and disjoint original offsets", () => expect(validPassageEnvelope(envelope)).toBe(true));
  it("preserves the complete-source legacy contract", () => expect(validPassageEnvelope({ content: "Complete source" })).toBe(true));
  it.each([
    { retrieval_mode: "unknown" }, { usage_role: "business_instructions" }, { passages: [] },
    { passages: null }, { passages: [second, first] }, { content: "Clipped or replaced" },
    { passages: [{ ...first, start_char: 0 }] }, { passages: [{ ...first, end_char: 1008 }] },
    { passages: [{ ...first, end_char: 1007.5 }] }, { passages: [{ ...first, start_char: "1001" }] },
    { passages: [{ start_char: 1, end_char: 1802, text: "x".repeat(1801) }] },
  ])("rejects malformed or misleading excerpt metadata %j", patch => expect(validPassageEnvelope({ ...envelope, ...patch })).toBe(false));
  it("requires explicit mode whenever passages are present", () => expect(validPassageEnvelope({ passages: [first], content: first.text })).toBe(false));
  it.each(["ar", "en"] as const)("labels partial knowledge and prohibits exhaustive inference in %s", locale => {
    const prompt = formatAnswerUserPrompt("Price?", [{ sourceId: "source", title: "Menu", contentVersion: 3, text: envelope.content, retrievalMode: "passages_v1" }], locale);
    expect(prompt).toContain(locale === "ar" ? "مقاطع مختارة، وليست المستند كاملًا" : "selected excerpts, incomplete document");
    expect(buildAnswerSystemPrompt(locale)).toContain(locale === "ar" ? "ولا تقدميها كقائمة شاملة" : "never claim an exhaustive list");
  });
});
