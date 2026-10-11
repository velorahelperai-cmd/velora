import "server-only";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isSyntheticUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
type Attestation = { verifiedAt: string; projectRef: string; modelId: "gemini-3.8-flash"; actorId: string; companyId: string; executionId: string; sessionId: string };
function fresh(value: unknown, now: number, maximumAge: number) { const at = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(at) && at <= now && now-at <= maximumAge ? at : null; }
/** Operator evidence is trusted server configuration, never accepted from a client. */
export function readSyntheticGeminiConfig(env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
 if (env.VELORA_GEMINI_FREE_ENABLED !== "true") return null;
 const reference = env.VELORA_GEMINI_FREE_KEY_REFERENCE;
 if (reference !== "AI_GEMINI_API_KEY" && reference !== "AI_GEMINI_FREE_API_KEY") return null;
 const key = env[reference]?.trim(); if (!key) return null;
 try {
  const a = JSON.parse(env.VELORA_GEMINI_FREE_ATTESTATION ?? "") as Record<string, unknown>;
  const at = fresh(a.verifiedAt, now, 3_600_000);
  if (at === null || a.version !== 1 || a.keyReference !== reference || a.billingDisabled !== true ||
      a.freeModelVerified !== true || a.regionAllowed !== true || a.unpaidTermsAccepted !== true || a.ledgerVerified !== true ||
      typeof a.projectRef !== "string" || !/^[a-z0-9][a-z0-9-]{5,62}$/.test(a.projectRef) || a.modelId !== "gemini-3.8-flash" ||
      ![a.actorId,a.sessionId,a.companyId,a.executionId].every(isSyntheticUuid)) return null;
  const quota = a.quota as Record<string, unknown> | undefined;
  const quotaAt = quota && fresh(quota.verifiedAt, now, 300_000);
  if (!quota || quotaAt === undefined || quotaAt === null || quota.modelId !== a.modelId ||
      !Number.isSafeInteger(quota.requestsAvailable) || Number(quota.requestsAvailable) < 1 ||
      !Number.isSafeInteger(quota.promptTokensAvailable) || Number(quota.promptTokensAvailable) < 1024) return null;
  return { key, model: "gemini-3.8-flash" as const, attestation: a as unknown as Attestation,
   expiresAt: new Date(Math.min(at+3_600_000, quotaAt+300_000)).toISOString() };
 } catch { return null; }
}
