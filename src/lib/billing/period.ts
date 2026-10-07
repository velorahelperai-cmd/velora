/**
 * Calendar period arithmetic for billing renewals.
 * Month/year use calendar rules (end-of-month clamp, leap years) — never "30-day months".
 */

export type BillingPeriodUnit = "day" | "month" | "year";

export type BillingPeriod = {
  unit: BillingPeriodUnit;
  count: number;
};

export function assertBillingPeriod(period: BillingPeriod): BillingPeriod {
  if (period.unit !== "day" && period.unit !== "month" && period.unit !== "year") {
    throw new Error("assertBillingPeriod: invalid unit");
  }
  if (!Number.isInteger(period.count) || period.count < 1) {
    throw new Error("assertBillingPeriod: count must be an integer >= 1");
  }
  return period;
}

/** Add a calendar period in UTC. Day-of-month is clamped to the target month length. */
export function addCalendarPeriod(from: Date, period: BillingPeriod): Date {
  const { unit, count } = assertBillingPeriod(period);
  if (Number.isNaN(from.getTime())) {
    throw new Error("addCalendarPeriod: invalid from date");
  }

  const hours = from.getUTCHours();
  const minutes = from.getUTCMinutes();
  const seconds = from.getUTCSeconds();
  const ms = from.getUTCMilliseconds();

  if (unit === "day") {
    const out = new Date(from.getTime());
    out.setUTCDate(out.getUTCDate() + count);
    return out;
  }

  if (unit === "month") {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth();
    const day = from.getUTCDate();
    const targetMonthIndex = month + count;
    const probe = new Date(Date.UTC(year, targetMonthIndex, 1, hours, minutes, seconds, ms));
    const lastDay = new Date(
      Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return new Date(
      Date.UTC(
        probe.getUTCFullYear(),
        probe.getUTCMonth(),
        Math.min(day, lastDay),
        hours,
        minutes,
        seconds,
        ms,
      ),
    );
  }

  const year = from.getUTCFullYear() + count;
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(day, lastDay), hours, minutes, seconds, ms),
  );
}

/**
 * Early renew keeps remainder:
 * paid_through_new = max(now, currentPaidThrough) + period
 * Late provider notices must not invent a past cutover — base is never before server now
 * when current is null/expired; remaining future time is preserved when current is ahead.
 */
export function computePaidThroughAfterPeriod(input: {
  now: Date;
  currentPaidThrough: Date | null;
  period: BillingPeriod;
}): Date {
  const base =
    input.currentPaidThrough == null
      ? input.now
      : input.currentPaidThrough.getTime() >= input.now.getTime()
        ? input.currentPaidThrough
        : input.now;
  return addCalendarPeriod(base, input.period);
}

/** Map locked order period fields (day unit keeps periodDays as count). */
export function periodFromLockedOrder(order: {
  periodUnit?: BillingPeriodUnit;
  periodCount?: number;
  periodDays: number;
}): BillingPeriod {
  const unit = order.periodUnit ?? "day";
  if (unit === "day") {
    return assertBillingPeriod({ unit: "day", count: order.periodCount ?? order.periodDays });
  }
  return assertBillingPeriod({
    unit,
    count: order.periodCount ?? order.periodDays,
  });
}
