import "server-only";
import { isLiveAnsweringEnabled } from "../guards";
import { executeReservedRealAnswer, type RealAnswerPayload, type RealAnswerResult } from "./execute";
import { callRealModel } from "./provider";
import { createClaimedWhatsappRuntimeStore, type ClaimedWhatsappRuntimeStore } from "./whatsapp-store";

export type ClaimedWhatsappAnswerInput = RealAnswerPayload & { jobId: string; claimToken: string };

/** Explicit ports support offline checks; no identity/session is fabricated for a worker. */
export async function executeClaimedWhatsappAnswer(
  input: ClaimedWhatsappAnswerInput,
  deps: { store: ClaimedWhatsappRuntimeStore; call: typeof callRealModel },
): Promise<RealAnswerResult> {
  if (!input.jobId?.trim() || !input.claimToken?.trim()) return { ok: false, error: "INVALID_INPUT", attempts: [] };
  return executeReservedRealAnswer(input, { ...deps, requireProviderIdentity: true });
}

/** Production has no caller-controlled provider or rollout flag. Live AI stays off. */
export function createClaimedWhatsappAnswerExecutor(): (input: ClaimedWhatsappAnswerInput) => Promise<RealAnswerResult> {
  return async input => {
    if (!isLiveAnsweringEnabled()) return { ok: false, error: "LIVE_AI_DISABLED", attempts: [] };
    let store: ClaimedWhatsappRuntimeStore;
    try { store = createClaimedWhatsappRuntimeStore(input); }
    catch { return { ok: false, error: "PERSISTENCE_UNAVAILABLE", attempts: [] }; }
    return executeClaimedWhatsappAnswer(input, { store, call: callRealModel });
  };
}
