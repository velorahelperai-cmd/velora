"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { instagramAuthorizationUrl, readInstagramOAuthConfig } from "@/lib/instagram/oauth-meta";
import { INSTAGRAM_ATTEMPT_COOKIE } from "@/lib/instagram/oauth-route";
import { embeddedSignupClientConfig } from "@/lib/whatsapp/embedded-signup";
import {captureEarlyAuthorization,earlyAuthorizationRpc} from '@/lib/whatsapp/early-authorization';
import {autoPinAllowed} from '@/lib/whatsapp/auto-pin';
import {onboardMetaSignup} from '@/lib/whatsapp/embedded-signup-meta';
import {sealSignupPreparation,openSignupPreparation} from '@/lib/whatsapp/signup-preparation';
import {signupCheckpointBinding,signupCheckpointRpc,parseSignupCheckpoint} from '@/lib/whatsapp/signup-checkpoint';
import { exchangeAfterCommittedClaim, exchangeOwnedBranchConnection } from "@/lib/tenancy/paid-branch-connection-adapters";
import { coexistenceServerConfig } from "@/lib/tenancy/paid-branch-connection-coexistence-config";
import {
  unavailablePaidBranchConnectionRead,
  parsePaidBranchConnectionRead,
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
    const pendingAttempt = result.read.connection.attempt;
    if (result.read.sourceStatus === "ready" && result.read.connection.flow === "wa_new_number" && pendingAttempt?.status === "pending" && Date.parse(pendingAttempt.expiresAt) <= Date.now()) {
      logEvent("info", "es02.branch_connection.cancel_flag", { enabled: process.env.VELORA_EXPIRED_WA_CANCEL_ENABLED === "true" });
    }
    // Local owner diagnostics only. Never project credentials or probe/write Meta.
    if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SITE_URL === 'http://127.0.0.1:3330'
      && parsed.branchId === 'a268f9d8-fe5b-41b2-a337-97046a5eaa5c' && result.read.sourceStatus === 'ready') {
      const attempt = result.read.connection.attempt;
      let checkpointAvailability = 'not_checked';
      let sessionMatch: boolean | null = null;
      if (attempt && result.read.connection.flow === 'wa_new_number') {
        const admin = createAdminClient();
        try{if(admin){
          const legacy=await admin.from('whatsapp_embedded_signup_attempts').select('session_id')
            .eq('id',attempt.id).eq('company_id',parsed.companyId).eq('user_id',parsed.expectedAccountId).maybeSingle();
          const legacyRow=legacy.data as {session_id?:unknown}|null;
          if(!legacy.error&&typeof legacyRow?.session_id==='string')sessionMatch=legacyRow.session_id.toLowerCase()===session.sessionId;
        }}catch{/* Diagnostics must not affect the normal read. */}
        const checkpoint = admin ? parseSignupCheckpoint(await signupCheckpointRpc(admin as unknown as PaidBranchConnectionRpc,
          'load', signupCheckpointBinding({...parsed, flow:'wa_new_number', attemptId:attempt.id, generation:attempt.generation}, session.sessionId))) : null;
        // A denied/expired load does not prove that no checkpoint row exists.
        checkpointAvailability = checkpoint ? 'available' : 'unavailable_or_absent';
      }
      logEvent('warn', 'es02.branch_connection.local_read_diagnostic', {
        request_id: requestId, branch_id: parsed.branchId, attempt_id: attempt?.id ?? null,
        attempt_status: attempt?.status ?? null, expires_at: attempt?.expiresAt ?? null,
        expired: attempt ? Date.parse(attempt.expiresAt) <= Date.now() : null,
        connection_state: result.read.connection.state, flow: result.read.connection.flow,
        verified: result.read.connection.verified, checkpoint_availability: checkpointAvailability,
        session_matches_legacy: sessionMatch,
        reason_codes: result.read.connection.reasonCodes, last_error_code: 'NOT_EXPOSED_BY_READ_CONTRACT',
      });
    }
    return result.read;
  });
}

