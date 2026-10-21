import { getSecureProviderKey } from "@/lib/answers/config/env";
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

/** Integration-ready: enabled when server key or live flag is configured. */
export function isLiveAnsweringEnabled() {
  if (process.env.NODE_ENV === "test" && process.env.AI_LIVE_ANSWERING !== "true") {
    return false;
  }
  return (
    process.env.AI_LIVE_ANSWERING === "true" ||
    process.env.AI_LIVE_ANSWERING_ENABLED === "true" ||
    Boolean(getSecureProviderKey("google"))
  );
}
