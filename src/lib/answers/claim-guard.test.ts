import { describe, it, expect } from "vitest";
import { guardResponseAgainstUngroundedClaims } from "./claim-guard";

describe("guardResponseAgainstUngroundedClaims", () => {
  it("allows answers with citations even if they contain prices or confirmations", () => {
    const text = "سعر الباقة هو 25 ر.ع وتم تأكيد الموعد.";
    const result = guardResponseAgainstUngroundedClaims(text, true, "ar");
    expect(result.valid).toBe(true);
    expect(result.sanitizedText).toBe(text);
  });

  it("allows polite missing-info apology and clarifying question when citations are empty", () => {
    const text = "عذراً، هذه المعلومة غير متوفرة حالياً. هل يمكنك تحديد الخدمة التي ترغب بها؟";
    const result = guardResponseAgainstUngroundedClaims(text, false, "ar");
    expect(result.valid).toBe(true);
    expect(result.sanitizedText).toBe(text);
  });

  it("allows polite greeting and courtesy when citations are empty", () => {
    const text = "أهلاً بك! كيف يمكنني مساعدتك اليوم؟";
    const result = guardResponseAgainstUngroundedClaims(text, false, "ar");
    expect(result.valid).toBe(true);
    expect(result.sanitizedText).toBe(text);
  });

  it("intercepts fabricated price when citations are empty and replaces with neutral reply", () => {
    const text = "تكلفة الخدمة هي 50 ر.ع فقط ويمكنك البدء اليوم.";
    const result = guardResponseAgainstUngroundedClaims(text, false, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_PRICE");
    expect(result.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");
  });

  it("intercepts fabricated booking claim when citations are empty", () => {
    const text = "تم الحجز بنجاح، ننتظرك غداً!";
    const result = guardResponseAgainstUngroundedClaims(text, false, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_ACTION");
    expect(result.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");
  });

  it("intercepts false handover claim when citations are empty", () => {
    const text = "سيتواصل معك الموظف قريباً للإجابة عن سؤالك.";
    const result = guardResponseAgainstUngroundedClaims(text, false, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_HANDOVER");
    expect(result.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");
  });

  it("intercepts English fabricated price when citations are empty", () => {
    const text = "The cost of this plan is $99 per month.";
    const result = guardResponseAgainstUngroundedClaims(text, false, "en");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_PRICE");
    expect(result.sanitizedText).toContain("I apologize, these specific details are not available");
  });

  it("مصدر يثبت خدمة المجسمات فقط لا يجيز ادعاء شحن مجاني إلى صلالة خلال يومين", () => {
    const sources = [
      {
        title: "خدمة المجسمات المعمارية",
        text: "نقدم في تاجسيم تصميم وتصنيع المجسمات المعمارية والماكيتات الهندسية بأعلى دقة وباستخدام أحدث تقنيات الطباعة ثلاثية الأبعاد والقص بالليزر.",
      },
    ];
    const generatedAnswer = "نقدم خدمة المجسمات المعمارية والماكيتات الهندسية، مع شحن مجاني إلى صلالة خلال يومين.";
    const result = guardResponseAgainstUngroundedClaims(generatedAnswer, sources, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_DELIVERY");
    expect(result.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");
  });
});
