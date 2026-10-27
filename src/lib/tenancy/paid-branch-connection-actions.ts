"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { instagramAuthorizationUrl, readInstagramOAuthConfig } from "@/lib/instagram/oauth-meta";
import { INSTAGRAM_ATTEMPT_COOKIE } from "@/lib/instagram/oauth-route";
import { embeddedSignupClientConfig } from "@/lib/whatsapp/embedded-signup";
import {onboardMetaSignup} from '@/lib/whatsapp/embedded-signup-meta';
import {sealSignupPreparation,openSignupPreparation} from '@/lib/whatsapp/signup-preparation';
import { exchangeAfterCommittedClaim, exchangeOwnedBranchConnection } from "@/lib/tenancy/paid-branch-connection-adapters";
import { coexistenceServerConfig } from "@/lib/tenancy/paid-branch-connection-coexistence-config";
import {
  unavailablePaidBranchConnectionRead,
  type CompleteOwnedPaidBranchConnectionInput,
  type PaidBranchConnectionDenial,
  type PaidBranchConnectionFlow,
  type PaidBranchConnectionMutation,
  type PaidBranchConnectionRead,
  type PaidBranchConnectionScope,
  type PaidBranchConnectionStartResult,
  type StartOwnedPaidBranchConnectionInput,
} from "@/lib/tenancy/paid-branch-connection-contracts";
import {
  paidBranchCompletionAccepted,
  parseConnectionAttempt,
  parseConnectionStart,
  runPaidBranchConnectionCancel,
  runPaidBranchConnectionComplete,
  runPaidBranchConnectionRead,
  runPaidBranchConnectionRecover,
  runPaidBranchConnectionStart,
  type PaidBranchConnectionAttemptRequest,
  type PaidBranchConnectionCommandResult,
} from "@/lib/tenancy/paid-branch-connection-flow";
import {
  classifyInstagramAttempt,
  createPaidBranchConnectionStore,
  type PaidBranchConnectionProof,
  type PaidBranchConnectionRpc,
} from "@/lib/tenancy/paid-branch-connection-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logFailure(operation: string, code: string, requestId: string) {
  logEvent("warn", "es02.branch_connection.failed", { request_id: requestId, operation, error_code: code, stage: "b3" });
}

async function sessionClient(expectedAccountId: string, requestId: string, asOf: string, scope: Partial<PaidBranchConnectionScope>): Promise<{ client: PaidBranchConnectionRpc; sessionId: string } | PaidBranchConnectionDenial> {
  const identity = await readSessionIdentity();
  if (!identity.ok || identity.userId !== expectedAccountId) {
    const code = identity.ok ? "account_mismatch" : identity.code === "UNAUTHENTICATED" ? "unauthenticated" : "source_failed";
    logFailure("session", code, requestId);
    return { ok: false, code, read: unavailablePaidBranchConnectionRead(scope, asOf, code) };
  }
  const client = await createClient();
  const claims = await client.auth.getClaims();
  const sessionId = claims.data?.claims?.session_id;
  if (claims.error || claims.data?.claims?.sub !== expectedAccountId || typeof sessionId !== "string" || !UUID.test(sessionId)) {
    logFailure("session", "forbidden", requestId);
    return { ok: false, code: "forbidden", read: unavailablePaidBranchConnectionRead(scope, asOf, "forbidden") };
  }
  return { client: client as unknown as PaidBranchConnectionRpc, sessionId: sessionId.toLowerCase() };
}

export async function readOwnedPaidBranchConnectionAction(scope: PaidBranchConnectionScope): Promise<PaidBranchConnectionRead> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  return withLogContext({ request_id: requestId, user_id: scope?.expectedAccountId }, async () => {
    const parsed = parseConnectionStart({ ...scope, flow: scope?.channel === "instagram" ? "instagram_direct" : "wa_new_number", clientOpId: "00000000-0000-4000-8000-000000000000", expectedRevision: "0" }, asOf);
    if ("ok" in parsed) return parsed.read;
    const session = await sessionClient(parsed.expectedAccountId, requestId, asOf, parsed);
    if ("ok" in session) return session.read;
    const result = await runPaidBranchConnectionRead(parsed, createPaidBranchConnectionStore(session.client, session.client, asOf), asOf);
    return result.read;
  });
}

