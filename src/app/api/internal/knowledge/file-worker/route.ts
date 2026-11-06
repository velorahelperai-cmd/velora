import { createAdminKnowledgeFileBatchPorts } from "@/lib/knowledge/file-worker/batch";
import { handleKnowledgeFileWorkerRequest } from "@/lib/knowledge/file-worker/route-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Knowledge file worker tick.
 * Primary invoker on Hobby: `scripts/knowledge-file-worker/run-tick.mjs`
 * (Task Scheduler / OS cron). Hobby Vercel Cron is daily-only — not a 5-minute worker.
 * Response always carries observation signals for stop/backlog detection.
 */
export async function POST(request: Request) {
  return handleKnowledgeFileWorkerRequest(request, createAdminKnowledgeFileBatchPorts);
}

/** Vercel Cron prefers GET with CRON_SECRET Bearer. */
export async function GET(request: Request) {
  return handleKnowledgeFileWorkerRequest(request, createAdminKnowledgeFileBatchPorts);
}
