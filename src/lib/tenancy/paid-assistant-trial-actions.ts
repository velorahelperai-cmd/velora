"use server";
import {checkRateLimit} from "@/lib/security/rate-limit";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiModelId } from "@/lib/answers/config/env";
import type { AnswerResult, AnswerPersona } from "@/lib/answers/types";
import type {
  TrialScope,
  TrialSnapshot,
} from "@/components/app/paid-assistant-trial";
import { ANSWER_MAX_CONTEXT_CHARS, ANSWER_MAX_SOURCES } from "@/lib/answers/constants";
import { realModelPricing, reserveRealCost, priceRealUsage } from "@/lib/answers/runtime/economics";
import { buildAnswerSystemPrompt, formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
import { getAnswerProvider } from "@/lib/answers/provider";
import { classifyHandoffPolicy } from "@/lib/answers/routing/handoff-policy";
import { loadApprovedBranchKnowledgeContext } from "./paid-branch-knowledge-actions";
import { branchHoursAssistantContext } from "./branch-hours-contracts";
import { readOwnedBranchHoursAction } from "./branch-hours-actions";
import { readOwnedBranchReplyLanguageAction } from "./paid-reply-language-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bound assistant trial output to keep responses concise and strictly guarantee spend <= 0.002 OMR total. */
const TRIAL_MAX_OUTPUT_TOKENS = 256;

/**
 * Isolated server configuration for restricted local customer trials.
 * When local customer mode is active, the trial must be explicitly bound
 * to a configured branch and budget cap; if either is missing, it fails closed.
 * For general production customers, standard tenant authorization applies.
 */
function getIsolatedTrialConfig() {
  const isRestrictedMode =
    process.env.VELORA_LOCAL_CUSTOMER_MODE === "live" ||
    Boolean(process.env.VELORA_TRIAL_PINNED_BRANCH_ID);

  const pinnedBranchId = process.env.VELORA_TRIAL_PINNED_BRANCH_ID?.trim() || null;
  const rawCap = process.env.VELORA_TRIAL_BUDGET_CAP_BAISA;
  const parsedCap = rawCap !== undefined && rawCap.trim() !== "" ? Number(rawCap) : null;
  const validCap = parsedCap !== null && Number.isFinite(parsedCap) && parsedCap > 0 && parsedCap <= 2 ? parsedCap : null;
  const invalidCap = parsedCap !== null && validCap === null;

  return {
    restricted: isRestrictedMode,
    pinnedBranchId,
    capBaisa: validCap,
    invalidCap,
    isComplete: isRestrictedMode ? Boolean(pinnedBranchId && validCap) : true,
  };
}

function validScope(s: unknown): s is TrialScope {
  if (!s || typeof s !== "object") return false;
  const scope = s as Record<string, unknown>;
  return (
    typeof scope.expectedAccountId === "string" &&
    UUID.test(scope.expectedAccountId) &&
    typeof scope.companyId === "string" &&
    UUID.test(scope.companyId) &&
    typeof scope.branchId === "string" &&
    UUID.test(scope.branchId)
  );
}

export type AssistantTrialAskResult =
  | { ok: true; snapshot: TrialSnapshot }
  | { ok: false; code: string; message: string; requestId?: string; retrySafe?: boolean; httpStatus?:429|503; retryAfterSeconds?:number };

export async function readOwnedBranchAssistantTrialAction(
  scope: TrialScope
): Promise<TrialSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: scope?.expectedAccountId }, async () => {
    if (!validScope(scope)) return null;
    const isolated = getIsolatedTrialConfig();
    if (isolated.restricted) {
      if (!isolated.isComplete || scope.branchId !== isolated.pinnedBranchId) return null;
    }
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== scope.expectedAccountId) return null;

    const client = await createClient();
    const res = await client.rpc("es02_read_owned_branch_assistant_trial" as never, {
      p_expected_account_id: scope.expectedAccountId,
      p_company_id: scope.companyId,
      p_branch_id: scope.branchId,
    } as never);

    const payload = res.data as unknown as { ok?: boolean; data?: { snapshot: TrialSnapshot } };
    if (res.error || !payload || payload.ok !== true) return null;
    const snapshot = payload.data?.snapshot;
    if (!snapshot || snapshot.scope?.expectedAccountId !== scope.expectedAccountId || snapshot.scope?.companyId !== scope.companyId || snapshot.scope?.branchId !== scope.branchId) return null;
    const recovery = await client.rpc("es02_read_owned_branch_trial_recovery" as never, {p_expected_account_id:scope.expectedAccountId,p_company_id:scope.companyId,p_branch_id:scope.branchId} as never);
    const value = recovery.data as unknown as {ok?:boolean;operation?:{id:string;status:string;recoverable:boolean}|null};
    const op = !recovery.error && value?.ok === true ? value.operation : null;
    return op && UUID.test(op.id) && ["reserved","running","uncertain","success"].includes(op.status) && typeof op.recoverable === "boolean" ? {...snapshot,pendingOperation:op,canAsk:false} : snapshot;
  });
}

