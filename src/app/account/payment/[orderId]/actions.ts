"use server";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "@/lib/auth/session-guard";
import { es02Uuid } from "@/lib/billing/es02/contracts";
import { classifyProvisionWriteAck } from "@/lib/billing/es02/write-ack";

export async function finishTestCheckout(orderId: string): Promise<{ ok: true; next: string } | { ok: false }> {
  if (!es02Uuid(orderId) || process.env.BILLING_ES02_PAYMOB_TEST_ENABLED !== "true") return { ok: false };
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const accountId = data?.claims?.sub;
  if (error || !es02Uuid(accountId) || accountId !== process.env.PAYMOB_HOSTED_TEST_ACCOUNT_ID?.trim()) return { ok: false };
  if (!(await checkAppSession(client)).ok) return { ok: false };
  try {
    const result = await client.rpc("es02_finish_test_checkout" as never, { p_expected_account_id: accountId, p_order_id: orderId } as never);
    if (result.error) return { ok: false };
    const ack = classifyProvisionWriteAck(result.data);
    if (ack.status !== "success") return { ok: false };
    const row = ack.data as { orderId?: unknown; companyId?: unknown } | null;
    if (row?.orderId !== orderId || !es02Uuid(row?.companyId)) return { ok: false };
    return { ok: true, next: "/setup" };
  } catch { return { ok: false }; }
}
