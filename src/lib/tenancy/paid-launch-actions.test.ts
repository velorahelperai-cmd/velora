import { describe, expect, it, vi, beforeEach } from "vitest";
import {projectTrustedBoundSelection,mergePaidBranchChannelProof} from './paid-setup-contracts';

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "99999999-9999-4999-8999-999999999999";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const VALID_OP_ID = "44444444-4444-4444-8444-444444444444";

let currentSessionId: string | null = VALID_ACCOUNT_ID;
let rpcMock = vi.fn();
vi.mock('./paid-setup-actions',()=>({readOwnedPaidBranchSetupAction:vi.fn(async()=>mergePaidBranchChannelProof(projectTrustedBoundSelection({companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID,branchLabel:'Main',orderGroupId:VALID_COMPANY_ID,slotIndex:0,persona:'level_1',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'2026-10-26T00:00:00Z'},{channels:['whatsapp']}),[{companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID,channel:'whatsapp',verified:true,generation:1,revoked:false,stale:false}]))}));

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
              sourceStatus: null,
              selectedChannels: null,
              entitlement: null,
              launch: { confirmationRequired: true, confirmed: false, canRequest: true, blockedReasons: [] },
            },
            readiness: { status: "ready", revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", blockers: [] },
            summary: {
              channels: [{ channel: "whatsapp", detail: "تم إثبات الربط", status: "verified" }],
              languages: { detail: "العربية", status: "verified" },
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
      readinessRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
      readinessRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: VALID_OP_ID,
      confirmed: true,
    });
    expect(res).not.toBeNull();
    expect(rpcMock).toHaveBeenCalledWith(
      "es02_confirm_owned_branch_launch",
      expect.objectContaining({
        p_readiness_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        p_operation_id: VALID_OP_ID,
        p_confirmed: true,
      })
    );
  });
  it("rejects a stale displayed readiness revision before invoking confirmation",async()=>{
    const result=await confirmOwnedBranchLaunchAction({expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID,expectedVersion:1,readinessRevision:'b'.repeat(32),operationId:VALID_OP_ID,confirmed:true});
    expect(result).toBeNull();expect(rpcMock.mock.calls.some(([name])=>name==='es02_confirm_owned_branch_launch')).toBe(false);
  });
  it("rejects malformed displayed readiness before any RPC",async()=>{
    const result=await confirmOwnedBranchLaunchAction({expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID,expectedVersion:0,readinessRevision:'a'.repeat(32),operationId:VALID_OP_ID,confirmed:true});
    expect(result).toBeNull();expect(rpcMock).not.toHaveBeenCalled();
  });

});

it("never confirms launch when the authoritative subscription/owner gate denies access", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn(async (name: string) => name === "es02_read_owned_branch_setup"
    ? { data: { ok: false, code: "SUSPENDED" }, error: null }
    : { data: { ok: true, data: { snapshot: { activation: { status: "launched" } } } }, error: null });
  const result = await confirmOwnedBranchLaunchAction({ expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, readinessRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operationId: VALID_OP_ID, confirmed: true });
  expect(result).toBeNull();
  expect(rpcMock).not.toHaveBeenCalledWith("es02_confirm_owned_branch_launch", expect.anything());
});

it("blocks server-side launch confirmation when readiness status is blocked due to trial_incomplete", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  const blockedSnapshot = {
    scope: { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID },
    version: 1,
    branchLabel: "Main",
    setup: {
      companyId: VALID_COMPANY_ID,
      selectedBranchId: VALID_BRANCH_ID,
      sourceStatus: null,
      selectedChannels: null,
      entitlement: null,
      launch: { confirmationRequired: true, confirmed: false, canRequest: false, blockedReasons: ["trial_incomplete"] },
    },
    readiness: { status: "blocked", revision: "rev-hash-blocked", blockers: ["trial_incomplete"] },
    summary: {
      channels: [{ channel: "whatsapp", detail: "تم إثبات الربط", status: "verified" }],
      hours: { detail: "مكتملة ومحفوظة", status: "verified" },
      knowledge: { detail: "مصادر معتمدة", status: "verified" },
      persona: { detail: "نورا", status: "verified" },
      team: { detail: "مالك النشاط", status: "verified" },
    },
    operationId: VALID_OP_ID,
    activation: { status: "not_started", receiptId: null, operationId: null },
  };
  rpcMock = vi.fn(async (name: string) => {
    if (name === "es02_read_owned_branch_setup") return { data: { ok: true }, error: null };
    if (name === "es02_read_owned_branch_launch_summary") return { data: { ok: true, data: { snapshot: blockedSnapshot } }, error: null };
    return { data: { ok: true, data: { snapshot: blockedSnapshot } }, error: null };
  });
  const result = await confirmOwnedBranchLaunchAction({
    expectedAccountId: VALID_ACCOUNT_ID,
    companyId: VALID_COMPANY_ID,
    branchId: VALID_BRANCH_ID,
    expectedVersion: 1,
    readinessRevision: "rev-hash-blocked",
    operationId: VALID_OP_ID,
    confirmed: true,
  });
  expect(result).toBeNull();
  expect(rpcMock).not.toHaveBeenCalledWith("es02_confirm_owned_branch_launch", expect.anything());
});

it("blocks server-side launch confirmation when channel is unverified", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  const channelBlocked = {
    scope: { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID },
    version: 1,
    branchLabel: "Main",
    setup: {
      companyId: VALID_COMPANY_ID,
      selectedBranchId: VALID_BRANCH_ID,
      sourceStatus: null,
      selectedChannels: null,
      entitlement: null,
      launch: { confirmationRequired: true, confirmed: false, canRequest: false, blockedReasons: ["channel_unverified:whatsapp"] },
    },
    readiness: { status: "blocked", revision: "rev-hash-ch", blockers: ["channel_unverified:whatsapp"] },
    summary: {
      channels: [{ channel: "whatsapp", detail: "بانتظار الربط", status: "pending" }],
      hours: { detail: "مكتملة ومحفوظة", status: "verified" },
      knowledge: { detail: "مصادر معتمدة", status: "verified" },
      persona: { detail: "نورا", status: "verified" },
      team: { detail: "مالك النشاط", status: "verified" },
    },
    operationId: VALID_OP_ID,
    activation: { status: "not_started", receiptId: null, operationId: null },
  };
  rpcMock = vi.fn(async (name: string) => {
    if (name === "es02_read_owned_branch_setup") return { data: { ok: true }, error: null };
    if (name === "es02_read_owned_branch_launch_summary") return { data: { ok: true, data: { snapshot: channelBlocked } }, error: null };
    return { data: { ok: true, data: { snapshot: channelBlocked } }, error: null };
  });
  const result = await confirmOwnedBranchLaunchAction({
    expectedAccountId: VALID_ACCOUNT_ID,
    companyId: VALID_COMPANY_ID,
    branchId: VALID_BRANCH_ID,
    expectedVersion: 1,
    readinessRevision: "rev-hash-ch",
    operationId: VALID_OP_ID,
    confirmed: true,
  });
  expect(result).toBeNull();
  expect(rpcMock).not.toHaveBeenCalledWith("es02_confirm_owned_branch_launch", expect.anything());
});
