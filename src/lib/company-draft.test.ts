import { describe, expect, it } from "vitest";
import {
  buildSetupTestKnowledgeKey,
  clearSetupTestProgress,
  emptyCompanyDraft,
  isSetupTestStillValid,
  markSetupTestPassed,
} from "./company-draft";

const srcA = {
  id: "a",
  status: "ready",
  content_version: 1,
  approved_version: 1,
  approved_for_answers: true,
};

const srcB = {
  id: "b",
  status: "ready",
  content_version: 2,
  approved_version: null,
  approved_for_answers: false,
};

describe("setupTestPassed local binding", () => {
  it("rejects unbound legacy markers", () => {
    const draft = emptyCompanyDraft("u1");
    draft.setupTestPassed = true;
    const key = buildSetupTestKnowledgeKey("co-1", "ready", [srcA]);
    expect(isSetupTestStillValid(draft, "co-1", key)).toBe(false);
  });

  it("invalidates when company changes", () => {
    const key = buildSetupTestKnowledgeKey("co-1", "ready", [srcA]);
    const marked = markSetupTestPassed(emptyCompanyDraft("u1"), "co-1", key);
    expect(isSetupTestStillValid(marked, "co-1", key)).toBe(true);
    expect(isSetupTestStillValid(marked, "co-2", key)).toBe(false);
  });

  it("invalidates when knowledge version or approval changes", () => {
    const key1 = buildSetupTestKnowledgeKey("co-1", "ready", [srcA, srcB]);
    const marked = markSetupTestPassed(emptyCompanyDraft("u1"), "co-1", key1);
    const key2 = buildSetupTestKnowledgeKey("co-1", "ready", [
      srcA,
      { ...srcB, content_version: 3 },
    ]);
    const key3 = buildSetupTestKnowledgeKey("co-1", "unavailable", [srcA, srcB]);
    const key4 = buildSetupTestKnowledgeKey("co-1", "ready", [
      srcA,
      { ...srcB, approved_for_answers: true, approved_version: 2 },
    ]);
    expect(isSetupTestStillValid(marked, "co-1", key1)).toBe(true);
    expect(isSetupTestStillValid(marked, "co-1", key2)).toBe(false);
    expect(isSetupTestStillValid(marked, "co-1", key3)).toBe(false);
    expect(isSetupTestStillValid(marked, "co-1", key4)).toBe(false);
  });

  it("clears marker after a failed later test", () => {
    const key = buildSetupTestKnowledgeKey("co-1", "ready", [srcA]);
    const marked = markSetupTestPassed(emptyCompanyDraft("u1"), "co-1", key);
    const cleared = clearSetupTestProgress(marked);
    expect(cleared.setupTestPassed).toBe(false);
    expect(cleared.setupTestCompanyId).toBeNull();
    expect(cleared.setupTestKnowledgeKey).toBeNull();
    expect(cleared.setupDone[2]).toBe(false);
    expect(isSetupTestStillValid(cleared, "co-1", key)).toBe(false);
  });

  it("does not treat empty/unbound mark as pass", () => {
    const draft = markSetupTestPassed(emptyCompanyDraft("u1"), "", "");
    expect(draft.setupTestPassed).toBe(false);
  });
});
