import { answerRuntimeSetup } from "@/lib/answers/runtime-setup";
import type { AnswerProvider } from "@/lib/answers/types";

/**
 * Plug point for the adopted AnswerProvider.
 * Integration-ready: returns null until answerRuntimeSetup is approved (provider+model+budget).
 * Env placeholders alone must not enable paid calls.
 */
export function getAnswerProvider(): AnswerProvider | null {
  // Plug here when answerRuntimeSetup() becomes ok with provider+model+budget.
  if (answerRuntimeSetup().code === "NEEDS_SETUP") return null;
  return null;
}
