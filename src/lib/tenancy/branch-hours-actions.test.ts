import { describe, expect, it, vi, beforeEach } from "vitest";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "99999999-9999-4999-8999-999999999999";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

let currentSessionId: string | null = VALID_ACCOUNT_ID;
let rpcMock = vi.fn();

vi.mock("@/lib/auth/server-identity", () => ({
  readSessionIdentity: vi.fn(async () => {
    if (!currentSessionId) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: true, userId: currentSessionId };
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getClaims: vi.fn(async () => ({
        data: { claims: { sub: currentSessionId } },
        error: null,
      })),
    },
    rpc: rpcMock,
  })),
}));

vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: vi.fn(),
  withLogContext: vi.fn(async (_ctx, fn) => fn()),
}));

import {
  copyOwnedBranchHoursAction,
  readOwnedBranchHoursAction,
  saveOwnedBranchHoursAction,
} from "./branch-hours-actions";
import { emptyBranchHours } from "./branch-hours-contracts";

describe("branch-hours-actions", () => {
  beforeEach(() => {
    currentSessionId = VALID_ACCOUNT_ID;
    rpcMock = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        data: {
          snapshot: {
            scope: {
              expectedAccountId: VALID_ACCOUNT_ID,
              companyId: VALID_COMPANY_ID,
              branchId: VALID_BRANCH_ID,
            },
            version: 1,
            branchLabel: "Main",
            timezone: "Asia/Muscat",
            schedule: emptyBranchHours(),
          },
          copyTargets: [],
          capabilities: { canSave: true, canCopy: false },
          confirmation: "unset",
        },
      },
      error: null,
    });
  });

  it("denies unauthenticated read", async () => {
    currentSessionId = null;
    const res = await readOwnedBranchHoursAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res).toEqual({ ok: false, code: "unauthenticated", snapshot: null });
  });

  it("denies account mismatch read", async () => {
    currentSessionId = OTHER_ACCOUNT_ID;
    const res = await readOwnedBranchHoursAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res).toEqual({ ok: false, code: "forbidden", snapshot: null });
  });

  it("successfully reads branch hours when authorized", async () => {
    const res = await readOwnedBranchHoursAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.snapshot.version).toBe(1);
      expect(res.snapshot.branchLabel).toBe("Main");
    }
  });

  it("saves branch hours draft when authorized", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          snapshot: {
            scope: {
              expectedAccountId: VALID_ACCOUNT_ID,
              companyId: VALID_COMPANY_ID,
              branchId: VALID_BRANCH_ID,
            },
            version: 2,
            branchLabel: "Main",
            timezone: "Asia/Muscat",
            schedule: emptyBranchHours(),
          },
          receipt: { branchId: VALID_BRANCH_ID, version: 2, fingerprint: "fp" },
        },
      },
      error: null,
    });

    const res = await saveOwnedBranchHoursAction({
      scope: {
        expectedAccountId: VALID_ACCOUNT_ID,
        companyId: VALID_COMPANY_ID,
        branchId: VALID_BRANCH_ID,
      },
      expectedVersion: 1,
      schedule: emptyBranchHours(),
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.receipt.version).toBe(2);
    }
  });

  it("denies save when account mismatch occurs", async () => {
    currentSessionId = OTHER_ACCOUNT_ID;
    const res = await saveOwnedBranchHoursAction({
      scope: {
        expectedAccountId: VALID_ACCOUNT_ID,
        companyId: VALID_COMPANY_ID,
        branchId: VALID_BRANCH_ID,
      },
      expectedVersion: 1,
      schedule: emptyBranchHours(),
    });
    expect(res).toEqual({ ok: false, code: "forbidden" });
  });

  it("handles copy owned branch hours action", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          results: [{ branchId: "44444444-4444-4444-8444-444444444444", version: 2, receiptId: "rcpt" }],
          targets: [],
        },
      },
      error: null,
    });

    const res = await copyOwnedBranchHoursAction({
      source: {
        scope: {
          expectedAccountId: VALID_ACCOUNT_ID,
          companyId: VALID_COMPANY_ID,
          branchId: VALID_BRANCH_ID,
        },
        expectedVersion: 1,
        schedule: emptyBranchHours(),
      },
      mode: "local-weekday-clock",
      targets: [{ branchId: "44444444-4444-4444-8444-444444444444", expectedVersion: 1 }],
    });

    expect(res.ok).toBe(true);
  });
});
