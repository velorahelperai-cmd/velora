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

type LiveFlag = "on" | "off" | "unset";

/** Parse AI_LIVE_ANSWERING / AI_LIVE_ANSWERING_ENABLED. Explicit off is a kill switch. */
export function readLiveAnsweringFlag(): LiveFlag {
  const raw = process.env.AI_LIVE_ANSWERING ?? process.env.AI_LIVE_ANSWERING_ENABLED;
  if (raw === undefined || raw.trim() === "") return "unset";
  const value = raw.trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off" || value === "no") return "off";
  if (value === "true" || value === "1" || value === "on" || value === "yes") return "on";
  // Unknown values fail closed (treat as off) so typos cannot accidentally enable spend.
  return "off";
}

/**
 * Live answering gate.
 * Contract: an explicit off/false kill switch wins over key presence.
 * Unset + key may enable outside hermetic tests; tests stay off unless flag is on.
 */
export function isLiveAnsweringEnabled() {
  const flag = readLiveAnsweringFlag();
  if (flag === "off") return false;
  if (flag === "on") return true;
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") return false;
  return Boolean(getSecureProviderKey("google"));
}
