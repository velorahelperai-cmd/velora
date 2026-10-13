import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ access: vi.fn(), knowledge: vi.fn(), whatsapp: vi.fn(), billing: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: state.access }));
vi.mock("@/lib/knowledge/actions", () => ({ listKnowledgeSources: state.knowledge }));
vi.mock("@/lib/whatsapp/connection-actions", () => ({ getWhatsappCompanyLink: state.whatsapp }));
vi.mock("@/lib/billing/wiring/display-read", () => ({ readCompanyBillingDisplay: state.billing }));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.client }));
import { getCustomerReadiness } from "./actions";
const companyId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  state.access.mockResolvedValue({ ok: true, context: { fullName: "Owner", email: "owner@example.test", needsProfileName: false,
    membership: { role: "owner", status: "active" }, company: { id: companyId, display_name: "Business", status: "setup" } } });
  state.knowledge.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  state.whatsapp.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  state.billing.mockResolvedValue({ ok: false, code: "unavailable" });
  state.client.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
});
it("starts independent readiness reads before a slow knowledge read finishes", async () => {
  let finish!: (value: unknown) => void;
  state.knowledge.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const request = getCustomerReadiness();
  await vi.waitFor(() => {
    expect(state.whatsapp).toHaveBeenCalledOnce();
    expect(state.billing).toHaveBeenCalledWith(companyId);
    expect(state.client).toHaveBeenCalledOnce();
  }, { timeout: 200 });
  finish({ ok: false, code: "UNAVAILABLE" });
  expect((await request).ok).toBe(true);
});
it("preserves the checklist and truthful failure states if one independent read throws", async () => {
  state.billing.mockRejectedValue(new Error("offline billing failure"));
  const result = await getCustomerReadiness();
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("checklist unavailable");
  expect(result.data.items.find(item => item.id === "subscription")).toMatchObject({ detail: "load_failed" });
  expect(result.data.items.find(item => item.id === "knowledge")).toMatchObject({ detail: "load_failed" });
});