export async function startOwnedPaidBranchConnectionAction(input: StartOwnedPaidBranchConnectionInput): Promise<PaidBranchConnectionStartResult | PaidBranchConnectionDenial> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    const parsed = parseConnectionStart(input, asOf);
    if ("ok" in parsed) return parsed;
    if (parsed.flow === "wa_coexistence" && parsed.confirmed !== true) return { ok: false, code: "invalid_input", read: unavailablePaidBranchConnectionRead(parsed, asOf, "invalid_input") };
    const session = await sessionClient(parsed.expectedAccountId, requestId, asOf, parsed);
    if ("ok" in session) return session;
    const material = serverLaunch(parsed.flow);
    if (!material) return { ok: false, code: "setup_required", read: unavailablePaidBranchConnectionRead(parsed, asOf, "setup_required") };
    const store = createPaidBranchConnectionStore(session.client, session.client, asOf, { sessionId: session.sessionId });
    const started = await runPaidBranchConnectionStart(parsed, {
      ...store,
      start: (request) => store.start({ ...request, ...material, sessionId: session.sessionId }),
    }, asOf);
    if (!started.ok || !started.launch || started.launch.attemptId !== started.read.connection.attempt?.id || started.launch.flow !== parsed.flow) {
      return started.ok ? { ok: false, code: "setup_required", read: started.read } : started;
    }
    if (started.launch.flow === "instagram_direct") {
      (await cookies()).set(INSTAGRAM_ATTEMPT_COOKIE, started.launch.attemptId, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/api/instagram/oauth/callback",
        maxAge: 600,
      });
    }
    return { ok: true, read: started.read, launch: started.launch };
  });
}

/** Read provider registration state after Facebook authorization, before the native completion claim. */
export async function prepareOwnedWhatsappRegistrationAction(input:CompleteOwnedPaidBranchConnectionInput):Promise<{ok:true;registrationRequired:boolean;authorizationTicket:string}|{ok:false}>{
 const asOf=new Date().toISOString(),request=attemptRequest(input,asOf);
 if('ok' in request||request.flow!=='wa_new_number')return {ok:false};
 const row=input.completion as Record<string,unknown>;
 if(!row||row.attemptId!==request.attemptId||typeof row.nonce!=='string'||!/^[0-9a-f]{64}$/.test(row.nonce)||typeof row.code!=='string'||!row.code||row.code.length>4096||typeof row.wabaId!=='string'||!/^\d{1,64}$/.test(row.wabaId)||typeof row.phoneNumberId!=='string'||!/^\d{1,64}$/.test(row.phoneNumberId)||row.pin!==''||row.authorizationTicket!==undefined)return {ok:false};
 const session=await sessionClient(request.expectedAccountId,randomUUID(),asOf,request);if('ok' in session)return {ok:false};
 const current=await runPaidBranchConnectionRead(request,createPaidBranchConnectionStore(session.client,session.client,asOf),asOf);
 const attempt=current.read.connection.attempt;
 if(current.read.sourceStatus!=='ready'||current.read.connection.flow!=='wa_new_number'||attempt?.id!==request.attemptId||attempt.generation!==request.generation||attempt.status!=='pending'||Date.parse(attempt.expiresAt)<=Date.now())return {ok:false};
 const config=embeddedSignupClientConfig(),appSecret=process.env.WHATSAPP_APP_SECRET?.trim()??'',systemUserToken=process.env.WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN?.trim()??'';
 if(!config.ok||!appSecret||!systemUserToken)return {ok:false};
 let captured:{token:string;registrationRequired:boolean}|null=null;
 await onboardMetaSignup({...config,enabled:true,appSecret,systemUserToken},{code:String(row.code),wabaId:String(row.wabaId),phoneNumberId:String(row.phoneNumberId),pin:'',keepOnPhone:false},fetch,{probe:true,capture:(token,registrationRequired)=>{captured={token,registrationRequired};}});
 if(!captured)return {ok:false};
 const result=captured as {token:string;registrationRequired:boolean};
 return {ok:true,registrationRequired:result.registrationRequired,authorizationTicket:sealSignupPreparation(appSecret,{accountId:request.expectedAccountId,sessionId:session.sessionId,companyId:request.companyId,branchId:request.branchId,attemptId:request.attemptId,generation:request.generation,nonce:String(row.nonce),wabaId:String(row.wabaId),phoneNumberId:String(row.phoneNumberId)},result.token)};
}

