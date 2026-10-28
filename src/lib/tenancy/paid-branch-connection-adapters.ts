import "server-only";
import {autoPinAllowed} from "@/lib/whatsapp/auto-pin";
import {openSignupPreparation} from '@/lib/whatsapp/signup-preparation';
import { completeInstagramConnection } from "@/lib/instagram/connection-flow";
import type { AttemptBinding, ConnectionPorts } from "@/lib/instagram/connection-contracts";
import { createInstagramConnectionStore, type InstagramRpcClient } from "@/lib/instagram/connection-store";
import { exchangeInstagramCode, readInstagramOAuthConfig } from "@/lib/instagram/oauth-meta";
import { ensureInstagramSubscription } from "@/lib/instagram/subscription";
import { PAID_BRANCH_CONNECTION_ROUTING_GAP, type PaidBranchConnectionReason } from "@/lib/tenancy/paid-branch-connection-contracts";
import { paidBranchCompletionAccepted, type PaidBranchConnectionAttemptRequest } from "@/lib/tenancy/paid-branch-connection-flow";
import type { PaidBranchConnectionProof, PaidBranchConnectionRpc } from "@/lib/tenancy/paid-branch-connection-store";
import { embeddedSignupClientConfig } from "@/lib/whatsapp/embedded-signup";
import { finishEmbeddedSignup, type SignupClaim } from "@/lib/whatsapp/embedded-signup-flow";
import { onboardMetaSignup, type MetaSignupConfig } from "@/lib/whatsapp/embedded-signup-meta";
import { coexistenceServerConfig } from "@/lib/tenancy/paid-branch-connection-coexistence-config";
import { finishCoexistenceSignup, type CoexistenceSignupClaim } from "@/lib/whatsapp/coexistence/flow";
import { createCoexistenceSignupPorts, type CoexistenceSignupRpcClient } from "@/lib/whatsapp/coexistence/signup-store";

export { PAID_BRANCH_CONNECTION_ROUTING_GAP };

export type BoundProviderResult =
  | { ok: true; accessToken?: string; proof?: unknown; stageReceipt?: string | null }
  | { ok: false; code: PaidBranchConnectionReason };

/**
 * A bare `{ ok: true }` is not provider evidence. Token, proof, or a native stage receipt is required.
 */
