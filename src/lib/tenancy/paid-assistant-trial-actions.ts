"use server";
import {checkRateLimit} from "@/lib/security/rate-limit";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
const SETUP_TRIAL_MODEL = "gemini-3.5-flash-lite" as const;
import {matchesRequestedModel} from '@/lib/answers/adapters/response-identity';
import type { AnswerResult, AnswerPersona, TrialProviderHandle } from "@/lib/answers/types";
import type {
  TrialScope,
  TrialSnapshot,
} from "@/components/app/paid-assistant-trial";
import { ANSWER_MAX_CONTEXT_CHARS, ANSWER_MAX_SOURCES } from "@/lib/answers/constants";
import { realModelPricing, reserveRealCost, priceRealUsage } from "@/lib/answers/runtime/economics";
import { buildAnswerSystemPrompt, formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
import { getAnswerProvider } from "@/lib/answers/provider";
import { isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { classifyHandoffPolicy } from "@/lib/answers/routing/handoff-policy";
import { loadApprovedBranchKnowledgeContext } from "./paid-branch-knowledge-actions";
import { branchHoursAssistantContext } from "./branch-hours-contracts";
import { readOwnedBranchHoursAction } from "./branch-hours-actions";
import { readOwnedBranchReplyLanguageAction } from "./paid-reply-language-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Output ceiling feeds reservation; it is not a guarantee of a fixed total trial cost. */
const TRIAL_MAX_OUTPUT_TOKENS = 512;

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
    const value = recovery.data as unknown as {ok?:boolean;operation?:{id:string;status:string;recoverable:boolean;blocksNewRequests?:boolean;pollable?:boolean;providerFailed?:boolean}|null};
    const op = !recovery.error && value?.ok === true ? value.operation : null;
    if(recovery.error||value?.ok!==true)return {...snapshot,canAsk:false};
    if(op&&UUID.test(op.id)&&["reserved","running","uncertain","success"].includes(op.status)&&typeof op.recoverable==="boolean"){
      const blocksNewRequests=!(op.status==="uncertain"&&!op.recoverable&&op.blocksNewRequests===false);
      return {...snapshot,pendingOperation:{...op,blocksNewRequests},canAsk:!blocksNewRequests&&snapshot.canAsk===true};
    }
    return op?{...snapshot,canAsk:false}:snapshot;
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
    // 1. Provider + live kill switch before any reservation. Explicit AI_LIVE_ANSWERING=false
    // wins over key presence (see isLiveAnsweringEnabled contract).
    const provider = getAnswerProvider(SETUP_TRIAL_MODEL);
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
    if (!isLiveAnsweringEnabled()) {
      logEvent("warn", "es02.branch_assistant_trial.live_disabled", {
        request_id: requestId,
        stage: "b6",
        detail: "Live answering kill switch blocked reservation; provider was not called.",
      });
      return {
        ok: false,
        code: "NEEDS_SETUP",
        message: "Live answering is disabled; request was not reserved.",
      };
    }

    const personaByLevel: Record<string, AnswerPersona> = { level_1: "noura", level_2: "lina", level_3: "dana" };
    const persona = personaByLevel[gate.data?.persona || ""];
    const configuredModel = SETUP_TRIAL_MODEL;
    if (!UUID.test(identity.nativeSessionId || "")) return { ok: false, code: "UNAVAILABLE", message: "Approved model and native session are required" };
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
    // Exact quick-question intent only; mixed/free-form questions retain their
    // approved knowledge. Business instructions always accompany the hours.
    const hoursOnly=/^(?:ما مواعيد العمل[؟?]?|what are the working hours\??)$/i.test(input.question.trim());
    const chunks = knowledgeContext.chunks.filter(chunk=>!hoursOnly||chunk.usageRole==='business_instructions');

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
        logEvent("warn", "es02.branch_assistant_trial.budget_exceeded", { request_id: requestId, stage: "b6", error_code: "TRIAL_BUDGET_EXCEEDED", detail: "Trial budget cap would be exceeded; request not sent." });
        return { ok: false, code: "TRIAL_BUDGET_EXCEEDED", message: "Trial budget would be exceeded; answer generation was not started", requestId, retrySafe: false };
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
    const settle = async (
      status: "success" | "rejected" | "incomplete" | "uncertain",
      answer?: Pick<Extract<AnswerResult, { ok: true }>, "usage">,
      evidence?: { errorCode?: string | null; latencyMs?: number | null; requestId?: string | null; responseId?: string | null; actualModelId?: string | null },
    ): Promise<boolean> => {
      try {
        let usage: Record<string, number> = {};
        let cost: { costUsd: number | null; costBaisa: number | null } = { costUsd: status === "uncertain" ? null : 0, costBaisa: status === "uncertain" ? null : 0 };
        if (answer) {
          usage = { promptTokens: answer.usage.promptTokens!, completionTokens: answer.usage.completionTokens!, cachedTokens: answer.usage.cachedTokens!, reasoningTokens: answer.usage.reasoningTokens!, cacheWriteTokens: answer.usage.cacheWriteTokens ?? 0, totalTokens: answer.usage.totalTokens! };
          cost = priceRealUsage(usage as Parameters<typeof priceRealUsage>[0], pricing);
          if (!answer.usage.actualModelId || !answer.usage.requestId) return false;
        }
        const providerError =
          typeof evidence?.errorCode === "string" && evidence.errorCode.trim()
            ? evidence.errorCode.trim().slice(0, 80)
            : "SETUP_TRIAL_PROVIDER_RESULT";
        const latency =
          answer?.usage.latencyMs ??
          (typeof evidence?.latencyMs === "number" && Number.isFinite(evidence.latencyMs) ? Math.max(0, Math.floor(evidence.latencyMs)) : 0);
        const settled = await writer.rpc("ai_settle_admin_attempt" as never, {
          p_id: operationId, p_status: status, p_cost_usd: cost.costUsd, p_cost_baisa: cost.costBaisa, p_usage: usage,
          p_request_id: answer?.usage.requestId ?? evidence?.requestId ?? null,
          p_error_code: status === "success" ? null : providerError,
          p_latency_ms: latency,
          p_response_id: answer?.usage.responseId ?? evidence?.responseId ?? null,
          p_actual_model_id: answer?.usage.actualModelId ?? evidence?.actualModelId ?? null,
        } as never);
        return !settled.error && settled.data === true;
      } catch {
        return false;
      }
    };
    // A billed but unusable (empty/truncated/unverifiable) call is priced from provider usage as
    // `incomplete` and never counts as a reply. If that cannot be recorded, hold it as `uncertain`.
    const settleBilled = async (usage: Extract<AnswerResult, { ok: true }>["usage"] | undefined, evidence?: Parameters<typeof settle>[2]): Promise<boolean> =>
      (usage ? await settle("incomplete", { usage }, evidence) : false) || settle("uncertain", undefined, evidence);
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
      // Start RPC failed: provider.complete was never invoked. Zero-cost release is allowed.
      if (!await settle("rejected")) return PENDING;
      return { ok: false, code: "UNAVAILABLE", message: "Authorization changed before the provider request" };
    }
    let completion: AnswerResult;
    try {
      const providerInput = {
        question: input.question.trim(),
        locale,
        chunks,
        persona,
        maxOutputTokens: TRIAL_MAX_OUTPUT_TOKENS,
        // Gemini's SDK also sends this as X-Server-Timeout. Allow generation
        // beyond the former 30s deadline without retries or a larger token cap.
        timeoutMs: 60_000,
      };
      if(provider.startTrial){
        // Persist intent before dispatch so an abandoned create can be classified
        // separately from old running operations, without releasing its hold.
        const prepared=await Promise.resolve(writer.rpc('es02_attach_trial_provider' as never,{
          p_operation_id:operationId,p_account_id:identity.userId,p_session_id:identity.nativeSessionId,
          p_company_id:input.companyId,p_branch_id:input.branchId,p_handle:null,p_question:input.question.trim(),
        } as never)).catch(()=>null);
        if(!prepared||prepared.error||(prepared.data as unknown as {ok?:boolean})?.ok!==true){
          if(!await settle('rejected'))return PENDING;
          return {ok:false,code:'UNAVAILABLE',message:'Provider request was not dispatched'};
        }
        const started=await provider.startTrial(providerInput);
        if('pending'in started){
          const attach=()=>Promise.resolve(writer.rpc('es02_attach_trial_provider' as never,{
            p_operation_id:operationId,p_account_id:identity.userId,p_session_id:identity.nativeSessionId,
            p_company_id:input.companyId,p_branch_id:input.branchId,p_handle:started.handle,p_question:input.question.trim(),
          } as never)).catch(()=>null);
          let attached=await attach();
          if(!attached||attached.error||(attached.data as unknown as {ok?:boolean})?.ok!==true)attached=await attach();
          // An ambiguous DB acknowledgement must not erase a handle that may have saved.
          if(!attached||attached.error||(attached.data as unknown as {ok?:boolean})?.ok!==true)return {ok:false,code:'TRIAL_PENDING',message:'Provider handle persistence needs recovery; do not resend'};
          const snapshot=await readOwnedBranchAssistantTrialAction(input).catch(()=>null);
          return snapshot?{ok:true,snapshot}:{ok:false,code:'TRIAL_PENDING',message:'Saved provider request awaits retrieval'};
        }
        completion=started;
      }else completion=await provider.complete(providerInput);
    }
    catch {
      // Transport threw after start — reach evidence is unknown. Do not unlock.
      if (!await settle("uncertain")) return PENDING;
      return { ok: false, code: "TRIAL_OUTCOME_UNKNOWN", message: "Provider outcome requires reconciliation; do not resend" };
    }
    if (!completion.ok) {
      // Classify by provider-reach evidence only — never by start alone or retrySafe alone.
      const reachedProvider = completion.providerAttempted === true;
      if (reachedProvider && completion.usage) {
        if (!await settleBilled(completion.usage, { errorCode: completion.providerErrorCode ?? completion.code, latencyMs: completion.latencyMs ?? null, requestId: completion.requestId ?? null })) return PENDING;
        return { ok: false, code: "UNAVAILABLE", message: "Provider returned no complete answer; usage was recorded and no reply was counted" };
      }
      // reached without usage, OR adapter claims non-attempt after start: hold. Adapter
      // retrySafe (e.g. HTTP 403/404) is fallback metadata, not settlement authority.
      logEvent("warn", "es02.branch_assistant_trial.provider_unconfirmed", {
        request_id: requestId,
        operation_id: operationId,
        provider: completion.provider ?? "google",
        model_id: completion.modelId ?? configuredModel,
        latency_ms: completion.latencyMs ?? null,
        stage: "b6",
        error_code: completion.providerErrorCode ?? completion.code,
        adapter_code: completion.code,
        provider_http_status: completion.providerHttpStatus ?? null,
        detail: reachedProvider ? "provider_attempted_without_usage" : "non_attempt_after_start",
      });
      if (!await settle("uncertain", undefined, {
        errorCode: completion.providerErrorCode ?? completion.code,
        latencyMs: completion.latencyMs ?? null,
        requestId: completion.requestId ?? null,
      })) return PENDING;
      // Provider authentication is not customer authentication. Keep the original
      // code in secure evidence, while the UI remains pending without retry authority.
      return {
        ok: false,
        code: "TRIAL_OUTCOME_UNKNOWN",
        message: "Could not get a reply. Check request status before sending another question.",
        requestId,
        retrySafe: false,
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
  const recoveryStartedAt=Date.now();
  if(!validScope(input)||!UUID.test(input.operationId))return {ok:false,code:"INVALID_INPUT",message:"Invalid recovery scope"};
  const isolated=getIsolatedTrialConfig();
  if(isolated.restricted&&(!isolated.isComplete||input.branchId!==isolated.pinnedBranchId))return {ok:false,code:'UNAVAILABLE',message:'Recovery scope unavailable'};
  const identity=await readSessionIdentity();
  if(!identity.ok||identity.userId!==input.expectedAccountId||!UUID.test(identity.nativeSessionId||""))return {ok:false,code:"UNAUTHENTICATED",message:"A current session is required"};
  // The owner/session/branch-checked load RPC is the retrieval authority.
  // A full transcript/readiness projection is needed only after a terminal result.
  const writer=createAdminClient();if(!writer)return {ok:false,code:"UNAVAILABLE",message:"Recovery is unavailable"};
  const binding={p_operation_id:input.operationId,p_account_id:identity.userId,p_session_id:identity.nativeSessionId,p_company_id:input.companyId,p_branch_id:input.branchId};
  const loaded=await Promise.resolve(writer.rpc('es02_load_trial_provider' as never,binding as never)).catch(()=>null);
  const durable=loaded?.data as unknown as {ok?:boolean;submissionUnknown?:boolean;data?:{handle:TrialProviderHandle;question:string;sessionId:string;pricing:ReturnType<typeof realModelPricing>;state:string;checkpoint:boolean}|null};
  logEvent('info','es02.branch_assistant_trial.retrieve_binding',{operation_id:input.operationId,authorized:durable?.ok===true,has_handle:!!durable?.data,state:durable?.data?.state??null,duration_ms:Date.now()-recoveryStartedAt});
  if(!loaded||loaded.error||durable?.ok!==true)return {ok:false,code:'TRIAL_PENDING',message:'Provider recovery authority unavailable'};
  if(durable.submissionUnknown){const fresh=await readOwnedBranchAssistantTrialAction(input);return fresh?{ok:true,snapshot:fresh}:{ok:false,code:'TRIAL_PENDING',message:'Submission outcome remains unknown'};}
  const stored=durable.data;
  if(stored&&stored.state==='running'&&!stored.checkpoint){
    const provider=getAnswerProvider();
    if(!provider?.retrieveTrial)return {ok:false,code:'TRIAL_PENDING',message:'Provider retrieval unavailable'};
    const completion=await provider.retrieveTrial(stored.handle).catch(()=>null);
    if(!completion||'pending'in completion)return {ok:false,code:'TRIAL_PENDING',message:'Saved provider request is still in progress'};
    const usage=completion.usage;
    let priced:{usage:{promptTokens:number;completionTokens:number;cachedTokens:number;reasoningTokens:number;cacheWriteTokens:number;totalTokens:number};costUsd:number;costBaisa:number}|null=null;
    try{
      if(!usage||!usage.actualModelId||!matchesRequestedModel(usage.actualModelId,stored.handle.modelId)||stored.pricing.modelId!==stored.handle.modelId||usage.requestId!==stored.handle.id)throw Error('UNVERIFIED_USAGE');
      const tokens={promptTokens:usage.promptTokens!,completionTokens:usage.completionTokens!,cachedTokens:usage.cachedTokens!,reasoningTokens:usage.reasoningTokens!,cacheWriteTokens:usage.cacheWriteTokens??0,totalTokens:usage.totalTokens!};
      priced={usage:tokens,...priceRealUsage(tokens,stored.pricing)};
    }catch{priced=null;}
    if(!completion.ok||!priced){
      const errorCode=!completion.ok?completion.providerErrorCode??completion.code:'GEMINI_USAGE_UNVERIFIED';
      const settlement=await Promise.resolve(writer.rpc('ai_settle_admin_attempt' as never,{p_id:input.operationId,p_status:priced?'incomplete':'uncertain',p_cost_usd:priced?.costUsd??null,p_cost_baisa:priced?.costBaisa??null,p_usage:priced?.usage??null,p_request_id:stored.handle.id,p_error_code:errorCode,p_latency_ms:usage?.latencyMs??(!completion.ok?completion.latencyMs:undefined)??0,p_response_id:usage?.responseId??null,p_actual_model_id:usage?.actualModelId??null} as never)).catch(()=>null);
      logEvent('warn','es02.branch_assistant_trial.background_failed',{operation_id:input.operationId,error_code:errorCode,detail:'Provider terminal result; generation was not retried.'});
      if(!settlement||settlement.error||settlement.data!==true)return {ok:false,code:'TRIAL_PENDING',message:'Terminal provider result needs accounting recovery'};
      const fresh=await readOwnedBranchAssistantTrialAction(input);
      return fresh?{ok:true,snapshot:{...fresh,providerFailure:true}}:{ok:false,code:'TRIAL_PENDING',message:'Provider failure recorded'};
    }
    const checkpoint=await Promise.resolve(writer.rpc('es02_checkpoint_branch_trial_result' as never,{...binding,p_session_id:stored.sessionId,p_result:{question:stored.question,answer:completion.text.trim(),modelId:stored.handle.modelId,...priced,requestId:stored.handle.id,responseId:usage!.responseId??stored.handle.id,actualModelId:usage!.actualModelId,latencyMs:usage!.latencyMs??0}} as never)).catch(()=>null);
    if(!checkpoint||checkpoint.error||(checkpoint.data as unknown as {ok?:boolean})?.ok!==true)return {ok:false,code:'TRIAL_PENDING',message:'Retrieved result awaits durable settlement'};
  }
  const result=await writer.rpc("es02_recover_branch_trial_result" as never,{p_operation_id:input.operationId,p_account_id:identity.userId,p_session_id:identity.nativeSessionId,p_company_id:input.companyId,p_branch_id:input.branchId} as never);
  if(result.error||(result.data as unknown as {ok?:boolean})?.ok!==true)return {ok:false,code:"TRIAL_PENDING",message:"Recovery remains unconfirmed; do not resend"};
  const fresh=await readOwnedBranchAssistantTrialAction(input);
  return fresh&&((result.data as unknown as {discarded?:boolean})?.discarded===true||fresh.messages.some(m=>m.executionId===input.operationId&&m.origin==="engine"))?{ok:true,snapshot:(result.data as unknown as {discarded?:boolean})?.discarded===true?{...fresh,recoveryNotice:"context_changed"}:fresh}:{ok:false,code:"TRIAL_PENDING",message:"Saved receipt could not be verified"};
}

/**
 * Re-check an owned uncertain hold. Missing provider identity is not proof of
 * non-execution; this customer action cannot manufacture a reconciliation receipt.
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
  return {ok:false,code:"TRIAL_PENDING",message:"Provider outcome requires verified reconciliation before this hold can be released; do not resend"};
}
