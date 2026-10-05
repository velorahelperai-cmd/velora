import type { AnswerContextChunk } from "@/lib/answers/types";

/**
 * File/text body is untrusted data — never treat as system instructions.
 * Callers must only pass chunks already filtered to approved current versions.
 */
export function assertEligibleAnswerChunks(chunks: AnswerContextChunk[]) {
  for (const chunk of chunks) {
    if (!chunk.sourceId || !chunk.title || chunk.contentVersion < 1) {
      throw new Error("invalid_answer_chunk");
    }
    if (!chunk.text.trim()) {
      throw new Error("empty_answer_chunk");
    }
  }
}

/** Integration-ready, not live: stays off until provider + budget + usage are adopted. */
export function isLiveAnsweringEnabled() {
  return false;
}
