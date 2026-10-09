export type DashboardBillingLoad =
  | { status: "unavailable" | "forbidden" }
  | { status: "empty"; companyId: string }
  | {
      status: "ready";
      companyId: string;
      subscriptionStatus: string;
      paidThrough: string | null;
      monthStart: string;
      sent: number;
      held: number;
      cap: number | null;
      remaining: number | null;
      usedPercent: number | null;
    };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Never turn malformed or failed database reads into a zero balance. */
export function dashboardBillingSnapshot(
  companyId: string,
  journey: unknown,
  usage: unknown,
): DashboardBillingLoad {
  const journeyRow = record(journey);
  if (!journeyRow || !("subscription" in journeyRow)) return { status: "unavailable" };
  if (journeyRow.subscription === null) return { status: "empty", companyId };
  const subscription = record(journeyRow.subscription);
  const usageRow = record(usage);
  if (!subscription || subscription.company_id !== companyId || !usageRow
    || typeof subscription.status !== "string" || !subscription.status.trim()
    || !(subscription.paid_through === null || typeof subscription.paid_through === "string"
      && Number.isFinite(Date.parse(subscription.paid_through)))
    || typeof usageRow.month_start !== "string" || !Number.isFinite(Date.parse(usageRow.month_start))
    || !count(usageRow.successful_automated_outbound) || !count(usageRow.held_outbound_capacity)
    || !(usageRow.cap === null || count(usageRow.cap))) return { status: "unavailable" };
  const sent = usageRow.successful_automated_outbound;
  const held = usageRow.held_outbound_capacity;
  const allocated = sent + held;
  if (!Number.isSafeInteger(allocated)) return { status: "unavailable" };
  const cap = usageRow.cap;
  return {
    status: "ready", companyId, subscriptionStatus: subscription.status,
    paidThrough: subscription.paid_through, monthStart: usageRow.month_start,
    sent, held, cap,
    remaining: cap === null ? null : Math.max(0, cap - allocated),
    usedPercent: cap === null || cap === 0 ? null : Math.min(100, allocated / cap * 100),
  };
}
