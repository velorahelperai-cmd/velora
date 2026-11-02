import { MultiModelAIRouter } from "../routing/router";
import type { AIModelId } from "../types";

/** Keep sensitive and catalog questions on their existing stronger route. */
export function selectWhatsappModel(question: string): AIModelId | undefined {
  if (question.length > 180 || /استرداد|استرجاع|شكوى|شكوي|تعويض|دفع|فلوس|اموال|أموال|حجز|إلغاء|الغاء/u.test(question)) return undefined;
  const result = new MultiModelAIRouter().classify({ question, locale: "ar", chunks: [] });
  return result.taskType === "simple_faq" && !result.verificationRequired ? "gemini-3.5-flash-lite" : undefined;
}
