/**
 * Worker liveness / backlog signals returned on every tick.
 * Monitors treat missed ticks (no successful observation within threshold) as stopped.
 */

export type WorkerObservation = {
  lastTickAt: string;
  ok: boolean;
  code: string;
  backlog: number;
  processed: number;
  extracted: number;
  unknown: number;
  failed: number;
  reviewRequired: number;
  automaticRetry: false;
  /** True when this tick ran but found due work older than the lease window. */
  stalledDueWork: boolean;
};

export function buildWorkerObservation(input: {
  nowMs: number;
  ok: boolean;
  code: string;
  backlog: number;
  processed: number;
  extracted: number;
  unknown: number;
  failed: number;
  reviewRequired: number;
  oldestDueExpiresAtMs: number | null;
}): WorkerObservation {
  const stalledDueWork =
    input.backlog > 0
    && input.oldestDueExpiresAtMs != null
    && input.oldestDueExpiresAtMs < input.nowMs;
  return {
    lastTickAt: new Date(input.nowMs).toISOString(),
    ok: input.ok,
    code: input.code,
    backlog: input.backlog,
    processed: input.processed,
    extracted: input.extracted,
    unknown: input.unknown,
    failed: input.failed,
    reviewRequired: input.reviewRequired,
    automaticRetry: false,
    stalledDueWork,
  };
}

/** Monitor heuristic: no successful tick within this window ⇒ worker stopped. */
export const WORKER_MISSED_TICK_MS = 15 * 60_000;

export function workerAppearsStopped(input: {
  lastSuccessTickAt: string | null;
  nowMs: number;
  thresholdMs?: number;
}): boolean {
  if (!input.lastSuccessTickAt) return true;
  const at = Date.parse(input.lastSuccessTickAt);
  if (!Number.isFinite(at)) return true;
  return input.nowMs - at > (input.thresholdMs ?? WORKER_MISSED_TICK_MS);
}