export async function startOwnedPaidBranchConnectionAction(input: StartOwnedPaidBranchConnectionInput): Promise<PaidBranchConnectionStartResult | PaidBranchConnectionDenial> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    const started = Date.now();
    const correlationId = typeof input?.clientOpId === "string" && UUID.test(input.clientOpId) ? input.clientOpId.toLowerCase() : requestId;
    const stage = (name: string, since: number, outcome: string, code?: string) => {
      try {
        logEvent("info", "es02.branch_connection.start_stage", {
          correlation_id: correlationId,
          stage: name,
          duration_ms: Math.max(0, Date.now() - since),
          outcome,
          ...(code ? { error_code: code } : {}),
          ...(input?.flow ? { flow: input.flow } : {}),
        });
      } catch {
        /* logging cannot change execution */
      }
    };
    stage("validation", started, "started");
    const parsed = parseConnectionStart(input, asOf);
    if ("ok" in parsed) {
      stage("validation", started, "denied", parsed.code);
      return parsed;
    }
    if (parsed.flow === "wa_coexistence" && parsed.confirmed !== true) {
      stage("validation", started, "denied", "invalid_input");
      return { ok: false, code: "invalid_input", read: unavailablePaidBranchConnectionRead(parsed, asOf, "invalid_input") };
    }
    stage("validation", started, "ok");
    const sessionStarted = Date.now();
    stage("session", sessionStarted, "started");
    const session = await sessionClient(parsed.expectedAccountId, requestId, asOf, parsed);
    if ("ok" in session) {
      stage("session", sessionStarted, "denied", session.code);
      return session;
    }
    stage("session", sessionStarted, "ok");
    if(parsed.flow==='wa_new_number'){
      const admin=createAdminClient();
      // The existing Meta app callback is retained. Its GET verification token is not an onboarding credential.
      const ready=process.env.WHATSAPP_ROUTING_MODE==='tenant_registry'&&process.env.WHATSAPP_RECEIVE_ENABLED==='true'&&admin&&await signupCheckpointRpc(admin as unknown as PaidBranchConnectionRpc,'ready',{accountId:parsed.expectedAccountId,companyId:parsed.companyId,branchId:parsed.branchId,sessionId:session.sessionId});
      if(!ready) {
        stage("prerequisites", sessionStarted, "denied", "setup_required");
        return {ok:false,code:'setup_required',read:unavailablePaidBranchConnectionRead(parsed,asOf,'setup_required')};
      }
    }
    const material = serverLaunch(parsed.flow);
    if (!material) {
      stage("material", sessionStarted, "denied", "setup_required");
      return { ok: false, code: "setup_required", read: unavailablePaidBranchConnectionRead(parsed, asOf, "setup_required") };
    }
    const store = createPaidBranchConnectionStore(session.client, session.client, asOf, { sessionId: session.sessionId });
    const startExecution = Date.now();
    stage("start", startExecution, "started");
    const startedResult = await runPaidBranchConnectionStart(parsed, {
      ...store,
      start: (request) => store.start({ ...request, ...material, sessionId: session.sessionId }),
    }, asOf);
    if (!startedResult.ok || !startedResult.launch || startedResult.launch.attemptId !== startedResult.read.connection.attempt?.id || startedResult.launch.flow !== parsed.flow) {
      const failCode = startedResult.ok ? "setup_required" : startedResult.code;
      stage("start", startExecution, "failed", failCode);
      return startedResult.ok ? { ok: false, code: "setup_required", read: startedResult.read } : startedResult;
    }
    stage("start", startExecution, "ok");
    if (startedResult.launch.flow === "instagram_direct") {
      (await cookies()).set(INSTAGRAM_ATTEMPT_COOKIE, startedResult.launch.attemptId, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/api/instagram/oauth/callback",
        maxAge: 600,
      });
    }
    stage("complete", started, "ok");
    return { ok: true, read: startedResult.read, launch: startedResult.launch };
  });
}

