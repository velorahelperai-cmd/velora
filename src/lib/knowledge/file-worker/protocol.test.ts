import { describe, expect, it } from "vitest";
import {
  canPublishWithAttempt,
  mapClaimToEnqueue,
  mayDispatchPaidExtract,
} from "./protocol";

const baseAttempt = {
  attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  state: "running" as const,
  expiresAt: "2099-01-01T00:00:00.000Z",
  contentVersion: 4,
  storagePath: "co/src/file.pdf",
};

describe("knowledge file attempt protocol", () => {
  it("blocks an expired or foreign attempt from publishing", () => {
    expect(
      canPublishWithAttempt({
        heldAttemptId: baseAttempt.attemptId,
        attempt: { ...baseAttempt, expiresAt: "2020-01-01T00:00:00.000Z" },
        sourceStatus: "processing",
        sourceContentVersion: 4,
        sourceStoragePath: baseAttempt.storagePath,
        nowMs: Date.parse("2026-10-31T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, code: "ATTEMPT_EXPIRED" });

    expect(
      canPublishWithAttempt({
        heldAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        attempt: baseAttempt,
        sourceStatus: "processing",
        sourceContentVersion: 4,
        sourceStoragePath: baseAttempt.storagePath,
        nowMs: Date.parse("2026-10-31T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, code: "ATTEMPT_CONFLICT" });
  });

  it("allows only the live matching attempt to publish", () => {
    expect(
      canPublishWithAttempt({
        heldAttemptId: baseAttempt.attemptId,
        attempt: baseAttempt,
        sourceStatus: "processing",
        sourceContentVersion: 4,
        sourceStoragePath: baseAttempt.storagePath,
        nowMs: Date.parse("2026-10-31T00:00:00.000Z"),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses blind paid extract retry on unknown outcomes or new attempt ids", () => {
    expect(
      mayDispatchPaidExtract({
        attemptState: "running",
        providerEvidence: "unknown",
        sameAttemptId: false,
      }),
    ).toEqual({ ok: false, code: "NO_BLIND_RETRY" });
    expect(
      mayDispatchPaidExtract({
        attemptState: "running",
        providerEvidence: "unknown",
        sameAttemptId: true,
      }),
    ).toEqual({ ok: false, code: "NO_BLIND_RETRY" });
    expect(
      mayDispatchPaidExtract({
        attemptState: "running",
        providerEvidence: "none",
        sameAttemptId: true,
      }),
    ).toEqual({ ok: true });
  });

  it("maps successful claims to queued/processing without implying extract finished", () => {
    expect(
      mapClaimToEnqueue({
        ok: true,
        attemptId: baseAttempt.attemptId,
        replayed: false,
      }),
    ).toEqual({
      mode: "queued",
      attemptId: baseAttempt.attemptId,
      status: "processing",
      replayed: false,
    });
    expect(
      mapClaimToEnqueue({
        ok: true,
        attemptId: baseAttempt.attemptId,
        replayed: true,
      }),
    ).toEqual({
      mode: "queued",
      attemptId: baseAttempt.attemptId,
      status: "processing",
      replayed: true,
    });
    expect(mapClaimToEnqueue({ ok: false, code: "BUSY" })).toEqual({
      mode: "busy",
      code: "BUSY",
    });
    expect(mapClaimToEnqueue({ ok: false, code: "REVIEW_REQUIRED", attemptId: baseAttempt.attemptId })).toEqual({
      mode: "busy",
      code: "REVIEW_REQUIRED",
      attemptId: baseAttempt.attemptId,
    });
  });

  it("never invents queued/processing when the claim was not saved", () => {
    expect(mapClaimToEnqueue({ ok: false, code: "CONFLICT" }).mode).toBe("busy");
    expect(mapClaimToEnqueue({ ok: true }).mode).toBe("unavailable");
    expect(mapClaimToEnqueue({ ok: true, attemptId: "" }).mode).toBe("unavailable");
  });
});
