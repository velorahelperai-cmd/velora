import "server-only";
import { createHash } from "node:crypto";
import type {
  AttemptBinding, ConnectionFailure, ConnectionFailureCode, ConnectionPorts,
  ConnectionProgress,
} from "./connection-contracts";

/** Standard POST PostgREST RPC: resolution MUST mean transaction commit completed.
 * Do not inject an adapter that returns SQL rows before committing a transaction.
 * No retry here. An error/exception/malformed success may hide a committed result.
 */
export type InstagramRpcClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}>;
export type StartConnectionInput = Readonly<{
  companyId: string; attemptId: string; state: string; appId: string;
  contractId: string; expectedGeneration: number;
}>;
export type StartConnectionResult = Readonly<{ ok: true; binding: AttemptBinding; expiresAt: string }> | ConnectionFailure;
export type InstagramStore = Omit<ConnectionPorts, "exchange" | "subscribe">;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 128;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unavailable = (): never => { throw Error("INSTAGRAM_STORE_UNAVAILABLE"); };
const fail = (code: ConnectionFailureCode): ConnectionFailure => ({ ok: false, code });
function denial(v: Record<string, unknown>): ConnectionFailure | null {
  if (v.ok !== false) return null;
  switch (v.code) {
    case "FORBIDDEN": case "EXPIRED": case "CONSUMED": case "INVALID_INPUT": case "UNAVAILABLE": case "RECONCILIATION_REQUIRED": case "ACCOUNT_MISMATCH": return fail(v.code);
    default: return unavailable();
  }
}
function capture(v: unknown): AttemptBinding {
  try {
    if (!object(v) || ![v.companyId, v.userId, v.sessionId, v.attemptId].every(uuid)
      || !text(v.appId) || !text(v.contractId) || !Number.isSafeInteger(v.generation) || (v.generation as number) < 1) return unavailable();
    return Object.freeze({ companyId: v.companyId as string, userId: v.userId as string,
      sessionId: v.sessionId as string, attemptId: v.attemptId as string, generation: v.generation as number,
      appId: v.appId, contractId: v.contractId });
  } catch { return unavailable(); }
}
function exact(v: unknown, b: AttemptBinding): AttemptBinding {
  const got = capture(v);
  if ((Object.keys(b) as (keyof AttemptBinding)[]).some(key => got[key] !== b[key])) return unavailable();
  return got;
}
function progress(v: unknown, b: AttemptBinding): ConnectionProgress {
  if (!object(v)) return unavailable();
  const binding = exact(v.binding, b);
  switch (v.kind) {
    case "pending": case "claimed": case "rejected": case "unknown": case "expired": case "cancelled": return { kind: v.kind, binding };
    case "bound": return uuid(v.linkId) ? { kind: "bound", binding, linkId: v.linkId } : unavailable();
    case "vault_staged": return uuid(v.stageReceipt) ? { kind: "vault_staged", binding, stageReceipt: v.stageReceipt } : unavailable();
    default: return unavailable();
  }
}
async function rpc<T>(client: InstagramRpcClient, name: string, args: Record<string, unknown>, parse: (data: Record<string, unknown>) => T): Promise<T> {
  try {
    const response = await client.rpc(name, args);
    if (response.error || !object(response.data)) return unavailable();
    return parse(response.data);
  } catch { return unavailable(); }
}

/** Session client carries the native verified user's JWT; server client stays on
 * server only. This is not a Server Action and performs no provider exchange.
 * SQL rechecks exact binding and current authority; browser identity is never proof.
 */
