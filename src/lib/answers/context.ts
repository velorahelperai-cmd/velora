import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANSWER_MAX_CONTEXT_CHARS,
  ANSWER_MAX_SOURCES,
} from "@/lib/answers/constants";
import {
  evaluateFileSourceIntegrity,
  isAnswerEligibleVerdict,
  knowledgeObjectFileName,
  knowledgeObjectFolder,
  type KnowledgeObjectMeta,
} from "@/lib/answers/file-integrity";
import type { AnswerContextChunk, AnswerFailureCode } from "@/lib/answers/types";
import type { Database } from "@/lib/database.types";
import { KNOWLEDGE_BUCKET } from "@/lib/knowledge/constants";
import { createClient } from "@/lib/supabase/server";

type KnowledgeClient = SupabaseClient<Database>;

export type PackedContext =
  | {
    ok: true;
    chunks: AnswerContextChunk[];
    /** Sum of packed text block lengths (characters), not tokens or spend. */
    contextChars: number;
  }
  | {
    ok: false;
    code: Extract<
      AnswerFailureCode,
      | "NO_KNOWLEDGE"
      | "APPROVAL_INCOMPLETE"
      | "APPROVAL_FOUNDATION_UNAVAILABLE"
      | "CONTEXT_OVERFLOW"
      | "UNAVAILABLE"
    >;
  };

/** Schema-absence of approval columns only — not RLS/network (aligned with knowledge list probe). */
function isMissingApprovalColumnError(error: { message?: string; code?: string } | null): boolean {
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

type ApprovedRow = {
  id: string;
  title: string;
  content: string;
  content_version: number;
  approved_version: number | null;
  approved_for_answers: boolean;
  status: string;
  kind: string;
  storage_path: string | null;
  byte_size: number | null;
  updated_at: string;
};

const APPROVED_SELECT =
  "id, title, content, content_version, approved_version, approved_for_answers, status, kind, storage_path, byte_size, updated_at";

/**
 * Re-check the Storage object behind every approved file row.
 * Owners may mutate objects directly, so DB columns are not sufficient proof.
 * Storage read failures are never treated as intact.
 */
async function keepRowsWithIntactObjects(
  companyId: string,
  rows: ApprovedRow[],
  supabase: KnowledgeClient,
): Promise<{ ok: true; rows: ApprovedRow[] } | { ok: false }> {
  const kept: ApprovedRow[] = [];
  for (const row of rows) {
    if (row.kind !== "file") {
      kept.push(row);
      continue;
    }
    if (!row.storage_path) continue;

    const fileName = knowledgeObjectFileName(row.storage_path);
    const { data, error } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .list(knowledgeObjectFolder(companyId, row.id), { limit: 100 });
    if (error) return { ok: false };

    const object = ((data ?? []) as KnowledgeObjectMeta[]).find((o) => o.name === fileName) ?? null;
    const verdict = evaluateFileSourceIntegrity({
      source: {
        kind: row.kind,
        storagePath: row.storage_path,
        byteSize: row.byte_size,
        rowUpdatedAt: row.updated_at,
      },
      object,
    });
    if (isAnswerEligibleVerdict(verdict)) kept.push(row);
  }
  return { ok: true, rows: kept };
}

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
  client?: KnowledgeClient,
): Promise<PackedContext> {
  const supabase = client ?? await createClient();
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select(APPROVED_SELECT)
    .eq("company_id", companyId)
    .eq("status", "ready")
    .eq("approved_for_answers", true)
    .order("updated_at", { ascending: false })
    .limit(ANSWER_MAX_SOURCES + 1);

  if (error) {
    if (isMissingApprovalColumnError(error)) {
      return { ok: false, code: "APPROVAL_FOUNDATION_UNAVAILABLE" };
    }
    throw new Error(error.message);
  }

  if ((data?.length ?? 0) > ANSWER_MAX_SOURCES) {
    return { ok: false, code: "CONTEXT_OVERFLOW" };
  }

  const dbEligible = ((data ?? []) as ApprovedRow[]).filter(
    (row) =>
      row.approved_for_answers
      && row.status === "ready"
      && row.approved_version != null
      && row.approved_version === row.content_version
      && btrim(row.content).length > 0,
  );

  // A changed, moved or deleted object must not keep its old extracted text eligible.
  const intact = await keepRowsWithIntactObjects(companyId, dbEligible, supabase);
  if (!intact.ok) return { ok: false, code: "UNAVAILABLE" };
  const rows = intact.rows;

  if (!rows.length) {
    // Distinguish empty company knowledge from ready-but-unapproved sources.
    const readyProbe = await supabase
      .from("knowledge_sources")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "ready");
    if (readyProbe.error) {
      if (isMissingApprovalColumnError(readyProbe.error)) {
        return { ok: false, code: "APPROVAL_FOUNDATION_UNAVAILABLE" };
      }
      throw new Error(readyProbe.error.message);
    }
    if ((readyProbe.count ?? 0) > 0) {
      return { ok: false, code: "APPROVAL_INCOMPLETE" };
    }
    return { ok: false, code: "NO_KNOWLEDGE" };
  }

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
  client?: KnowledgeClient,
): Promise<boolean> {
  if (!chunks.length) return false;
  const supabase = client ?? await createClient();
  const ids = chunks.map((c) => c.sourceId);
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select(APPROVED_SELECT)
    .eq("company_id", companyId)
    .in("id", ids);

  if (error || !data || data.length !== chunks.length) return false;

  const rows = data as ApprovedRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const chunk of chunks) {
    const row = byId.get(chunk.sourceId);
    if (!row) return false;
    if (row.status !== "ready" || !row.approved_for_answers) return false;
    if (row.approved_version == null || row.approved_version !== row.content_version) return false;
    if (row.content_version !== chunk.contentVersion) return false;
    if (!btrim(row.content).length) return false;
  }

  // Same object re-check before delivery — the file may have changed mid-answer.
  const intact = await keepRowsWithIntactObjects(companyId, rows, supabase);
  if (!intact.ok) return false;
  return intact.rows.length === rows.length;
}

function btrim(value: string) {
  return value.trim();
}
