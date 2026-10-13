vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), identity: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: state.client }));
vi.mock("@/lib/auth/server-identity", () => ({ readSessionIdentity: state.identity }));
import { updatePassword } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  state.client.mockResolvedValue({ auth: { getUser: state.user, updateUser: state.update } });
  state.user.mockResolvedValue({ data: { user: { id: "private-user-id" } }, error: null });
  state.identity.mockResolvedValue({ ok: true, userId: "private-user-id" });
  state.update.mockResolvedValue({ error: null });
});

describe("password update diagnostics", () => {
  it("refuses a stale password form after account switching", async () => {
    expect(await updatePassword("long-password", "old-account")).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("keeps a getUser transport failure distinct from a missing session", async () => {
    state.user.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError" } });
    expect(await updatePassword("long-password")).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("returns a bounded provider hint without exposing provider text or password", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    state.update.mockResolvedValue({ error: { message: "private provider payload", code: "private-code" } });
    const result = await updatePassword("private-password");
    expect(result).toMatchObject({ ok: false, code: "AUTH_ERROR", diagnostic: {
      operation: "auth_password_update", stage: "provider", code: "AUTH_ERROR", reference: expect.stringMatching(/^VEL-[A-F0-9]{16}$/),
    } });
    const serialized = JSON.stringify([result, logs.mock.calls]);
    for (const secret of ["private provider payload", "private-code", "private-password", "private-user-id"]) expect(serialized).not.toContain(secret);
    logs.mockRestore();
  });
  it("refuses malformed input before creating a client", async () => {
    expect(await updatePassword(null as unknown as string)).toMatchObject({ ok: false, code: "INVALID_INPUT", diagnostic: { stage: "input" } });
    expect(state.client).not.toHaveBeenCalled();
  });
  it("retains identity enforcement before contacting the update provider", async () => {
    state.identity.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await updatePassword("long-password")).toMatchObject({ ok: false, code: "FORBIDDEN", diagnostic: { stage: "access" } });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("distinguishes a missing session from a provider read failure", async () => {
    state.user.mockResolvedValue({ data: { user: null }, error: null });
    expect(await updatePassword("long-password")).toMatchObject({ ok: false, code: "UNAUTHENTICATED", diagnostic: { stage: "session" } });
    state.user.mockRejectedValue(new Error("private read failure"));
    expect(await updatePassword("long-password")).toMatchObject({ ok: false, code: "UNAVAILABLE", diagnostic: { stage: "session" } });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("preserves confirmed success", async () => {
    expect(await updatePassword("long-password")).toEqual({ ok: true, data: undefined });
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ password: "long-password" });
  });
});
