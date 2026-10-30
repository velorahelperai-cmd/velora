import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  identity: { ok: true as const, userId: "11111111-1111-4111-8111-111111111111" } as
    | { ok: true; userId: string }
    | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" },
  rpc: vi.fn(),
  logs: [] as unknown[],
}));

vi.mock("@/lib/auth/server-identity", () => ({
  readSessionIdentity: () => Promise.resolve(state.identity),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ rpc: state.rpc }),
}));
vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: (...args: unknown[]) => { state.logs.push(args); },
  withLogContext: (_fields: unknown, operation: () => unknown) => operation(),
}));

import { readOwnedPaidBranchSetupShellAction, readOwnedPaidBranchSetupAction, readOwnedPaidBranchSetupEntryAction, selectOwnedPaidBranchChannelsAction } from "./paid-setup-actions";

function readyConnection(channel: "whatsapp" | "instagram") {
  return {
    schemaVersion: 1,
    sourceStatus: "ready",
    expectedAccountId: input.expectedAccountId,
    companyId: input.companyId,
    branchId: input.branchId,
    channel,
    asOf: "2026-10-20T01:00:00.000Z",
    revision: "0",
    connection: { state: "not_connected", flow: null, attempt: null, link: null, verified: false, reasonCodes: [] },
  };
}

const input = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
};

const facts = {
  companyId: input.companyId,
  branchId: input.branchId,
  branchLabel: "Main",
  orderGroupId: "44444444-4444-4444-8444-444444444444",
  slotIndex: 0,
  persona: "level_2",
  package: "premium",
  term: "yearly",
  maxChannels: 2,
  employeesExcludingOwner: 4,
  clockState: "waiting_readiness",
  asOf: "2026-10-20T01:00:00.000Z",
};

beforeEach(() => {
  state.identity = { ok: true, userId: input.expectedAccountId };
  state.rpc.mockReset();
  state.logs.length = 0;
});

describe("readOwnedPaidBranchSetupAction", () => {
  it("does not read company readiness or forward caller channel fields", async () => {
    const source = readFileSync(new URL("./paid-setup-actions.ts", import.meta.url), "utf8");
    expect(source).not.toContain("getCustomerReadiness");
    expect(source).not.toContain("es02_reconcile_activation_readiness");
    expect(source).toContain("projectTrustedBoundSelection");
    state.rpc.mockResolvedValue({ data: { ok: true, code: "SELECTION_REQUIRED", data: facts, binding: null }, error: null });
    await readOwnedPaidBranchSetupAction({
      ...input,
      selectedChannels: ["instagram"],
      readiness: { hours: "verified" },
      completion: true,
    } as typeof input);
    expect(state.rpc.mock.calls).toEqual([[
      "es02_read_owned_branch_setup_binding",
      {
        p_expected_account_id: input.expectedAccountId,
        p_company_id: input.companyId,
        p_branch_id: input.branchId,
      },
    ]]);
  });

  it("projects selection_required from native facts and ignores a smuggled channel", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, code: "SELECTION_REQUIRED", data: facts }, error: null });
    const read = await readOwnedPaidBranchSetupAction({ ...input, selectedChannels: ["whatsapp"] } as typeof input);
    expect(state.rpc).toHaveBeenCalledWith("es02_read_owned_branch_setup_binding", {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
    });
    expect(read.sourceStatus).toBe("selection_required");
    expect(read.selectedChannels).toBeNull();
    expect(read.progress.denominator).toBeNull();
    expect(read.steps).toEqual([]);
    expect(read.launch.canRequest).toBe(false);
    expect(read.entitlement?.maxChannels).toBe(2);
  });

  it("fails closed on source, actor, and tampered failures", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "db" } });
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["source_failed"]);

    state.identity = { ok: false, code: "UNAUTHENTICATED" };
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["unauthenticated"]);
    expect(state.rpc).toHaveBeenCalledTimes(1);

    state.identity = { ok: true, userId: "99999999-9999-4999-8999-999999999999" };
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["account_mismatch"]);

    state.identity = { ok: true, userId: input.expectedAccountId };
    state.rpc.mockResolvedValue({ data: { ok: false, code: "SUSPENDED" }, error: null });
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["suspended"]);

    state.rpc.mockResolvedValue({ data: { ok: false, code: "UNPAID" }, error: null });
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["unpaid"]);

    state.rpc.mockResolvedValue({ data: { ok: false, code: "FOOTPRINT_MISSING" }, error: null });
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["footprint_missing"]);

    state.rpc.mockResolvedValue({
      data: { ok: true, code: "SELECTION_REQUIRED", data: { ...facts, selectedChannels: ["instagram"] } },
      error: null,
    });
    expect((await readOwnedPaidBranchSetupAction(input)).launch.blockedReasons).toEqual(["tampered_row"]);
    expect(state.logs.some((entry) => Array.isArray(entry) && entry[1] === "es02.paid_setup.read_failed")).toBe(true);
  });

  it("does not call the database for a malformed id", async () => {
    const read = await readOwnedPaidBranchSetupAction({ ...input, branchId: "branch" });
    expect(read.sourceStatus).toBe("unavailable");
    expect(read.launch.blockedReasons).toEqual(["invalid_input"]);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("projects a stored binding and ignores the caller channel", async () => {
    state.rpc.mockImplementation(async (name: string, args: { p_channel?: string }) => {
      if (name === "es02_b3_read_owned_branch_connection") {
        return { data: readyConnection(args.p_channel === "instagram" ? "instagram" : "whatsapp"), error: null };
      }
      return {
        data: { ok: true, code: "BOUND", data: { ...facts, package: "basic", maxChannels: 1, employeesExcludingOwner: 2 }, binding: { channels: ["whatsapp"] } },
        error: null,
      };
    });
    const read = await readOwnedPaidBranchSetupAction({ ...input, selectedChannels: ["instagram"] } as typeof input);
    expect(state.rpc.mock.calls[0][1]).toEqual({
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
    });
    expect(read.sourceStatus).toBe("ready");
    expect(read.selectedChannels).toEqual(["whatsapp"]);
    expect(read.steps).toHaveLength(6);
    expect(read.progress.denominator).toBe(6);
    expect(read.launch.canRequest).toBe(false);
    expect(read.launch.confirmed).toBe(false);
  });

  it("projects both stored channels as seven steps", async () => {
    state.rpc.mockImplementation(async (name: string, args: { p_channel?: string }) => {
      if (name === "es02_b3_read_owned_branch_connection") {
        return { data: readyConnection(args.p_channel === "instagram" ? "instagram" : "whatsapp"), error: null };
      }
      return { data: { ok: true, code: "BOUND", data: facts, binding: { channels: ["whatsapp", "instagram"] } }, error: null };
    });
    const read = await readOwnedPaidBranchSetupAction(input);
    expect(read.steps).toHaveLength(7);
    expect(read.progress.denominator).toBe(7);
    expect(read.selectedChannels).toEqual(["whatsapp", "instagram"]);
    expect(read.steps.every((step) => step.status !== "verified")).toBe(true);
  });
});

