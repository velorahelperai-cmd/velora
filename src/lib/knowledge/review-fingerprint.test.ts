import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isKnowledgeReviewFingerprint,
  knowledgeReviewFingerprint,
} from "./review-fingerprint";

describe("knowledgeReviewFingerprint", () => {
  it("hashes trimmed content and does not use a stale prepared digest as the fingerprint", () => {
    const content = "  reviewed body  ";
    const expected = createHash("sha256").update("reviewed body", "utf8").digest("hex");
    const stalePrepared = "a".repeat(64);
    expect(knowledgeReviewFingerprint({ content })).toBe(expected);
    expect(isKnowledgeReviewFingerprint(expected)).toBe(true);
    expect(expected).not.toBe(stalePrepared);
  });

  it("returns null for empty content", () => {
    expect(knowledgeReviewFingerprint({ content: "   " })).toBeNull();
    expect(knowledgeReviewFingerprint({})).toBeNull();
  });
});