export async function askOwnedBranchAssistantTrialAction(
  input: TrialScope & { expectedVersion: number; knowledgeRevision: string; question: string; operationId?: string }
): Promise<AssistantTrialAskResult> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input)) {
      return { ok: false, code: "INVALID_INPUT", message: "Invalid trial parameters" };
    }
    const isolated = getIsolatedTrialConfig();
    if (isolated.restricted) {
      if (!isolated.isComplete) {
        return { ok: false, code: "UNAVAILABLE", message: "Restricted trial configuration is incomplete; trial stopped" };
      }
      if (input.branchId !== isolated.pinnedBranchId) {
        return { ok: false, code: "FORBIDDEN", message: "Trial is currently restricted to the configured authorized branch" };
      }
    }
    if (typeof input.question !== "string" || !input.question.trim() || input.question.trim().length > 1000 ||
        !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        typeof input.knowledgeRevision !== "string" || !input.knowledgeRevision.trim() ||
        (input.operationId !== undefined && !UUID.test(input.operationId))) {
      return { ok: false, code: "INVALID_INPUT", message: "Question is required and scope must be valid" };
    }
    const identity = await readSessionIdentity();
    if (!identity.ok || identity.userId !== input.expectedAccountId) {
      return { ok: false, code: "UNAUTHENTICATED", message: "User session does not match account" };
    }

    // Resolve the existing owner/subscription/branch authority before any paid request.
    const authorityClient = await createClient();
    const authority = await authorityClient.rpc("es02_read_owned_branch_setup" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
    } as never);
    const gate = authority.data as unknown as { ok?: boolean; code?: string; data?: { persona?: string } } | null;
    if (authority.error || gate?.ok !== true) {
      return { ok: false, code: gate?.code || "UNAVAILABLE", message: "Branch authorization is unavailable or denied" };
    }
    const preview=classifyHandoffPolicy(input.question).previewReason;
    if(preview){
      const snapshot=await readOwnedBranchAssistantTrialAction(input);
      if(!snapshot||snapshot.version!==input.expectedVersion||snapshot.knowledgeRevision!==input.knowledgeRevision)return {ok:false,code:'CONTEXT_CHANGED',message:'Reload the current branch before previewing escalation'};
      // Pure policy preview: never claim a customer conversation was transferred,
      // and never reserve a provider attempt or grant an engine trial receipt.
      return {ok:true,snapshot:{...snapshot,handoffPreview:preview}};
    }
    // 1. Authoritative Answer Provider (Gemini). Return explicit error if not configured.
    const provider = getAnswerProvider();
    if (!provider) {
      logEvent("warn", "es02.branch_assistant_trial.missing_provider", {
        request_id: requestId,
        stage: "b6",
        detail: "Gemini provider is not configured on server (AI_GEMINI_API_KEY required).",
      });
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "Gemini provider is not configured. API key is required.",
      };
    }

    const personaByLevel: Record<string, AnswerPersona> = { level_1: "noura", level_2: "lina", level_3: "dana" };
    const persona = personaByLevel[gate.data?.persona || ""];
    const configuredModel = getGeminiModelId();
    if (configuredModel !== "gemini-3.8-flash" || !UUID.test(identity.nativeSessionId || "")) return { ok: false, code: "UNAVAILABLE", message: "Approved model and native session are required" };
    const writer = createAdminClient();
    if (!persona || !writer) return { ok: false, code: "UNAVAILABLE", message: "Verified answer profile and trusted receipt writer are required" };

    // 2. Load branch hours from B4
    const hours = await readOwnedBranchHoursAction({
      expectedAccountId: input.expectedAccountId,
      companyId: input.companyId,
      branchId: input.branchId,
    });

    if (!hours.ok || !hours.snapshot) return { ok: false, code: "UNAVAILABLE", message: "Branch hours could not be verified" };
    const hoursRev = hours.snapshot.version;
    const hoursChunkText = branchHoursAssistantContext(hours.snapshot);
    if (!hoursChunkText) return {ok:false,code:"UNAVAILABLE",message:"Branch hours are invalid or unavailable"};

    // 3. Load approved branch knowledge (indexed website pages + approved sources)
    const knowledgeContext = await loadApprovedBranchKnowledgeContext(input.companyId, input.branchId);
    if (!knowledgeContext.ok || knowledgeContext.chunks.length === 0) {
      const code = !knowledgeContext.ok ? knowledgeContext.code : "NO_KNOWLEDGE";
      logEvent("warn", "es02.branch_assistant_trial.knowledge_unavailable", {
        request_id: requestId,
        stage: "b6",
        error_code: code,
        detail: "Approved branch knowledge could not be packed for trial ask.",
      });
      return { ok: false, code, message: "Approved knowledge could not be verified", requestId };
    }
    // Validate the disclosed context before reserving allowance or spending a provider request.
    const trial = await readOwnedBranchAssistantTrialAction(input);
    if (!trial) return { ok: false, code: "UNAVAILABLE", message: "Trial context could not be verified", requestId };
    if (trial.scope?.expectedAccountId !== input.expectedAccountId || trial.scope?.companyId !== input.companyId ||
        trial.scope?.branchId !== input.branchId || trial.version !== input.expectedVersion ||
        trial.knowledgeRevision !== input.knowledgeRevision || knowledgeContext.knowledgeRevision !== input.knowledgeRevision) {
      return { ok: false, code: "CONTEXT_CHANGED", message: "Trial context changed; reload the branch before asking", requestId };
    }
    const chunks = [...knowledgeContext.chunks];

    if (hoursChunkText) {
      chunks.push({
        sourceId: `hours-${input.branchId}`,
        title: "Working Hours",
        contentVersion: hoursRev,
        text: hoursChunkText,
        usageRole: "business_instructions",
      });
    }
    // Hours are mandatory business instructions; reject before spend if the combined set no longer fits.
    if (chunks.length > ANSWER_MAX_SOURCES || chunks.reduce((n, c) => n + c.title.length + c.text.length + 6, 0) > ANSWER_MAX_CONTEXT_CHARS) {
      return { ok: false, code: "CONTEXT_OVERFLOW", message: "Knowledge plus hours exceeds the allowed context limit", requestId };
    }

    // 4. Branch confirmed reply language
    const langRes = await readOwnedBranchReplyLanguageAction({
      expectedAccountId: input.expectedAccountId,
      companyId: input.companyId,
      branchId: input.branchId,
    });
    if (!langRes || !["ar", "en", "both"].includes(langRes.replyLanguage || "")) return { ok: false, code: "UNAVAILABLE", message: "Confirmed reply language could not be verified", requestId };
    const locale: "ar" | "en" = langRes.replyLanguage === "en" || (langRes.replyLanguage === "both" && !/[\u0600-\u06ff]/.test(input.question)) ? "en" : "ar";

    const operationId = input.operationId || requestId;
    const pricing = realModelPricing(configuredModel);
    const systemPrompt = buildAnswerSystemPrompt(locale, persona);
    const userPrompt = formatAnswerUserPrompt(input.question, chunks, locale);
    // Provider-counted input is preferred. When counting fails, reserveRealCost already uses the
    // proven UTF-8 byte upper bound — never a weaker estimate — so do not hard-block the trial.
    let providerInputTokens: number | undefined;
    if (provider.countInputTokens) {
      let counted: number | null = null;
      try { counted = await provider.countInputTokens({ question: input.question.trim(), locale, chunks, persona }); } catch { counted = null; }
      if (counted !== null && Number.isSafeInteger(counted) && counted >= 1) {
        providerInputTokens = counted;
      } else {
        logEvent("warn", "es02.branch_assistant_trial.token_count_fallback", {
          request_id: requestId,
          stage: "b6",
          detail: "Provider token count unavailable; reserving from UTF-8 byte upper bound.",
        });
      }
    }
    const reservedBaisa = reserveRealCost(configuredModel, systemPrompt, userPrompt, pricing, TRIAL_MAX_OUTPUT_TOKENS, providerInputTokens);
    // If restricted local customer trial mode is active, the cap is required and strictly <= 2 baisa.
    // If general SaaS mode, an optional cap can still be passed via VELORA_TRIAL_BUDGET_CAP_BAISA.
    if (isolated.invalidCap) {
      return { ok: false, code: "UNAVAILABLE", message: "Trial budget configuration is invalid; request not sent" };
    }
    const cap = isolated.capBaisa;
    if (isolated.restricted && (!cap || cap <= 0 || cap > 2)) {
      return { ok: false, code: "UNAVAILABLE", message: "Approved trial budget cap (2 baisa) is required; uncapped reservation is disabled" };
    }
    const reserveArgs = {
      p_operation_id: operationId, p_account_id: identity.userId, p_session_id: identity.nativeSessionId,
      p_company_id: input.companyId, p_branch_id: input.branchId, p_question: input.question.trim(),
      p_knowledge_revision: knowledgeContext.knowledgeRevision, p_hours_revision: hoursRev, p_language_code: langRes.replyLanguage,
      p_persona: persona, p_model_id: configuredModel, p_reserved_baisa: reservedBaisa,
      p_pricing_version: pricing.version, p_pricing_snapshot: pricing,
      p_source_citations: chunks.map(({ sourceId, title, contentVersion }) => ({ sourceId, title, contentVersion })),
    };
    let reservation;
    try {
      reservation = cap !== null && cap > 0
        ? await writer.rpc("es02_reserve_branch_trial_capped" as never, { ...reserveArgs, p_trial_cap_baisa: cap } as never)
        : await writer.rpc("es02_reserve_branch_trial" as never, reserveArgs as never);
    } catch {
      // Nothing was dispatched. Any row that did get reserved stays held until reconciled.
      return { ok: false, code: "UNAVAILABLE", message: "Free setup allowance could not be reserved" };
    }
    const allowance = reservation.data as unknown as { ok?: boolean; code?: string; newlyReserved?: boolean; state?: string } | null;
    if (reservation.error || allowance?.ok !== true) {
      if (allowance?.code === "TRIAL_BUDGET_EXCEEDED") {
        logEvent("warn", "es02.branch_assistant_trial.budget_exceeded", { request_id: requestId, stage: "b6", detail: "Trial budget cap would be exceeded; request not sent." });
        return { ok: false, code: "UNAVAILABLE", message: "Trial budget would be exceeded; request not sent" };
      }
      return { ok: false, code: allowance?.code || "UNAVAILABLE", message: "Free setup allowance could not be reserved" };
    }
    if (!allowance.newlyReserved) {
      if (allowance.state === "success") {
        const snapshot = await readOwnedBranchAssistantTrialAction(input);
        // Ledger success alone does not prove this operation's transcript was saved.
        if (snapshot?.messages.some(message =>
          message.executionId === operationId && message.origin === "engine" &&
          message.question === input.question.trim() &&
          message.scope.expectedAccountId === input.expectedAccountId &&
          message.scope.companyId === input.companyId && message.scope.branchId === input.branchId
        )) return { ok: true, snapshot };
      }
      return { ok: false, code: "TRIAL_PENDING", message: "This operation is already recorded; it will not be sent again" };
    }
    // Settlement never throws. A false result means accounting is unconfirmed: the ledger row stays
    // held (reserved/running) and blocks any new dispatch for the branch, so nothing is resent.
    const settle = async (status: "success" | "rejected" | "incomplete" | "uncertain", answer?: Pick<Extract<AnswerResult, { ok: true }>, "usage">): Promise<boolean> => {
      try {
        let usage: Record<string, number> = {};
        let cost: { costUsd: number | null; costBaisa: number | null } = { costUsd: status === "uncertain" ? null : 0, costBaisa: status === "uncertain" ? null : 0 };
        if (answer) {
          usage = { promptTokens: answer.usage.promptTokens!, completionTokens: answer.usage.completionTokens!, cachedTokens: answer.usage.cachedTokens!, reasoningTokens: answer.usage.reasoningTokens!, cacheWriteTokens: answer.usage.cacheWriteTokens ?? 0, totalTokens: answer.usage.totalTokens! };
          cost = priceRealUsage(usage as Parameters<typeof priceRealUsage>[0], pricing);
          if (!answer.usage.actualModelId || !answer.usage.requestId) return false;
        }
        const settled = await writer.rpc("ai_settle_admin_attempt" as never, {
          p_id: operationId, p_status: status, p_cost_usd: cost.costUsd, p_cost_baisa: cost.costBaisa, p_usage: usage,
          p_request_id: answer?.usage.requestId ?? null, p_error_code: status === "success" ? null : "SETUP_TRIAL_PROVIDER_RESULT",
          p_latency_ms: answer?.usage.latencyMs ?? 0, p_response_id: answer?.usage.responseId ?? null, p_actual_model_id: answer?.usage.actualModelId ?? null,
        } as never);
        return !settled.error && settled.data === true;
      } catch {
        return false;
      }
    };
    // A billed but unusable (empty/truncated/unverifiable) call is priced from provider usage as
    // `incomplete` and never counts as a reply. If that cannot be recorded, hold it as `uncertain`.
    const settleBilled = async (usage: Extract<AnswerResult, { ok: true }>["usage"] | undefined): Promise<boolean> =>
      (usage ? await settle("incomplete", { usage }) : false) || settle("uncertain");
    const PENDING = { ok: false as const, code: "TRIAL_PENDING", message: "Accounting requires reconciliation; do not retry" };
    const rate=await checkRateLimit('ai_trial',`company:${input.companyId}`);
    if(!rate.allowed){
      if(!await settle('rejected'))return PENDING;
      return {ok:false,code:rate.code,message:'Please wait before another request',httpStatus:rate.httpStatus,retryAfterSeconds:rate.retryAfterSeconds};
    }
    let startedOk = false;
    try {
      const started = await writer.rpc("es02_start_branch_trial" as never, { p_operation_id: operationId } as never);
      startedOk = !started.error && (started.data as unknown as { ok?: boolean })?.ok === true;
    } catch { startedOk = false; }
    if (!startedOk) {
      // No provider request has been made; releasing the hold at zero cost is safe.
      if (!await settle("rejected")) return PENDING;
      return { ok: false, code: "UNAVAILABLE", message: "Authorization changed before the provider request" };
    }
    let completion: AnswerResult;
    try {
      completion = await provider.complete({
        question: input.question.trim(),
        locale,
        chunks,
        persona,
        maxOutputTokens: TRIAL_MAX_OUTPUT_TOKENS,
      });
    }
    catch {
      // No response body or usage evidence reached the server. Release the hold at zero
      // cost so the branch is not permanently locked; never replay this operationId.
      if (!await settle("rejected")) return PENDING;
      return { ok: false, code: "UNAVAILABLE", message: "Provider request failed before a verifiable result; you may ask a new question", retrySafe: true };
    }
    if (!completion.ok) {
      const safeFailure = completion.providerAttempted === false || completion.retrySafe === true;
      const noUsageEvidence = !completion.usage;
      if (!safeFailure && completion.providerAttempted === true && completion.usage) {
        if (!await settleBilled(completion.usage as Extract<AnswerResult, { ok: true }>["usage"])) return PENDING;
        return { ok: false, code: "UNAVAILABLE", message: "Provider returned no complete answer; usage was recorded and no reply was counted" };
      }
      // Timeout/transport failures without usage must not settle as uncertain — that
      // permanently blocks canAsk with only a refresh button (C15.2).
      const releaseHold = safeFailure || noUsageEvidence;
      if (!await settle(releaseHold ? "rejected" : "uncertain")) return PENDING;
      return {
        ok: false,
        code: releaseHold ? (safeFailure ? completion.code : "UNAVAILABLE") : "TRIAL_OUTCOME_UNKNOWN",
        message: completion.message || "Provider did not return a verified answer",
        ...(releaseHold ? { retrySafe: true, ...(completion.requestId ? { requestId: completion.requestId } : {}) } : {}),
      };
    }
    if (!completion.text.trim() || completion.modelId !== configuredModel) {
      if (!await settleBilled(completion.usage)) return PENDING;
      return { ok: false, code: "TRIAL_OUTCOME_UNKNOWN", message: "Provider response identity could not be verified" };
    }
    let result;
    try {
      const usage = { promptTokens: completion.usage.promptTokens!, completionTokens: completion.usage.completionTokens!, cachedTokens: completion.usage.cachedTokens!, reasoningTokens: completion.usage.reasoningTokens!, cacheWriteTokens: completion.usage.cacheWriteTokens ?? 0, totalTokens: completion.usage.totalTokens! };
      const cost = priceRealUsage(usage, pricing);
      if (!completion.usage.actualModelId || !completion.usage.requestId) throw Error("PROVIDER_IDENTITY_MISSING");
      result = { question: input.question.trim(), answer: completion.text.trim(), modelId: configuredModel, usage, ...cost, requestId: completion.usage.requestId, responseId: completion.usage.responseId ?? null, actualModelId: completion.usage.actualModelId, latencyMs: completion.usage.latencyMs ?? 0 };
    } catch {
      if (!await settleBilled(completion.usage)) return PENDING;
      return { ok: false, code: "TRIAL_OUTCOME_UNKNOWN", message: "Provider usage could not be verified" };
    }
    const binding = { p_operation_id: operationId, p_account_id: identity.userId, p_session_id: identity.nativeSessionId, p_company_id: input.companyId, p_branch_id: input.branchId };
    const saved = await writer.rpc("es02_checkpoint_branch_trial_result" as never, { ...binding, p_result: result } as never);
    if (saved.error || (saved.data as unknown as {ok?:boolean})?.ok !== true) return { ok: false, code: "TRIAL_PENDING", message: "Result persistence is unconfirmed; do not resend" };
    const recovered = await writer.rpc("es02_recover_branch_trial_result" as never, binding as never);
    if (recovered.error || (recovered.data as unknown as {ok?:boolean})?.ok !== true) return { ok: false, code: "TRIAL_PENDING", message: "The saved result needs recovery; do not resend" };
    const snapshot = await readOwnedBranchAssistantTrialAction(input);
    if (!snapshot) return { ok: false, code: "TRIAL_PENDING", message: "The saved trial receipt could not be read; do not resend" };
    return { ok: true, snapshot: (recovered.data as unknown as {discarded?:boolean})?.discarded===true ? {...snapshot,recoveryNotice:"context_changed"} : snapshot };
  });
}