const entryBranches = [
  { id: input.branchId, label: "Main", isPrimary: true },
  { id: "55555555-5555-4555-8555-555555555555", label: "Second", isPrimary: false },
];

describe("readOwnedPaidBranchSetupEntryAction", () => {
  it("returns paid branch ids and does not select one", async () => {
    state.rpc.mockResolvedValue({
      data: {
        ok: true,
        code: "SELECTION_REQUIRED",
        data: { companyId: input.companyId, branches: entryBranches, asOf: "2026-10-20T01:00:00.000Z" },
      },
      error: null,
    });
    const read = await readOwnedPaidBranchSetupEntryAction({
      ...input,
      branches: [{ id: "99999999-9999-4999-8999-999999999999", label: "Smuggled", isPrimary: true }],
      paid: true,
    } as never);
    expect(state.rpc.mock.calls).toEqual([[
      "es02_list_owned_paid_setup_branches",
      { p_expected_account_id: input.expectedAccountId, p_company_id: input.companyId },
    ]]);
    expect(read).toMatchObject({
      schemaVersion: 1,
      sourceStatus: "selection_required",
      companyId: input.companyId,
      selectedBranchId: null,
      branches: entryBranches,
      reasonCodes: [],
    });
    expect(read.selectedBranchId).toBeNull();
  });

  it("keeps an empty inventory unselected", async () => {
    state.rpc.mockResolvedValue({
      data: { ok: true, code: "SELECTION_REQUIRED", data: { companyId: input.companyId, branches: [], asOf: "2026-10-20T01:00:00.000Z" } },
      error: null,
    });
    const read = await readOwnedPaidBranchSetupEntryAction(input);
    expect(read.branches).toEqual([]);
    expect(read.selectedBranchId).toBeNull();
    expect(read.reasonCodes).toEqual(["empty_inventory"]);
  });

  it("rejects a foreign account, duplicate ids, and a tampered row", async () => {
    state.identity = { ok: true, userId: "99999999-9999-4999-8999-999999999999" };
    expect((await readOwnedPaidBranchSetupEntryAction(input)).reasonCodes).toEqual(["account_mismatch"]);
    expect(state.rpc).not.toHaveBeenCalled();

    state.identity = { ok: true, userId: input.expectedAccountId };
    state.rpc.mockResolvedValue({
      data: {
        ok: true,
        code: "SELECTION_REQUIRED",
        data: { companyId: input.companyId, branches: [entryBranches[0], entryBranches[0]], asOf: "2026-10-20T01:00:00.000Z" },
      },
      error: null,
    });
    expect((await readOwnedPaidBranchSetupEntryAction(input)).reasonCodes).toEqual(["tampered_row"]);
    state.rpc.mockResolvedValue({ data: { ok: false, code: "FORBIDDEN" }, error: null });
    expect((await readOwnedPaidBranchSetupEntryAction(input)).reasonCodes).toEqual(["forbidden"]);
  });
});

const clientOpId = "66666666-6666-4666-8666-666666666666";
const receipt = {
  receiptId: "77777777-7777-4777-8777-777777777777",
  companyId: input.companyId,
  branchId: input.branchId,
  channels: ["whatsapp"],
  asOf: "2026-10-20T01:02:00.000Z",
};

