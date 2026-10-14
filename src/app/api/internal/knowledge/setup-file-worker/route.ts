import { timingSafeEqual } from "node:crypto";
import { runConfiguredSetupFileDeletion } from "@/lib/tenancy/setup-file-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const token = process.env.SETUP_FILE_WORKER_TOKEN?.trim() ?? "";
  if (token.length < 32) return Response.json({ code: "SETUP_FILE_WORKER_UNCONFIGURED" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${token}`); const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const result = await runConfiguredSetupFileDeletion(process.env.SETUP_FILE_WORKER_ENABLED === "true");
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
