import { timingSafeEqual } from "node:crypto";
import { processEmailOutbox } from "@/lib/billing/email/internal";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const token = process.env.BILLING_EMAIL_WORKER_TOKEN?.trim() ?? "";
  if (token.length < 32) return Response.json({ code: "EMAIL_WORKER_NOT_CONFIGURED" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  if (process.env.BILLING_EMAIL_WORKER_ENABLED !== "true") return Response.json({ code: "EMAIL_DISABLED" }, { status: 503 });
  try { const result = await processEmailOutbox(); return Response.json(result, { status: result.ok ? 200 : 503 }); }
  catch { return Response.json({ code: "EMAIL_STORE_UNAVAILABLE" }, { status: 503 }); }
}
