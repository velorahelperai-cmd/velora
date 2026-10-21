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

async function sessionClient(
  expectedAccountId: string,
  requestId: string
): Promise<{ client: BranchHoursRpc } | { ok: false; code: "unauthenticated" | "forbidden" }> {
  const identity = await readSessionIdentity();
  if (!identity.ok || identity.userId !== expectedAccountId) {
    const code = identity.ok ? "forbidden" : "unauthenticated";
    logHoursFailure("session", code, requestId);
    return { ok: false, code };
  }
  const client = await createClient();
  const claims = await client.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== expectedAccountId) {
    logHoursFailure("session", "forbidden", requestId);
    return { ok: false, code: "forbidden" };
  }
  return { client: client as unknown as BranchHoursRpc };
}

export async function readOwnedBranchHoursAction(
  scope: BranchHoursScope
): Promise<BranchHoursReadResult> {
  const requestId = randomUUID();
  const accountId = scope?.expectedAccountId;
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
    const result = await runBranchHoursRead(scope, store);
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
    const result = await runBranchHoursSave(draft, store);
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
  return withLogContext({ request_id: requestId, user_id: accountId }, async () => {
    if (!accountId || !UUID.test(accountId)) {
      logHoursFailure("copy", "invalid_input", requestId);
      return { ok: false, code: "invalid_input" };
    }
    const session = await sessionClient(accountId, requestId);
    if ("ok" in session) {
      return { ok: false, code: session.code };
    }
    const store = createBranchHoursStore(session.client);
    const result = await runBranchHoursCopy(draft, store);
    if (!result.ok) {
      logHoursFailure("copy", result.code, requestId);
    }
    return result;
  });
}
