import { describe, expect, it } from "vitest";
import { classifyPureSocialSmallTalk } from "./small-talk";

describe("classifyPureSocialSmallTalk", () => {
  it("classifies pure Arabic thanks as pure social small-talk", () => {
    const thanksVariants = [
      "شكرا",
      "شكرًا",
      "شكرا جزيلا",
      "شكرًا جزيلاً",
      "مشكور",
      "تسلم يا غالي",
      "تسلم ايدك",
      "يعطيك العافية",
      "جزاك الله خيرا",
      "بارك الله فيك",
      "الف شكر",
    ];
    for (const text of thanksVariants) {
      const res = classifyPureSocialSmallTalk(text);
      expect(res.isPureSocial, `Expected "${text}" to be pure social`).toBe(true);
      expect(res.kind).toBe("thanks");
      expect(res.responseText).toBe("العفو! في خدمتك دائماً.");
    }
  });

  it("classifies pure Arabic greetings as pure social small-talk", () => {
    const greetingVariants = [
      "مرحبا",
      "مرحباً",
      "اهلا",
      "أهلاً",
      "أهلا وسهلا",
      "السلام عليكم",
      "السلام عليكم ورحمة الله وبركاته",
      "صباح الخير",
      "مساء الخير",
      "هلا والله",
    ];
    for (const text of greetingVariants) {
      const res = classifyPureSocialSmallTalk(text);
      expect(res.isPureSocial, `Expected "${text}" to be pure social`).toBe(true);
      expect(res.kind).toBe("greeting");
      expect(res.responseText).toBe("أهلاً وسهلاً بك! كيف يمكنني مساعدتك اليوم؟");
    }
  });

  it("classifies pure English thanks & greetings as pure social small-talk", () => {
    expect(classifyPureSocialSmallTalk("thank you")).toMatchObject({
      isPureSocial: true,
      kind: "thanks",
      responseText: "You're welcome! Happy to help.",
    });
    expect(classifyPureSocialSmallTalk("hello")).toMatchObject({
      isPureSocial: true,
      kind: "greeting",
      responseText: "Hello! How can I help you today?",
    });
  });

  it("rejects compound messages that combine courtesy with commercial inquiries", () => {
    const compound = [
      "شكرًا، والأسعار كام؟",
      "شكرا، ما هي الخدمات التي تقدمها تاجسيم؟",
      "أهلاً، ممكن أحجز موعد؟",
      "تسلم، كم تكلفة الاشتراك؟",
      "مرحبا، وين موقع الفرع؟",
      "hello, what are your prices?",
      "thanks, can I book an appointment?",
    ];
    for (const text of compound) {
      const res = classifyPureSocialSmallTalk(text);
      expect(res.isPureSocial, `Expected "${text}" to NOT be pure social`).toBe(false);
    }
  });

  it("rejects direct business inquiries and commercial questions", () => {
    const inquiries = [
      "ما هي الخدمات التي تقدمها تاجسيم؟",
      "كم سعر باقة فيلورا؟",
      "أوقات الدوام؟",
      "هل عندكم حجز اليوم؟",
      "what services do you offer?",
      "price list please",
    ];
    for (const text of inquiries) {
      const res = classifyPureSocialSmallTalk(text);
      expect(res.isPureSocial, `Expected "${text}" to NOT be pure social`).toBe(false);
    }
  });

  it("rejects risk and escalation requests even if prefixed with greeting", () => {
    expect(classifyPureSocialSmallTalk("مرحبا، اريد المدير").isPureSocial).toBe(false);
    expect(classifyPureSocialSmallTalk("شكرا، أريد استرجاع المبلغ").isPureSocial).toBe(false);
    expect(classifyPureSocialSmallTalk("السلام عليكم، عندي شكوى").isPureSocial).toBe(false);
  });
});
