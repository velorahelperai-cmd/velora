import { knowledgeFileWorkerProviderExtractEnabled } from "./gate";
import {
  canPublishWithAttempt,
  mayDispatchPaidExtract,
  type AttemptSnapshot,
} from "./protocol";

export type FileWorkerPorts = {
  loadAttempt: (sourceId: string) => Promise<AttemptSnapshot | null>;
  loadSource: (sourceId: string) => Promise<{
    status: string;
    contentVersion: number;
    storagePath: string;
  } | null>;
  /**
   * Extract bytes for a claimed attempt.
   * Local offline kinds (e.g. text/plain) may succeed while the paid-provider
   * gate is off. Paid/PDF provider paths must return PROVIDER_EXTRACT_DISABLED
   * or unknown evidence — never invent a second paid call.
   */
  extract: (input: { sourceId: string; attemptId: string }) => Promise<
    | { ok: true; text: string; evidence: "none" | "verified_usage" }
    | { ok: false; evidence: "none" | "unknown" | "safe_failure"; code: string }
  >;
  publish: (input: {
    sourceId: string;
    attemptId: string;
    text: string;
  }) => Promise<{ ok: true } | { ok: false; code: string }>;
  failAttempt: (input: { sourceId: string; attemptId: string; code: string }) => Promise<boolean>;
  nowMs: () => number;
};

/**
 * One claimed attempt: verify fence → extract → publish/fail.
 * Never blind-retries paid extract on unknown outcomes.
 * Provider extract stays off until VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT=true;
 * local text extract remains available through ports.extract when the worker is on.
 */
export async function runKnowledgeFileAttempt(
  input: { sourceId: string; attemptId: string },
  ports: FileWorkerPorts,
): Promise<{ ok: boolean; code: string; extracted: boolean }> {
  const attempt = await ports.loadAttempt(input.sourceId);
  const source = await ports.loadSource(input.sourceId);
  if (!source) return { ok: false, code: "NOT_FOUND", extracted: false };
  const guard = canPublishWithAttempt({
    heldAttemptId: input.attemptId,
    attempt,
    sourceStatus: source.status,
    sourceContentVersion: source.contentVersion,
    sourceStoragePath: source.storagePath,
    nowMs: ports.nowMs(),
  });
  if (!guard.ok) return { ok: false, code: guard.code, extracted: false };

  if (knowledgeFileWorkerProviderExtractEnabled()) {
    const dispatch = mayDispatchPaidExtract({
      attemptState: attempt!.state,
      providerEvidence: "none",
      sameAttemptId: true,
    });
    if (!dispatch.ok) return { ok: false, code: dispatch.code, extracted: false };
  }

  const extracted = await ports.extract({
    sourceId: input.sourceId,
    attemptId: input.attemptId,
  });
  if (!extracted.ok) {
    if (extracted.evidence === "unknown") {
      // Do not fail-or-retry blindly; leave running for explicit reconciliation.
      return { ok: false, code: "PROVIDER_OUTCOME_UNKNOWN", extracted: false };
    }
    await ports.failAttempt({
      sourceId: input.sourceId,
      attemptId: input.attemptId,
      code: extracted.code,
    });
    return { ok: false, code: extracted.code, extracted: false };
  }

  const published = await ports.publish({
    sourceId: input.sourceId,
    attemptId: input.attemptId,
    text: extracted.text,
  });
  if (!published.ok) return { ok: false, code: published.code, extracted: true };
  return { ok: true, code: "PUBLISHED", extracted: true };
}
