import { es02Uuid } from "@/lib/billing/es02/contracts";

/** Browser return is navigation only: provider success/signature fields are discarded. */
export async function GET(request: Request) {
  const orderId = new URL(request.url).searchParams.get("order_id");
  if (!es02Uuid(orderId)) return new Response("invalid_order", { status: 400 });
  return new Response(null, { status: 303, headers: {
    Location: `https://www.velorahelper.com/account/payment/${orderId}`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  } });
}
