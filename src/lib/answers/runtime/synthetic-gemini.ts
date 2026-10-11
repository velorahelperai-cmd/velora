import "server-only";
import { createGeminiSyntheticTransport } from "../adapters/gemini";
import { createRealRuntimeStore, type RealRuntimeStore } from "./store";
import { readSyntheticGeminiConfig } from "./synthetic-gemini-config";

type Identity = { actorId: string; sessionId: string; companyId: string; executionId: string };
type SyntheticInput = Identity & { executeConfirmed: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = "gemini-free-synthetic-v1";
const failure = (error: string) => ({ ok: false as const, error, retrySafe: false as const });

/** Server-only opt-in. Client input cannot attest billing, authorize a model, or supply a prompt. */
function approvedConfig(input: SyntheticInput, env: NodeJS.ProcessEnv) {
  const config = readSyntheticGeminiConfig(env);
  if (!config || (["actorId", "companyId", "executionId"] as const).some(k => config.attestation[k] !== input[k]) ||
      config.attestation.sessionId !== input.sessionId) return null;
  return { model: config.model, key: config.key, verifiedAt: config.attestation.verifiedAt };
}
/** Internal runner. Only the owner-authenticated server action exposes it; dependencies are for offline tests. */
export async function executeSyntheticGemini(input: SyntheticInput,
  dependencies?: { env?: NodeJS.ProcessEnv; store?: RealRuntimeStore }) {
  const allowed = ["actorId", "sessionId", "companyId", "executionId", "executeConfirmed"];
  if (!input || Object.keys(input).some(k => !allowed.includes(k)) ||
      input.executeConfirmed !== true ||
      (["actorId", "sessionId", "companyId", "executionId"] as const).some(k => !UUID.test(input[k] ?? ""))) {
    return failure("SYNTHETIC_INPUT_REQUIRED");
  }
  const config = approvedConfig(input, dependencies?.env ?? process.env);
  if (!config) return failure("FREE_SYNTHETIC_NEEDS_SETUP");
  let store: RealRuntimeStore;
  try {
    store = dependencies?.store ?? createRealRuntimeStore();
    const reservation = await store.reserve({
      ...input, id: input.executionId, attempt: 1, usageMode: "admin_test",
      model: config.model, provider: "google", reservedBaisa: 1, pricingVersion: VERSION,
      pricingSnapshot: { modelId: config.model, version: VERSION, tier: "free",
        inputUsdPerMillion: 0, outputUsdPerMillion: 0, verifiedAt: config.verifiedAt,
        syntheticOnly: true, maxOutputTokens: 128, maxPromptTokens: 1024 },
    });
    if (!reservation.ok) return failure("RESERVATION_REJECTED");
  } catch { return failure("RESERVATION_UNVERIFIED"); }

  try {
    if (!await store.start(input.executionId)) {
      const settled = await store.settle({ id: input.executionId, status: "rejected",
        costUsd: 0, costBaisa: 0, usage: null, errorCode: "START_REJECTED", latencyMs: 0 });
      return failure(settled ? "START_REJECTED" : "SETTLEMENT_UNVERIFIED");
    }
  } catch {
    // A start write might have committed. No provider dispatch, and no guessing the durable state.
    return failure("START_UNVERIFIED");
  }
  // Revalidate the short-lived attestation immediately before dispatch.
  if (!approvedConfig(input, dependencies?.env ?? process.env)) {
    try {
      if (!await store.settle({ id: input.executionId, status: "rejected", costUsd: 0,
        costBaisa: 0, usage: null, errorCode: "ATTESTATION_EXPIRED", latencyMs: 0 })) return failure("SETTLEMENT_UNVERIFIED");
    } catch { return failure("SETTLEMENT_UNVERIFIED"); }
    return failure("FREE_SYNTHETIC_NEEDS_SETUP");
  }
  let result: Awaited<ReturnType<ReturnType<typeof createGeminiSyntheticTransport>>>;
  try { result = await createGeminiSyntheticTransport(config.key, config.model)(); }
  catch { result = { ok: false, status: "uncertain", error: "PROVIDER_OUTCOME_UNKNOWN", latencyMs: 0 }; }
  try {
    const settled = await store.settle({
      id: input.executionId, status: result.status,
      costUsd: result.status === "uncertain" ? null : 0,
      costBaisa: result.status === "uncertain" ? null : 0,
      usage: result.ok ? result.usage : null, latencyMs: result.latencyMs,
      requestId: result.ok ? result.requestId : undefined,
      responseId: result.ok ? result.responseId : undefined,
      actualModelId: result.ok ? result.actualModelId : undefined,
      errorCode: result.ok ? undefined : result.error,
    });
    if (!settled) return failure("SETTLEMENT_UNVERIFIED");
  } catch { return failure("SETTLEMENT_UNVERIFIED"); }
  if (!result.ok) return failure(result.error);
  return { ok: true as const, text: "VELORA_SYNTHETIC_OK", synthetic: true as const,
    modelId: config.model, provider: "google" as const, usage: result.usage, costUsd: 0, costBaisa: 0,
    executionId: input.executionId, retrySafe: false as const };
}
