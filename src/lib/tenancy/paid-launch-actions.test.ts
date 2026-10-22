import { describe, expect, it, vi, beforeEach } from "vitest";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "99999999-9999-4999-8999-999999999999";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const VALID_OP_ID = "44444444-4444-4444-8444-444444444444";

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
    rpc: rpcMock,
  })),
}));

vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: vi.fn(),
  withLogContext: vi.fn(async (_ctx, fn) => fn()),
}));

import {
  confirmOwnedBranchLaunchAction,
  readOwnedBranchLaunchSummaryAction,
} from "./paid-launch-actions";

describe("paid-launch-actions", () => {
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
            setup: {
              companyId: VALID_COMPANY_ID,
              selectedBranchId: VALID_BRANCH_ID,
              sourceStatus: "ready",
              selectedChannels: ["whatsapp"],
              entitlement: { package: "basic" },
              launch: { confirmationRequired: true, confirmed: false, canRequest: true, blockedReasons: [] },
            },
            readiness: { status: "ready", revision: "rev-hash", blockers: [] },
            summary: {
              channels: [{ channel: "whatsapp", detail: "تم إثبات الربط", status: "verified" }],
              hours: { detail: "مكتملة ومحفوظة", status: "verified" },
              knowledge: { detail: "مصادر معتمدة", status: "verified" },
              persona: { detail: "نورا", status: "verified" },
              team: { detail: "مالك النشاط", status: "verified" },
            },
            operationId: VALID_OP_ID,
            activation: { status: "not_started", receiptId: null, operationId: null },
          },
        },
      },
      error: null,
    });
  });

  it("denies unauthenticated launch read", async () => {
    currentSessionId = null;
    const res = await readOwnedBranchLaunchSummaryAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res).toBeNull();
  });

  it("denies account mismatch on launch confirmation", async () => {
    currentSessionId = OTHER_ACCOUNT_ID;
    const res = await confirmOwnedBranchLaunchAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      readinessRevision: "rev-hash",
      operationId: VALID_OP_ID,
      confirmed: true,
    });
    expect(res).toBeNull();
  });

  it("calls launch confirmation RPC with verified readiness revision", async () => {
    const res = await confirmOwnedBranchLaunchAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      readinessRevision: "rev-hash",
      operationId: VALID_OP_ID,
      confirmed: true,
    });
    expect(res).not.toBeNull();
    expect(rpcMock).toHaveBeenCalledWith(
      "es02_confirm_owned_branch_launch",
      expect.objectContaining({
        p_readiness_revision: "rev-hash",
        p_operation_id: VALID_OP_ID,
        p_confirmed: true,
      })
    );
  });
});

it("never confirms launch when the authoritative subscription/owner gate denies access", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn(async (name: string) => name === "es02_read_owned_branch_setup"
    ? { data: { ok: false, code: "SUSPENDED" }, error: null }
    : { data: { ok: true, data: { snapshot: { activation: { status: "launched" } } } }, error: null });
  const result = await confirmOwnedBranchLaunchAction({ expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, readinessRevision: "rev-hash", operationId: VALID_OP_ID, confirmed: true });
  expect(result).toBeNull();
  expect(rpcMock).not.toHaveBeenCalledWith("es02_confirm_owned_branch_launch", expect.anything());
});