/** Code is exchanged and saved before FINISH. No asset authority is granted here. */
export async function captureOwnedWhatsappAuthorizationAction(input:PaidBranchConnectionScope&{attemptId:string;generation:number;nonce:string;code:string;correlationId?:string}):Promise<{ok:boolean}>{
 const requestId=randomUUID(),started=Date.now();
 return withLogContext({request_id:requestId},async()=>{
  // Fixed labels only: never input, code, nonce, session/account IDs, provider URL/body or raw Error.
  const attemptRef=typeof input?.attemptId==='string'&&UUID.test(input.attemptId)?createHash('sha256').update(input.attemptId.toLowerCase()).digest('hex').slice(0,24):'invalid';
  const correlationId=typeof input?.correlationId==='string'&&UUID.test(input.correlationId)?input.correlationId.toLowerCase():null;
  const report=(stage:string,outcome:string,durationMs:number,reasonCode?:string)=>{try{logEvent('info','whatsapp.early_authorization.stage',{stage,outcome,duration_ms:Math.max(0,durationMs),attempt_ref:attemptRef,...(correlationId?{correlation_id:correlationId}:{}),...(reasonCode?{reason_code:reasonCode}:{})});}catch{/* logging cannot change authorization */}};
  const finish=(ok:boolean)=>{report('complete',ok?'confirmed':'unknown',Date.now()-started);return {ok};};
  let stage='input';let stageStarted=Date.now();report('received','started',0);
  try{
   const asOf=new Date().toISOString();const request=attemptRequest({...input,flow:'wa_new_number'},asOf);
   if('ok' in request||typeof input.code!=='string'||!input.code.trim()||input.code.length>4096||!/^([a-f0-9]{64})$/.test(input.nonce)){report(stage,'denied',Date.now()-stageStarted,'INPUT_REJECTED');return finish(false);}
   report(stage,'confirmed',Date.now()-stageStarted);
   stage='identity';stageStarted=Date.now();report(stage,'started',0);
   const session=await sessionClient(request.expectedAccountId,requestId,asOf,request);if('ok' in session){report(stage,'denied',Date.now()-stageStarted,'IDENTITY_REJECTED');return finish(false);}report(stage,'confirmed',Date.now()-stageStarted);
   stage='attempt';stageStarted=Date.now();report(stage,'started',0);
   const current=await runPaidBranchConnectionRead(request,createPaidBranchConnectionStore(session.client,session.client,asOf),asOf);const a=current.read.connection.attempt;
   if(current.read.sourceStatus!=='ready'||a?.id!==request.attemptId||a.generation!==request.generation||a.status!=='pending'||Date.parse(a.expiresAt)<=Date.now()){const reason=current.read.sourceStatus!=='ready'?'ATTEMPT_READ_UNAVAILABLE':a?.id!==request.attemptId?'ATTEMPT_MISMATCH':a.generation!==request.generation?'GENERATION_MISMATCH':a.status!=='pending'?'ATTEMPT_NOT_PENDING':'ATTEMPT_EXPIRED';report(stage,'denied',Date.now()-stageStarted,reason);return finish(false);}report(stage,'confirmed',Date.now()-stageStarted);
   stage='configuration';stageStarted=Date.now();
   const config=embeddedSignupClientConfig(),appSecret=process.env.WHATSAPP_APP_SECRET?.trim()??'',admin=createAdminClient();if(!config.ok||!appSecret||!admin){report(stage,'denied',Date.now()-stageStarted,!config.ok?'SIGNUP_CONFIG_UNAVAILABLE':!appSecret?'APP_CREDENTIAL_UNAVAILABLE':'SERVER_CLIENT_UNAVAILABLE');return finish(false);}report(stage,'confirmed',Date.now()-stageStarted);
   const binding={...signupCheckpointBinding(request,session.sessionId),...config,nonce:input.nonce};
   return finish(await captureEarlyAuthorization(admin as unknown as PaidBranchConnectionRpc,binding,input.code,{...config,enabled:true,appSecret},undefined,report));
  }catch(error){report(stage,'unknown',Date.now()-stageStarted);report('complete','unknown',Date.now()-started);throw error;}
 });
}

