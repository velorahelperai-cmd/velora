import { describe, expect, it } from "vitest";
import { isExactMissingApprovalColumnError } from "./foundation";
import { isApprovedForAnswers, type KnowledgeSourceRecord } from "./types";

function baseSrc(over: Partial<KnowledgeSourceRecord> = {}): KnowledgeSourceRecord {
  return {
    id: "s1",
    company_id: "co-a",
    kind: "text",
    title: "Hours",
    content: "10-22",
    file_name: null,
    content_type: null,
    byte_size: null,
    storage_path: null,
    status: "ready",
    failure_code: null,
    content_version: 1,
    approved_for_answers: true,
    approved_version: 1,
    approved_at: "2026-01-01T00:00:00Z",
    approved_by: "u1",
    created_by: "u1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("isExactMissingApprovalColumnError", () => {
  it("detects schema absence of approval columns", () => {
    expect(
      isExactMissingApprovalColumnError({
        code: "PGRST204",
        message: "Could not find the 'approved_for_answers' column of 'knowledge_sources' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isExactMissingApprovalColumnError({
        code: "42703",
        message: 'column "content_version" does not exist',
      }),
    ).toBe(true);
  });

  it("does not treat RLS or permission errors as missing foundation", () => {
    expect(
      isExactMissingApprovalColumnError({
        code: "42501",
        message: "permission denied for table knowledge_sources",
      }),
    ).toBe(false);
    expect(
      isExactMissingApprovalColumnError({
        message: "new row violates row-level security policy",
      }),
    ).toBe(false);
  });
});

describe("isApprovedForAnswers", () => {
  it("requires ready + matching approved version + content", () => {
    expect(isApprovedForAnswers(baseSrc())).toBe(true);
    expect(isApprovedForAnswers(baseSrc({ approved_for_answers: false }))).toBe(false);
    expect(isApprovedForAnswers(baseSrc({ approved_version: 2 }))).toBe(false);
    expect(isApprovedForAnswers(baseSrc({ content_version: null }))).toBe(false);
    expect(isApprovedForAnswers(baseSrc({ content: "   " }))).toBe(false);
    expect(isApprovedForAnswers(baseSrc({ status: "stored" }))).toBe(false);
  });

  it("rejects stale approval after version bump", () => {
    expect(
      isApprovedForAnswers(baseSrc({
        content_version: 3,
        approved_version: 2,
        approved_for_answers: true,
      })),
    ).toBe(false);
  });
});
