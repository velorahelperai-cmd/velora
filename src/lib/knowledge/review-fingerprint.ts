import { createHash } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** True when the value is a lowercase SHA-256 hex digest. */
export function isKnowledgeReviewFingerprint(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * Fingerprint of the exact text shown for review: always SHA-256 of trimmed content.
 * prepared_text_sha256 is never used as a substitute; a mismatched stored digest
 * must not authorize approval of different on-screen text.
 */
export function knowledgeReviewFingerprint(source: {
  content?: string | null;
}): string | null {
  const text = typeof source.content === "string" ? source.content.trim() : "";
  if (!text) return null;
  return createHash("sha256").update(text, "utf8").digest("hex");
}
