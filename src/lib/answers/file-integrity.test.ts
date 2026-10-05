import { describe, expect, it } from "vitest";
import {
  evaluateFileSourceIntegrity,
  isAnswerEligibleVerdict,
  knowledgeObjectFileName,
  knowledgeObjectFolder,
  OBJECT_CLOCK_TOLERANCE_MS,
  type FileSourceExpectation,
  type KnowledgeObjectMeta,
} from "./file-integrity";

const ROW_AT = "2026-10-05T10:00:00.000Z";

function fileSource(over: Partial<FileSourceExpectation> = {}): FileSourceExpectation {
  return {
    kind: "file",
    storagePath: "co-a/src-1/menu.pdf",
    byteSize: 1024,
    rowUpdatedAt: ROW_AT,
    ...over,
  };
}

function object(over: Partial<KnowledgeObjectMeta> = {}): KnowledgeObjectMeta {
  return {
    name: "menu.pdf",
    updated_at: "2026-10-05T09:59:50.000Z",
    metadata: { size: 1024 },
    ...over,
  };
}

describe("evaluateFileSourceIntegrity", () => {
  it("accepts an object written before the row published its text", () => {
    expect(evaluateFileSourceIntegrity({ source: fileSource(), object: object() })).toBe("ok");
  });

  it("rejects a deleted or moved object (no object at the stored path)", () => {
    expect(evaluateFileSourceIntegrity({ source: fileSource(), object: null })).toBe("missing");
  });

  it("rejects an object replaced in place after extraction", () => {
    const verdict = evaluateFileSourceIntegrity({
      source: fileSource(),
      object: object({
        updated_at: new Date(Date.parse(ROW_AT) + OBJECT_CLOCK_TOLERANCE_MS + 1_000).toISOString(),
      }),
    });
    expect(verdict).toBe("modified");
  });

  it("rejects a byte-size change even when timestamps look old", () => {
    expect(
      evaluateFileSourceIntegrity({ source: fileSource(), object: object({ metadata: { size: 99 } }) }),
    ).toBe("size_mismatch");
  });

  it("rejects a row whose storage path was cleared", () => {
    expect(
      evaluateFileSourceIntegrity({ source: fileSource({ storagePath: null }), object: object() }),
    ).toBe("no_path");
  });

  it("rejects unreadable timestamps instead of passing them", () => {
    expect(
      evaluateFileSourceIntegrity({
        source: fileSource(),
        object: object({ updated_at: null, created_at: null }),
      }),
    ).toBe("unreadable");
  });

  it("skips text sources", () => {
    expect(
      evaluateFileSourceIntegrity({
        source: fileSource({ kind: "text", storagePath: null }),
        object: null,
      }),
    ).toBe("not_file");
  });

  it("treats only ok and not_file as answer eligible", () => {
    expect(isAnswerEligibleVerdict("ok")).toBe(true);
    expect(isAnswerEligibleVerdict("not_file")).toBe(true);
    for (const bad of ["missing", "modified", "size_mismatch", "no_path", "unreadable"] as const) {
      expect(isAnswerEligibleVerdict(bad)).toBe(false);
    }
  });
});

describe("path helpers", () => {
  it("derives folder and file name from company/source identity", () => {
    expect(knowledgeObjectFolder("co-a", "src-1")).toBe("co-a/src-1");
    expect(knowledgeObjectFileName("co-a/src-1/menu.pdf")).toBe("menu.pdf");
  });
});
