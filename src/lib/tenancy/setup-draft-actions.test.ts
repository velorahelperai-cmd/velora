import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
afterEach(()=>vi.unstubAllEnvs());
vi.mock('server-only',()=>({}));
import { emptyCompanyDraft } from "../company-draft";
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(), from: vi.fn() }));
vi.mock("./access", () => ({ getCompanyAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { readSetupDraft, saveSetupDraft, readActiveSetupDraft, setupDraftLifecycleAction } from "./setup-draft-actions";
const scope = { expectedUserId: "owner", expectedCompanyId: null };
const context = { userId: "owner", company: null, membership: null, needsCompanyContext: false, isPlatformAdmin: false };
const input = { ...scope, expectedRevision: 0, draft: emptyCompanyDraft("owner") };

beforeEach(() => {
  vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, context });
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: mocks.maybeSingle };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
});

describe("server draft authorization and receipts", () => {
  it('rollout-off keeps the baseline query and rejects lifecycle endpoints before new-schema reads',async()=>{
    vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','false');mocks.maybeSingle.mockResolvedValue({data:null,error:null});
    expect(await readSetupDraft(scope)).toEqual({ok:true,data:null});
    const query=mocks.from.mock.results[0].value;expect(query.select).toHaveBeenCalledWith('user_id,company_id,payload,revision,updated_at');
    expect(await readActiveSetupDraft(scope.expectedUserId)).toEqual({ok:false,code:'UNCONFIGURED'});expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies old account and company requests before touching persistence", async () => {
    expect(await saveSetupDraft({ ...input, expectedUserId: "previous" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await readSetupDraft({ ...scope, expectedCompanyId: "previous-company" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("does not write invalid contact progress or mismatched draft identity", async () => {
    expect(await saveSetupDraft({ ...input, draft: { ...input.draft, business: { ...input.draft.business, contactPhone: "123" } } })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await saveSetupDraft({ ...input, draft: { ...input.draft, userId: "other" } })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns only a matching durable receipt and keeps conflicts explicit", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, data: { user_id: "owner", company_id: null, payload: { business: input.draft.business, setupStep: 0 }, revision: 1, updated_at: "2026-10-14" } }, error: null });
    const result = await saveSetupDraft(input);
    expect(result.ok && result.data.revision).toBe(1);
    mocks.rpc.mockResolvedValue({ data: { ok: false, code: "CONFLICT" }, error: null });
    expect(await saveSetupDraft(input)).toEqual({ ok: false, code: "CONFLICT" });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect(await saveSetupDraft(input)).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("does not treat failed reads as an empty draft", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "table unavailable" } });
    expect(await readSetupDraft(scope)).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await readSetupDraft(scope)).toEqual({ ok: true, data: null });
  });
  it("keeps draft closure, active-account conflict and expired confirmation failures explicit", async () => {
    for (const code of ["DRAFT_CLOSED", "LEGACY_DRAFT_CONFLICT", "DRAFT_EXPIRED", "DRAFT_BINDING_REQUIRED"]) {
      mocks.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
      expect(await saveSetupDraft(input)).toEqual({ ok: false, code });
    }
    mocks.rpc.mockResolvedValue({ data: { ok: false, code: "CONFIRMATION_REQUIRED" }, error: null });
    expect(await setupDraftLifecycleAction({ ...scope, draftId: "d1", expectedRevision: 1, generation: 1, action: "confirm_cancel" })).toEqual({ ok: false, code: "CONFIRMATION_REQUIRED" });
  });
  it("does not accept a preview that includes unscoped files or a forged closure receipt", async () => {
    const actionInput = { ...scope, draftId: "d1", expectedRevision: 1, generation: 1, action: "preview_cancel" as const };
    mocks.rpc.mockResolvedValue({ data: { ok: true, data: { confirmationToken: "token", scopedFileCount: 3, unscopedFilesIncluded: true, cleanupPolicy: "UNCONFIGURED", scope: "draft_payload_only", companyPreserved: true } }, error: null });
    expect(await setupDraftLifecycleAction(actionInput)).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.rpc.mockResolvedValue({ data: { ok: true, data: { user_id: "other", company_id: null, draft_id: "d1", revision: 2, generation: 2, state: "cancelled", updated_at: "2026-10-14", expires_at: null, paid_protected_at: null, cleanup_policy: "UNCONFIGURED" } }, error: null });
    expect(await setupDraftLifecycleAction({ ...actionInput, action: "confirm_cancel" })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("cannot read active progress through a mismatched account context", async () => {
    expect(await readActiveSetupDraft("previous")).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
