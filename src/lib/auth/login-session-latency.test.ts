import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rscHolder = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const path = await import("node:path");
  const req = createRequire(import.meta.url);
  const reactPkgDir = path.dirname(req.resolve("react/package.json"));
  const reactServerPath = path.join(reactPkgDir, "cjs", "react.react-server.development.js");
  const reactServer = req(reactServerPath) as typeof import("react");
  const reactResolved = req.resolve("react");
  req.cache[reactResolved] = {
    id: reactResolved,
    filename: reactResolved,
    loaded: true,
    exports: reactServer,
    children: [],
    paths: [],
  } as unknown as NodeModule;
  const rscServer = req(
    "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js",
  ) as {
    renderToReadableStream: (model: unknown) => ReadableStream<Uint8Array>;
  };
  return { reactServer, rscServer };
});

vi.mock("react", () => rscHolder.reactServer);

type RequestStore = {
  cookies: Array<{ name: string; value: string }>;
  userId?: string;
  handleHash?: string;
  cookieName?: string;
  generation?: string;
  accessEnc?: string;
  refreshEnc?: string;
};

const requestStorage = new AsyncLocalStorage<RequestStore>();

const state = vi.hoisted(() => ({
  cookies: [] as Array<{ name: string; value: string }>,
  rpcLatencyMs: 0,
  authLatencyMs: 0,
  probeOk: true,
  continuityOk: true,
  continuityState: "active",
  continuityGeneration: 1,
  continuityRegistryId: null as string | null,
  continuityLineageId: null as string | null,
  resolveOk: true,
  resolveLineageGeneration: 1,
  resolveRegistryId: null as string | null,
  resolveLineageId: null as string | null,
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

function activeCookies() {
  return requestStorage.getStore()?.cookies ?? state.cookies;
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => activeCookies().map((c) => ({ ...c })),
    get: (name: string) => activeCookies().find((c) => c.name === name),
    set: (name: string, value: string) => {
      const target = activeCookies();
      const idx = target.findIndex((c) => c.name === name);
      if (idx >= 0) target[idx] = { name, value };
      else target.push({ name, value });
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
            browser_lineage_id: state.continuityLineageId ?? state.lineageId,
            current_generation: state.continuityGeneration,
            current_registry_id: state.continuityRegistryId ?? state.registryId,
            state: state.continuityState,
            valid_until: "2099-01-01T00:00:00Z",
          },
          error: null,
        };
      }
      if (name === "vel_broker_resolve_bound_session") {
        if (!state.resolveOk) return { data: { ok: false, code: "UNAUTHENTICATED" }, error: null };
        const reqStore = requestStorage.getStore();
        return {
          data: {
            ok: true,
            registry_id: state.resolveRegistryId ?? state.registryId,
            handle_hash: reqStore?.handleHash ?? state.handleHash,
            cookie_name: reqStore?.cookieName ?? state.cookieName,
            generation: reqStore?.generation ?? state.generation,
            user_id: reqStore?.userId ?? state.userId,
            native_session_id: state.nativeSessionId,
            access_token_enc: reqStore?.accessEnc ?? state.accessEnc,
            refresh_token_enc: reqStore?.refreshEnc ?? state.refreshEnc,
            token_expires_at: "2099-01-01T00:00:00Z",
            refresh_revision: 1,
            auth_ordinal: 1,
            browser_lineage_id: state.resolveLineageId ?? state.lineageId,
            lineage_generation: state.resolveLineageGeneration,
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
        if (!state.guardOk) return { data: { ok: false, code: "SESSION_EXPIRED" }, error: null };
        return { data: { ok: true, expires_at: "2099-01-01T00:00:00Z" }, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

import { boundaryFingerprint, decryptSecret, encryptSecret, newOpaqueHandle } from "./broker/crypto";
import { selectCandidateHandles, type CookieReader } from "./broker/cookies";
import { hashHex, probeBrokerCapability, resolveBoundSession } from "./broker/registry";
import { readBoundBrowserContinuity } from "./broker/continuity";
import { createUserClientFromTokens } from "./broker/resolve";
import { brokerExchangeOAuthCode } from "./broker/login";
import { checkAppSession } from "./session-guard";
import { readSessionIdentity } from "./server-identity";
import { createBrokerBoundClient, createClient } from "@/lib/supabase/server";
import { proxy } from "@/proxy";

/**
 * Exact 6431afd baseline implementation of `resolveBrokerSession` + `readSessionIdentity`
 * without any duplicate `createClient()` call or asymmetric work.
 */
async function readSessionIdentityBaseline6431afd(reader: CookieReader) {
  const capability = await probeBrokerCapability();
  if (!capability.ok) return { ok: false as const, code: "UNAVAILABLE" as const };
  const selected = selectCandidateHandles(reader);
  if ("failClosed" in selected) return { ok: false as const, code: "UNAVAILABLE" as const };
  if (selected.length === 0) return { ok: false as const, code: "UNAUTHENTICATED" as const };
  const bound = await readBoundBrowserContinuity(reader);
  if (!bound?.bootstrapHash) return { ok: false as const, code: "UNAUTHENTICATED" as const };
  const handleHashes = selected.map((c) => hashHex(c.value));
  const byHash = new Map(selected.map((c) => [hashHex(c.value), c]));
  const row = await resolveBoundSession({
    bootstrapHash: bound.bootstrapHash,
    handleHashes,
    admissionScope: "app",
  });
  if (!row) return { ok: false as const, code: "UNAUTHENTICATED" as const };
  const cookie = byHash.get(row.handle_hash);
  if (!cookie || cookie.name !== row.cookie_name) {
    return { ok: false as const, code: "UNAUTHENTICATED" as const };
  }
  const accessToken = decryptSecret(Buffer.from(row.access_token_enc, "base64"));
  const refreshToken = decryptSecret(Buffer.from(row.refresh_token_enc, "base64"));
  if (!accessToken || !refreshToken) return { ok: false as const, code: "UNAVAILABLE" as const };
  const client = createUserClientFromTokens(accessToken, refreshToken);
  if (!client) return { ok: false as const, code: "UNAVAILABLE" as const };

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false as const, code: "UNAUTHENTICATED" as const };
  const guard = await checkAppSession(client);
  if (!guard.ok) return guard;
  return {
    ok: true as const,
    userId: data.user.id,
    email: data.user.email ?? "",
    fullName: String(data.user.user_metadata?.full_name || data.user.user_metadata?.name || ""),
    emailConfirmed: !!(data.user.email_confirmed_at || data.user.phone_confirmed_at),
    sessionExpiresAt: guard.expiresAt,
    boundaryFingerprint: boundaryFingerprint(cookie.value),
    nativeSessionId: row.native_session_id,
    generation: row.generation,
  };
}

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
    state.continuityState = "active";
    state.continuityGeneration = 1;
    state.continuityRegistryId = null;
    state.continuityLineageId = null;
    state.resolveOk = true;
    state.resolveLineageGeneration = 1;
    state.resolveRegistryId = null;
    state.resolveLineageId = null;
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

  it("paired benchmark: compares original 6431afd vs candidate readSessionIdentity with identical fixtures, call counts, and 35ms simulated hop delay", async () => {
    state.rpcLatencyMs = 35;
    state.authLatencyMs = 35;
    const reader = { getAll: () => state.cookies.map((c) => ({ ...c })) };
    const legacySamples: number[] = [];
    const candidateSamples: number[] = [];

    for (let i = 0; i < 6; i++) {
      // Original 6431afd baseline: 3 sequential broker RPCs + 2 sequential auth/guard calls = 5 serial waves (4 RPCs + 1 Auth call)
      state.rpcCalls = [];
      state.authCalls = [];
      const legacyStart = performance.now();
      const legacyIdentity = await readSessionIdentityBaseline6431afd(reader);
      legacySamples.push(Math.round(performance.now() - legacyStart));
      expect(state.rpcCalls).toEqual([
        "vel_broker_capability_probe",
        "vel_broker_lookup_browser_continuity",
        "vel_broker_resolve_bound_session",
        "check_app_session",
      ]);
      expect(state.authCalls).toEqual(["auth.getUser"]);

      // Candidate: same 4 RPCs + 1 Auth call executed in 2 parallel waves (wave 1: 3 broker RPCs, wave 2: getUser + check_app_session)
      state.rpcCalls = [];
      state.authCalls = [];
      const candidateStart = performance.now();
      const candidateIdentity = await readSessionIdentity();
      candidateSamples.push(Math.round(performance.now() - candidateStart));
      expect(state.rpcCalls).toHaveLength(4);
      expect([...state.rpcCalls].sort()).toEqual(
        [
          "vel_broker_capability_probe",
          "vel_broker_lookup_browser_continuity",
          "vel_broker_resolve_bound_session",
          "check_app_session",
        ].sort(),
      );
      expect(state.authCalls).toEqual(["auth.getUser"]);
      expect(candidateIdentity).toEqual(legacyIdentity);
    }

    const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const legacyAvg = avg(legacySamples);
    const candidateAvg = avg(candidateSamples);
    console.info(
      JSON.stringify({
        benchmark: "simulated_session_identity_paired_35ms_hop",
        kind: "synthetic_in_memory_simulation_not_production",
        iterations: 6,
        baseline6431afdAvgMs: legacyAvg,
        candidateAvgMs: candidateAvg,
        baseline6431afdSerialWaves: 5,
        candidateSerialWaves: 2,
        rpcCallsPerSide: 4,
        authCallsPerSide: 1,
      }),
    );
    expect(candidateAvg).toBeLessThan(legacyAvg * 0.65);
  });

  it("actual RSC render memoizes createClient/createBrokerBoundClient once for identical cookies, re-verifies on cookie change, and isolates across requests", async () => {
    const { reactServer, rscServer } = rscHolder;
    const secondHandle = newOpaqueHandle();
    const secondHash = hashHex(secondHandle);

    async function RscSameAndMutatedCookies() {
      const { cookies } = await import("next/headers");
      const store = await cookies();
      // Three calls with identical cookie snapshot within one RSC request
      const firstBound = await createBrokerBoundClient();
      const secondClient = await createClient();
      const thirdBound = await createBrokerBoundClient();
      expect(firstBound.bound.ok).toBe(true);
      expect(thirdBound.bound.ok).toBe(true);
      if (firstBound.bound.ok && thirdBound.bound.ok) {
        expect(secondClient).toBe(firstBound.bound.client);
        expect(thirdBound.bound.client).toBe(firstBound.bound.client);
      }
      const resolvesBeforeMutation = state.rpcCalls.filter(
        (c) => c === "vel_broker_resolve_bound_session",
      ).length;

      // Mutate cookie inside the same request -> must invalidate cache and re-verify
      const reqStore = requestStorage.getStore()!;
      reqStore.handleHash = secondHash;
      store.set(state.cookieName, secondHandle);
      const afterMutation = await createBrokerBoundClient();
      const afterMutationRepeat = await createBrokerBoundClient();
      const resolvesAfterMutation = state.rpcCalls.filter(
        (c) => c === "vel_broker_resolve_bound_session",
      ).length;
      const fp1 = firstBound.bound.ok ? firstBound.bound.resolve.boundary.boundaryFingerprint : "none";
      const fp2 = afterMutation.bound.ok ? afterMutation.bound.resolve.boundary.boundaryFingerprint : "none";
      const fp2Repeat = afterMutationRepeat.bound.ok
        ? afterMutationRepeat.bound.resolve.boundary.boundaryFingerprint
        : "none";
      return reactServer.createElement(
        "div",
        null,
        `before=${resolvesBeforeMutation};after=${resolvesAfterMutation};fp1=${fp1};fp2=${fp2};sameAfter=${fp2 === fp2Repeat}`,
      );
    }

    const req1Text = await requestStorage.run(
      {
        cookies: state.cookies.map((c) => ({ ...c })),
        handleHash: state.handleHash,
      },
      async () => {
        const stream = rscServer.renderToReadableStream(
          reactServer.createElement(RscSameAndMutatedCookies),
        );
        return new Response(stream).text();
      },
    );

    expect(req1Text).toContain("before=1;after=2;");
    expect(req1Text).toContain(`fp1=${boundaryFingerprint(state.handle)};fp2=${boundaryFingerprint(secondHandle)};sameAfter=true`);

    // Verify request isolation: two separate RSC requests (with identical or distinct cookies) do NOT leak cache across requests
    state.rpcCalls = [];
    const userBId = "99999999-9999-4999-8999-999999999999";
    const handleB = newOpaqueHandle();
    const hashB = hashHex(handleB);
    const jwtB = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
      JSON.stringify({ sub: userBId, session_id: state.nativeSessionId }),
    ).toString("base64url")}.sig`;
    const accessEncB = encryptSecret(jwtB)!.toString("base64");

    async function RscIsolatedRequest() {
      const bound1 = await createBrokerBoundClient();
      const bound2 = await createBrokerBoundClient();
      const uid1 = bound1.bound.ok ? bound1.bound.resolve.boundary.userId : "none";
      const uid2 = bound2.bound.ok ? bound2.bound.resolve.boundary.userId : "none";
      return reactServer.createElement("span", null, `uid=${uid1}:${uid2}`);
    }

    const [outA1, outB, outA2] = await Promise.all([
      requestStorage.run(
        {
          cookies: state.cookies.map((c) => ({ ...c })),
          userId: state.userId,
          handleHash: state.handleHash,
          accessEnc: state.accessEnc,
        },
        async () =>
          new Response(
            rscServer.renderToReadableStream(reactServer.createElement(RscIsolatedRequest)),
          ).text(),
      ),
      requestStorage.run(
        {
          cookies: [
            { name: "vel_bc", value: "A".repeat(44) },
            { name: state.cookieName, value: handleB },
          ],
          userId: userBId,
          handleHash: hashB,
          accessEnc: accessEncB,
        },
        async () =>
          new Response(
            rscServer.renderToReadableStream(reactServer.createElement(RscIsolatedRequest)),
          ).text(),
      ),
      requestStorage.run(
        {
          cookies: state.cookies.map((c) => ({ ...c })),
          userId: state.userId,
          handleHash: state.handleHash,
          accessEnc: state.accessEnc,
        },
        async () =>
          new Response(
            rscServer.renderToReadableStream(reactServer.createElement(RscIsolatedRequest)),
          ).text(),
      ),
    ]);

    expect(outA1).toContain(`uid=${state.userId}:${state.userId}`);
    expect(outB).toContain(`uid=${userBId}:${userBId}`);
    expect(outA2).toContain(`uid=${state.userId}:${state.userId}`);
    // 3 distinct RSC requests x 1 cached resolve per request = 3 resolves total (not 6, and not 1 shared across requests)
    expect(state.rpcCalls.filter((c) => c === "vel_broker_resolve_bound_session")).toHaveLength(3);
  });

  it.each(["revocation", "generation"] as const)("an explicit fresh RSC fence detects database %s with unchanged cookies", async (change) => {
    async function RscFreshFence() {
      const initial = await createBrokerBoundClient();
      if (change === "revocation") state.resolveOk = false;
      else state.continuityGeneration = 2;
      const fresh = await createBrokerBoundClient({ fresh: true });
      const resolves = state.rpcCalls.filter((name) => name === "vel_broker_resolve_bound_session").length;
      return rscHolder.reactServer.createElement("div", null, `initial=${initial.bound.ok};fresh=${fresh.bound.ok};resolves=${resolves}`);
    }
    const output = await requestStorage.run(
      { cookies: state.cookies.map((cookie) => ({ ...cookie })), handleHash: state.handleHash },
      async () => new Response(rscHolder.rscServer.renderToReadableStream(rscHolder.reactServer.createElement(RscFreshFence))).text(),
    );
    expect(output).toContain("initial=true;fresh=false;resolves=2");
  });

  it("denies access when session is revoked or lineage generation changes during parallel reads", async () => {
    // 1. Session revoked in continuity (state='revoked') while resolveBoundSession returns stale row
    state.continuityState = "revoked";
    expect(await readSessionIdentity()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    state.continuityState = "active";

    // 2. Continuity lookup fails (revoked/closed) while resolveBoundSession returns stale row
    state.continuityOk = false;
    expect(await readSessionIdentity()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    state.continuityOk = true;

    // 3. Generation changes between parallel continuity lookup (gen 2) and bound session resolve (stale gen 1)
    state.continuityGeneration = 2;
    state.resolveLineageGeneration = 1;
    expect(await readSessionIdentity()).toEqual({ ok: false, code: "UNAUTHENTICATED" });

    // 4. Generation changes in reverse order (continuity gen 1 vs bound session gen 2)
    state.continuityGeneration = 1;
    state.resolveLineageGeneration = 2;
    expect(await readSessionIdentity()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    state.resolveLineageGeneration = 1;

    // 5. Current registry tip rotates during parallel reads
    state.continuityRegistryId = "77777777-7777-4777-8777-777777777777";
    expect(await readSessionIdentity()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    state.continuityRegistryId = null;

    // 6. Browser lineage ID diverges during parallel reads
    state.continuityLineageId = "88888888-8888-4888-8888-888888888888";
    expect(await readSessionIdentity()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    state.continuityLineageId = null;

    // 7. Session revoked in check_app_session while parallel auth.getUser() succeeds with stale token
    state.guardOk = false;
    expect(await readSessionIdentity()).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      expired: true,
    });
    state.guardOk = true;

    // Restoring matching generation and active session succeeds
    expect(await readSessionIdentity()).toMatchObject({
      ok: true,
      userId: state.userId,
      generation: state.generation,
    });
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