export async function completeOwnedPaidBranchConnectionAction(input: CompleteOwnedPaidBranchConnectionInput): Promise<PaidBranchConnectionMutation> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    const request = attemptRequest(input, asOf);
    if ("ok" in request) return request;
    if (!paidBranchCompletionAccepted(request.flow, request.attemptId, input.completion)) {
      return { ok: false, code: "invalid_input", read: unavailablePaidBranchConnectionRead(request, asOf, "invalid_input") };
    }
    const session = await sessionClient(request.expectedAccountId, requestId, asOf, request);
    if ("ok" in session) return session;
    const completion=input.completion as unknown as Record<string,unknown>;
    if(request.flow==='wa_new_number'&&completion.authorizationTicket!==undefined&&!openSignupPreparation(process.env.WHATSAPP_APP_SECRET?.trim()??'',completion.authorizationTicket,{accountId:request.expectedAccountId,sessionId:session.sessionId,companyId:request.companyId,branchId:request.branchId,attemptId:request.attemptId,generation:request.generation,nonce:String(completion.nonce),wabaId:String(completion.wabaId),phoneNumberId:String(completion.phoneNumberId)})){
      const current=await runPaidBranchConnectionRead(request,createPaidBranchConnectionStore(session.client,session.client,asOf),asOf);
      return {ok:false,code:'invalid_input',read:current.read};
    }
    const admin = createAdminClient();
    if (!admin) return { ok: false, code: "setup_required", read: unavailablePaidBranchConnectionRead(request, asOf, "setup_required") };
    const proof = admin as unknown as PaidBranchConnectionRpc;
    const slot: PaidBranchConnectionProof = { sessionId: session.sessionId };
    const store = createPaidBranchConnectionStore(session.client, proof, asOf, slot);
    let claimed: PaidBranchConnectionCommandResult | null = null;
    const claim = store.claim;
    store.claim = async (value) => {
      const row = input.completion as unknown as Record<string, unknown>;
      const result = await claim({
        ...value,
        nonce: typeof row.nonce === "string" ? row.nonce : undefined,
        oauthState: typeof row.state === "string" ? row.state : undefined,
      });
      claimed = result;
      return result;
    };
    store.exchange = () => exchangeAfterCommittedClaim(claimed?.ok === true && claimed.fresh === true, () => exchangeOwnedBranchConnection({
      request,
      completion: input.completion as unknown as Record<string, unknown>,
      slot,
      legacy: claimed?.legacy ?? null,
      session: session.client,
      admin: proof,
      finalize: async () => {
        const saved = await store.finalize(request);
        return saved ? { ok: saved.ok, linkId: saved.ok ? saved.read.connection.link?.id : undefined } : null;
      },
      stage: (accessToken, evidence) => stageOwnedConnection(proof, request, slot.sessionId, accessToken, evidence),
    }), slot);
    return publicMutation(await runPaidBranchConnectionComplete(request, store, asOf));
  });
}

export async function recoverOwnedPaidBranchConnectionAction(input: PaidBranchConnectionScope & { flow: PaidBranchConnectionFlow; attemptId: string; generation: number }): Promise<PaidBranchConnectionMutation> {
  return attemptMutation(input, "recover");
}

export async function cancelOwnedPaidBranchConnectionAction(input: PaidBranchConnectionScope & { flow: PaidBranchConnectionFlow; attemptId: string; generation: number; oauthState?: string }): Promise<PaidBranchConnectionMutation> {
  return attemptMutation(input, "cancel");
}

export async function classifyOwnedInstagramAttempt(attemptId: string): Promise<"legacy" | "branch" | "unavailable"> {
  if (!UUID.test(attemptId)) return "unavailable";
  try {
    const classified = await classifyInstagramAttempt(await createClient() as unknown as PaidBranchConnectionRpc, attemptId);
    return classified.kind;
  } catch {
    return "unavailable";
  }
}

export async function completeOwnedInstagramCallback(input: { attemptId: string; state: string; code: string }): Promise<{ ok: true } | { ok: false; code: string }> {
  return instagramCallback(input, false);
}

export async function cancelOwnedInstagramCallback(input: { attemptId: string; state: string }): Promise<{ ok: boolean }> {
  const result = await instagramCallback({ ...input, code: "" }, true);
  return { ok: result.ok };
}

