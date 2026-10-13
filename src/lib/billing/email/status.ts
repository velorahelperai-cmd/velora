import "server-only";
export type EmailStatus = { state: "queued" | "claimed" | "accepted" | "rejected" | "reconciliation_required" | "blocked" | "not_queued" | "unavailable"; queuedAt: string | null; acceptedAt: string | null; delivered: false };
export const unavailableEmailStatus = (): EmailStatus => ({ state: "unavailable", queuedAt: null, acceptedAt: null, delivered: false });
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
/** Only called after the existing billing owner gate and scoped order lookup; SQL independently checks that session. */
export async function readScopedEmailStatus(client: Rpc, companyId: string, orderId: string): Promise<EmailStatus> {
  try {
    const { data, error } = await client.rpc("billing_admin_read_subscription_email", { p_company_id: companyId, p_order_id: orderId });
    if (error || !data || typeof data !== "object") return unavailableEmailStatus();
    const row = data as Record<string, unknown>, email = row.email as Record<string, unknown> | null;
    if (row.ok !== true || row.companyId !== companyId || row.orderId !== orderId || !email || !["queued", "claimed", "accepted", "rejected", "reconciliation_required", "blocked", "not_queued"].includes(String(email.state)) || email.delivered !== false
      || (email.queuedAt !== null && (typeof email.queuedAt !== "string" || !Number.isFinite(Date.parse(email.queuedAt))))
      || (email.acceptedAt !== null && (typeof email.acceptedAt !== "string" || !Number.isFinite(Date.parse(email.acceptedAt))))) return unavailableEmailStatus();
    return { state: email.state as EmailStatus["state"], queuedAt: email.queuedAt as string | null, acceptedAt: email.acceptedAt as string | null, delivered: false };
  } catch { return unavailableEmailStatus(); }
}
