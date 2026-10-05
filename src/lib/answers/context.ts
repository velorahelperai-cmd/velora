import {
  ANSWER_MAX_CONTEXT_CHARS,
  ANSWER_MAX_SOURCES,
} from "@/lib/answers/constants";
import type { AnswerContextChunk } from "@/lib/answers/types";
import { createClient } from "@/lib/supabase/server";

export type PackedContext =
  | {
    ok: true;
    chunks: AnswerContextChunk[];
    /** Sum of packed text block lengths (characters), not tokens or spend. */
    contextChars: number;
  }
  | {
    ok: false;
    code: "NO_KNOWLEDGE" | "CONTEXT_OVERFLOW";
  };

type ApprovedRow = {
  id: string;
  title: string;
  content: string;
  content_version: number;
  approved_version: number | null;
  approved_for_answers: boolean;
  status: string;
};

/**
 * Load answer-eligible sources for a verified company id only.
 * Requires: status=ready, approved_for_answers, approved_version = content_version.
 * File body text is treated as untrusted data (never instructions).
 *
 * Limits are character counts of source text (plus titles), not model tokens or money.
 * If the eligible set exceeds ANSWER_MAX_SOURCES or ANSWER_MAX_CONTEXT_CHARS,
 * returns CONTEXT_OVERFLOW — never a partial success that hides sources.
 */
export async function loadApprovedAnswerContext(
  companyId: string,
): Promise<PackedContext> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select("id, title, content, content_version, approved_version, approved_for_answers, status")
    .eq("company_id", companyId)
    .eq("status", "ready")
    .eq("approved_for_answers", true)
    .order("updated_at", { ascending: false })
    .limit(ANSWER_MAX_SOURCES + 1);

  if (error) throw new Error(error.message);

  if ((data?.length ?? 0) > ANSWER_MAX_SOURCES) {
    return { ok: false, code: "CONTEXT_OVERFLOW" };
  }

  const rows = ((data ?? []) as ApprovedRow[]).filter(
    (row) =>
      row.approved_for_answers
      && row.status === "ready"
      && row.approved_version != null
      && row.approved_version === row.content_version
      && btrim(row.content).length > 0,
  );

  if (!rows.length) return { ok: false, code: "NO_KNOWLEDGE" };

  if (rows.length > ANSWER_MAX_SOURCES) {
    return { ok: false, code: "CONTEXT_OVERFLOW" };
  }

  const chunks: AnswerContextChunk[] = [];
  let used = 0;

  for (const row of rows) {
    const text = btrim(row.content);
    const block = `### ${row.title}\n${text}`;
    const sep = chunks.length ? 2 : 0;
    used += block.length + sep;
    chunks.push({
      sourceId: row.id,
      title: row.title,
      contentVersion: row.content_version,
      text,
    });
  }

  // Entire eligible set must fit; do not drop a large source and succeed with the rest.
  if (used > ANSWER_MAX_CONTEXT_CHARS) {
    return { ok: false, code: "CONTEXT_OVERFLOW" };
  }

  return { ok: true, chunks, contextChars: used };
}

/** Re-check cited sources are still approved at the same content_version for this company. */
export async function verifyAnswerCitationsStillValid(
  companyId: string,
  chunks: AnswerContextChunk[],
): Promise<boolean> {
  if (!chunks.length) return false;
  const supabase = await createClient();
  const ids = chunks.map((c) => c.sourceId);
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select("id, content_version, approved_version, approved_for_answers, status, content")
    .eq("company_id", companyId)
    .in("id", ids);

  if (error || !data || data.length !== chunks.length) return false;

  const byId = new Map(data.map((row) => [row.id, row]));
  for (const chunk of chunks) {
    const row = byId.get(chunk.sourceId);
    if (!row) return false;
    if (row.status !== "ready" || !row.approved_for_answers) return false;
    if (row.approved_version == null || row.approved_version !== row.content_version) return false;
    if (row.content_version !== chunk.contentVersion) return false;
    if (!btrim(row.content).length) return false;
  }
  return true;
}

function btrim(value: string) {
  return value.trim();
}
