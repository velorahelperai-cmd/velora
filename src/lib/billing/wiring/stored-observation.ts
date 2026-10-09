import { classifyPaymobTransactionStatus } from "@/lib/billing/paymob/callback";

/** Legacy event_status=success cannot replace complete verified payment lifecycle evidence. */
export function isStoredPaymobPaymentSuccess(summary: unknown): boolean {
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return false;
  const row = summary as Record<string, unknown>;
  if (row.event_status !== "success") return false;
  const lifecycle = {
    pending: row.pending,
    success: row.success,
    errorOccured: row.error_occured,
    isAuth: row.is_auth,
    isCapture: row.is_capture,
    isVoided: row.is_voided,
    isRefunded: row.is_refunded,
    hasParentTransaction: row.has_parent_transaction,
    isStandalonePayment: row.is_standalone_payment,
  };
  if (Object.values(lifecycle).some(flag => typeof flag !== "boolean")) return false;
  return classifyPaymobTransactionStatus(lifecycle as Record<keyof typeof lifecycle, boolean>) === "success";
}