export async function exchangeAfterCommittedClaim(
  claimed: boolean,
  exchange: () => Promise<BoundProviderResult>,
  slot: PaidBranchConnectionProof,
): Promise<{ ok: true } | { ok: false; code: PaidBranchConnectionReason }> {
  if (!claimed) return { ok: false, code: "forbidden" };
  const result = await exchange();
  if (!result.ok) return result;
  if (result.accessToken == null && result.proof == null && (result.stageReceipt == null || result.stageReceipt === "")) {
    return { ok: false, code: "reconciliation_required" };
  }
  if (result.accessToken) slot.accessToken = result.accessToken;
  if (result.proof !== undefined) slot.proof = result.proof;
  if (result.stageReceipt !== undefined) slot.stageReceipt = result.stageReceipt;
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function same(value: unknown, expected: string): boolean {
  return text(value) && value.toLowerCase() === expected;
}

function metaConfig(): (MetaSignupConfig & { configId: string }) | null {
  const config = embeddedSignupClientConfig();
  if (!config.ok) return null;
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() ?? "";
  if (!appSecret) return null;
  return { enabled: true, appId: config.appId, configId: config.configId, graphVersion: config.graphVersion, appSecret };
}

function signupClaim(legacy: Record<string, unknown>, request: PaidBranchConnectionAttemptRequest, sessionId: string): SignupClaim | null {
  if (!same(legacy.attempt_id, request.attemptId) || !same(legacy.company_id, request.companyId) || !same(legacy.user_id, request.expectedAccountId) || !same(legacy.session_id, sessionId)) return null;
  if (!text(legacy.app_id) || !text(legacy.config_id) || !text(legacy.graph_version) || typeof legacy.keep_on_phone !== "boolean") return null;
  return {
    ok: true,
    attempt_id: request.attemptId,
    company_id: request.companyId,
    user_id: request.expectedAccountId,
    session_id: sessionId,
    app_id: legacy.app_id,
    config_id: legacy.config_id,
    graph_version: legacy.graph_version,
    keep_on_phone: legacy.keep_on_phone,
  };
}

export async function exchangeOwnedBranchConnection(input: {
  request: PaidBranchConnectionAttemptRequest;
  completion: Record<string, unknown>;
  slot: PaidBranchConnectionProof;
  legacy: Record<string, unknown> | null;
  session: PaidBranchConnectionRpc;
  admin: PaidBranchConnectionRpc;
  finalize: () => Promise<{ ok: boolean; linkId?: string } | null>;
  stage: (accessToken: string, evidence: unknown) => Promise<{ ok: boolean; stageReceipt?: string } | null>;
}): Promise<BoundProviderResult> {
  const { request, completion, slot, legacy } = input;
  if (!legacy || !paidBranchCompletionAccepted(request.flow, request.attemptId, completion)) return { ok: false, code: "invalid_input" };
  const identity = { companyId: request.companyId, userId: request.expectedAccountId, sessionId: slot.sessionId };
  if (request.flow === "wa_new_number") {
    const config = metaConfig();
    const claim = signupClaim(legacy, request, slot.sessionId);
    if (!config || !claim || claim.keep_on_phone) return { ok: false, code: "setup_required" };
    const prepared=completion.authorizationTicket===undefined?undefined:openSignupPreparation(config.appSecret,completion.authorizationTicket,{accountId:request.expectedAccountId,sessionId:slot.sessionId,companyId:request.companyId,branchId:request.branchId,attemptId:request.attemptId,generation:request.generation,nonce:String(completion.nonce),wabaId:String(completion.wabaId),phoneNumberId:String(completion.phoneNumberId)});
    if(prepared===null)return {ok:false,code:'forbidden'};
    const finished = await finishEmbeddedSignup(identity, completion as never, config, {
      claim: async () => claim,
      provider: (providerInput) => onboardMetaSignup(config, providerInput,fetch,{...(prepared?{token:prepared}:{}),autoPinAllowed:()=>autoPinAllowed({companyId:request.companyId,branchId:request.branchId,phoneNumberId:providerInput.phoneNumberId})}),
      finalize: async (_claim, token, proof) => {
        slot.accessToken = token;
        slot.proof = proof;
        const saved = await input.finalize();
        return saved?.ok ? { ok: true } : { ok: false, code: "RECONCILIATION_REQUIRED" };
      },
      // Keep the claimed native attempt recoverable; do not consume the staged token on transport failure.
      fail: async () => {},
    });
    return finished.ok ? { ok: true, accessToken: slot.accessToken, proof: slot.proof } : { ok: false, code: "reconciliation_required" };
  }
  if (request.flow === "wa_coexistence") {
    const coexistenceConfig = coexistenceServerConfig();
    const claim = signupClaim(legacy, request, slot.sessionId);
    const phone = typeof legacy.expected_phone_number === "string" ? legacy.expected_phone_number : "";
    if (!coexistenceConfig || !claim || claim.keep_on_phone !== true || !/^\+[1-9]\d{6,14}$/.test(phone)) return { ok: false, code: "setup_required" };
    const coexistence: CoexistenceSignupClaim = { ...claim, keep_on_phone: true, expected_phone_number: phone, config_id: coexistenceConfig.configId };
    const guarded = branchPhaseProxy(input.admin, request);
    const ports = createCoexistenceSignupPorts(identity, completion as never, coexistenceConfig, input.session as CoexistenceSignupRpcClient, guarded as CoexistenceSignupRpcClient);
    const finished = await finishCoexistenceSignup(identity, { ...completion, confirmedPhoneNumber: phone } as never, coexistenceConfig, {
      claim: async () => coexistence,
      prepare: ports.prepare,
      checkpoint: ports.checkpoint,
      subscribe: ports.subscribe,
      finalize: async (_claim, proof) => {
        slot.proof = proof;
        const saved = await input.finalize();
        return saved?.ok ? { ok: true } : { ok: false, code: "RECONCILIATION_REQUIRED" };
      },
      fail: ports.fail,
    });
    return finished.ok ? { ok: true, proof: slot.proof } : { ok: false, code: "reconciliation_required" };
  }
  const cfg = readInstagramOAuthConfig();
  const binding = instagramBinding(legacy, request, slot.sessionId);
  if (!cfg || !binding) return { ok: false, code: "setup_required" };
  const store = createInstagramConnectionStore(input.session as InstagramRpcClient, input.admin as InstagramRpcClient);
  const ports: ConnectionPorts = {
    readProgress: (ref) => store.readProgress(ref),
    claim: async () => ({ kind: "claimed", committed: true, binding }),
    exchange: (code, ref) => exchangeInstagramCode(code, ref, cfg),
    stage: async (_ref, success) => {
      const staged = await input.stage(success.accessToken, success.evidence);
      if (!staged?.ok || !staged.stageReceipt || !UUID.test(staged.stageReceipt)) return { ok: false, code: "RECONCILIATION_REQUIRED" };
      slot.accessToken = success.accessToken;
      slot.stageReceipt = staged.stageReceipt;
      return { stageReceipt: staged.stageReceipt };
    },
    subscribe: (ref, receipt) => ensureInstagramSubscription(ref, receipt, branchPhaseProxy(input.admin, request) as InstagramRpcClient),
    finalize: async (_ref, receipt) => {
      slot.stageReceipt = receipt;
      const saved = await input.finalize();
      return saved?.ok && saved.linkId && UUID.test(saved.linkId) ? { ok: true, linkId: saved.linkId } : { ok: false, code: "RECONCILIATION_REQUIRED" };
    },
    settleClaim: (ref, outcome) => store.settleClaim(ref, outcome),
  };
  const finished = await completeInstagramConnection(identity, completion as never, binding, ports);
  return finished.ok ? { ok: true, stageReceipt: slot.stageReceipt ?? null } : { ok: false, code: "reconciliation_required" };
}

function branchPhaseProxy(admin: PaidBranchConnectionRpc, request: PaidBranchConnectionAttemptRequest): PaidBranchConnectionRpc {
  return {
    rpc(name, args) {
      if (name === "whatsapp_coexistence_checkpoint_signup") {
        return admin.rpc("es02_b3_checkpoint_owned_branch_connection", {
          p_expected_account_id: request.expectedAccountId,
          p_company_id: request.companyId,
          p_branch_id: request.branchId,
          p_channel: request.channel,
          p_flow: request.flow,
          p_attempt_id: request.attemptId,
          p_generation: request.generation,
          p_session_id: args.p_session_id,
          p_user_id: args.p_user_id,
          p_access_token: args.p_access_token,
          p_proof: args.p_proof,
        });
      }
      if (name === "instagram_claim_subscription") {
        return admin.rpc("es02_b3_claim_instagram_subscription", {
          p_expected_account_id: request.expectedAccountId,
          p_company_id: request.companyId,
          p_branch_id: request.branchId,
          p_channel: request.channel,
          p_flow: request.flow,
          p_attempt_id: request.attemptId,
          p_generation: request.generation,
          p_session_id: (args.p_binding as { sessionId?: string } | undefined)?.sessionId ?? null,
          p_binding: args.p_binding,
          p_stage_receipt: args.p_stage_receipt,
        });
      }
      return admin.rpc(name, args);
    },
  };
}

function instagramBinding(legacy: Record<string, unknown>, request: PaidBranchConnectionAttemptRequest, sessionId: string): AttemptBinding | null {
  const source = legacy.binding && typeof legacy.binding === "object" ? legacy.binding as Record<string, unknown> : legacy;
  if (!same(source.companyId ?? source.company_id, request.companyId) || !same(source.userId ?? source.user_id, request.expectedAccountId) || !same(source.sessionId ?? source.session_id, sessionId) || !same(source.attemptId ?? source.attempt_id, request.attemptId)) return null;
  if (!text(source.appId ?? source.app_id) || !text(source.contractId ?? source.contract_id)) return null;
  const generation = Number(source.generation);
  if (!Number.isSafeInteger(generation) || generation < 1) return null;
  return {
    companyId: request.companyId,
    userId: request.expectedAccountId,
    sessionId,
    attemptId: request.attemptId,
    generation,
    appId: String(source.appId ?? source.app_id),
    contractId: String(source.contractId ?? source.contract_id),
  };
}
