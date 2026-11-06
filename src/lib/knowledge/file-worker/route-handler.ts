import { timingSafeEqual } from "node:crypto";
import {
  knowledgeFileWorkerEnabled,
  knowledgeFileWorkerSecretConfigured,
} from "./gate.ts";
import { buildWorkerObservation, type WorkerObservation } from "./observation.ts";
import { processKnowledgeFileWorkerBatch, type BatchPorts } from "./batch-core.ts";

export function authorizeWorkerRequest(request: Request): "ok" | "unconfigured" | "unauthorized" {
  const workerSecret = process.env.VELORA_KNOWLEDGE_FILE_WORKER_SECRET?.trim() ?? "";
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (
    (!workerSecret || workerSecret.length < 32 || !knowledgeFileWorkerSecretConfigured())
    && (!cronSecret || cronSecret.length < 16)
  ) {
    return "unconfigured";
  }
  const candidates = [workerSecret, cronSecret].filter((s) => s.length >= 16);
  for (const expected of candidates) {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return "ok";
  }
  return "unauthorized";
}

export function determineWorkerHttpStatus(observation: WorkerObservation): number {
  return observation.code === "LIST_UNAVAILABLE" || observation.code === "ADMIN_UNAVAILABLE"
    ? 503
    : observation.reviewRequired > 0 || observation.stalledDueWork
      ? 202
      : 200;
}

export async function handleKnowledgeFileWorkerRequest(
  request: Request,
  portsSource?: BatchPorts | (() => BatchPorts | null) | null,
): Promise<Response> {
  const auth = authorizeWorkerRequest(request);
  if (auth === "unconfigured") {
    return Response.json({ code: "WORKER_NOT_CONFIGURED" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!knowledgeFileWorkerEnabled()) {
    return Response.json(
      buildWorkerObservation({
        nowMs: Date.now(),
        ok: false,
        code: "WORKER_DISABLED",
        backlog: 0,
        processed: 0,
        extracted: 0,
        unknown: 0,
        failed: 0,
        reviewRequired: 0,
        oldestDueExpiresAtMs: null,
      }),
      { status: 503 },
    );
  }

  const ports = typeof portsSource === "function" ? portsSource() : (portsSource ?? null);
  if (!ports) {
    return Response.json(
      buildWorkerObservation({
        nowMs: Date.now(),
        ok: false,
        code: "ADMIN_UNAVAILABLE",
        backlog: 0,
        processed: 0,
        extracted: 0,
        unknown: 0,
        failed: 0,
        reviewRequired: 0,
        oldestDueExpiresAtMs: null,
      }),
      { status: 503 },
    );
  }

  const observation = await processKnowledgeFileWorkerBatch(ports, 10);
  const status = determineWorkerHttpStatus(observation);
  return Response.json(observation, { status });
}
