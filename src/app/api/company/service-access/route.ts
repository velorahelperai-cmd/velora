import { readSessionServiceAccess } from "@/lib/services/access";
import type { ServiceAccessCode } from "@/lib/services/decision";
export const runtime = "nodejs";
const status: Record<ServiceAccessCode, number> = {
  INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403,
  UNAVAILABLE: 503, SUBSCRIPTION_INACTIVE: 403,
  UNSUPPORTED_CAPABILITY: 403, SERVICE_CONTRACT_MISSING: 503, SERVICE_NOT_ACTIVE: 403,
};
/** Authenticated readiness only; returns no knowledge, reports, customer or billing rows. */
export async function GET(request: Request) {
  const result = await readSessionServiceAccess(new URL(request.url).searchParams.get("capability"));
  return Response.json(result, { status: result.allowed ? 200 : status[result.code], headers: { "Cache-Control": "private, no-store" } });
}
