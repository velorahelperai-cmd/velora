import { timingSafeEqual } from "node:crypto";
import {
  knowledgeFileWorkerEnabled,
  knowledgeFileWorkerSecretConfigured,
} from "@/lib/knowledge/file-worker/gate";
import {
  createAdminKnowledgeFileBatchPorts,
  processKnowledgeFileWorkerBatch,
} from "@/lib/knowledge/file-worker/batch";
import { buildWorkerObservation } from "@/lib/knowledge/file-worker/observation";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): "ok" | "unconfigured" | "unauthorized" {
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

/**
 * Knowledge file worker tick.
 * Primary invoker on Hobby: `scripts/knowledge-file-worker/run-tick.mjs`
 * (Task Scheduler / OS cron). Hobby Vercel Cron is daily-only — not a 5-minute worker.
 * Response always carries observation signals for stop/backlog detection.
 */
export async function POST(request: Request) {
  return tick(request);
}

/** Vercel Cron prefers GET with CRON_SECRET Bearer. */
export async function GET(request: Request) {
  return tick(request);
}

async function tick(request: Request) {
  const auth = authorize(request);
  if (auth === "unconfigured") {
    return Response.json({ code: "WORKER_NOT_CONFIGURED" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!knowledgeFileWorkerEnabled()) {
    return Response.json(
      {
        ...buildWorkerObservation({
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
      },
      { status: 503 },
    );
  }

  const ports = createAdminKnowledgeFileBatchPorts();
  if (!ports) {
    return Response.json(
      {
        ...buildWorkerObservation({
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
      },
      { status: 503 },
    );
  }

  const observation = await processKnowledgeFileWorkerBatch(ports, 10);
  const status =
    observation.code === "LIST_UNAVAILABLE" || observation.code === "ADMIN_UNAVAILABLE"
      ? 503
      : observation.reviewRequired > 0 || observation.stalledDueWork
        ? 202
        : 200;
  return Response.json(observation, { status });
}