async function instagramCallback(input: { attemptId: string; state: string; code: string }, cancel: boolean): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!UUID.test(input?.attemptId ?? "") || !/^[a-f0-9]{64}$/.test(input?.state ?? "")) return { ok: false, code: "UNAVAILABLE" };
  try {
    const classified = await classifyInstagramAttempt(await createClient() as unknown as PaidBranchConnectionRpc, input.attemptId);
    if (classified.kind !== "branch") return { ok: false, code: "UNAVAILABLE" };
    const identity = await readSessionIdentity();
    if (!identity.ok) return { ok: false, code: "UNAVAILABLE" };
    const common = { ...classified.scope, expectedAccountId: identity.userId, flow: classified.flow, attemptId: input.attemptId, generation: classified.generation };
    const result = cancel
      ? await cancelOwnedPaidBranchConnectionAction({ ...common, oauthState: input.state })
      : await completeOwnedPaidBranchConnectionAction({ ...common, completion: { attemptId: input.attemptId, state: input.state, code: input.code } });
    return result.ok ? { ok: true } : { ok: false, code: result.code.toUpperCase() };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

async function attemptMutation(input: PaidBranchConnectionScope & { flow: PaidBranchConnectionFlow; attemptId: string; generation: number; oauthState?: string }, kind: "recover" | "cancel"): Promise<PaidBranchConnectionMutation> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    const request = attemptRequest(input, asOf);
    if ("ok" in request) return request;
    if (kind === "cancel" && typeof input.oauthState === "string") request.oauthState = input.oauthState;
    const session = await sessionClient(request.expectedAccountId, requestId, asOf, request);
    if ("ok" in session) return session;
    const store = createPaidBranchConnectionStore(session.client, session.client, asOf, { sessionId: session.sessionId });
    return (kind === "recover" ? runPaidBranchConnectionRecover : runPaidBranchConnectionCancel)(request, store, asOf);
  });
}

function attemptRequest(input: PaidBranchConnectionScope & { flow: PaidBranchConnectionFlow; attemptId: string; generation: number }, asOf: string): PaidBranchConnectionAttemptRequest | PaidBranchConnectionDenial {
  return parseConnectionAttempt(input, asOf);
}

function serverLaunch(flow: PaidBranchConnectionFlow): { appId: string; configId?: string; graphVersion?: string; nonce?: string; oauthState?: string; contractId?: string; buildAuthorizationUrl?: (state: string) => string | null } | null {
  if (flow === "instagram_direct") {
    const config = readInstagramOAuthConfig();
    const state = randomBytes(32).toString("hex");
    if (!config || !instagramAuthorizationUrl(config, state)) return null;
    return { oauthState: state, appId: config.appId, contractId: config.contractId, buildAuthorizationUrl: (value) => instagramAuthorizationUrl(config, value) };
  }
  if (flow === "wa_coexistence") {
    const coexistence = coexistenceServerConfig();
    if (!coexistence) return null;
    return { appId: coexistence.appId, configId: coexistence.configId, graphVersion: coexistence.graphVersion, nonce: randomBytes(32).toString("hex") };
  }
  const config = embeddedSignupClientConfig();
  if (!config.ok) return null;
  return { appId: config.appId, configId: config.configId, graphVersion: config.graphVersion, nonce: randomBytes(32).toString("hex") };
}

function publicMutation(result: PaidBranchConnectionCommandResult): PaidBranchConnectionMutation {
  return result.ok ? { ok: true, read: result.read } : { ok: false, code: result.code, read: result.read };
}

async function stageOwnedConnection(client: PaidBranchConnectionRpc, request: PaidBranchConnectionAttemptRequest, sessionId: string, accessToken: string, evidence: unknown): Promise<{ ok: boolean; stageReceipt?: string } | null> {
  try {
    const staged = await client.rpc("es02_b3_stage_owned_branch_connection", {
      p_expected_account_id: request.expectedAccountId,
      p_company_id: request.companyId,
      p_branch_id: request.branchId,
      p_channel: request.channel,
      p_flow: request.flow,
      p_attempt_id: request.attemptId,
      p_generation: request.generation,
      p_session_id: sessionId,
      p_access_token: accessToken,
      p_evidence: evidence,
    });
    const receipt = staged.data && typeof staged.data === "object" ? (staged.data as { stageReceipt?: unknown }).stageReceipt : undefined;
    if (staged.error || typeof receipt !== "string") return { ok: false };
    return { ok: true, stageReceipt: receipt };
  } catch {
    return null;
  }
}
