import { describe, expect, it } from "vitest";
import { selectWhatsappModel } from "./whatsapp-model";

describe("WhatsApp model selection", () => {
  it.each(["مواعيد العمل؟", "What are your opening hours?"])("chooses the efficient model for a simple question: %s", question => {
    expect(selectWhatsappModel(question)).toBe("gemini-3.5-flash-lite");
  });
  it("keeps longer questions on the existing route", () => expect(selectWhatsappModel("details ".repeat(30))).toBeUndefined());
  it.each(["أريد استرداد المبلغ", "compare products", "refund my purchase"])("retains existing routing for sensitive or catalog requests: %s", question => {
    expect(selectWhatsappModel(question)).toBeUndefined();
  });
});
