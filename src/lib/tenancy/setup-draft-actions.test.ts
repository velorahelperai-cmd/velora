import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCompanyDraft } from "../company-draft";
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(), from: vi.fn() }));
vi.mock("./access", () => ({ getCompanyAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { readSetupDraft, saveSetupDraft } from "./setup-draft-actions";
const scope = { expectedUserId: "owner", expectedCompanyId: null };
const context = { userId: "owner", company: null, membership: null, needsCompanyContext: false, isPlatformAdmin: false };
const input = { ...scope, expectedRevision: 0, draft: emptyCompanyDraft("owner") };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, context });
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: mocks.maybeSingle };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
});

describe("server draft authorization and receipts", () => {
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
});
