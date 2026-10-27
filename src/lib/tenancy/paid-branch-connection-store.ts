import {
  parsePaidBranchConnectionLaunch,
  parsePaidBranchConnectionRead,
  parsePaidBranchConnectionScope,
  unavailablePaidBranchConnectionRead,
  type PaidBranchConnectionFlow,
  type PaidBranchConnectionReason,
  type PaidBranchConnectionScope,
} from "@/lib/tenancy/paid-branch-connection-contracts";
import type { PaidBranchConnectionAttemptRequest, PaidBranchConnectionCommandResult, PaidBranchConnectionStartRequest, PaidBranchConnectionStorePorts } from "@/lib/tenancy/paid-branch-connection-flow";
import {logEvent} from '@/lib/logging/logger.mjs';

export type PaidBranchConnectionRpc = {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const REASONS = new Set<PaidBranchConnectionReason>([
  "invalid_input", "account_mismatch", "forbidden", "unpaid", "suspended", "selection_required", "channel_not_selected",
  "stale_scope", "expired", "conflict", "legacy_ambiguous", "reconciliation_required", "setup_required", "source_failed", "unauthenticated",
]);

function reason(code: unknown): PaidBranchConnectionReason {
  const normalized = String(code ?? "").toLowerCase();
  return REASONS.has(normalized as PaidBranchConnectionReason) ? normalized as PaidBranchConnectionReason : "source_failed";
}

function mutation(scope: PaidBranchConnectionScope, data: unknown, flow?: PaidBranchConnectionFlow): PaidBranchConnectionCommandResult | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const read = parsePaidBranchConnectionRead(row.read, scope);
  if (!read) return null;
  if (row.ok === true) {
    const legacy = row.legacy && typeof row.legacy === "object" && !Array.isArray(row.legacy) ? row.legacy as Record<string, unknown> : undefined;
    const fresh = row.fresh === true ? true : row.fresh === false ? false : undefined;
    if (flow) {
      const attemptId = read.connection.attempt?.id;
      const launch = attemptId ? parsePaidBranchConnectionLaunch(flow, row.launch, attemptId) : null;
      if (!launch) return null;
      return { ok: true, read, launch, ...(fresh === undefined ? {} : { fresh }), ...(legacy ? { legacy } : {}) };
    }
    return { ok: true, read, ...(fresh === undefined ? {} : { fresh }), ...(legacy ? { legacy } : {}) };
  }
  if (row.ok === false) return { ok: false, code: reason(row.code), read };
  return null;
}

async function call(client: PaidBranchConnectionRpc, name: string, args: Record<string, unknown>, scope: PaidBranchConnectionScope, asOf: string, flow?: PaidBranchConnectionFlow): Promise<PaidBranchConnectionCommandResult | null> {
  try {
    const result = await client.rpc(name, args);
    if (result.error) {
      if(name==='es02_b3_cancel_owned_branch_connection'&&process.env.NODE_ENV==='development'&&process.env.NEXT_PUBLIC_SITE_URL==='http://127.0.0.1:3330'){
        const error=result.error as {code?:unknown};
        logEvent('warn','es02.branch_connection.local_cancel_rpc_error',{error_code:typeof error.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'UNAVAILABLE'});
      }
      return { ok: false, code: "source_failed", read: unavailablePaidBranchConnectionRead(scope, asOf, "source_failed") };
    }
    return mutation(scope, result.data, flow);
  } catch {
    return null;
  }
}

export type PaidBranchConnectionProof = {
  sessionId: string;
  accessToken?: string;
  proof?: unknown;
  stageReceipt?: string | null;
};

function attachInstagramAuthorization(data: unknown, build: ((state: string) => string | null) | undefined): unknown {
  if (!data || typeof data !== "object") return data;
  const row = data as Record<string, unknown>;
  if (row.ok !== true || !row.launch || typeof row.launch !== "object") return data;
  const launch = row.launch as Record<string, unknown>;
  if (launch.flow !== "instagram_direct" || typeof launch.state !== "string") return data;
  const authorizationUrl = build?.(launch.state) ?? null;
  if (!authorizationUrl?.startsWith("https://")) return { ...row, ok: false, code: "setup_required" };
  return { ...row, launch: { ...launch, authorizationUrl } };
}

