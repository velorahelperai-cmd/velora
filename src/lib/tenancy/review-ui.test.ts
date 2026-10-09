import { describe, expect, it } from "vitest";
import { canResubmitReview, reviewFailureMessage } from "./review-ui";

describe("G03 review UI", () => {
  it("allows explicit re-submission of a legacy or stale pending/approved snapshot", () => {
    expect(canResubmitReview({ status: "approved", proof_current: false })).toBe(true);
    expect(canResubmitReview({ status: "pending_review" })).toBe(true);
    expect(canResubmitReview({ status: "pending_review", proof_current: true })).toBe(false);
    expect(canResubmitReview({ status: "changes_requested", proof_current: true })).toBe(true);
    expect(canResubmitReview(null)).toBe(false);
  });
  it("distinguishes missing legacy evidence from unavailable reads without claiming channel activation", () => {
    expect(reviewFailureMessage("FILE_REPREPARE_REQUIRED", "ar")).toContain("إعادة تجهيز");
    expect(reviewFailureMessage("secret-error", "ar")).not.toContain("secret-error");
  });
});
