"use server";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import type {
  BranchHoursCopyDraft,
  BranchHoursSaveDraft,
  BranchHoursScope,
} from "./branch-hours-contracts";
import {
  runBranchHoursCopy,
  runBranchHoursRead,
  runBranchHoursSave,
} from "./branch-hours-flow";
import type {
  BranchHoursCopyResult,
  BranchHoursReadResult,
  BranchHoursSaveResult,
} from "./branch-hours-service-contracts";
import {
  createBranchHoursStore,
  type BranchHoursRpc,
} from "./branch-hours-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logHoursFailure(operation: string, code: string, requestId: string) {
  logEvent("warn", "es02.branch_hours.failed", {
    request_id: requestId,
    operation,
    error_code: code,
    stage: "b4",
  });
}

type SessionClientSuccess = {
  client: BranchHoursRpc;
  timing: {
    identityMs: number;
    clientMs: number;
    claimsMs: number;
  };
};

type SessionClientFailure = {
  ok: false;
  code: "unauthenticated" | "forbidden";
};

async function sessionClient(
  expectedAccountId: string,
  requestId: string
): Promise<SessionClientSuccess | SessionClientFailure> {
  const t0 = Date.now();
  let identityMs = 0, clientMs = 0;
  // Concurrently resolve session identity and create client to eliminate sequential network roundtrips
  const [identityResult, clientResult] = await Promise.allSettled([
    readSessionIdentity().finally(() => { identityMs = Date.now() - t0; }),
    createClient().finally(() => { clientMs = Date.now() - t0; }),
  ]);


  if (identityResult.status !== "fulfilled") {
    logHoursFailure("session", "unauthenticated", requestId);
    return { ok: false, code: "unauthenticated" };
  }

  const identity = identityResult.value;
  if (!identity.ok || identity.userId !== expectedAccountId) {
    const code = identity.ok ? "forbidden" : "unauthenticated";
    logHoursFailure("session", code, requestId);
    return { ok: false, code };
  }

  if (clientResult.status !== "fulfilled") {
    logHoursFailure("session", "unauthenticated", requestId);
    return { ok: false, code: "unauthenticated" };
  }

  const client = clientResult.value;

  const tClaims = Date.now();
  const claims = await client.auth.getClaims();
  const claimsMs = Date.now() - tClaims;
  if (claims.error || claims.data?.claims?.sub !== expectedAccountId) {
    logHoursFailure("session", "forbidden", requestId);
    return { ok: false, code: "forbidden" };
  }

  return {
    client: client as unknown as BranchHoursRpc,
    timing: { identityMs, clientMs, claimsMs },
  };
}

export async function readOwnedBranchHoursAction(
  scope: BranchHoursScope
): Promise<BranchHoursReadResult> {
  const requestId = randomUUID();
  const accountId = scope?.expectedAccountId;
  const tTotalStart = Date.now();
  return withLogContext({ request_id: requestId, user_id: accountId }, async () => {
    if (!accountId || !UUID.test(accountId)) {
      logHoursFailure("read", "invalid_input", requestId);
      return { ok: false, code: "invalid_input", snapshot: null };
    }
    const session = await sessionClient(accountId, requestId);
    if ("ok" in session) {
      return { ok: false, code: session.code, snapshot: null };
    }
    const store = createBranchHoursStore(session.client);
    const tRpc = Date.now();
    const result = await runBranchHoursRead(scope, store);
    const rpcMs = Date.now() - tRpc;
    const totalMs = Date.now() - tTotalStart;

    logEvent("info", "es02.branch_hours.timing", {
      request_id: requestId,
      operation: "read",
      identity_ms: session.timing.identityMs,
      client_ms: session.timing.clientMs,
      claims_ms: session.timing.claimsMs,
      rpc_ms: rpcMs,
      total_ms: totalMs,
      ok: result.ok,
    });

    if (!result.ok) {
      logHoursFailure("read", result.code, requestId);
    }
    return result;
  });
}

export async function saveOwnedBranchHoursAction(
  draft: BranchHoursSaveDraft
): Promise<BranchHoursSaveResult> {
  const requestId = randomUUID();
  const accountId = draft?.scope?.expectedAccountId;
  const tTotalStart = Date.now();
  return withLogContext({ request_id: requestId, user_id: accountId }, async () => {
    if (!accountId || !UUID.test(accountId)) {
      logHoursFailure("save", "invalid_input", requestId);
      return { ok: false, code: "invalid_input" };
    }
    const session = await sessionClient(accountId, requestId);
    if ("ok" in session) {
      return { ok: false, code: session.code };
    }
    const store = createBranchHoursStore(session.client);
    const tRpc = Date.now();
    const result = await runBranchHoursSave(draft, store);
    const rpcMs = Date.now() - tRpc;
    const totalMs = Date.now() - tTotalStart;

    logEvent("info", "es02.branch_hours.timing", {
      request_id: requestId,
      operation: "save",
      identity_ms: session.timing.identityMs,
      client_ms: session.timing.clientMs,
      claims_ms: session.timing.claimsMs,
      rpc_ms: rpcMs,
      total_ms: totalMs,
      ok: result.ok,
    });

    if (!result.ok) {
      logHoursFailure("save", result.code, requestId);
    }
    return result;
  });
}

export async function copyOwnedBranchHoursAction(
  draft: BranchHoursCopyDraft
): Promise<BranchHoursCopyResult> {
  const requestId = randomUUID();
  const accountId = draft?.source?.scope?.expectedAccountId;
  const tTotalStart = Date.now();
  return withLogContext({ request_id: requestId, user_id: accountId }, async () => {
    if (!accountId || !UUID.test(accountId)) {
      logHoursFailure("copy", "invalid_input", requestId);
      return { ok: false, code: "invalid_input", targets: [] };
    }
    const session = await sessionClient(accountId, requestId);
    if ("ok" in session) {
      return { ok: false, code: session.code, targets: [] };
    }
    const store = createBranchHoursStore(session.client);
    const tRpc = Date.now();
    const result = await runBranchHoursCopy(draft, store);
    const rpcMs = Date.now() - tRpc;
    const totalMs = Date.now() - tTotalStart;

    logEvent("info", "es02.branch_hours.timing", {
      request_id: requestId,
      operation: "copy",
      identity_ms: session.timing.identityMs,
      client_ms: session.timing.clientMs,
      claims_ms: session.timing.claimsMs,
      rpc_ms: rpcMs,
      total_ms: totalMs,
      ok: result.ok,
    });

    if (!result.ok) {
      logHoursFailure("copy", result.code, requestId);
    }
    return result;
  });
}