/** Recover a persisted response only. This action never dispatches an AI request. */
export async function recoverOwnedBranchAssistantTrialAction(input: TrialScope & {operationId:string}):Promise<AssistantTrialAskResult>{
  if(!validScope(input)||!UUID.test(input.operationId))return {ok:false,code:"INVALID_INPUT",message:"Invalid recovery scope"};
  const identity=await readSessionIdentity();
  if(!identity.ok||identity.userId!==input.expectedAccountId||!UUID.test(identity.nativeSessionId||""))return {ok:false,code:"UNAUTHENTICATED",message:"A current session is required"};
  const snapshot=await readOwnedBranchAssistantTrialAction(input);
  if(!snapshot)return {ok:false,code:"UNAVAILABLE",message:"Branch authority could not be verified"};
  const writer=createAdminClient();if(!writer)return {ok:false,code:"UNAVAILABLE",message:"Recovery is unavailable"};
  const result=await writer.rpc("es02_recover_branch_trial_result" as never,{p_operation_id:input.operationId,p_account_id:identity.userId,p_session_id:identity.nativeSessionId,p_company_id:input.companyId,p_branch_id:input.branchId} as never);
  if(result.error||(result.data as unknown as {ok?:boolean})?.ok!==true)return {ok:false,code:"TRIAL_PENDING",message:"Recovery remains unconfirmed; do not resend"};
  const fresh=await readOwnedBranchAssistantTrialAction(input);
  return fresh&&((result.data as unknown as {discarded?:boolean})?.discarded===true||fresh.messages.some(m=>m.executionId===input.operationId&&m.origin==="engine"))?{ok:true,snapshot:(result.data as unknown as {discarded?:boolean})?.discarded===true?{...fresh,recoveryNotice:"context_changed"}:fresh}:{ok:false,code:"TRIAL_PENDING",message:"Saved receipt could not be verified"};
}