/** Read provider registration state after Facebook authorization, before the native completion claim. */
export async function prepareOwnedWhatsappRegistrationAction(input:CompleteOwnedPaidBranchConnectionInput):Promise<{ok:true;registrationRequired:boolean;autoPinEligible?:boolean;authorizationTicket:string}|{ok:false}>{
 const asOf=new Date().toISOString(),request=attemptRequest(input,asOf);
 if('ok' in request||request.flow!=='wa_new_number')return {ok:false};
 const row=input.completion as Record<string,unknown>;
 if(!row||row.attemptId!==request.attemptId||typeof row.nonce!=='string'||!/^[0-9a-f]{64}$/.test(row.nonce)||typeof row.code!=='string'||!row.code||row.code.length>4096||typeof row.wabaId!=='string'||!/^\d{1,64}$/.test(row.wabaId)||typeof row.phoneNumberId!=='string'||!/^\d{1,64}$/.test(row.phoneNumberId)||row.pin!==''||row.authorizationTicket!==undefined)return {ok:false};
 const session=await sessionClient(request.expectedAccountId,randomUUID(),asOf,request);if('ok' in session)return {ok:false};
 const current=await runPaidBranchConnectionRead(request,createPaidBranchConnectionStore(session.client,session.client,asOf),asOf);
 const attempt=current.read.connection.attempt;
 if(current.read.sourceStatus!=='ready'||current.read.connection.flow!=='wa_new_number'||attempt?.id!==request.attemptId||attempt.generation!==request.generation||attempt.status!=='pending'||Date.parse(attempt.expiresAt)<=Date.now())return {ok:false};
 const config=embeddedSignupClientConfig(),appSecret=process.env.WHATSAPP_APP_SECRET?.trim()??'';
 if(!config.ok||!appSecret)return {ok:false};
 const admin=createAdminClient();if(!admin)return {ok:false};
 const binding=signupCheckpointBinding(request,session.sessionId);
  const earlyBinding={...binding,...config,nonce:row.nonce,wabaId:row.wabaId,phoneNumberId:row.phoneNumberId};
  if(row.code!=='early-authorization'&&!await captureEarlyAuthorization(admin as unknown as PaidBranchConnectionRpc,earlyBinding,String(row.code),{...config,enabled:true,appSecret}))return {ok:false};
  const early=await earlyAuthorizationRpc(admin as unknown as PaidBranchConnectionRpc,'load',earlyBinding);
  const existing=early?null:parseSignupCheckpoint(await signupCheckpointRpc(admin as unknown as PaidBranchConnectionRpc,'load',binding));
  if(existing&&(existing.wabaId!==row.wabaId||existing.phoneNumberId!==row.phoneNumberId||existing.nonce!==row.nonce||existing.appId!==config.appId||existing.configId!==config.configId||existing.graphVersion!==config.graphVersion))return {ok:false};
  const token=early?.token??existing?.token;if(typeof token!=='string'||!token)return {ok:false};
  let registrationRequired:boolean|undefined;
  await onboardMetaSignup({...config,enabled:true,appSecret},{code:'early-authorization',wabaId:String(row.wabaId),phoneNumberId:String(row.phoneNumberId),pin:'',keepOnPhone:false},fetch,{token,probe:true,capture:(_token,required)=>{registrationRequired=required;}});
  if(registrationRequired===undefined)return {ok:false};
  if(early&&!await earlyAuthorizationRpc(admin as unknown as PaidBranchConnectionRpc,'promote',earlyBinding))return {ok:false};
  return {ok:true,registrationRequired,autoPinEligible:registrationRequired&&autoPinAllowed({companyId:request.companyId,branchId:request.branchId,phoneNumberId:String(row.phoneNumberId)}),authorizationTicket:sealSignupPreparation(appSecret,{...binding,nonce:String(row.nonce),wabaId:String(row.wabaId),phoneNumberId:String(row.phoneNumberId)},token)};
}