export function createPaidBranchConnectionStore(client: PaidBranchConnectionRpc, proof: PaidBranchConnectionRpc, asOf: string, proofPayload: PaidBranchConnectionProof = { sessionId: "" }): PaidBranchConnectionStorePorts {
  return {
    read: async (scope) => {
      try {
        const result = await client.rpc("es02_b3_read_owned_branch_connection", {
          p_expected_account_id: scope.expectedAccountId,
          p_company_id: scope.companyId,
          p_branch_id: scope.branchId,
          p_channel: scope.channel,
        });
        if (result.error) return null;
        return parsePaidBranchConnectionRead(result.data, scope);
      } catch {
        return null;
      }
    },
    start: async (input: PaidBranchConnectionStartRequest) => {
      const args = {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
      p_channel: input.channel,
      p_flow: input.flow,
      p_client_op_id: input.clientOpId,
      p_expected_revision: input.expectedRevision,
      p_confirmed_phone_number: input.confirmedPhoneNumber ?? null,
      p_app_id: input.appId ?? null,
      p_config_id: input.configId ?? null,
      p_graph_version: input.graphVersion ?? null,
      p_nonce: input.nonce ?? null,
      p_oauth_state: input.oauthState ?? null,
      p_contract_id: input.contractId ?? null,
      p_session_id: input.sessionId ?? null,
      p_confirmed: input.confirmed === true,
      };
      try {
        const result = await client.rpc("es02_b3_start_owned_branch_connection", args);
        if (result.error) return { ok: false as const, code: "source_failed" as const, read: unavailablePaidBranchConnectionRead(input, asOf, "source_failed") };
        const data = input.flow === "instagram_direct" ? attachInstagramAuthorization(result.data, input.buildAuthorizationUrl) : result.data;
        return mutation(input, data, input.flow);
      } catch {
        return null;
      }
    },
    claim: (input) => call(client, "es02_b3_claim_owned_branch_connection", {
      ...attemptArgs(input),
      p_nonce: input.nonce ?? null,
      p_oauth_state: input.oauthState ?? null,
    }, input, asOf),
    finalize: (input) => call(proof, "es02_b3_finalize_owned_branch_connection", {
      ...attemptArgs(input),
      p_session_id: proofPayload.sessionId,
      p_access_token: proofPayload.accessToken ?? null,
      p_proof: proofPayload.proof ?? null,
      p_stage_receipt: proofPayload.stageReceipt ?? null,
    }, input, asOf),
    recover: (input) => call(client, "es02_b3_recover_owned_branch_connection", attemptArgs(input), input, asOf),
    cancel: (input) => call(client, "es02_b3_cancel_owned_branch_connection", {
      ...attemptArgs(input),
      p_oauth_state: input.oauthState ?? null,
    }, input, asOf),
    exchange: async () => ({ ok: false, code: "source_failed" }),
  };
}

function attemptArgs(input: PaidBranchConnectionAttemptRequest): Record<string, unknown> {
  return {
    p_expected_account_id: input.expectedAccountId,
    p_company_id: input.companyId,
    p_branch_id: input.branchId,
    p_channel: input.channel,
    p_flow: input.flow,
    p_attempt_id: input.attemptId,
    p_generation: input.generation,
  };
}

export type InstagramAttemptClass =
  | { kind: "legacy" }
  | { kind: "unavailable" }
  | { kind: "branch"; scope: PaidBranchConnectionScope; generation: number; flow: "instagram_direct" };

export async function classifyInstagramAttempt(client: PaidBranchConnectionRpc, attemptId: string): Promise<InstagramAttemptClass> {
  try {
    const result = await client.rpc("es02_b3_classify_instagram_attempt", { p_attempt_id: attemptId });
    if (result.error || !result.data || typeof result.data !== "object") return { kind: "unavailable" };
    const row = result.data as Record<string, unknown>;
    if (row.kind === "legacy") return { kind: "legacy" };
    const scope = parsePaidBranchConnectionScope(row);
    if (row.kind !== "branch" || !scope || scope.channel !== "instagram" || row.flow !== "instagram_direct" || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1) return { kind: "unavailable" };
    return { kind: "branch", scope, generation: Number(row.generation), flow: "instagram_direct" };
  } catch {
    return { kind: "unavailable" };
  }
}
