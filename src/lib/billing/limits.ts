/**
 * Usage-limit gates: missing required limit blocks the operation (fail-closed).
 * Synthetic values belong only in labeled test fixtures.
 */

export type LimitReadResult =
  | { ok: true; value: number }
  | { ok: false; code: "limit_not_configured" };

export function requirePositiveIntLimit(value: number | null | undefined): LimitReadResult {
  if (value == null || !Number.isInteger(value) || value < 0) {
    return { ok: false, code: "limit_not_configured" };
  }
  return { ok: true, value };
}

export function assertOperationAllowedByLimit(
  limit: number | null | undefined,
): { allowed: true; limit: number } | { allowed: false; code: "limit_not_configured" } {
  const read = requirePositiveIntLimit(limit);
  if (!read.ok) return { allowed: false, code: read.code };
  return { allowed: true, limit: read.value };
}
