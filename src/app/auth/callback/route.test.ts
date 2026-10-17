import { beforeEach, expect, it, vi } from "vitest";

const INTENT = "aaaaaaaa-aaaaaaaa-aaaaaaaa";
const GEN = "gen-synthetic-01";

const f = vi.hoisted(() => ({
  rows: [] as Array<{ name: string; value: string }>,
  set: vi.fn(),
  exchange: vi.fn(),
  commitReturn: vi.fn(),
  readReturn: vi.fn(() => null as string | null),
  access: vi.fn(),
  path: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => f.rows,
    get: (name: string) => {
      const row = f.rows.find((c) => c.name === name);
      return row ? { value: row.value } : undefined;
    },
    set: f.set,
  }),
}));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ ok: true }) }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: f.access, pathForAccess: f.path }));
vi.mock("@/lib/auth/broker", async () => {
  const c = await import("@/lib/auth/broker/cookies");
  return {
    brokerExchangeOAuthCode: f.exchange,
    readIntentCookie: c.readIntentCookie,
    expireIntentCookie: c.expireIntentCookie,
    commitAuthReturnForGeneration: f.commitReturn,
    readAuthReturnForGeneration: f.readReturn,
  };
});

import { intentCookieName } from "@/lib/auth/broker/cookies";
import { GET } from "./route";

const RETURN_COOKIE = `velora_ar_${GEN}`;
const request = (query: string, headers?: HeadersInit) =>
  new Request(`https://velora.example/auth/callback?${query}`, { headers });
const withIntent = (extra = "code=synthetic") => `${extra}&vel_intent=${INTENT}`;
const location = (response: Response) =>
  new URL(response.headers.get("location")!, "https://velora.example");
const setNames = () => f.set.mock.calls.map((c) => c[0] as string);

function bindIntent(extra: Array<{ name: string; value: string }> = []) {
  f.rows = [{ name: intentCookieName(INTENT), value: INTENT }, ...extra];
}

beforeEach(() => {
  vi.clearAllMocks();
  f.rows = [];
  f.exchange.mockResolvedValue({ ok: true, generation: GEN });
  f.readReturn.mockReturnValue(null);
  f.access.mockResolvedValue({ ok: true });
  f.path.mockReturnValue("/app");
  bindIntent();
});

it("ignores an untrusted forwarded host and protocol for redirects", async () => {
  const url = location(
    await GET(
      request("error=access_denied", {
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http",
      }),
    ),
  );
  expect(url.origin).toBe("https://velora.example");
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("error")).toBe("oauth_cancelled");
});

it("does not reflect provider descriptions or exchange errors into login URLs", async () => {
  const cancelled = location(await GET(request("error_description=synthetic-secret-pii")));
  expect(cancelled.searchParams.get("detail")).toBeNull();
  expect(cancelled.searchParams.get("error")).toBe("oauth_cancelled");
  expect(cancelled.toString()).not.toContain("synthetic-secret-pii");

  f.exchange.mockResolvedValue({
    ok: false,
    code: "AUTH_ERROR",
    detail: "exchange_failed",
    expireIntent: true,
  });
  const failed = location(await GET(request(withIntent())));
  expect(failed.searchParams.get("detail")).toBe("exchange_failed");
  expect(failed.toString()).not.toContain("synthetic-secret-pii");
  expect(failed.searchParams.get("error")).toBe("auth_callback");
});

it("fails closed when authorization lookup throws and keeps exchanged cookies", async () => {
  f.access.mockRejectedValue(new Error("synthetic unavailable"));
  f.exchange.mockImplementation(
    async (input: { writer: { set: (n: string, v: string, o?: object) => void } }) => {
      input.writer.set("sb-session", "synthetic", { path: "/" });
      return { ok: true, generation: GEN };
    },
  );
  const response = await GET(request(withIntent("code=synthetic&next=%2Fadmin")));
  expect(location(response).pathname).toBe("/access");
  expect(location(response).searchParams.get("code")).toBe("UNAVAILABLE");
  expect(setNames()).toContain("sb-session");
  expect(f.set.mock.calls.some((c) => c[0] === "sb-session" && c[1] === "synthetic")).toBe(true);
});

it("preserves per-intent cookie cleanup on failed exchange and keeps preferred next", async () => {
  f.exchange.mockResolvedValue({
    ok: false,
    code: "AUTH_ERROR",
    detail: "verification_browser",
    expireIntent: true,
  });
  const response = await GET(request(withIntent("code=synthetic&next=%2Faccount")));
  expect(location(response).searchParams.get("error")).toBe("verification_browser");
  expect(location(response).searchParams.get("next")).toBe("/account");
  expect(setNames()).toContain(intentCookieName(INTENT));
  expect(setNames()).toContain("vel_ai");
  expect(
    f.set.mock.calls.some((c) => c[0] === intentCookieName(INTENT) && c[1] === ""),
  ).toBe(true);
  expect(f.commitReturn).not.toHaveBeenCalled();
});

it("does not leave a stale recovery return cookie after successful authentication", async () => {
  f.readReturn.mockReturnValue("/reset-password");
  bindIntent([{ name: RETURN_COOKIE, value: "/reset-password" }]);
  const response = await GET(request(withIntent("code=synthetic&next=%2Freset-password")));
  expect(location(response).pathname).toBe("/reset-password");
  expect(response.cookies.get(RETURN_COOKIE)).toMatchObject({ name: RETURN_COOKIE, value: "" });
  expect(response.cookies.get("vel_ai")).toMatchObject({ name: "vel_ai", value: "" });
  expect(response.headers.get("set-cookie")).toContain(`${RETURN_COOKIE}=`);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(f.commitReturn).toHaveBeenCalledWith(expect.anything(), GEN, "/reset-password");
});

it("returns a safe retry path when the exchange throws", async () => {
  f.exchange.mockRejectedValue(new Error("synthetic provider outage"));
  const response = await GET(request(withIntent("code=synthetic&next=%2Faccount")));
  expect(location(response).pathname).toBe("/login");
  expect(location(response).searchParams.get("detail")).toBe("exchange_failed");
  expect(location(response).searchParams.get("next")).toBe("/account");
  expect(setNames()).not.toContain(intentCookieName(INTENT));
});
