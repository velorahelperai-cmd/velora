import { afterEach, describe, expect, it, vi } from "vitest";
import { validateLiveTestScope, LIVE_TEST_ALLOWED_SCOPE } from "./live-test-gate";

describe("live-test-gate allowlist enforcement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes any scope when live test gate is inactive", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WHATSAPP_LIVE_TEST_SCOPE_ENFORCED", "false");
    const result = validateLiveTestScope({
      companyId: "random-company",
      recipientWaId: "12345678",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("allows exact live test parameters when gate is enforced", () => {
    vi.stubEnv("WHATSAPP_LIVE_TEST_SCOPE_ENFORCED", "true");
    const result1 = validateLiveTestScope({
      companyId: LIVE_TEST_ALLOWED_SCOPE.companyId,
      branchId: LIVE_TEST_ALLOWED_SCOPE.branchId,
      recipientWaId: "+96893180420",
      createdAt: "2026-11-05T21:15:00Z",
    });
    expect(result1.ok).toBe(true);

    const result2 = validateLiveTestScope({
      companyId: LIVE_TEST_ALLOWED_SCOPE.companyId,
      branchId: LIVE_TEST_ALLOWED_SCOPE.branchId,
      recipientWaId: "+96879989464",
      createdAt: "2026-11-05T21:15:00Z",
    });
    expect(result2.ok).toBe(true);

    const resultAny = validateLiveTestScope({
      companyId: LIVE_TEST_ALLOWED_SCOPE.companyId,
      branchId: LIVE_TEST_ALLOWED_SCOPE.branchId,
      recipientWaId: "+966501234567",
      createdAt: "2026-11-05T21:15:00Z",
    });
    expect(resultAny.ok).toBe(true);
  });

  it("rejects unauthorized company", () => {
    vi.stubEnv("WHATSAPP_LIVE_TEST_SCOPE_ENFORCED", "true");
    const result = validateLiveTestScope({
      companyId: "unauthorized-company-id",
      recipientWaId: "+96893180420",
      createdAt: "2026-11-05T21:15:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("COMPANY_NOT_IN_LIVE_TEST_SCOPE");
  });

  it("rejects unauthorized recipient when specific test recipient is configured in env", () => {
    vi.stubEnv("WHATSAPP_LIVE_TEST_SCOPE_ENFORCED", "true");
    vi.stubEnv("WHATSAPP_TEST_RECIPIENT", "96893180420");
    const result = validateLiveTestScope({
      companyId: LIVE_TEST_ALLOWED_SCOPE.companyId,
      recipientWaId: "+96891234567",
      createdAt: "2026-11-05T21:15:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("RECIPIENT_NOT_IN_LIVE_TEST_SCOPE");
  });

  it("rejects unauthorized branch", () => {
    vi.stubEnv("WHATSAPP_LIVE_TEST_SCOPE_ENFORCED", "true");
    const result = validateLiveTestScope({
      companyId: LIVE_TEST_ALLOWED_SCOPE.companyId,
      branchId: "foreign-branch-id",
      recipientWaId: "+96893180420",
      createdAt: "2026-11-05T21:15:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("BRANCH_NOT_IN_LIVE_TEST_SCOPE");
  });

  it("rejects historical job prior to activation cutoff", () => {
    vi.stubEnv("WHATSAPP_LIVE_TEST_SCOPE_ENFORCED", "true");
    const result = validateLiveTestScope({
      companyId: LIVE_TEST_ALLOWED_SCOPE.companyId,
      branchId: LIVE_TEST_ALLOWED_SCOPE.branchId,
      recipientWaId: "+96893180420",
      createdAt: "2026-11-05T20:52:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("JOB_PRIOR_TO_ACTIVATION_CUTOFF");
  });
});