export async function completeOwnedPaidBranchConnectionAction(input: CompleteOwnedPaidBranchConnectionInput): Promise<PaidBranchConnectionMutation> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    const started = Date.now();
    const completion = input?.completion as unknown as Record<string, unknown> | undefined;
    const correlationId = typeof completion?.correlationId === "string" && UUID.test(completion.correlationId)
      ? completion.correlationId.toLowerCase()
      : typeof input?.attemptId === "string" && UUID.test(input.attemptId)
        ? input.attemptId.toLowerCase()
        : requestId;
    const stage = (name: string, since: number, outcome: string, code?: string) => {
      try {
        logEvent("info", "es02.branch_connection.complete_stage", {
          correlation_id: correlationId,
          stage: name,
          duration_ms: Math.max(0, Date.now() - since),
          outcome,
          ...(code ? { error_code: code } : {}),
          ...(input?.flow ? { flow: input.flow } : {}),
          ...(input?.attemptId && UUID.test(input.attemptId) ? { attempt_id: input.attemptId.toLowerCase() } : {}),
          ...(typeof input?.generation === "number" ? { generation: input.generation } : {}),
        });
      } catch {
        /* logging cannot change execution */
      }
    };
    stage("validation", started, "started");
    const request = attemptRequest(input, asOf);
    if ("ok" in request) {
      stage("validation", started, "denied", request.code);
      return request;
    }
    if (!paidBranchCompletionAccepted(request.flow, request.attemptId, input.completion)) {
      stage("validation", started, "denied", "invalid_input");
      return { ok: false, code: "invalid_input", read: unavailablePaidBranchConnectionRead(request, asOf, "invalid_input") };
    }
    stage("validation", started, "ok");
    const sessionStarted = Date.now();
    stage("session", sessionStarted, "started");
    const session = await sessionClient(request.expectedAccountId, requestId, asOf, request);
    if ("ok" in session) {
      stage("session", sessionStarted, "denied", session.code);
      return session;
    }
    stage("session", sessionStarted, "ok");
    if(request.flow==='wa_new_number'){
      const checkpointStarted = Date.now();
      stage("checkpoint", checkpointStarted, "started");
      const current=await runPaidBranchConnectionRead(request,createPaidBranchConnectionStore(session.client,session.client,asOf),asOf);
      if(current.read.sourceStatus!=='ready'||current.read.connection.attempt?.id!==request.attemptId||current.read.connection.attempt.generation!==request.generation) {
        stage("checkpoint", checkpointStarted, "denied", "forbidden");
        return {ok:false,code:'forbidden',read:current.read};
      }
      if(current.read.connection.verified&&current.read.connection.attempt.status==='bound') {
        stage("checkpoint", checkpointStarted, "ok");
        stage("complete", started, "ok");
        return {ok:true,read:current.read};
      }
      const token=openSignupPreparation(process.env.WHATSAPP_APP_SECRET?.trim()??'',completion?.authorizationTicket as string,{accountId:request.expectedAccountId,sessionId:session.sessionId,companyId:request.companyId,branchId:request.branchId,attemptId:request.attemptId,generation:request.generation,nonce:String(completion?.nonce),wabaId:String(completion?.wabaId),phoneNumberId:String(completion?.phoneNumberId)});
      if(!token) {
        stage("checkpoint", checkpointStarted, "denied", "invalid_input");
        return {ok:false,code:'invalid_input',read:current.read};
      }
      const checkpointAdmin=createAdminClient();
      const checkpoint=checkpointAdmin?parseSignupCheckpoint(await signupCheckpointRpc(checkpointAdmin as unknown as PaidBranchConnectionRpc,'load',signupCheckpointBinding(request,session.sessionId))):null;
      if(!checkpoint||checkpoint.token!==token||checkpoint.nonce!==completion?.nonce||checkpoint.wabaId!==completion?.wabaId||checkpoint.phoneNumberId!==completion?.phoneNumberId) {
        stage("checkpoint", checkpointStarted, "denied", "reconciliation_required");
        return {ok:false,code:'reconciliation_required',read:current.read};
      }
      stage("checkpoint", checkpointStarted, "ok");
    }
    const adminStarted = Date.now();
    const admin = createAdminClient();
    if (!admin) {
      stage("prerequisites", adminStarted, "denied", "setup_required");
      return { ok: false, code: "setup_required", read: unavailablePaidBranchConnectionRead(request, asOf, "setup_required") };
    }
    const proof = admin as unknown as PaidBranchConnectionRpc;
    const slot: PaidBranchConnectionProof = { sessionId: session.sessionId };
    const store = createPaidBranchConnectionStore(session.client, proof, asOf, slot);
    let claimed: PaidBranchConnectionCommandResult | null = null;
    const claim = store.claim;
    store.claim = async (value) => {
      const claimStarted = Date.now();
      stage("claim", claimStarted, "started");
      const row = input.completion as unknown as Record<string, unknown>;
      const result = await claim({
        ...value,
        nonce: typeof row.nonce === "string" ? row.nonce : undefined,
        oauthState: typeof row.state === "string" ? row.state : undefined,
      });
      claimed = result;
      const claimOutcome = result?.ok ? "ok" : "denied";
      const claimCode = !result ? "source_failed" : !result.ok ? result.code : undefined;
      stage("claim", claimStarted, claimOutcome, claimCode);
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
        const finalizeStarted = Date.now();
        stage("finalize", finalizeStarted, "started");
        const saved = await store.finalize(request);
        stage("finalize", finalizeStarted, saved?.ok ? "ok" : "denied", saved && !saved.ok ? saved.code : undefined);
        return saved ? { ok: saved.ok, linkId: saved.ok ? saved.read.connection.link?.id : undefined } : null;
      },
      stage: (accessToken, evidence) => stageOwnedConnection(proof, request, slot.sessionId, accessToken, evidence),
    }), slot);
    const completeStarted = Date.now();
    const result=publicMutation(await runPaidBranchConnectionComplete(request, store, asOf));
    if(request.flow==='wa_new_number'&&result.ok&&result.read.connection.verified)await signupCheckpointRpc(proof,'discard',signupCheckpointBinding(request,session.sessionId));
    stage("complete", completeStarted, result.ok ? "ok" : "failed", !result.ok ? result.code : undefined);
    return result;
  });
}

