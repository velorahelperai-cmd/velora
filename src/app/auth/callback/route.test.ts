import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ exchange: vi.fn(), cookieOptions: null as null | { setAll: (rows: Array<{ name: string; value: string }>) => void } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: string, _key: string, options: { cookies: typeof state.cookieOptions }) => {
  state.cookieOptions = options.cookies;
  return { auth: { exchangeCodeForSession: state.exchange } };
} }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ ok: true, url: "https://synthetic.example.test", publishableKey: "synthetic-public-setting" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], get: () => undefined, set: vi.fn() }) }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: async () => ({ ok: true }), pathForAccess: () => "/setup" }));
import { GET } from "./route";

beforeEach(() => { vi.clearAllMocks(); });
describe("legacy PKCE callback and normal OAuth session safety", () => {
  it("turns a missing verifier into a safe sign-in explanation and preserves a safe next", async () => {
    state.exchange.mockResolvedValue({ error: { code: "pkce_code_verifier_not_found", message: "PKCE code verifier not found in storage" } });
    const response = await GET(new Request("https://example.test/auth/callback?code=synthetic-code&next=%2Fsetup"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("verification_browser");
    expect(location.searchParams.get("next")).toBe("/setup");
    expect(location.searchParams.has("detail")).toBe(false);
    expect(location.searchParams.has("code")).toBe(false);
  });
  it("keeps successful code exchange and response cookies for OAuth", async () => {
    state.exchange.mockImplementation(async () => {
      state.cookieOptions!.setAll([{ name: "synthetic-session", value: "synthetic-cookie" }]);
      return { error: null };
    });
    const response = await GET(new Request("https://example.test/auth/callback?code=synthetic-code"));
    expect(response.headers.get("location")).toBe("https://example.test/setup");
    expect(response.headers.get("set-cookie")).toContain("synthetic-session=synthetic-cookie");
    expect(state.exchange).toHaveBeenCalledExactlyOnceWith("synthetic-code");
  });
});
