import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ companyId: "company-a", rpc: vi.fn(), claims: vi.fn(), attempt: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: async () => ({ ok: true, context: {
  identityVerified: true, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", company: { id: state.companyId, status: "active" }, membership: { role: "owner" },
} }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, auth: { getClaims: state.claims } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: async () => ({ ok: true }) }));
vi.mock("./embedded-signup", () => ({ embeddedSignupClientConfig: () => ({ ok: true, appId: "111", configId: "444", graphVersion: "v25.0" }), createEmbeddedSignupAttempt: state.attempt }));
import { getEmbeddedSignupSetup, startEmbeddedSignup, disconnectEmbeddedSignup, getFixedAckSetup, configureFixedAck } from "./embedded-signup-actions";

describe("Meta actions preserve the company rendered in the caller", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.companyId = "company-a";
    state.claims.mockResolvedValue({ data: { claims: { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }, error: null });
    state.attempt.mockReturnValue({ ok: true, attempt: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", nonce: "a".repeat(64) } });
    state.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === "whatsapp_start_embedded_signup"
      ? { ok: true, attempt_id: args.p_attempt_id, nonce: args.p_nonce, expires_at: "2099-01-01T00:00:00Z" } : { ok: true } }));
  });
  it.each(["setup", "start", "disconnect"])("rejects stale-company %s before RPC or provider preparation", async action => {
    state.companyId = "company-b";
    const result = action === "setup" ? await getEmbeddedSignupSetup("company-a")
      : action === "start" ? await startEmbeddedSignup({ companyId: "company-a", keepOnPhone: false }) : await disconnectEmbeddedSignup("company-a");
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.attempt).not.toHaveBeenCalled();
  });
  it.each(["setup", "start", "disconnect"])("rejects an unbound legacy %s call", async action => {
    const missing = undefined as unknown as string;
    const result = action === "setup" ? await getEmbeddedSignupSetup(missing)
      : action === "start" ? await startEmbeddedSignup({ companyId: missing, keepOnPhone: false }) : await disconnectEmbeddedSignup(missing);
    expect(result.ok).toBe(false); expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["setup", "start", "disconnect"])("preserves same-company %s with the server-derived company", async action => {
    const result = action === "setup" ? await getEmbeddedSignupSetup("company-a")
      : action === "start" ? await startEmbeddedSignup({ companyId: "company-a", keepOnPhone: false }) : await disconnectEmbeddedSignup("company-a");
    expect(result.ok).toBe(true); expect(state.rpc.mock.calls[0][1].p_company_id).toBe("company-a");
  });
});

it("fixed opt-in cannot cross the company rendered in the caller",async()=>{
 state.companyId="company-b";state.rpc.mockClear();expect(await configureFixedAck("company-a",true)).toEqual({ok:false,code:"FORBIDDEN"});expect(await getFixedAckSetup("company-a")).toEqual({ok:false,code:"FORBIDDEN"});expect(state.rpc).not.toHaveBeenCalled();
});
it("fixed opt-in stays unavailable without host scope and sends no privileged mutation",async()=>{
 vi.unstubAllEnvs();state.companyId="company-a";state.rpc.mockClear();expect(await getFixedAckSetup("company-a")).toEqual({ok:true,available:false});expect(await configureFixedAck("company-a",true)).toEqual({ok:false,code:"NEEDS_SETUP"});expect(state.rpc).not.toHaveBeenCalled();
});
