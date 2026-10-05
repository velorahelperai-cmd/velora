import type { AnswerResult } from "@/lib/answers/types";

/**
 * Shared outcome contract for the assistant tester.
 * Ask failures become UNAVAILABLE and notify the setup callback once
 * so a stale local setupTestPassed marker can be cleared.
 * Callback throws never rewrite the ask result and never enqueue a second notify.
 */
export async function runAssistantAskAttempt(input: {
  ask: () => Promise<AnswerResult>;
  onAnswerResult?: (result: AnswerResult) => void;
}): Promise<{ result: AnswerResult; fromException: boolean }> {
  let result: AnswerResult;
  let fromException = false;
  try {
    result = await input.ask();
  } catch {
    result = { ok: false, code: "UNAVAILABLE" };
    fromException = true;
  }

  try {
    input.onAnswerResult?.(result);
  } catch {
    // Callback is fire-and-notify only; its failure must not replace the ask outcome.
  }

  return { result, fromException };
}