export function createInstagramConnectionStore(session: InstagramRpcClient, server: InstagramRpcClient): InstagramStore {
  return {
    readProgress: async supplied => {
      const b = capture(supplied);
      return rpc(session, "instagram_read_connection", { p_binding: b }, data => progress(data, b));
    },
    claim: async (supplied, state) => {
      const b = capture(supplied);
      if (!/^[0-9a-f]{64}$/.test(state)) return fail("INVALID_INPUT");
      return rpc(session, "instagram_claim_connection", { p_binding: b, p_nonce: state }, data => {
        const denied = denial(data); if (denied) return denied;
        if (data.kind === "existing") return { kind: "existing", progress: progress(data.progress, b) };
        if (data.kind !== "claimed" || data.committed !== true) return unavailable();
        return { kind: "claimed", committed: true, binding: exact(data.binding, b) };
      });
    },
    stage: async (supplied, success) => {
      try {
        const b = capture(supplied);
        return await rpc(server, "instagram_stage_connection", { p_binding: b, p_access_token: success.accessToken,
          p_evidence: { appId: success.evidence.appId, accountId: success.evidence.accountId,
            permissions: [...success.evidence.permissions], expiresAt: success.evidence.expiresAt, contractId: success.evidence.contractId } }, data => {
          const denied = denial(data); if (denied) return denied;
          return uuid(data.stageReceipt) ? { stageReceipt: data.stageReceipt } : unavailable();
        });
      } catch { return unavailable(); }
    },
    finalize: async (supplied, receipt) => {
      const b = capture(supplied);
      if (!uuid(receipt)) return fail("INVALID_INPUT");
      return rpc(server, "instagram_finalize_connection", { p_binding: b, p_stage_receipt: receipt }, data => {
        const denied = denial(data); if (denied) return denied;
        return data.ok === true && uuid(data.linkId) ? { ok: true, linkId: data.linkId } : unavailable();
      });
    },
    settleClaim: async (supplied, outcome) => {
      const b = capture(supplied);
      if (outcome !== "unknown" && outcome !== "rejected") return unavailable();
      return rpc(server, "instagram_settle_connection", { p_binding: b, p_outcome: outcome }, data => progress(data, b));
    },
  };
}
/** State is a fresh 256-bit server-generated nonce. Persist only its hash.
 * expectedGeneration is read by a future verified action; a stale start is denied.
 * An existing operation UUID is replayed exactly, never allocated anew on retry.
 */
export async function startInstagramConnection(client: InstagramRpcClient, input: StartConnectionInput): Promise<StartConnectionResult> {
  try {
    const { companyId, attemptId, state, appId, contractId, expectedGeneration } = input;
    if (!uuid(companyId) || !uuid(attemptId) || typeof state !== "string" || !/^[0-9a-f]{64}$/.test(state)
      || !text(appId) || !text(contractId) || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || expectedGeneration >= Number.MAX_SAFE_INTEGER) return fail("INVALID_INPUT");
    return await rpc(client, "instagram_start_connection", { p_company_id: companyId, p_attempt_id: attemptId,
      p_nonce_hash: createHash("sha256").update(state).digest("hex"), p_app_id: appId, p_contract_id: contractId,
      p_expected_generation: expectedGeneration }, data => {
      const denied = denial(data); if (denied) return denied;
      if (data.ok !== true || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))) return unavailable();
      const binding = capture(data.binding);
      if (binding.companyId !== companyId || binding.attemptId !== attemptId || binding.appId !== appId
        || binding.contractId !== contractId || binding.generation !== expectedGeneration + 1) return unavailable();
      return { ok: true, binding, expiresAt: data.expiresAt };
    });
  } catch { return fail("RECONCILIATION_REQUIRED"); }
}
export async function cancelInstagramConnection(client: InstagramRpcClient, supplied: AttemptBinding): Promise<ConnectionProgress | ConnectionFailure> {
  const b = capture(supplied);
  return rpc(client, "instagram_cancel_connection", { p_binding: b }, data => denial(data) ?? progress(data, b));
}
/** Secret-bearing SERVER INTERNAL result. Never wire to a client/Server Action.
 * Bound to the exact persisted link/account/company/generation/OAuth user/session.
 * Later manual-send authority is a separate gate; this does not authorize sending.
 */
export async function readInstagramConnectionSecret(server: InstagramRpcClient, supplied: AttemptBinding, linkId: string, accountId: string): Promise<Readonly<{ ok: true; accessToken: string }> | ConnectionFailure> {
  const b = capture(supplied);
  if (!uuid(linkId) || !text(accountId)) return fail("INVALID_INPUT");
  return rpc(server, "instagram_secret_connection", { p_binding: b, p_link_id: linkId, p_account_id: accountId }, data => {
    const denied = denial(data); if (denied) return denied;
    if (data.ok !== true || typeof data.accessToken !== "string" || data.accessToken.trim() === "" || data.accessToken.length > 16384) return unavailable();
    return { ok: true, accessToken: data.accessToken };
  });
}
