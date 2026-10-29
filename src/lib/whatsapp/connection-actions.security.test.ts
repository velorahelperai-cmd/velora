import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: mocks.access, requirePlatformAdmin: mocks.admin }));
import { getWhatsappCompanyLink, saveWhatsappLinkRequest, adminGetWhatsappCompanyLink,
  adminUpdateWhatsappLinkNote, adminMarkWhatsappLinkNeedsExternal } from "./connection-actions";

const companyId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const actions = [
  () => getWhatsappCompanyLink(),
  () => saveWhatsappLinkRequest({ requestedDisplayNumber: "+96812345678", keepOnPhone: true }),
  () => adminGetWhatsappCompanyLink(companyId),
  () => adminUpdateWhatsappLinkNote({ companyId, adminNote: "note" }),
  () => adminMarkWhatsappLinkNeedsExternal(companyId),
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, context: { company: { id: companyId, status: "active" }, membership: { role: "owner" } } });
  mocks.admin.mockResolvedValue({ ok: true });
});
describe("WhatsApp public error boundary", () => {
  it.each(actions)("hides database error details", async (action) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "secret token and private schema detail" } });
    expect(await action()).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("hides unknown RPC rejection details", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code: "private internal failure" }, error: null });
    expect(await getWhatsappCompanyLink()).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it.each(["forbidden", "already_verified", "invalid_transition"])("preserves known rejection %s", async (code) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    expect(await getWhatsappCompanyLink()).toEqual({ ok: false, code: code.toUpperCase() });
  });
  it("does not call RPC for a non-owner write", async () => {
    mocks.access.mockResolvedValue({ ok: true, context: { company: { id: companyId }, membership: { role: "member" } } });
    expect(await actions[1]()).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
