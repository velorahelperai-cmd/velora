/**
 * Pure helpers for knowledge approval-foundation detection (no I/O).
 * Dependency: supabase/migrations/20261005093000_vel_knowledge_answer_foundation.sql
 */

/** True only for PostgREST/Postgres schema absence of approval columns — not network or RLS. */
export function isExactMissingApprovalColumnError(
  error: { message?: string; code?: string } | null,
): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toUpperCase();
  if (code === "42501" || m.includes("permission") || m.includes("row-level security")) {
    return false;
  }
  const mentionsApprovalColumn =
    m.includes("content_version")
    || m.includes("approved_for_answers")
    || m.includes("approved_version")
    || m.includes("approved_at")
    || m.includes("approved_by");
  const schemaAbsence =
    m.includes("does not exist")
    || m.includes("could not find")
    || code === "42703"
    || code === "PGRST204";
  return mentionsApprovalColumn && schemaAbsence;
}
