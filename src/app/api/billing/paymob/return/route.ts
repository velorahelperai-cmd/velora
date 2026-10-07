import {
  mapBillingReturnDisplay,
  redirectionQueryGrantsEntitlement,
} from "@/lib/billing/wiring/return-status";
import { loadBillingReturnRow } from "@/lib/billing/wiring/return-load";
import { getCompanyAccess } from "@/lib/tenancy/access";

export const runtime = "nodejs";

/**
 * Display-only return. Query params never grant subscription.
 * Cross-company order id → order_not_found (no leak).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id")?.trim() ?? "";
  const query: Record<string, string | undefined> = {
    success: url.searchParams.get("success") ?? undefined,
    pending: url.searchParams.get("pending") ?? undefined,
    hmac: url.searchParams.get("hmac") ?? undefined,
    id: url.searchParams.get("id") ?? undefined,
  };

  // Explicit: redirect query does not grant entitlement.
  void redirectionQueryGrantsEntitlement(query);

  const access = await getCompanyAccess();
  if (!access.ok || !access.context.company) {
    return Response.json(
      { kind: "forbidden", messageKey: "order_not_found", grantsEntitlement: false },
      { status: 401 },
    );
  }

  const requestCompanyId = access.context.company.id;
  if (!orderId) {
    return Response.json(
      { kind: "forbidden", messageKey: "order_not_found", grantsEntitlement: false },
      { status: 400 },
    );
  }

  const row = await loadBillingReturnRow({ requestCompanyId, orderId });
  const display = mapBillingReturnDisplay({ requestCompanyId, row });

  return Response.json({
    ...display,
    grantsEntitlement: false,
    orderId: display.kind === "forbidden" ? null : orderId,
  });
}