export async function recoverOwnedPaidBranchConnectionAction(input: PaidBranchConnectionScope & { flow: PaidBranchConnectionFlow; attemptId: string; generation: number }): Promise<PaidBranchConnectionMutation> {
  const requestId = randomUUID();
  const started = Date.now();
  const correlationId = typeof input?.attemptId === "string" && UUID.test(input.attemptId) ? input.attemptId.toLowerCase() : requestId;
  const stage = (name: string, since: number, outcome: string, code?: string) => {
    try {
      logEvent("info", "es02.branch_connection.recover_stage", {
        correlation_id: correlationId,
        stage: name,
        duration_ms: Math.max(0, Date.now() - since),
        outcome,
        ...(code ? { error_code: code } : {}),
        flow: input.flow,
        attempt_id: input.attemptId,
        generation: input.generation,
      });
    } catch {
      /* logging cannot change execution */
    }
  };
  stage("validation", started, "started");
  if(input.flow==='wa_new_number'){
    const readStarted = Date.now();
    stage("read", readStarted, "started");
    const current=await readOwnedPaidBranchConnectionAction(input);
    const attempt=current.connection.attempt;
    if(current.sourceStatus==='ready'&&attempt?.id===input.attemptId&&attempt.generation===input.generation
      && Date.parse(attempt.expiresAt)<=Date.now()){
      stage("read", readStarted, "denied", "expired");
      stage("complete", started, "failed", "expired");
      return {ok:false,code:'expired',read:current};
    }
    stage("read", readStarted, "ok");
  }
  const mutationStarted = Date.now();
  stage("recover_mutation", mutationStarted, "started");
  const recovered=await attemptMutation(input,"recover");
  stage("recover_mutation", mutationStarted, recovered.ok ? "ok" : "denied", !recovered.ok ? recovered.code : undefined);
  if(input.flow!=='wa_new_number'||!recovered.ok||recovered.read.sourceStatus!=='ready'||recovered.read.connection.verified) {
    stage("complete", started, recovered.ok ? "ok" : "failed", !recovered.ok ? recovered.code : undefined);
    return recovered;
  }
  const request=attemptRequest(input,new Date().toISOString());
  if('ok' in request) {
    stage("validation", started, "denied", request.code);
    return request;
  }
  const sessionStarted = Date.now();
  stage("session", sessionStarted, "started");
  const session=await sessionClient(request.expectedAccountId,requestId,new Date().toISOString(),request);
  if('ok' in session) {
    stage("session", sessionStarted, "denied", session.code);
    return session;
  }
  stage("session", sessionStarted, "ok");
  const admin=createAdminClient(),config=embeddedSignupClientConfig();
  const appSecret=process.env.WHATSAPP_APP_SECRET?.trim()??'';
  if(!admin||!config.ok||!appSecret) {
    stage("prerequisites", started, "denied", "setup_required");
    stage("complete", started, "failed", "setup_required");
    return recovered;
  }
  const checkpointStarted = Date.now();
  stage("checkpoint", checkpointStarted, "started");
  const checkpoint=parseSignupCheckpoint(await signupCheckpointRpc(admin as unknown as PaidBranchConnectionRpc,'load',signupCheckpointBinding(request,session.sessionId)));
  if(!checkpoint||checkpoint.appId!==config.appId||checkpoint.configId!==config.configId||checkpoint.graphVersion!==config.graphVersion) {
    stage("checkpoint", checkpointStarted, "denied", "checkpoint_mismatch");
    stage("complete", started, "ok");
    return recovered;
  }
  stage("checkpoint", checkpointStarted, "ok");
  const providerInput={code:'durable-checkpoint',wabaId:checkpoint.wabaId,phoneNumberId:checkpoint.phoneNumberId,pin:'',keepOnPhone:false};
  if(recovered.read.connection.attempt?.status==='pending'){
   const probeStarted = Date.now();
   stage("probe", probeStarted, "started");
   let registrationRequired:boolean|undefined;
   await onboardMetaSignup({...config,enabled:true,appSecret},providerInput,fetch,{token:checkpoint.token,probe:true,capture:(_token,required)=>{registrationRequired=required;}});
   if(registrationRequired===undefined) {
     stage("probe", probeStarted, "denied", "probe_failed");
     stage("complete", started, "ok");
     return recovered;
   }
   stage("probe", probeStarted, "ok");
   stage("complete", started, "ok");
   return {...recovered,continuation:{registrationRequired,autoPinEligible:registrationRequired&&autoPinAllowed({companyId:request.companyId,branchId:request.branchId,phoneNumberId:checkpoint.phoneNumberId}),nonce:checkpoint.nonce,wabaId:checkpoint.wabaId,phoneNumberId:checkpoint.phoneNumberId,authorizationTicket:sealSignupPreparation(appSecret,{...signupCheckpointBinding(request,session.sessionId),nonce:checkpoint.nonce,wabaId:checkpoint.wabaId,phoneNumberId:checkpoint.phoneNumberId},checkpoint.token)}};
  }
  // An interrupted write is reconciled by GET requests only. Never re-register or re-subscribe.
  const probeStarted = Date.now();
  stage("probe", probeStarted, "started");
  const verified=await onboardMetaSignup({...config,enabled:true,appSecret},providerInput,fetch,{token:checkpoint.token,readOnly:true});
  if(!verified.ok) {
    stage("probe", probeStarted, "denied", verified.code);
    stage("complete", started, "ok");
    return recovered;
  }
  stage("probe", probeStarted, "ok");
  const finalizeStarted = Date.now();
  stage("finalize", finalizeStarted, "started");
  const store=createPaidBranchConnectionStore(session.client,admin as unknown as PaidBranchConnectionRpc,new Date().toISOString(),{sessionId:session.sessionId,accessToken:verified.accessToken,proof:verified.proof});
  const result=publicMutation(await store.finalize(request)??{ok:false,code:'reconciliation_required',read:recovered.read});
  stage("finalize", finalizeStarted, result.ok ? "ok" : "denied", !result.ok ? result.code : undefined);
  if(result.ok&&result.read.connection.verified)await signupCheckpointRpc(admin as unknown as PaidBranchConnectionRpc,'discard',signupCheckpointBinding(request,session.sessionId));
  stage("complete", started, result.ok ? "ok" : "failed", !result.ok ? result.code : undefined);
  return result;
}