describe("selectOwnedPaidBranchChannelsAction", () => {
  it("sends only the branch request and returns the stored receipt", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, code: "SELECTED", data: receipt }, error: null });
    const result = await selectOwnedPaidBranchChannelsAction({
      expectedAccountId: input.expectedAccountId,
      companyId: input.companyId,
      branchId: input.branchId,
      clientOpId,
      channels: ["instagram", "whatsapp"],
      orderId: "88888888-8888-4888-8888-888888888888",
      completion: true,
    } as never);
    expect(state.rpc.mock.calls[0]).toEqual([
      "es02_select_owned_branch_channels",
      {
        p_expected_account_id: input.expectedAccountId,
        p_company_id: input.companyId,
        p_branch_id: input.branchId,
        p_client_op_id: clientOpId,
        p_channels: ["instagram", "whatsapp"],
      },
    ]);
    expect(result).toMatchObject({ ok: true, code: "selected", receiptId: receipt.receiptId, channels: ["whatsapp"] });
  });

  it("returns the same receipt for a duplicate and rejects conflicts", async () => {
    state.rpc.mockResolvedValue({ data: { ok: true, code: "DUPLICATE", data: receipt }, error: null });
    expect(await selectOwnedPaidBranchChannelsAction({ ...input, clientOpId, channels: ["whatsapp"] })).toMatchObject({ ok: true, code: "duplicate", receiptId: receipt.receiptId });
    state.rpc.mockResolvedValue({ data: { ok: false, code: "CONFLICT" }, error: null });
    expect(await selectOwnedPaidBranchChannelsAction({ ...input, clientOpId, channels: ["instagram"] })).toMatchObject({ ok: false, code: "conflict" });
    state.rpc.mockResolvedValue({ data: { ok: false, code: "ALREADY_SELECTED" }, error: null });
    expect(await selectOwnedPaidBranchChannelsAction({ ...input, clientOpId, channels: ["whatsapp"] })).toMatchObject({ ok: false, code: "already_selected" });
    state.rpc.mockResolvedValue({ data: { ok: false, code: "CHANNEL_CONNECTED" }, error: null });
    expect(await selectOwnedPaidBranchChannelsAction({ ...input, clientOpId, channels: ["whatsapp"] })).toMatchObject({ ok: false, code: "channel_connected" });
    state.rpc.mockResolvedValue({ data: { ok: false, code: "ENTITLEMENT_EXCEEDED" }, error: null });
    expect(await selectOwnedPaidBranchChannelsAction({ ...input, clientOpId, channels: ["whatsapp", "instagram"] })).toMatchObject({ ok: false, code: "entitlement_exceeded" });
  });

  it("does not call the database for a non-string channel", async () => {
    const result = await selectOwnedPaidBranchChannelsAction({ ...input, clientOpId, channels: ["whatsapp", 1] } as never);
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

// A slow or failing Meta read cannot gate independently authorized branch navigation.
it("returns paid shell without any connection RPC or fabricated verified state", async () => {
 state.rpc.mockResolvedValue({data:{ok:true,code:"BOUND",data:facts,binding:{channels:["whatsapp","instagram"]}},error:null});
 const read=await readOwnedPaidBranchSetupShellAction(input);
 expect(state.rpc).toHaveBeenCalledTimes(1);
 expect(read.sourceStatus).toBe("ready");expect(read.progress.verified).toBe(0);
 expect(read.launch.canRequest).toBe(false);expect(read.launch.confirmed).toBe(false);
 expect(read.steps.find(step=>step.id==="hours")?.status).toBe("pending");
});
it("shell rejects account and branch mismatches before exposing navigation",async()=>{
 state.identity={ok:true,userId:"other"};expect((await readOwnedPaidBranchSetupShellAction(input)).sourceStatus).toBe("unavailable");expect(state.rpc).not.toHaveBeenCalled();
 state.identity={ok:true,userId:input.expectedAccountId};state.rpc.mockResolvedValue({data:{ok:true,code:"BOUND",data:{...facts,branchId:"foreign"},binding:{channels:["whatsapp"]}},error:null});
 expect((await readOwnedPaidBranchSetupShellAction(input)).sourceStatus).toBe("unavailable");
});
it("starts independent channel RPCs together and still rejects an unavailable proof",async()=>{
 const finishes:Array<(value:unknown)=>void>=[];
 state.rpc.mockImplementation((name:string)=>name==="es02_read_owned_branch_setup_binding"?Promise.resolve({data:{ok:true,code:"BOUND",data:facts,binding:{channels:["whatsapp","instagram"]}},error:null}):new Promise(resolve=>finishes.push(resolve)));
 const reading=readOwnedPaidBranchSetupAction(input);
 await vi.waitFor(()=>expect(finishes).toHaveLength(2));
 finishes[0]({error:{message:"offline"}});finishes[1]({data:readyConnection("instagram"),error:null});
 expect((await reading).sourceStatus).toBe("unavailable");
});