/**
 * Release a non-recoverable uncertain setup-trial hold that has no provider identity.
 * Never dispatches AI and never invents usage; only zero-cost reconcile is allowed.
 */
export async function releaseOwnedBranchAssistantTrialAction(input: TrialScope & {operationId:string}):Promise<AssistantTrialAskResult>{
  if(!validScope(input)||!UUID.test(input.operationId))return {ok:false,code:"INVALID_INPUT",message:"Invalid release scope"};
  const identity=await readSessionIdentity();
  if(!identity.ok||identity.userId!==input.expectedAccountId||!UUID.test(identity.nativeSessionId||""))return {ok:false,code:"UNAUTHENTICATED",message:"A current session is required"};
  const snapshot=await readOwnedBranchAssistantTrialAction(input);
  if(!snapshot)return {ok:false,code:"UNAVAILABLE",message:"Branch authority could not be verified"};
  const pending=snapshot.pendingOperation;
  if(!pending||pending.id!==input.operationId||pending.recoverable||pending.status!=="uncertain"){
    return {ok:false,code:"TRIAL_PENDING",message:"Only a non-recoverable uncertain hold can be released"};
  }
  const writer=createAdminClient();
  if(!writer)return {ok:false,code:"UNAVAILABLE",message:"Release is unavailable"};
  let released=false;
  try{
    const result=await writer.rpc("ai_reconcile_attempt" as never,{
      p_id:input.operationId,
      p_cost_usd:0,
      p_cost_baisa:0,
      p_usage:{},
      p_provider_reference:"setup_trial_timeout_no_provider_evidence",
    } as never);
    released=!result.error&&result.data===true;
  }catch{released=false;}
  if(!released)return {ok:false,code:"TRIAL_PENDING",message:"Hold could not be released; do not resend"};
  const fresh=await readOwnedBranchAssistantTrialAction(input);
  if(!fresh||fresh.pendingOperation)return {ok:false,code:"TRIAL_PENDING",message:"Hold release needs another status check"};
  return {ok:true,snapshot:fresh};
}