export async function cancelOwnedPaidBranchConnectionAction(input: PaidBranchConnectionScope & { flow: PaidBranchConnectionFlow; attemptId: string; generation: number; oauthState?: string }): Promise<PaidBranchConnectionMutation> {
  const result=await attemptMutation(input, "cancel");
  if(process.env.NODE_ENV==='development'&&process.env.NEXT_PUBLIC_SITE_URL==='http://127.0.0.1:3330'){
    logEvent('warn','es02.branch_connection.local_cancel_result',{attempt_id:result.read.connection.attempt?.id??null,
      ok:result.ok,error_code:result.ok?null:result.code,attempt_status:result.read.connection.attempt?.status??null,
      connection_state:result.read.connection.state});
  }
  return result;
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
  return withLogContext(kind === "cancel" && input?.flow === "wa_new_number" ? { request_id: requestId } : { request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    const started = Date.now();
    const stage = (name: string, since: number, outcome: string, code?: string) => {
      if (kind === "cancel" && input?.flow === "wa_new_number") logEvent("info", "es02.branch_connection.cancel_stage", { stage: name, duration_ms: Date.now() - since, outcome, ...(code ? { error_code: code } : {}) });
    };
    const request = attemptRequest(input, asOf);
    if ("ok" in request) { stage("validation", started, "denied", request.code); return request; }
    if (kind === "cancel" && typeof input.oauthState === "string") request.oauthState = input.oauthState;
    const sessionStarted = Date.now();
    stage("session", sessionStarted, "started");
    const session = await sessionClient(request.expectedAccountId, requestId, asOf, request);
    if ("ok" in session) { stage("session", sessionStarted, "denied", session.code); return session; }
    stage("session", sessionStarted, "ok");
    const store = createPaidBranchConnectionStore(session.client, session.client, asOf, { sessionId: session.sessionId });
    let pendingRead: PaidBranchConnectionRead | null = null;
    if (kind === "cancel" && request.flow === "wa_new_number") {
      const readStarted = Date.now();
      stage("read", readStarted, "started");
      const current = await store.read(request);
      stage("read", readStarted, current ? "ok" : "unknown");
      if (!current) return { ok: false, code: "source_failed", read: unavailablePaidBranchConnectionRead(request, asOf, "source_failed") };
      if (current.connection.attempt?.id !== request.attemptId || current.connection.attempt.generation !== request.generation) return { ok: false, code: "reconciliation_required", read: current };
      if (current.connection.attempt.status === "cancelled" && !current.connection.verified) return { ok: true, read: current };
      if (current.connection.attempt.status !== "pending" || current.connection.verified) return { ok: false, code: "reconciliation_required", read: current };
      pendingRead = current;
    }
    const expiry = pendingRead?.connection.attempt?.expiresAt;
    if (kind === "cancel" && request.flow === "wa_new_number" && pendingRead) {
      logEvent("info", "es02.branch_connection.cancel_flag", { enabled: process.env.VELORA_EXPIRED_WA_CANCEL_ENABLED === "true" });
    }
    const directExpiredCancel = kind === "cancel" && request.flow === "wa_new_number" && pendingRead && expiry
      && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= Date.now()
      && process.env.VELORA_EXPIRED_WA_CANCEL_ENABLED === "true";
    let result: PaidBranchConnectionMutation;
    if (directExpiredCancel && pendingRead) {
      const rpcStarted = Date.now();
      stage("expired_rpc", rpcStarted, "started");
      try {
        const fallback = await session.client.rpc("es02_b3_cancel_expired_unstarted_whatsapp", { p_expected_account_id: request.expectedAccountId, p_company_id: request.companyId, p_branch_id: request.branchId, p_attempt_id: request.attemptId, p_generation: request.generation });
        const data = fallback.data as { ok?: unknown; read?: unknown; code?: unknown } | null;
        const read = parsePaidBranchConnectionRead(data?.read, request);
        if (!fallback.error && data?.ok === true && read?.connection.attempt?.id === request.attemptId && read.connection.attempt.generation === request.generation && read.connection.attempt.status === "cancelled" && !read.connection.verified) {
          result = { ok: true, read };
          stage("expired_rpc", rpcStarted, "confirmed");
        } else if (!fallback.error && data?.ok === false && (data.code === "forbidden" || data.code === "reconciliation_required")) {
          result = { ok: false, code: data.code, read: pendingRead };
          stage("expired_rpc", rpcStarted, "denied", data.code);
        } else {
          result = { ok: false, code: "source_failed", read: pendingRead };
          stage("expired_rpc", rpcStarted, "unknown");
        }
      } catch {
        result = { ok: false, code: "source_failed", read: pendingRead };
        stage("expired_rpc", rpcStarted, "unknown");
      }
    } else {
      const rpcStarted = Date.now();
      stage("standard_rpc", rpcStarted, "started");
      try {
        result = await (kind === "recover" ? runPaidBranchConnectionRecover : runPaidBranchConnectionCancel)(request, store, asOf);
        stage("standard_rpc", rpcStarted, result.ok ? "confirmed" : result.code === "source_failed" ? "unknown" : "denied", result.ok ? undefined : result.code);
      } catch (error) {
        stage("standard_rpc", rpcStarted, "unknown");
        throw error;
      }
    }
    if (kind === "cancel" && request.flow === "wa_new_number" && result.ok) {
      const cleanupStarted = Date.now();
      const admin = createAdminClient();
      stage("checkpoint_cleanup", cleanupStarted, "started");
      const cleaned = admin ? await signupCheckpointRpc(admin as unknown as PaidBranchConnectionRpc, "discard", signupCheckpointBinding(request, session.sessionId)) : null;
      stage("checkpoint_cleanup", cleanupStarted, cleaned ? "confirmed" : "unknown");
    }
    stage("complete", started, result.ok ? "confirmed" : "not_confirmed", result.ok ? undefined : result.code);
    return result;
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
