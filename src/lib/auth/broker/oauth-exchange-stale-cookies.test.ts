import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  load: vi.fn(),
  claim: vi.fn(),
  capture: vi.fn(),
  admit: vi.fn(),
  exchange: vi.fn(),
  materialize: vi.fn(),
  cleanup: vi.fn(),
  resume: vi.fn(),
}));

vi.mock("./lineage-auth", () => ({ prepareBrokerAdmissionLineage: m.prepare }));
vi.mock("./registry", () => ({
  probeBrokerCapability: async () => ({ ok: true, boundAdmit: true }),
  loadAuthIntentByNonce: m.load,
  claimProviderAttempt: m.claim,
  recordProviderSessionCapture: m.capture,
  admitBoundSessionAtomic: m.admit,
  materializeCommittedIntentAdmission: m.materialize,
}));
vi.mock("./provider", () => ({
  createProviderAuthClient: () => ({ client: { auth: { exchangeCodeForSession: m.exchange } } }),
  seedPkceVerifier: vi.fn(),
  readPkceVerifier: () => "fixture-verifier",
}));
vi.mock("./provider-session", () => ({
  resumeProviderCleanup: m.resume,
  signOutProviderSessionAfterAdmitFailure: m.cleanup,
}));
vi.mock("./session-id", () => ({
  nativeSessionIdFromAccessToken: () => "11111111-1111-4111-8111-111111111111",
  expiresAtFromSession: () => new Date(Date.now() + 3600_000).toISOString(),
}));

import { brokerExchangeOAuthCode } from "./login";

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
  m.load.mockResolvedValue({
    id: "intent",
    status: "reserved",
    purpose: "oauth_google",
    pkceVerifier: "fixture-verifier",
    browserLineageId: "lineage",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
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
  m.exchange.mockResolvedValue({
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

it("OAuth exchange rotates stale handles, passes reader into admit, and commits the winner", async () => {
  const jar = new Map<string, string>([[stale, "stale-opaque-handle-value-0123456789abcd"]]);
  const writer = {
    set(name: string, value: string, options?: { maxAge?: number }) {
      if (options?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
  const reader = { getAll: () => [...jar].map(([name, value]) => ({ name, value })) };
  expect(
    await brokerExchangeOAuthCode({
      code: "fixture-code",
      stateNonce: "fixture-state-nonce-123456",
      reader,
      writer,
    }),
  ).toEqual({ ok: true, generation: "b".repeat(32) });
  expect(m.prepare).toHaveBeenCalledWith(reader, writer, { rotateStaleHandles: true });
  expect(m.admit).toHaveBeenCalled();
  expect(jar.has(stale)).toBe(false);
  expect(jar.get(winner)).toBe(handle);
});
