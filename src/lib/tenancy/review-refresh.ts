/**
 * Review-request refresh outcomes.
 *
 * A successful read with no row means the request is gone server-side and the
 * local snapshot must be cleared. A failed read keeps the snapshot and warns —
 * it never implies "no request".
 */

export type ReviewRefreshOutcome<T> =
  | { kind: "adopt"; review: T }
  | { kind: "cleared" }
  | { kind: "keep_snapshot" };

export function resolveReviewRefresh<T>(
  result: { ok: true; data: T | null } | { ok: false },
): ReviewRefreshOutcome<T> {
  if (!result.ok) return { kind: "keep_snapshot" };
  if (result.data == null) return { kind: "cleared" };
  return { kind: "adopt", review: result.data };
}
