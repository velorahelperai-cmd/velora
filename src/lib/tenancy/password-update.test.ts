vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  resolve: vi.fn(),
  update: vi.fn(),
  identity: vi.fn(),
  clearReturn: vi.fn(),
  clearWorkspace: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: state.cookieSet,
  }),
}));
vi.mock("@/lib/auth/server-identity", () => ({ readSessionIdentity: state.identity }));
vi.mock("@/lib/auth/broker", () => ({
  resolveAuthoritativeForMutation: state.resolve,
  brokerUpdatePassword: state.update,
  clearAuthReturnForGeneration: state.clearReturn,
  clearWorkspaceHintForGeneration: state.clearWorkspace,
}));

import { updatePassword } from "./actions";

const FP = "a1b2c3d4e5f60718";
const USER = "private-user-id";
const tip = {
  ok: true as const,
  boundary: {
    userId: USER,
    boundaryFingerprint: FP,
    generation: "generation-a",
    nativeSessionId: "native-a",
    browserLineageId: "lineage-a",
    cookieName: "vel_bh_a",
    authOrdinal: 1,
    contextGeneration: 1,
  },
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  registryId: "registry-a",
  handleHash: "handle-a",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.resolve.mockResolvedValue(tip);
  state.identity.mockResolvedValue({ ok: true, userId: USER });
  state.update.mockResolvedValue({ ok: true, operationId: "op-success", stages: {} });
});

describe("password update diagnostics", () => {
  it("refuses password mutation without a boundary capture", async () => {
    expect(await updatePassword("long-password")).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
      diagnostic: { stage: "input", operation: "auth_password_update" },
    });
    expect(await updatePassword("long-password", USER, "not-a-fingerprint")).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("refuses a stale password form after account switching", async () => {
    expect(await updatePassword("long-password", "old-account", FP)).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
      diagnostic: { stage: "session" },
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("keeps a resolve transport failure distinct from a missing session", async () => {
    state.resolve.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    expect(await updatePassword("long-password", USER, FP)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      diagnostic: { stage: "session" },
    });
    state.resolve.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    expect(await updatePassword("long-password", USER, FP)).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
      diagnostic: { stage: "session" },
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("returns a bounded provider hint without exposing provider text or password", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    state.update.mockResolvedValue({
      ok: false,
      code: "AUTH_ERROR",
      operationId: "op-auth-error",
      stages: {},
    });
    const result = await updatePassword("private-password", USER, FP);
    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_ERROR",
      diagnostic: {
        operation: "auth_password_update",
        stage: "provider",
        code: "AUTH_ERROR",
        reference: expect.stringMatching(/^VEL-[A-F0-9]{16}$/),
      },
    });
    expect(state.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        password: "private-password",
        expectedBoundaryFingerprint: FP,
        expectedUserId: USER,
      }),
    );
    const serialized = JSON.stringify([result, logs.mock.calls]);
    for (const secret of ["private provider payload", "private-password", "private-user-id"]) {
      expect(serialized).not.toContain(secret);
    }
    logs.mockRestore();
  });

  it("refuses malformed input before resolving the authoritative tip", async () => {
    expect(await updatePassword(null as unknown as string)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      diagnostic: { stage: "input" },
    });
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("retains identity enforcement before contacting the update provider", async () => {
    state.identity.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await updatePassword("long-password", USER, FP)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      diagnostic: { stage: "access" },
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("distinguishes a missing session from a provider read failure", async () => {
    state.resolve.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    expect(await updatePassword("long-password", USER, FP)).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
      diagnostic: { stage: "session" },
    });
    state.resolve.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    expect(await updatePassword("long-password", USER, FP)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      diagnostic: { stage: "session" },
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("preserves confirmed success with capture", async () => {
    expect(await updatePassword("long-password", USER, FP)).toEqual({
      ok: true,
      data: { operationId: "op-success" },
    });
    expect(state.resolve).toHaveBeenCalledExactlyOnceWith(expect.any(Object), FP);
    expect(state.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        password: "long-password",
        expectedUserId: USER,
        expectedBoundaryFingerprint: FP,
        resolved: tip,
      }),
    );
    expect(state.clearWorkspace).toHaveBeenCalled();
    expect(state.clearReturn).toHaveBeenCalled();
  });

  it("reports unresolved mandatory session revocation as pending fail-closed", async () => {
    // C3: revoke/pending/no-replay is mandatory — never treat epoch/app-revoke gaps as ok:true.
    state.update.mockResolvedValue({
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId: "op-pending-revoke",
      stages: { credentialMutation: "confirmed", appRevocation: "unknown" },
    });
    const result = await updatePassword("long-password", USER, FP);
    expect(result).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      data: { operationId: "op-pending-revoke" },
    });
    expect(result.ok).toBe(false);
    expect(state.update).toHaveBeenCalledTimes(1);
  });

  it("reports a changed password with unresolved session revocation as pending fail-closed", async () => {
    state.update.mockResolvedValue({
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId: "op-pending-native",
      stages: {},
    });
    const result = await updatePassword("private-password", USER, FP);
    expect(result).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
    });
    expect(JSON.stringify(result)).not.toContain("private-provider-error");
    expect(JSON.stringify(result)).not.toContain("private-password");
  });
});
