import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  client: vi.fn(),
  rpc: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("./access", () => ({ getCompanyAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: mocks.logEvent,
  withLogContext: (_fields: unknown, operation: () => unknown) => operation(),
}));

import { readAccountPrepDraft, saveAccountPrepDraft } from "./account-prep-draft-actions";

const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const DRAFT = "11111111-1111-4111-8111-111111111111";
const context = { userId: ACCOUNT, company: null, membership: null, needsCompanyContext: false, isPlatformAdmin: false };

const receipt = {
  draft_id: DRAFT,
  account_id: ACCOUNT,
  payload: { name: "Cafe", goals: ["support"] },
  version: 1,
  state: "active",
  created_at: "2026-10-25T00:00:00.000Z",
  updated_at: "2026-10-25T00:00:00.000Z",
  expires_at: "2027-02-25T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, context });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});

describe("account prep draft actions", () => {
  it("denies forged account ids before persistence", async () => {
    expect(await readAccountPrepDraft(OTHER)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await saveAccountPrepDraft({ expectedAccountId: OTHER, expectedVersion: 0, patch: { name: "X" } })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("saves then reads a durable receipt and keeps conflicts explicit", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, data: receipt }, error: null });
    const saved = await saveAccountPrepDraft({
      expectedAccountId: ACCOUNT,
      expectedVersion: 0,
      patch: { name: "Cafe", goals: ["support"] },
    });
    expect(saved.ok && saved.data.version).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_account_prep_draft",
      expect.objectContaining({ p_expected_account_id: ACCOUNT, p_expected_version: 0 }),
    );

    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, data: receipt }, error: null });
    const read = await readAccountPrepDraft(ACCOUNT);
    expect(read).toEqual({
      ok: true,
      data: expect.objectContaining({ draftId: DRAFT, accountId: ACCOUNT, version: 1 }),
    });

    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, code: "CONFLICT" }, error: null });
    expect(
      await saveAccountPrepDraft({ expectedAccountId: ACCOUNT, expectedVersion: 0, patch: { name: "Cafe" } }),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("does not treat network failure as a saved draft", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect(
      await saveAccountPrepDraft({ expectedAccountId: ACCOUNT, expectedVersion: 0, patch: { name: "Cafe" } }),
    ).toEqual({ ok: false, code: "UNAVAILABLE" });
  });

  it("rejects invalid patches and non-uuid draft ids without calling rpc", async () => {
    expect(
      await saveAccountPrepDraft({ expectedAccountId: ACCOUNT, expectedVersion: 0, patch: { forged: true } }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(
      await saveAccountPrepDraft({
        expectedAccountId: ACCOUNT,
        expectedVersion: 1,
        draftId: "not-a-uuid",
        patch: { name: "Cafe" },
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("isolates a mismatched access context from another account", async () => {
    mocks.access.mockResolvedValue({ ok: true, context: { ...context, userId: OTHER } });
    expect(await readAccountPrepDraft(ACCOUNT)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it.each([{isPlatformAdmin:true,membership:null},{isPlatformAdmin:false,membership:{role:'staff'},hasBusinessMemberships:true}])('applies the same actor eligibility before read and save RPC (%#)',async fields=>{
 mocks.access.mockResolvedValue({ok:true,context:{...context,...fields,ownedBusinessCount:0,workspaceChoices:[]}});expect(await readAccountPrepDraft(ACCOUNT)).toEqual({ok:false,code:'FORBIDDEN'});expect(await saveAccountPrepDraft({expectedAccountId:ACCOUNT,expectedVersion:0,patch:{name:'Cafe'}})).toEqual({ok:false,code:'FORBIDDEN'});expect(mocks.client).not.toHaveBeenCalled();
});

it('rejects malformed direct action input before provider access',async()=>{expect(await saveAccountPrepDraft(null as never)).toEqual({ok:false,code:'INVALID_INPUT'});expect(mocks.client).not.toHaveBeenCalled();});
it('keeps raw thrown provider details out of the draft log',async()=>{mocks.rpc.mockRejectedValue(Error('private form field payload'));expect(await saveAccountPrepDraft({expectedAccountId:ACCOUNT,expectedVersion:0,patch:{name:'Cafe'}})).toEqual({ok:false,code:'UNAVAILABLE'});expect(mocks.logEvent.mock.calls[0][2].error.message).toBe('ACCOUNT_PREP_DRAFT_SAVE_FAILED');});
