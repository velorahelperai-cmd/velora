"use server";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiModelId } from "@/lib/answers/config/env";
import type { AnswerResult, AnswerPersona } from "@/lib/answers/types";
import type {
  TrialScope,
  TrialSnapshot,
} from "@/components/app/paid-assistant-trial";
import { realModelPricing, reserveRealCost, priceRealUsage } from "@/lib/answers/runtime/economics";
import { buildAnswerSystemPrompt, formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
import { getAnswerProvider } from "@/lib/answers/provider";
import { loadApprovedBranchKnowledgeContext } from "./paid-branch-knowledge-actions";
import { readOwnedBranchHoursAction } from "./branch-hours-actions";
import { readOwnedBranchReplyLanguageAction } from "./paid-reply-language-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  | { ok: false; code: string; message: string };

export async function readOwnedBranchAssistantTrialAction(
  scope: TrialScope
): Promise<TrialSnapshot | null> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: scope?.expectedAccountId }, async () => {
    if (!validScope(scope)) return null;
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
    return payload.data?.snapshot ?? null;
  });
}

export async function askOwnedBranchAssistantTrialAction(
  input: TrialScope & { expectedVersion: number; knowledgeRevision: string; question: string; operationId?: string }
): Promise<AssistantTrialAskResult> {
  const requestId = randomUUID();
  return withLogContext({ request_id: requestId, user_id: input?.expectedAccountId }, async () => {
    if (!validScope(input) || !input.question?.trim() || input.question.trim().length > 1000 || (input.operationId !== undefined && !UUID.test(input.operationId))) {
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
    // 1. Authoritative Answer Provider (Gemini). Return explicit error if not configured.
    const provider = getAnswerProvider();
    if (!provider) {
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
    let hoursChunkText = "";
    const hoursRev = hours.ok && hours.snapshot ? (hours.snapshot.version ?? 1) : 0;
    if (hours.ok && hours.snapshot) {
      hoursChunkText = `Branch hours (${hours.snapshot.branchLabel}, timezone: ${hours.snapshot.timezone || "unknown"}):\n` +
        JSON.stringify(hours.snapshot.schedule);
    }

    // 3. Load approved branch knowledge (indexed website pages + approved sources)
    const knowledgeContext = await loadApprovedBranchKnowledgeContext(input.companyId, input.branchId);
    if (!knowledgeContext.ok || knowledgeContext.chunks.length === 0) return { ok: false, code: "UNAVAILABLE", message: "Approved knowledge could not be verified" };
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

    // 4. Branch confirmed reply language
    const langRes = await readOwnedBranchReplyLanguageAction({
      expectedAccountId: input.expectedAccountId,
      companyId: input.companyId,
      branchId: input.branchId,
    });
    if (!langRes || !["ar", "en", "both"].includes(langRes.replyLanguage || "")) return { ok: false, code: "UNAVAILABLE", message: "Confirmed reply language could not be verified" };
    const locale: "ar" | "en" = langRes.replyLanguage === "en" || (langRes.replyLanguage === "both" && !/[\u0600-\u06ff]/.test(input.question)) ? "en" : "ar";

    const operationId = input.operationId || requestId;
    const pricing = realModelPricing(configuredModel);
    const reservedBaisa = reserveRealCost(configuredModel, buildAnswerSystemPrompt(locale, persona), formatAnswerUserPrompt(input.question, chunks, locale), pricing);
    const reservation = await writer.rpc("es02_reserve_branch_trial" as never, {
      p_operation_id: operationId, p_account_id: identity.userId, p_session_id: identity.nativeSessionId,
      p_company_id: input.companyId, p_branch_id: input.branchId, p_question: input.question.trim(),
      p_knowledge_revision: knowledgeContext.knowledgeRevision, p_hours_revision: hoursRev, p_language_code: langRes.replyLanguage,
      p_persona: persona, p_model_id: configuredModel, p_reserved_baisa: reservedBaisa,
      p_pricing_version: pricing.version, p_pricing_snapshot: pricing,
      p_source_citations: chunks.map(({ sourceId, title, contentVersion }) => ({ sourceId, title, contentVersion })),
    } as never);
    const allowance = reservation.data as unknown as { ok?: boolean; code?: string; newlyReserved?: boolean; state?: string } | null;
    if (reservation.error || allowance?.ok !== true) return { ok: false, code: allowance?.code || "UNAVAILABLE", message: "Free setup allowance could not be reserved" };
    if (!allowance.newlyReserved) {
      if (allowance.state === "success") {
        const snapshot = await readOwnedBranchAssistantTrialAction(input);
        if (snapshot?.messages.length) return { ok: true, snapshot };
      }
      return { ok: false, code: "TRIAL_PENDING", message: "This operation is already recorded; it will not be sent again" };
    }
    const settle = async (status: "success" | "rejected" | "uncertain", answer?: Extract<AnswerResult, { ok: true }>) => {
      let usage: Record<string, number> = {};
      let cost: { costUsd: number | null; costBaisa: number | null } = { costUsd: status === "uncertain" ? null : 0, costBaisa: status === "uncertain" ? null : 0 };
      if (answer) {
        usage = { promptTokens: answer.usage.promptTokens!, completionTokens: answer.usage.completionTokens!, cachedTokens: answer.usage.cachedTokens!, reasoningTokens: answer.usage.reasoningTokens!, cacheWriteTokens: answer.usage.cacheWriteTokens ?? 0, totalTokens: answer.usage.totalTokens! };
        cost = priceRealUsage(usage as Parameters<typeof priceRealUsage>[0], pricing);
        if (!answer.usage.actualModelId || !answer.usage.requestId) throw Error("PROVIDER_IDENTITY_MISSING");
      }
      const settled = await writer.rpc("ai_settle_admin_attempt" as never, {
        p_id: operationId, p_status: status, p_cost_usd: cost.costUsd, p_cost_baisa: cost.costBaisa, p_usage: usage,
        p_request_id: answer?.usage.requestId ?? null, p_error_code: status === "success" ? null : "SETUP_TRIAL_PROVIDER_RESULT",
        p_latency_ms: answer?.usage.latencyMs ?? 0, p_response_id: answer?.usage.responseId ?? null, p_actual_model_id: answer?.usage.actualModelId ?? null,
      } as never);
      return !settled.error && settled.data === true;
    };
    const started = await writer.rpc("es02_start_branch_trial" as never, { p_operation_id: operationId } as never);
    if (started.error || (started.data as unknown as { ok?: boolean })?.ok !== true) {
      await settle("rejected");
      return { ok: false, code: "UNAVAILABLE", message: "Authorization changed before the provider request" };
    }
    let completion: AnswerResult;
    try { completion = await provider.complete({ question: input.question.trim(), locale, chunks, persona }); }
    catch {
      await settle("uncertain");
      return { ok: false, code: "TRIAL_OUTCOME_UNKNOWN", message: "Provider outcome is unknown; this operation will not be retried" };
    }
    if (!completion.ok) {
      const safeFailure = completion.providerAttempted === false || completion.retrySafe === true;
      if (!await settle(safeFailure ? "rejected" : "uncertain")) return { ok: false, code: "TRIAL_PENDING", message: "Accounting requires reconciliation; do not retry" };
      return { ok: false, code: safeFailure ? completion.code : "TRIAL_OUTCOME_UNKNOWN", message: completion.message || "Provider did not return a verified answer" };
    }
    try {
      if (!await settle("success", completion)) return { ok: false, code: "TRIAL_PENDING", message: "Accounting requires reconciliation; do not retry" };
    } catch {
      await settle("uncertain");
      return { ok: false, code: "TRIAL_OUTCOME_UNKNOWN", message: "Provider usage could not be verified; do not retry" };
    }

    if (!completion.text.trim() || completion.modelId !== configuredModel) return { ok: false, code: "UNAVAILABLE", message: "Provider response identity could not be verified" };
    // A completed provider request is never repeated after a context/receipt failure.
    const freshIdentity = await readSessionIdentity();
    const freshGateResult = await authorityClient.rpc("es02_read_owned_branch_setup" as never, {
      p_expected_account_id: input.expectedAccountId, p_company_id: input.companyId, p_branch_id: input.branchId,
    } as never);
    const freshGate = freshGateResult.data as unknown as typeof gate;
    const freshKnowledge = await loadApprovedBranchKnowledgeContext(input.companyId, input.branchId);
    const freshHours = await readOwnedBranchHoursAction(input);
    const freshLanguage = await readOwnedBranchReplyLanguageAction(input);
    if (!freshIdentity.ok || freshIdentity.userId !== identity.userId || freshIdentity.nativeSessionId !== identity.nativeSessionId ||
        freshGateResult.error || freshGate?.ok !== true || freshGate.data?.persona !== gate.data?.persona ||
        !freshKnowledge.ok || freshKnowledge.knowledgeRevision !== knowledgeContext.knowledgeRevision ||
        !freshHours.ok || freshHours.snapshot?.version !== hours.snapshot.version ||
        freshLanguage?.replyLanguage !== langRes.replyLanguage || getGeminiModelId() !== configuredModel) {
      return { ok: false, code: "CONTEXT_CHANGED", message: "Authorization or answer context changed; no trial proof was recorded" };
    }
    const answerText = completion.text;
    const modelId = completion.modelId;
    const effectiveKnowledgeRev = knowledgeContext.knowledgeRevision;

    // 6. Record genuine engine interaction in DB with revision hashes
    const res = await writer.rpc("es02_record_owned_branch_assistant_trial" as never, {
      p_expected_account_id: input.expectedAccountId,
      p_company_id: input.companyId,
      p_branch_id: input.branchId,
      p_question: input.question.trim(),
      p_answer: answerText,
      p_model_id: modelId,
      p_hours_revision: hoursRev,
      p_language_code: langRes.replyLanguage,
      p_persona: persona,
      p_execution_id: operationId,
      p_knowledge_revision: effectiveKnowledgeRev,
    } as never);

    const payload = res.data as unknown as { ok?: boolean };
    if (res.error || !payload || payload.ok !== true) {
      return { ok: false, code: "STORAGE_FAILED", message: "Failed to persist trial interaction" };
    }
    const snapshot = await readOwnedBranchAssistantTrialAction(input);
    if (!snapshot) return { ok: false, code: "STORAGE_FAILED", message: "Trial receipt could not be read" };
    return { ok: true, snapshot };
  });
}
