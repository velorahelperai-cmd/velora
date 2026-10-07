/** Injectable clock — server time is the source of truth; tests inject fixed instants. */

export type Clock = {
  now(): Date;
};

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

export function fixedClock(isoOrDate: string | Date): Clock {
  const at = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(at.getTime())) {
    throw new Error("fixedClock: invalid date");
  }
  return {
    now(): Date {
      return new Date(at.getTime());
    },
  };
}

/** Add whole UTC calendar days (period length). */
export function addUtcDays(from: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("addUtcDays: days must be an integer >= 1");
  }
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
