import type { AnswerProvider } from "@/lib/answers/types";

/**
 * Live providers stay disabled until configured with budget/usage controls.
 * Presence of env placeholders alone must not enable paid calls.
 */
export function getAnswerProvider(): AnswerProvider | null {
  // No provider wired in this foundation package — tester must surface NEEDS_SETUP.
  return null;
}
