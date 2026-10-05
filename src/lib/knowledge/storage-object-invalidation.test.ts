import { describe, expect, it } from "vitest";
import {
  applyStorageObjectEvent,
  isAnswerEligibleRow,
  storageObjectInvalidationOps,
  type KnowledgeFileRow,
} from "./storage-object-invalidation";

function approvedFile(over: Partial<KnowledgeFileRow> = {}): KnowledgeFileRow {
  return {
    kind: "file",
    storage_path: "co-a/src-1/menu.pdf",
    content: "Daily 10-22",
    status: "ready",
    failure_code: null,
    content_version: 2,
    approved_for_answers: true,
    approved_version: 2,
    ...over,
  };
}

describe("storageObjectInvalidationOps — direct Storage writes", () => {
  it("invalidates the old identity on owner delete", () => {
    expect(
      storageObjectInvalidationOps({
        op: "DELETE",
        bucket: "company-knowledge",
        name: "co-a/src-1/menu.pdf",
      }),
    ).toEqual([{ path: "co-a/src-1/menu.pdf", leaveIdentity: true }]);
  });

  it("invalidates same-path replace without dropping the reserved path", () => {
    expect(
      storageObjectInvalidationOps({
        op: "UPDATE",
        oldBucket: "company-knowledge",
        oldName: "co-a/src-1/menu.pdf",
        newBucket: "company-knowledge",
        newName: "co-a/src-1/menu.pdf",
      }),
    ).toEqual([{ path: "co-a/src-1/menu.pdf", leaveIdentity: false }]);
  });

  it("treats a rename/move as leave-old + invalidate-new", () => {
    expect(
      storageObjectInvalidationOps({
        op: "UPDATE",
        oldBucket: "company-knowledge",
        oldName: "co-a/src-1/menu.pdf",
        newBucket: "company-knowledge",
        newName: "co-a/src-1/menu-v2.pdf",
      }),
    ).toEqual([
      { path: "co-a/src-1/menu.pdf", leaveIdentity: true },
      { path: "co-a/src-1/menu-v2.pdf", leaveIdentity: false },
    ]);
  });

  it("ignores objects outside company-knowledge", () => {
    expect(
      storageObjectInvalidationOps({
        op: "DELETE",
        bucket: "other-bucket",
        name: "co-a/src-1/menu.pdf",
      }),
    ).toEqual([]);
  });
});

describe("applyStorageObjectEvent — old text must not stay answer-eligible", () => {
  it("clears eligibility after a direct delete", () => {
    const next = applyStorageObjectEvent(approvedFile(), {
      op: "DELETE",
      bucket: "company-knowledge",
      name: "co-a/src-1/menu.pdf",
    });
    expect(next.content).toBe("");
    expect(next.storage_path).toBeNull();
    expect(next.status).toBe("failed");
    expect(isAnswerEligibleRow(next)).toBe(false);
  });

  it("clears eligibility after an in-place replace", () => {
    const next = applyStorageObjectEvent(approvedFile(), {
      op: "UPDATE",
      oldBucket: "company-knowledge",
      oldName: "co-a/src-1/menu.pdf",
      newBucket: "company-knowledge",
      newName: "co-a/src-1/menu.pdf",
    });
    expect(next.content).toBe("");
    expect(next.storage_path).toBe("co-a/src-1/menu.pdf");
    expect(next.status).toBe("stored");
    expect(isAnswerEligibleRow(next)).toBe(false);
  });

  it("does not bump content_version when content is already empty and the path stays", () => {
    const empty = approvedFile({
      content: "",
      status: "draft",
      approved_for_answers: false,
      approved_version: null,
      content_version: 3,
    });
    const next = applyStorageObjectEvent(empty, {
      op: "UPDATE",
      oldBucket: "company-knowledge",
      oldName: "co-a/src-1/menu.pdf",
      newBucket: "company-knowledge",
      newName: "co-a/src-1/menu.pdf",
    });
    expect(next.content_version).toBe(3);
    expect(next.storage_path).toBe("co-a/src-1/menu.pdf");
    expect(next.content).toBe("");
  });

  it("clears eligibility after a move away from the stored path", () => {
    const next = applyStorageObjectEvent(approvedFile(), {
      op: "UPDATE",
      oldBucket: "company-knowledge",
      oldName: "co-a/src-1/menu.pdf",
      newBucket: "company-knowledge",
      newName: "co-a/src-1/other.pdf",
    });
    expect(next.storage_path).toBeNull();
    expect(next.content).toBe("");
    expect(isAnswerEligibleRow(next)).toBe(false);
  });
});

describe("live Storage/RLS", () => {
  it.skip("deferred: owner UPDATE/DELETE on company-knowledge against an authorized project (no guessed cloud fixtures)", () => {
    expect(true).toBe(true);
  });
});
