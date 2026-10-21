import { describe, expect, it } from "vitest";
import {
  SECOND_BRANCH_DEFERRED,
  SINGLE_BRANCH_MAX_BRANCHES,
  isSecondBranchDeferredError,
  secondBranchDeferredMessage,
  singleBranchCountAllowed,
} from "./single-branch-policy";

describe("single branch policy", () => {
  it("enforces a maximum of one branch in current scope", () => {
    expect(SINGLE_BRANCH_MAX_BRANCHES).toBe(1);
    expect(singleBranchCountAllowed(1)).toBe(true);
    expect(singleBranchCountAllowed(0)).toBe(false);
    expect(singleBranchCountAllowed(2)).toBe(false);
    expect(singleBranchCountAllowed(5)).toBe(false);
    expect(singleBranchCountAllowed(null)).toBe(false);
    expect(singleBranchCountAllowed(undefined)).toBe(false);
    expect(singleBranchCountAllowed("1")).toBe(false);
  });

  it("provides truthful messages in Arabic and English explaining the deferral", () => {
    const ar = secondBranchDeferredMessage("ar");
    const en = secondBranchDeferredMessage("en");
    expect(ar).toContain("فرعًا واحدًا");
    expect(ar).toContain("مؤجَّل");
    expect(en).toContain("one branch per business");
    expect(en).toContain("deferred");
  });

  it("identifies native SECOND_BRANCH_DEFERRED errors", () => {
    expect(isSecondBranchDeferredError({ message: "SECOND_BRANCH_DEFERRED" })).toBe(true);
    expect(isSecondBranchDeferredError({ details: "failed with SECOND_BRANCH_DEFERRED code" })).toBe(true);
    expect(isSecondBranchDeferredError({ code: SECOND_BRANCH_DEFERRED })).toBe(true);
    expect(isSecondBranchDeferredError({ message: "OTHER_ERROR" })).toBe(false);
    expect(isSecondBranchDeferredError(null)).toBe(false);
  });
});
