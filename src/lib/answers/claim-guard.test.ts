import { describe, it, expect } from "vitest";
import { guardResponseAgainstUngroundedClaims } from "./claim-guard";

describe("guardResponseAgainstUngroundedClaims", () => {
  it("مصدر «لا نوفر الشحن» لا يجيز «شحن مجاني خلال يومين»", () => {
    const sources = [
      {
        title: "الشحن والتوصيل",
        text: "نحن متجر محلي حالياً، لا نوفر الشحن والتوصيل خارج المقر.",
      },
    ];
    const generatedAnswer = "شحن مجاني خلال يومين إلى موقعك.";
    const result = guardResponseAgainstUngroundedClaims(generatedAnswer, sources, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_DELIVERY");
    expect(result.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");
  });

  it("مصدر عن المجسمات وحده لا يجيز سعرًا غير موجود", () => {
    const sources = [
      {
        title: "خدمة المجسمات المعمارية",
        text: "نقدم في تاجسيم تصميم وتصنيع المجسمات المعمارية والماكيتات الهندسية بأعلى دقة.",
      },
    ];
    const generatedAnswer = "نقدم خدمة المجسمات المعمارية والماكيتات الهندسية بأعلى دقة. تكلفة الباقة 50 ر.ع.";
    const result = guardResponseAgainstUngroundedClaims(generatedAnswer, sources, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_PRICE");
    // Retains the verified service part while explicitly stating price detail is unavailable
    expect(result.sanitizedText).toContain("نقدم خدمة المجسمات المعمارية والماكيتات الهندسية بأعلى دقة");
    expect(result.sanitizedText).toContain("تفاصيل الأسعار غير متوفرة");
  });

  it("وجود مصادر لا يجيز «تم الحجز» دون تنفيذ", () => {
    const sources = [
      {
        title: "المواعيد",
        text: "يمكن للمستفيدين حجز المواعيد للاستشارات الهندسية عبر منصة الحجز الرسمية.",
      },
    ];
    const generatedAnswer = "يمكن حجز المواعيد للاستشارات الهندسية. تم الحجز بنجاح وموعدك غداً.";
    const result = guardResponseAgainstUngroundedClaims(generatedAnswer, sources, "ar");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("UNGROUNDED_ACTION");
    expect(result.sanitizedText).toContain("يمكن حجز المواعيد للاستشارات الهندسية");
    expect(result.sanitizedText).toContain("تأكيد الحجز أو الدفع غير متاح آلياً");
  });

  it("بقاء السؤال المعروف والمجاملة وNO_MATCH تعمل", () => {
    // 1. Known question with grounded answer and valid citation
    const sources = [
      {
        title: "خدمة المجسمات المعمارية",
        text: "نقدم في تاجسيم تصميم وتصنيع المجسمات المعمارية والماكيتات الهندسية بأعلى دقة.",
      },
    ];
    const groundedAnswer = "نقدم في تاجسيم تصميم وتصنيع المجسمات المعمارية والماكيتات الهندسية بأعلى دقة.";
    const res1 = guardResponseAgainstUngroundedClaims(groundedAnswer, sources, "ar");
    expect(res1.valid).toBe(true);
    expect(res1.sanitizedText).toBe(groundedAnswer);

    // 2. Pure courtesy / small-talk without citations
    const courtesy = "أهلاً بك! كيف يمكنني مساعدتك اليوم؟";
    const res2 = guardResponseAgainstUngroundedClaims(courtesy, [], "ar");
    expect(res2.valid).toBe(true);
    expect(res2.sanitizedText).toBe(courtesy);

    // 3. NO_MATCH polite response without citations
    const noMatch = "عذراً، هذه المعلومة غير متوفرة حالياً في معلومات النشاط المعتمدة. هل يمكنك توضيح سؤالك؟";
    const res3 = guardResponseAgainstUngroundedClaims(noMatch, [], "ar");
    expect(res3.valid).toBe(true);
    expect(res3.sanitizedText).toBe(noMatch);
  });

  it("allows grounded price when price appears in verified sources", () => {
    const sources = [
      {
        title: "أسعار الباقات",
        text: "سعر الباقة الأساسية هو 25 ر.ع شاملة كافة الخدمات المعتمدة.",
      },
    ];
    const text = "سعر الباقة الأساسية هو 25 ر.ع.";
    const result = guardResponseAgainstUngroundedClaims(text, sources, "ar");
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
