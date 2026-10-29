import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ resolve: vi.fn(), provider: vi.fn(), rpc: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("@/lib/auth/broker", () => ({ createBrokerUserClient: state.resolve }));
vi.mock("@/lib/auth/broker/provider", () => ({ createProviderAuthClient: state.provider }));
import { createClient } from "./server";
import { checkSessionActivity } from "@/lib/auth/session-actions";

beforeEach(() => {
  vi.resetAllMocks();
  state.provider.mockReturnValue({ client: { auth: { getUser: async () => ({
    data: { user: null }, error: { name: "AuthSessionMissingError" },
  }) } } });
});

it("does not turn a broker outage into a guest client", async () => {
  state.resolve.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  await expect(createClient()).rejects.toThrow("BROKER_SESSION_UNAVAILABLE");
  expect(state.provider).not.toHaveBeenCalled();
});

it("activity checks preserve unavailable instead of triggering expiry and quarantine", async () => {
  state.resolve.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  await expect(checkSessionActivity()).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });
  expect(state.provider).not.toHaveBeenCalled();
});

it("confirmed absence still returns unauthenticated", async () => {
  state.resolve.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
  await expect(checkSessionActivity()).resolves.toEqual({ ok: false, code: "UNAUTHENTICATED" });
});

it("a recovered broker keeps the same authenticated activity check", async () => {
  state.resolve.mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" });
  await expect(checkSessionActivity()).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });
  state.rpc.mockResolvedValue({ data: { ok: true, expires_at: "2026-10-30T02:00:00Z" }, error: null });
  state.resolve.mockResolvedValue({ ok: true, client: {
    auth: { getUser: async () => ({ data: { user: { id: "fixture-a" } }, error: null }) }, rpc: state.rpc,
  } });
  await expect(checkSessionActivity(true)).resolves.toEqual({ ok: true, expiresAt: "2026-10-30T02:00:00Z" });
  expect(state.rpc).toHaveBeenCalledWith("check_app_session", { p_touch: true });
});
