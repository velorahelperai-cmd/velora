import { describe, expect, it } from "vitest";
import { classifyStuckAttempt } from "./recovery";

const base = {
  attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  state: "running" as const,
  expiresAt: "2026-10-31T12:00:00.000Z",
  providerDispatch: "none" as const,
  sourceStatus: "processing",
  failureCode: null,
};

describe("classifyStuckAttempt", () => {
  it("waits while the lease is still active", () => {
    expect(classifyStuckAttempt(base, Date.parse("2026-10-31T11:00:00.000Z"))).toEqual({
      action: "wait",
      reason: "LEASE_ACTIVE",
    });
  });

  it("allows a new attemptId when the lease expired before provider contact", () => {
    expect(classifyStuckAttempt(base, Date.parse("2026-10-31T13:00:00.000Z"))).toEqual({
      action: "recover_expired",
      reason: "LEASE_EXPIRED_BEFORE_PROVIDER",
      recoverAttemptId: base.attemptId,
    });
  });

  it("holds review when the provider outcome is unknown", () => {
    expect(
      classifyStuckAttempt(
        { ...base, providerDispatch: "dispatched", expiresAt: "2026-10-31T10:00:00.000Z" },
        Date.parse("2026-10-31T13:00:00.000Z"),
      ),
    ).toEqual({ action: "review_required", reason: "PROVIDER_DISPATCHED_UNKNOWN" });

    expect(
      classifyStuckAttempt(
        {
          ...base,
          state: "failed",
          sourceStatus: "failed",
          failureCode: "provider_outcome_unknown",
          providerDispatch: "unknown",
        },
        Date.parse("2026-10-31T13:00:00.000Z"),
      ),
    ).toEqual({ action: "review_required", reason: "PROVIDER_OUTCOME_UNKNOWN" });
  });
});
