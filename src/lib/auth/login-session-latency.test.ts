import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  cookies: [] as Array<{ name: string; value: string }>,
  rpcLatencyMs: 0,
  authLatencyMs: 0,
  probeOk: true,
  continuityOk: true,
  resolveOk: true,
  intentOk: true,
  claimOk: true,
  admitOk: true,
  exchangeOk: true,
  getUserOk: true,
  guardOk: true,
  userId: "11111111-1111-4111-8111-111111111111",
  nativeSessionId: "22222222-2222-4222-8222-222222222222",
  lineageId: "33333333-3333-4333-8333-333333333333",
  registryId: "44444444-4444-4444-8444-444444444444",
  intentId: "55555555-5555-4555-8555-555555555555",
  handle: "",
  handleHash: "",
  cookieName: "vel_sh_0123456789abcdef0123456789abcdef",
  generation: "0123456789abcdef0123456789abcdef",
  accessEnc: "",
  refreshEnc: "",
  pkceEnc: "",
  rpcCalls: [] as string[],
  authCalls: [] as string[],
  restCalls: [] as string[],
}));

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => state.cookies.map((c) => ({ ...c })),
    get: (name: string) => state.cookies.find((c) => c.name === name),
    set: (name: string, value: string) => {
      const idx = state.cookies.findIndex((c) => c.name === name);
      if (idx >= 0) state.cookies[idx] = { name, value };
      else state.cookies.push({ name, value });
    },
  }),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseEnv: () => ({
    ok: true,
    url: "http://127.0.0.1:54321",
    publishableKey: "synthetic-anon-key",
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      await sleep(state.rpcLatencyMs);
      if (name === "vel_broker_capability_probe") {
        if (!state.probeOk) return { data: null, error: { code: "503" } };
        return {
          data: {
            ok: true,
            contract_version: 2,
            revoke_boolean: true,
            idle_wrappers: true,
            broker_registry: true,
            revoke_at_operation: true,
            refresh_lease: true,
            admit_ordinal: true,
            admit_atomic: true,
            browser_attempt_issue: true,
            admit_14arg: true,
            issue_seq_column: true,
            admission_scope_column: true,
            complete_revocation: true,
            browser_bootstrap_claim: true,
            complete_revocation_strict: true,
            bound_admit: true,
            bound_resolve: true,
            codes: [],
          },
          error: null,
        };
      }
      if (name === "vel_broker_lookup_browser_continuity") {
        if (!state.continuityOk) return { data: { ok: false }, error: null };
        return {
          data: {
            ok: true,
            browser_lineage_id: state.lineageId,
            current_generation: 1,
            current_registry_id: state.registryId,
            state: "active",
            valid_until: "2099-01-01T00:00:00Z",
          },
          error: null,
        };
      }
      if (name === "vel_broker_resolve_bound_session") {
        if (!state.resolveOk) return { data: { ok: false, code: "UNAUTHENTICATED" }, error: null };
        return {
          data: {
            ok: true,
            registry_id: state.registryId,
            handle_hash: state.handleHash,
            cookie_name: state.cookieName,
            generation: state.generation,
            user_id: state.userId,
            native_session_id: state.nativeSessionId,
            access_token_enc: state.accessEnc,
            refresh_token_enc: state.refreshEnc,
            token_expires_at: "2099-01-01T00:00:00Z",
            refresh_revision: 1,
            auth_ordinal: 1,
            browser_lineage_id: state.lineageId,
            lineage_generation: 1,
          },
          error: null,
        };
      }
      if (name === "vel_broker_claim_provider_attempt") {
        return { data: { ok: state.claimOk, claimed: state.claimOk }, error: null };
      }
      if (name === "vel_broker_record_provider_session") {
        return { data: state.admitOk, error: null };
      }
      if (name === "vel_broker_admit_bound_session") {
        if (!state.admitOk) return { data: { ok: false }, error: null };
        return {
          data: {
            ok: true,
            registry_id: state.registryId,
            cookie_name: state.cookieName,
            generation: state.generation,
            browser_lineage_id: state.lineageId,
            lineage_generation: 2,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.restCalls.push(`${table}.select`);
            await sleep(state.rpcLatencyMs);
            if (table === "vel_broker_auth_intents") {
              if (!state.intentOk) return { data: null, error: null };
              return {
                data: {
                  id: state.intentId,
                  ordinal: 1,
                  purpose: "oauth_google",
                  status: "reserved",
                  expires_at: "2099-01-01T00:00:00Z",
                  pkce_verifier_enc: state.pkceEnc,
                  user_id: null,
                  expected_parent_handle_hash: null,
                  browser_lineage_id: state.lineageId,
                  recovery_operation_key: null,
                  admission_receipt: null,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        state.authCalls.push("auth.getUser");
        await sleep(state.authLatencyMs);
        if (!state.getUserOk) return { data: { user: null }, error: { name: "AuthRetryableFetchError" } };
        return {
          data: {
            user: {
              id: state.userId,
              email: "owner@synthetic.invalid",
              email_confirmed_at: "2026-01-01T00:00:00Z",
              user_metadata: { full_name: "Synthetic Owner" },
            },
          },
          error: null,
        };
      },
      exchangeCodeForSession: async () => {
        state.authCalls.push("auth.exchangeCodeForSession");
        await sleep(state.authLatencyMs);
        if (!state.exchangeOk) return { data: { session: null }, error: { code: "exchange_failed" } };
        const payload = Buffer.from(
          JSON.stringify({ sub: state.userId, session_id: state.nativeSessionId }),
        ).toString("base64url");
        return {
          data: {
            session: {
              user: { id: state.userId },
              access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`,
              refresh_token: "synthetic-refresh",
              expires_in: 3600,
            },
          },
          error: null,
        };
      },
    },
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      await sleep(state.rpcLatencyMs);
      if (name === "check_app_session") {
        if (!state.guardOk) return { data: { ok: false, code: "UNAUTHENTICATED", expired: true }, error: null };
        return { data: { ok: true, expires_at: "2099-01-01T00:00:00Z" }, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

import { encryptSecret, newOpaqueHandle } from "./broker/crypto";
import { hashHex, probeBrokerCapability, resolveBoundSession } from "./broker/registry";
import { readBoundBrowserContinuity } from "./broker/continuity";
import { brokerExchangeOAuthCode } from "./broker/login";
import { readSessionIdentity } from "./server-identity";
import { createBrokerBoundClient, createClient } from "@/lib/supabase/server";
import { proxy } from "@/proxy";

describe("login and session initialization latency and boundary verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VELORA_SESSION_BROKER_KEY = randomBytes(32).toString("base64");
    const payload = Buffer.from(
      JSON.stringify({ sub: state.userId, session_id: state.nativeSessionId }),
    ).toString("base64url");
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
    state.handle = newOpaqueHandle();
    state.handleHash = hashHex(state.handle);
    state.accessEnc = encryptSecret(jwt)!.toString("base64");
    state.refreshEnc = encryptSecret("synthetic-refresh")!.toString("base64");
    state.pkceEnc = encryptSecret("synthetic-pkce-verifier")!.toString("base64");
    state.cookies = [
      { name: "vel_bc", value: "A".repeat(44) },
      { name: state.cookieName, value: state.handle },
    ];
    state.rpcLatencyMs = 0;
    state.authLatencyMs = 0;
    state.probeOk = true;
    state.continuityOk = true;
    state.resolveOk = true;
    state.intentOk = true;
    state.claimOk = true;
    state.admitOk = true;
    state.exchangeOk = true;
    state.getUserOk = true;
    state.guardOk = true;
    state.rpcCalls = [];
    state.authCalls = [];
    state.restCalls = [];
  });

  it("paired benchmark: resolveBrokerSession + readSessionIdentity cuts sequential round-trip wait under identical 35ms network latency", async () => {
    state.rpcLatencyMs = 35;
    state.authLatencyMs = 35;
    const reader = { getAll: () => state.cookies.map((c) => ({ ...c })) };
    const legacySamples: number[] = [];
    const optimizedSamples: number[] = [];

    for (let i = 0; i < 6; i++) {
      // Legacy sequential baseline (3 sequential broker RPCs + 2 sequential auth/guard calls = 5 serial hops)
      const legacyStart = performance.now();
      await probeBrokerCapability();
      const continuity = await readBoundBrowserContinuity(reader);
      await resolveBoundSession({
        bootstrapHash: continuity!.bootstrapHash,
        handleHashes: [state.handleHash],
        admissionScope: "app",
      });
      const client = await createClient();
      await client.auth.getUser();
      await client.rpc("check_app_session" as never, { p_touch: false } as never);
      legacySamples.push(Math.round(performance.now() - legacyStart));

      // Optimized path (parallelized broker resolve + parallelized getUser & checkAppSession = 2 serial hops)
      state.rpcCalls = [];
      state.authCalls = [];
      const optimizedStart = performance.now();
      const identity = await readSessionIdentity();
      optimizedSamples.push(Math.round(performance.now() - optimizedStart));
      expect(identity).toMatchObject({
        ok: true,
        userId: state.userId,
        boundaryFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      });
    }

    const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const legacyAvg = avg(legacySamples);
    const optimizedAvg = avg(optimizedSamples);
    console.info(
      JSON.stringify({
        benchmark: "session_identity_paired_35ms_hop",
        iterations: 6,
        beforeAvgMs: legacyAvg,
        afterAvgMs: optimizedAvg,
        beforeSerialHops: 5,
        afterSerialHops: 2,
      }),
    );
    expect(optimizedAvg).toBeLessThan(legacyAvg * 0.65);
  });

  it("new Google OAuth callback exchanges code without redundant guest resolve probe", async () => {
    // Fresh login: continuity cookie present, no existing vel_bh_* session handle
    state.cookies = [{ name: "vel_bc", value: "B".repeat(44) }];
    state.rpcLatencyMs = 25;
    state.authLatencyMs = 25;
    const written: Array<{ name: string; value: string }> = [];
    const result = await brokerExchangeOAuthCode({
      code: "synthetic-oauth-code",
      stateNonce: "synthetic-state-nonce",
      reader: { getAll: () => state.cookies },
      writer: { set: (name, value) => written.push({ name, value }) },
    });
    expect(result).toEqual({ ok: true, generation: state.generation });
    expect(written.some((c) => c.name === state.cookieName)).toBe(true);
    // probeBrokerCapability runs once (not twice inside prepareBrokerAdmissionLineage)
    expect(state.rpcCalls.filter((c) => c === "vel_broker_capability_probe")).toHaveLength(1);
  });

  it("fails closed with UNAVAILABLE on network/broker outage and recovers cleanly on retry", async () => {
    state.probeOk = false;
    const failed = await readSessionIdentity();
    expect(failed).toEqual({ ok: false, code: "UNAVAILABLE" });

    state.probeOk = true;
    const recovered = await readSessionIdentity();
    expect(recovered).toMatchObject({ ok: true, userId: state.userId });
  });

  it("re-resolves immediately when cookies change during account switch or logout", async () => {
    const first = await createBrokerBoundClient();
    expect(first.bound.ok).toBe(true);

    // Simulate logout / expired handle removing the broker cookie
    state.cookies = [{ name: "vel_bc", value: "A".repeat(44) }];
    const afterLogout = await createBrokerBoundClient();
    expect(afterLogout.bound).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("proxy skips session RPCs on public/callback paths while enforcing session on protected paths", async () => {
    const cookieHeader = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const publicRes = await proxy(
      new NextRequest("http://localhost:3000/login", { headers: { cookie: cookieHeader } }),
    );
    expect(publicRes.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);

    const callbackRes = await proxy(
      new NextRequest("http://localhost:3000/auth/callback?code=abc", {
        headers: { cookie: cookieHeader },
      }),
    );
    expect(callbackRes.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);

    const protectedRes = await proxy(
      new NextRequest("http://localhost:3000/setup", { headers: { cookie: cookieHeader } }),
    );
    expect(protectedRes.status).toBe(200);
    expect(state.rpcCalls).toContain("vel_broker_resolve_bound_session");

    // Expired session on protected route redirects to /login?next=/setup&reason=session_expired
    state.guardOk = false;
    const expiredRes = await proxy(
      new NextRequest("http://localhost:3000/setup", { headers: { cookie: cookieHeader } }),
    );
    expect(expiredRes.status).toBe(307);
    expect(expiredRes.headers.get("location")).toContain("/login?next=%2Fsetup&reason=session_expired");
  });
});
