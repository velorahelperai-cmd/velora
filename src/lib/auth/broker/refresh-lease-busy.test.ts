import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./log", () => ({ brokerLog: vi.fn() }));

import {
  REFRESH_SOFT_REUSE_MIN_MS,
  settleNearExpirySession,
} from "./resolve";
import type { BrokerResolveResult } from "./types";

type Resolved = Extract<BrokerResolveResult, { ok: true }>;

const CLOCK = 1_700_000_000_000;

function session(overrides: Partial<Resolved> = {}): Resolved {
  return {
    ok: true,
    boundary: {
      boundaryFingerprint: "aaaaaaaaaaaaaaaa",
      userId: "177ef439-3fb0-4e3e-96b8-2a9e8661386d",
      nativeSessionId: "00000000-0000-4000-8000-000000000001",
      cookieName: "vb_h_test",
      generation: "1",
      authOrdinal: 1,
      contextGeneration: 1,
      browserLineageId: "00000000-0000-4000-8000-000000000002",
    },
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(CLOCK + 30_000).toISOString(),
    refreshRevision: 3,
    registryId: "00000000-0000-4000-8000-000000000003",
    authOrdinal: 1,
    handleHash: "hash",
    ...overrides,
  };
}

it("soft-reuses a still-valid session when the refresh lease stays busy", async () => {
  const initial = session();
  const refresh = vi.fn(async () => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    reason: "LEASE_BUSY" as const,
  }));
  const resolve = vi.fn(async () => initial);
  const recordedSleep = vi.fn(async (_ms: number) => undefined);
  let t = CLOCK;
  const settled = await settleNearExpirySession({ getAll: () => [] }, initial, {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      await recordedSleep(ms);
    },
    refresh,
    resolve,
    waitBudgetMs: 500,
  });
  expect(settled).toMatchObject({
    ok: true,
    resolve: { accessToken: "access-token", refreshRevision: 3 },
  });
  expect(refresh).toHaveBeenCalled();
  expect(recordedSleep).toHaveBeenCalled();
});

it("adopts peer-completed tokens after a busy lease wait", async () => {
  const initial = session({ refreshRevision: 3 });
  const peer = session({
    refreshRevision: 4,
    accessToken: "peer-access",
    refreshToken: "peer-refresh",
    expiresAt: new Date(CLOCK + 3_600_000).toISOString(),
  });
  const refresh = vi.fn(async () => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    reason: "LEASE_BUSY" as const,
  }));
  let t = CLOCK;
  const settled = await settleNearExpirySession({ getAll: () => [] }, initial, {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    refresh,
    resolve: async () => peer,
    waitBudgetMs: 400,
  });
  expect(settled).toMatchObject({
    ok: true,
    resolve: { accessToken: "peer-access", refreshRevision: 4 },
  });
});

it("returns UNAVAILABLE only when the access token is already too close to expiry", async () => {
  const initial = session({
    expiresAt: new Date(CLOCK + REFRESH_SOFT_REUSE_MIN_MS - 500).toISOString(),
  });
  const refresh = vi.fn(async () => ({
    ok: false as const,
    code: "UNAVAILABLE" as const,
    reason: "LEASE_BUSY" as const,
  }));
  let t = CLOCK;
  const settled = await settleNearExpirySession({ getAll: () => [] }, initial, {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    refresh,
    resolve: async () => initial,
    waitBudgetMs: 200,
  });
  expect(settled).toEqual({ ok: false, code: "UNAVAILABLE" });
});

it("skips refresh when the access token is outside the skew window", async () => {
  const initial = session({
    expiresAt: new Date(CLOCK + 120_000).toISOString(),
  });
  const refresh = vi.fn();
  const settled = await settleNearExpirySession({ getAll: () => [] }, initial, {
    now: () => CLOCK,
    refresh,
    resolve: async () => initial,
  });
  expect(settled).toMatchObject({ ok: true, resolve: initial });
  expect(refresh).not.toHaveBeenCalled();
});
