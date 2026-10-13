vi.mock('server-only',()=>({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import type { CompanyContext } from "./types";

// External boundaries are offline doubles; the server actions themselves run unchanged.
const state = vi.hoisted(() => ({
  access: vi.fn(), client: vi.fn(), cap: vi.fn(), settings: vi.fn(), order: vi.fn(),
  admin: vi.fn(), open: vi.fn(), provider: vi.fn(), journey: vi.fn(),
  writes: [] as Array<{ kind: string; companyId: string | null }>,
  reads: [] as Array<{ kind: string; companyId: string | null }>,
  knowledgeRows: [] as unknown[],
  reviewRow: null as unknown,
  events: [] as unknown[],
  rpcRequests: [] as Array<{ name: string; input: Record<string, unknown> }>,
  uploads: [] as string[],
}));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: state.access, requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.admin }));
vi.mock("@/lib/access/actions", () => ({ sessionHasCompanyCapability: state.cap }));
vi.mock("@/lib/auth/server-identity", () => ({ readSessionIdentity: vi.fn() }));
vi.mock("@/lib/billing/wiring/display-read", () => ({ readCompanyBillingDisplay: state.journey }));
vi.mock("@/lib/billing/wiring/order-actions", () => ({ createBillingOrderAction: state.order }));
vi.mock("@/lib/billing/wiring/test-checkout", () => ({
  readTestCheckoutConfig: state.settings, openTestCheckout: state.open,
  fetchPaymobHttp: { request: state.provider },
}));
vi.mock("@/lib/auth/site-url", () => ({ siteUrl: () => "https://synthetic.example.com" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getCompanyReviewRequest, getCustomerReadiness, listCompanyReviewEvents, saveOwnerBusiness, submitCompanyReviewRequest, resubmitCompanyReviewRequest } from "./actions";
import { saveWhatsappLinkRequest } from "@/lib/whatsapp/connection-actions";
import { listKnowledgeSources, saveTextKnowledgeSource, uploadKnowledgeFiles } from "@/lib/knowledge/actions";
import { startTestCheckoutAction } from "@/lib/billing/wiring/test-checkout-actions";

const COMPANY_A = "00000000-0000-0000-0000-00000000000a";
const COMPANY_B = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-000000000001";
const AT = "2026-10-08T00:00:00.000Z";
const business = {
  displayName: "Synthetic business", businessType: "retail", replyLanguage: "both" as const,
  country: "Oman", city: "Muscat", hours: "09:00-17:00", contactPhone: "+96890000000",
  contactEmail: "synthetic@example.com",
};
const review = { numberOwnership: "own" as const, whatsappNumber: "+96890000000", ready: true, expectedRevision: 2 };

function context(companyId: string | null = COMPANY_B): CompanyContext {
  return {
    userId: USER, email: "synthetic@example.com", phone: "", fullName: "Synthetic owner", supportCode: "SYNTHETIC",
    needsProfileName: false, emailConfirmed: true, identityVerified: true, isPlatformAdmin: false,
    company: companyId ? {
      id: companyId, display_name: business.displayName, status: "active", business_type: "retail", reply_language: "both",
      country: "Oman", city: "Muscat", hours: business.hours, contact_phone: business.contactPhone,
      contact_email: business.contactEmail, created_by: USER, created_at: AT, updated_at: AT,
    } : null,
    membership: companyId ? { company_id: companyId, user_id: USER, role: "owner", status: "active", member_name: "Synthetic owner", created_at: AT } : null,
    needsCompanyContext: false,
    workspaceChoices: companyId ? [COMPANY_A, COMPANY_B].map(id => ({ companyId: id, displayName: "Synthetic", role: "owner" })) : [],
  };
}

function offlineClient() {
  return {
    rpc: async (name: string, input: Record<string, unknown> = {}) => {
      const companyId = typeof input.p_company_id === "string" ? input.p_company_id : null;
      state.rpcRequests.push({ name, input });
      if (name === "g03_read_review_request") {
        state.reads.push({ kind: "review", companyId });
        return { error: null, data: state.reviewRow };
      }
      if (name === "g03_begin_review_check") {
        state.reads.push({ kind: "review_snapshot", companyId });
        return { error: null, data: { ok: true, check_id: `check-${companyId}`, files: [] } };
      }
      if (name === "list_owner_company_review_events" || name === "list_owner_company_review_events_for_company") {
        state.reads.push({ kind: name, companyId });
        return { error: null, data: state.events };
      }
      state.writes.push({ kind: name, companyId });
      if (name === "transition_company_review") return { error: null, data: { ok: true, request: {
        company_id: companyId, requested_by: USER, number_ownership: "own", whatsapp_number: review.whatsappNumber,
        readiness_confirmed: true, requested_at: AT, status: "pending_review", revision: 3,
      } } };
      if (name === "upsert_selected_whatsapp_link_request") return { error: null, data: { ok: true, link: {
        id: "link", company_id: companyId, requested_display_number: business.contactPhone, keep_on_phone: true,
        status: "request_saved", verified_display_number: null, inbound_tested_at: null, outbound_tested_at: null,
        reception_send_tested: false, prior_link_evidence: false, last_error_code: null, created_at: AT, updated_at: AT,
      } } };
      return { error: null, data: context(companyId ?? COMPANY_A).company };
    },
    from: (table: string) => {
      let mutation: "insert" | "update" | null = null;
      let values: Record<string, unknown> = {};
      let companyId: string | null = null;
      const result = () => {
        if (!mutation && table === "company_review_requests") {
          state.reads.push({ kind: "review", companyId });
          return { error: null, data: state.reviewRow };
        }
        if (mutation) state.writes.push({ kind: mutation, companyId });
        return { error: null, data: {
          id: "source", company_id: companyId, kind: "text", title: "Synthetic title", content: "Synthetic facts",
          file_name: null, content_type: null, byte_size: null, storage_path: null, status: "ready", failure_code: null,
          content_version: 1, approved_for_answers: false, approved_version: null, approved_at: null, approved_by: null,
          created_by: USER, created_at: AT, updated_at: AT, ...values,
        } };
      };
      const query = {
        select: () => query,
        insert: (input: Record<string, unknown>) => { mutation = "insert"; values = input; companyId = String(input.company_id); return query; },
        update: (input: Record<string, unknown>) => { mutation = "update"; values = input; return query; },
        eq: (key: string, value: string) => { if (key === "company_id") companyId = value; return query; },
        order: () => query,
        limit: () => query,
        single: async () => result(), maybeSingle: async () => result(),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
          if (companyId) state.reads.push({ kind: "knowledge_list", companyId });
          return Promise.resolve({ data: companyId ? state.knowledgeRows : [], error: null }).then(resolve);
        },
      };
      return query;
    },
    storage: { from: () => ({ upload: async (path: string) => { state.uploads.push(path); return { error: null }; } }) },
  };
}

type Result = { ok: boolean; code?: string; message?: string };
type Binding = { expectedCompanyId?: unknown };
const actions: Array<{ name: string; run: (binding: Binding) => Promise<Result> }> = [
  { name: "business save", run: binding => saveOwnerBusiness({ ...business, ...binding } as Parameters<typeof saveOwnerBusiness>[0]) },
  { name: "review submission", run: binding => submitCompanyReviewRequest({ ...review, ...binding } as Parameters<typeof submitCompanyReviewRequest>[0]) },
  { name: "review resubmission", run: binding => resubmitCompanyReviewRequest({ ...review, ...binding } as Parameters<typeof resubmitCompanyReviewRequest>[0]) },
  { name: "WhatsApp request", run: binding => saveWhatsappLinkRequest({ requestedDisplayNumber: business.contactPhone, keepOnPhone: true, ...binding } as Parameters<typeof saveWhatsappLinkRequest>[0]) },
  { name: "text knowledge create", run: binding => saveTextKnowledgeSource({ title: "Synthetic title", content: "Synthetic facts", ...binding } as Parameters<typeof saveTextKnowledgeSource>[0]) },
  { name: "text knowledge update", run: binding => saveTextKnowledgeSource({ id: "source", title: "Synthetic title", content: "Synthetic facts", ...binding } as Parameters<typeof saveTextKnowledgeSource>[0]) },
  { name: "knowledge file upload", run: binding => {
    const form = new FormData();
    form.append("files", new File(["synthetic image"], "synthetic.png", { type: "image/png" }));
    if ("expectedCompanyId" in binding) form.append("expectedCompanyId", binding.expectedCompanyId instanceof Blob ? binding.expectedCompanyId : String(binding.expectedCompanyId));
    return uploadKnowledgeFiles(form);
  } },
  { name: "Test checkout", run: binding => startTestCheckoutAction({ planVersionId: "version", clientOpId: "operation", ...binding } as Parameters<typeof startTestCheckoutAction>[0]) },
];

beforeEach(() => {
  vi.clearAllMocks(); state.writes.length = 0; state.uploads.length = 0; state.reads.length = 0; state.knowledgeRows = [];
  state.reviewRow = null; state.events = []; state.rpcRequests.length = 0;
  state.access.mockResolvedValue({ ok: true, context: context() });
  state.client.mockResolvedValue(offlineClient()); state.cap.mockResolvedValue(false);
  // New external boundary only: do not mock/skip the server proof orchestrator.
  state.admin.mockReturnValue({
    storage: { from: () => ({}) },
    rpc: async (name: string, input: Record<string, unknown>) => {
      state.rpcRequests.push({ name, input });
      if (name !== "g03_complete_review_check" || !String(input.p_check_id).startsWith("check-")) throw Error("unexpected server RPC");
      return { data: { ok: true }, error: null };
    },
  });
  state.settings.mockReturnValue({ ok: true, unitsPerOmr: 1000, config: { integrationId: 123 } });
  state.journey.mockResolvedValue({ ok:false,code:"unavailable" });
  state.order.mockImplementation(async () => {
    state.writes.push({ kind: "billing_order", companyId: COMPANY_B });
    return { ok: false, code: "plan_not_published" };
  });
});

describe("rendered-company binding on knowledge reads", () => {
  const list = (input?: Binding) => (listKnowledgeSources as (input?: Binding) => ReturnType<typeof listKnowledgeSources>)(input);

  it.each([false, true])("rejects an A reload before reading selected B even when B empty=%s", async empty => {
    if (!empty) state.knowledgeRows = [{
      id: "source-b", company_id: COMPANY_B, kind: "text", title: "B facts", content: "B content",
      file_name: null, content_type: null, byte_size: null, storage_path: null, status: "ready", failure_code: null,
      content_version: 1, approved_for_answers: false, approved_version: null, approved_at: null, approved_by: null,
      created_by: USER, created_at: AT, updated_at: AT,
    }];
    expect(await list({ expectedCompanyId: COMPANY_A })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(state.reads).toEqual([]); expect(state.writes).toEqual([]);
  });
  it.each(["", "company-b", 12, {}, undefined, null])("rejects malformed read binding %j before querying", async expectedCompanyId => {
    expect(await list({ expectedCompanyId })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(state.reads).toEqual([]);
  });
  it("returns a matching company's empty list as an actual empty success", async () => {
    expect(await list({ expectedCompanyId: COMPANY_B })).toEqual({ ok: true, data: { sources: [], approvalFoundation: "ready" } });
    expect(state.reads).toEqual([{ kind: "knowledge_list", companyId: COMPANY_B }]);
  });
  it.each([undefined, {}])("preserves legacy omitted read bindings %j", async input => {
    expect(await list(input)).toEqual({ ok: true, data: { sources: [], approvalFoundation: "ready" } });
    expect(state.reads).toEqual([{ kind: "knowledge_list", companyId: COMPANY_B }]);
  });
  it("a matching company ID cannot bypass authoritative access failure", async () => {
    state.access.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    expect(await list({ expectedCompanyId: COMPANY_B })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(state.reads).toEqual([]); expect(state.access).toHaveBeenCalledOnce();
  });
  it("a matching company ID cannot bypass staff read capability", async () => {
    const staff = context(); staff.membership!.role = "staff";
    state.access.mockResolvedValue({ ok: true, context: staff });
    expect(await list({ expectedCompanyId: COMPANY_B })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(state.reads).toEqual([]); expect(state.cap).toHaveBeenCalledWith(COMPANY_B, "knowledge.read");
  });
  it("readiness treats a changed-company empty nested list as a failed load for its captured company", async () => {
    state.access.mockResolvedValue({ ok: false, code: "UNAVAILABLE" })
      .mockResolvedValueOnce({ ok: true, context: context(COMPANY_A) })
      .mockResolvedValueOnce({ ok: true, context: context(COMPANY_B) });
    const result = await getCustomerReadiness();
    expect(result).toMatchObject({ ok: true, data: { companyId: COMPANY_A } });
    if (!result.ok) throw new Error("Synthetic readiness failed");
    expect(result.data.items.find(item => item.id === "knowledge")).toMatchObject({ tone: "load_failed", detail: "load_failed" });
    expect(state.reads).toEqual([]);
  });
});

describe("rendered-company binding on review reads", () => {
  const getReview = (input?: Binding) => (getCompanyReviewRequest as (input?: Binding) => ReturnType<typeof getCompanyReviewRequest>)(input);
  const getEvents = (input?: Binding) => (listCompanyReviewEvents as (input?: Binding) => ReturnType<typeof listCompanyReviewEvents>)(input);

  it.each([false, true])("rejects an A review reload before reading selected B even when B review absent=%s", async absent => {
    if (!absent) state.reviewRow = {
      company_id: COMPANY_B, requested_by: USER, number_ownership: "own", whatsapp_number: business.contactPhone,
      readiness_confirmed: true, requested_at: AT, status: "pending_review", revision: 2,
    };
    expect(await getReview({ expectedCompanyId: COMPANY_A })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(state.reads).toEqual([]);
  });
  it("rejects an A event reload before querying selected B", async () => {
    expect(await getEvents({ expectedCompanyId: COMPANY_A })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(state.rpcRequests).toEqual([]);
  });
  it.each([undefined, {}, { expectedCompanyId: COMPANY_B }])("event history uses an explicit company RPC even for legacy input %j", async input => {
    state.events = [{ action: "submit", revision: 2, created_at: AT, owner_note: "" }];
    expect(await getEvents(input)).toEqual({ ok: true, data: [{ action: "submit", revision: 2, created_at: AT, owner_note: "" }] });
    expect(state.rpcRequests).toEqual([{ name: "list_owner_company_review_events_for_company", input: { p_company_id: COMPANY_B } }]);
  });
  it.each([undefined, {}, { expectedCompanyId: COMPANY_B }])("matching or omitted review bindings retain a company's null review %j", async input => {
    expect(await getReview(input)).toEqual({ ok: true, data: null });
    expect(state.reads).toEqual([{ kind: "review", companyId: COMPANY_B }]);
  });
  for (const getter of [{ name: "review", run: getReview }, { name: "events", run: getEvents }]) {
    it.each(["invalid", undefined])(`${getter.name} rejects malformed read binding %j before querying`, async expectedCompanyId => {
      expect(await getter.run({ expectedCompanyId })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(state.reads).toEqual([]); expect(state.rpcRequests).toEqual([]);
    });
    it(`${getter.name} binding cannot replace authoritative owner access`, async () => {
      state.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
      expect(await getter.run({ expectedCompanyId: COMPANY_B })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(state.access).toHaveBeenCalledWith("owner"); expect(state.reads).toEqual([]);
    });
  }
  it("readiness treats a changed-company null review as a failed load for its captured company", async () => {
    state.access.mockResolvedValue({ ok: false, code: "UNAVAILABLE" })
      .mockResolvedValueOnce({ ok: true, context: context(COMPANY_A) })
      .mockResolvedValueOnce({ ok: true, context: context(COMPANY_A) })
      .mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" })
      .mockResolvedValueOnce({ ok: true, context: context(COMPANY_B) });
    const result = await getCustomerReadiness();
    expect(result).toMatchObject({ ok: true, data: { companyId: COMPANY_A } });
    if (!result.ok) throw new Error("Synthetic readiness failed");
    expect(result.data.items.find(item => item.id === "review")).toMatchObject({ tone: "load_failed", detail: "load_failed" });
    expect(state.reads).toEqual([{ kind: "knowledge_list", companyId: COMPANY_A }]);
  });
});

describe("rendered-company binding on owner onboarding actions", () => {
  for (const action of actions) {
    it(`${action.name} rejects an A form after selection changes to another company the owner belongs to`, async () => {
      const result = await action.run({ expectedCompanyId: COMPANY_A });
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(state.writes).toEqual([]); expect(state.uploads).toEqual([]);
      expect(state.order).not.toHaveBeenCalled(); expect(state.open).not.toHaveBeenCalled(); expect(state.provider).not.toHaveBeenCalled();
      expect(state.access).toHaveBeenCalledOnce();
    });
    it(`${action.name} accepts a matching rendered company without changing legacy writes`, async () => {
      const result = await action.run({ expectedCompanyId: COMPANY_B });
      expect(result).toMatchObject(action.name === "Test checkout" ? { ok: false, code: "plan_not_published" } : { ok: true });
      expect(state.writes.length).toBeGreaterThan(0);
      expect(state.writes.every(write => write.companyId === COMPANY_B)).toBe(true);
      if (action.name.startsWith("review ")) {
        expect(state.rpcRequests.map(request => request.name)).toEqual([
          "g03_begin_review_check", "g03_complete_review_check", "transition_company_review",
        ]);
      }
    });
    it(`${action.name} preserves callers that omit the rendered company`, async () => {
      const result = await action.run({});
      expect(result).toMatchObject(action.name === "Test checkout" ? { ok: false, code: "plan_not_published" } : { ok: true });
      expect(state.writes.length).toBeGreaterThan(0);
    });
    it.each(["", "company-b", 12, {}, undefined])(`${action.name} rejects malformed binding %j before side effects`, async expectedCompanyId => {
      const result = await action.run({ expectedCompanyId });
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(result.message?.length ?? 0).toBeLessThan(100);
      expect(state.writes).toEqual([]); expect(state.uploads).toEqual([]); expect(state.order).not.toHaveBeenCalled();
    });
    it(`${action.name} still runs authoritative access gates for a matching company`, async () => {
      state.access.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
      const result = await action.run({ expectedCompanyId: COMPANY_B });
      expect(result.ok).toBe(false); expect(state.access).toHaveBeenCalledOnce();
      expect(state.writes).toEqual([]); expect(state.uploads).toEqual([]); expect(state.order).not.toHaveBeenCalled();
    });
  }

  it("a null business binding cannot turn a stale creation form into an existing-company update", async () => {
    expect(await saveOwnerBusiness({ ...business, expectedCompanyId: null } as Parameters<typeof saveOwnerBusiness>[0])).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(state.writes).toEqual([]);
  });
  it("a null business binding permits creation only when access confirms no selected company", async () => {
    state.access.mockResolvedValue({ ok: true, context: context(null) });
    expect(await saveOwnerBusiness({ ...business, expectedCompanyId: null } as Parameters<typeof saveOwnerBusiness>[0])).toMatchObject({ ok: true });
    expect(state.writes).toEqual([{ kind: "upsert_owner_company", companyId: null }]);
  });
  it("a bound business update cannot turn into creation when its company is unavailable", async () => {
    state.access.mockResolvedValue({ ok: true, context: context(null) });
    expect(await saveOwnerBusiness({ ...business, expectedCompanyId: COMPANY_A } as Parameters<typeof saveOwnerBusiness>[0])).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(state.writes).toEqual([]);
  });
  it("a Blob cannot stand in for the upload company's ID", async () => {
    const upload = actions.find(action => action.name === "knowledge file upload")!;
    expect(await upload.run({ expectedCompanyId: new Blob([COMPANY_B]) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(state.writes).toEqual([]); expect(state.uploads).toEqual([]);
  });
  it("multiple upload company fields are rejected rather than choosing one", async () => {
    const form = new FormData();
    form.append("files", new File(["synthetic image"], "synthetic.png", { type: "image/png" }));
    form.append("expectedCompanyId", COMPANY_B); form.append("expectedCompanyId", COMPANY_A);
    expect(await uploadKnowledgeFiles(form)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(state.writes).toEqual([]); expect(state.uploads).toEqual([]);
  });
});

describe("readiness pillar uses qualified current billing evidence",()=>{
  it.each(["refunded","voided","cancelled"])("%s pending settlement cannot retain the active badge",async()=>{
    state.access.mockResolvedValue({ok:true,context:context(COMPANY_B)});
    state.journey.mockResolvedValue({ok:true,data:{company_id:COMPANY_B,environment:"live",billing_paid:false,operational_eligible:false,qualified_paid_through:null,
      journey:{subscription:{company_id:COMPANY_B,status:"active",paid_through:"2099-01-01T00:00:00Z"}}}});
    const result=await getCustomerReadiness();expect(result.ok).toBe(true);if(!result.ok)throw Error("readiness unavailable");
    expect(result.data.items.find(x=>x.id==="subscription")).toMatchObject({tone:"not_configured",detail:"subscription_inactive"});
    expect(state.journey).toHaveBeenCalledWith(COMPANY_B);
  });
  it("qualified scheduled cancellation retains current eligibility, separately from channel and AI activation",async()=>{
    state.access.mockResolvedValue({ok:true,context:context(COMPANY_B)});
    state.journey.mockResolvedValue({ok:true,data:{company_id:COMPANY_B,environment:"live",billing_paid:true,operational_eligible:true,qualified_paid_through:"2099-01-01T00:00:00Z",journey:{subscription:{company_id:COMPANY_B,status:"cancel_at_period_end"}}}});
    const result=await getCustomerReadiness();if(!result.ok)throw Error("readiness unavailable");
    expect(result.data.items.find(x=>x.id==="subscription")).toMatchObject({tone:"complete",detail:"subscription_active"});
  });
  it("malformed qualified facts display a failed load instead of known inactive",async()=>{
    state.access.mockResolvedValue({ok:true,context:context(COMPANY_B)});state.journey.mockResolvedValue({ok:true,data:{billing_paid:null,operational_eligible:null}});
    const result=await getCustomerReadiness();if(!result.ok)throw Error("readiness unavailable");expect(result.data.items.find(x=>x.id==="subscription")).toMatchObject({tone:"blocked",detail:"load_failed"});
  });
});

describe("business save runtime shape validation", () => {
  it("keeps a committed business save successful when cache refresh fails", async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error("offline cache failure"); });
    expect(await saveOwnerBusiness({ ...business, expectedCompanyId: COMPANY_B })).toMatchObject({ ok: true, data: context(COMPANY_B).company,diagnostic:{operation:"company_save",stage:"refresh",code:"REFRESH_FAILED"} });
    expect(state.writes).toEqual([{ kind: "upsert_selected_owner_company", companyId: COMPANY_B }]);
  });
  it.each([
    ["null object", null], ["array", []],
    ["numeric name", { ...business, displayName: 42 }],
    ["null hours", { ...business, hours: null }],
    ["missing business type", { ...business, businessType: undefined }],
    ["invalid reply language", { ...business, replyLanguage: "xx" }],
    ["boolean country", { ...business, country: false }],
    ["object city", { ...business, city: {} }],
    ["numeric phone", { ...business, contactPhone: 42 }],
    ["array email", { ...business, contactEmail: [] }],
    ["numeric member name", { ...business, memberName: 42 }],
  ])("rejects %s without an RPC or uncaught error", async (_name, input) => {
    await expect(saveOwnerBusiness(input as Parameters<typeof saveOwnerBusiness>[0])).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT", diagnostic: { operation: "company_save", stage: "input", code: "INVALID_INPUT" } });
    expect(state.client).not.toHaveBeenCalled();
    expect(state.rpcRequests).toEqual([]);
  });
  it("keeps authorization ahead of malformed-input handling", async () => {
    state.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    await expect(saveOwnerBusiness(null as unknown as Parameters<typeof saveOwnerBusiness>[0])).resolves.toMatchObject({ ok: false, code: "FORBIDDEN", diagnostic: { operation: "company_save", stage: "access", code: "FORBIDDEN" } });
    expect(state.client).not.toHaveBeenCalled();
  });
});

describe("business contact validation", () => {
  it.each([
    { contactPhone: "not a phone" }, { contactPhone: "---" }, { contactPhone: "+123456" },
    { contactPhone: "+1234567890123456" }, { contactEmail: "missing-at.example.com" },
    { contactEmail: "a@b.com\nInjected" }, { contactEmail: "a\u0000@b.com" }, { contactEmail: `${"a".repeat(249)}@b.com` },
  ])("rejects malformed contacts %j before persistence", async contact => {
    expect(await saveOwnerBusiness({ ...business, ...contact, expectedCompanyId: COMPANY_B })).toMatchObject({ ok: false, code: "INVALID_INPUT", diagnostic: { operation: "company_save", stage: "input", code: "INVALID_INPUT" } });
    expect(state.client).not.toHaveBeenCalled();
    expect(state.rpcRequests).toEqual([]);
  });
  it.each([
    ["", "", "", ""], ["   ", "\t", "", ""],
    [" +968 9000-0000 ", " Owner+sales@Example.COM ", "+96890000000", "Owner+sales@Example.COM"],
    ["+1234567", "مبيعات@مثال.عمان", "+1234567", "مبيعات@مثال.عمان"],
    ["+123456789012345", `${"a".repeat(248)}@b.com`, "+123456789012345", `${"a".repeat(248)}@b.com`],
  ])("persists normalized optional/international contacts", async (contactPhone, contactEmail, phone, email) => {
    expect(await saveOwnerBusiness({ ...business, contactPhone, contactEmail, expectedCompanyId: COMPANY_B })).toMatchObject({ ok: true });
    expect(state.rpcRequests).toEqual([{ name: "upsert_selected_owner_company", input: expect.objectContaining({ p_company_id: COMPANY_B, p_contact_phone: phone, p_contact_email: email }) }]);
  });
});
