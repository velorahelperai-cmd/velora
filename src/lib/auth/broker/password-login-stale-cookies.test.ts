import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  reserve: vi.fn(),
  claim: vi.fn(),
  load: vi.fn(),
  materialize: vi.fn(),
  capture: vi.fn(),
  admit: vi.fn(),
  signIn: vi.fn(),
  resume: vi.fn(),
  cleanup: vi.fn(),
  log: vi.fn(),
}));

vi.mock("./lineage-auth", () => ({ prepareBrokerAdmissionLineage: m.prepare }));
vi.mock("./registry", () => ({
  probeBrokerCapability: async () => ({ ok: true, boundAdmit: true }),
  reserveBoundAuthIntent: m.reserve,
  claimProviderAttempt: m.claim,
  loadAuthIntentByNonce: m.load,
  materializeCommittedIntentAdmission: m.materialize,
  recordProviderSessionCapture: m.capture,
  admitBoundSessionAtomic: m.admit,
  loadBrokerOperation: vi.fn(),
}));
vi.mock("./provider", () => ({
  createProviderAuthClient: () => ({ client: { auth: { signInWithPassword: m.signIn } } }),
}));
vi.mock("./provider-session", () => ({
  resumeProviderCleanup: m.resume,
  signOutProviderSessionAfterAdmitFailure: m.cleanup,
}));
vi.mock("./log", () => ({ brokerLog: m.log }));
vi.mock("./session-id", () => ({
  nativeSessionIdFromAccessToken: () => "11111111-1111-4111-8111-111111111111",
  expiresAtFromSession: () => new Date(Date.now() + 3600_000).toISOString(),
}));

import { brokerPasswordLogin } from "./login";

const stale = "vel_sh_" + "a".repeat(32);
const winner = "vel_sh_" + "b".repeat(32);
const handle = "opaque-handle-value-for-tests-0123456789ab";

beforeEach(() => {
  vi.resetAllMocks();
  m.prepare.mockResolvedValue({
    ok: true,
    bootstrapHash: "root",
    browserLineageId: "lineage",
  });
  m.reserve.mockResolvedValue({
    id: "intent",
    stateNonce: "state-nonce-value",
    lineageGeneration: 1,
    browserLineageId: "lineage",
    parentHandleHash: null,
    providerState: "ready",
    status: "reserved",
    idempotent: false,
  });
  m.claim.mockResolvedValue({ ok: true, claimed: true });
  m.capture.mockResolvedValue(true);
  m.admit.mockResolvedValue({
    cookieName: winner,
    handle,
    generation: "b".repeat(32),
    userId: "user",
    boundaryFingerprint: "fp",
  });
  m.signIn.mockResolvedValue({
    data: {
      session: {
        user: { id: "user" },
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      },
    },
    error: null,
  });
});

it("rotates stale handle cookies before admit and commits only the winner", async () => {
  const jar = new Map<string, string>([[stale, "stale-opaque-handle-value-0123456789abcd"]]);
  const writer = {
    set(name: string, value: string, options?: { maxAge?: number }) {
      if (options?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
  const reader = { getAll: () => [...jar].map(([name, value]) => ({ name, value })) };
  // Lineage already rotates in prepare; still ensure admit expires request-jar leftovers.
  expect(
    await brokerPasswordLogin({
      email: "qa@example.test",
      password: "SyntheticPassword42!",
      requestNonce: "gesture-nonce-16chars",
      reader,
      writer,
    }),
  ).toEqual({ ok: true });
  expect(jar.has(stale)).toBe(false);
  expect(jar.get(winner)).toBe(handle);
  expect(m.prepare).toHaveBeenCalledWith(reader, writer, { rotateStaleHandles: true });
});

it("replays a committed intent cookie when the same gesture retries after a lost Set-Cookie", async () => {
  m.reserve.mockResolvedValue({
    id: "intent",
    stateNonce: "state-nonce-value",
    lineageGeneration: 1,
    browserLineageId: "lineage",
    parentHandleHash: null,
    providerState: "committed",
    status: "committed",
    idempotent: true,
  });
  m.load.mockResolvedValue({
    id: "intent",
    status: "committed",
    purpose: "password_login",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    admissionReceipt: { ok: true },
  });
  m.materialize.mockResolvedValue({
    cookieName: winner,
    handle,
    generation: "b".repeat(32),
    userId: "user",
    boundaryFingerprint: "fp",
  });
  const jar = new Map<string, string>();
  const writer = {
    set(name: string, value: string, options?: { maxAge?: number }) {
      if (options?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
  expect(
    await brokerPasswordLogin({
      email: "qa@example.test",
      password: "SyntheticPassword42!",
      requestNonce: "gesture-nonce-16chars",
      reader: { getAll: () => [...jar].map(([name, value]) => ({ name, value })) },
      writer,
    }),
  ).toEqual({ ok: true });
  expect(jar.get(winner)).toBe(handle);
  expect(m.signIn).not.toHaveBeenCalled();
  expect(m.claim).not.toHaveBeenCalled();
  expect(m.log).toHaveBeenCalledWith(
    "info",
    "auth.broker.login.rematerialized",
    expect.objectContaining({ error_code: "COMMITTED_INTENT_COOKIE_REPLAY" }),
  );
});
