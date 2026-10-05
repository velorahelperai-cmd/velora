/**
 * Storage-object integrity for approved file knowledge.
 *
 * Storage policies let an active owner INSERT/UPDATE/DELETE objects in
 * `company-knowledge` directly (see 20261004110000_vel006a_knowledge_sources.sql),
 * so database columns alone cannot prove the approved text still matches the file.
 * Every answer path re-checks the object before using the stored text.
 */

export type KnowledgeObjectMeta = {
  name: string;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: { size?: number | null } | null;
};

export type FileSourceExpectation = {
  kind: string;
  storagePath: string | null;
  byteSize: number | null;
  /** Row timestamp of the write that published the extracted text. */
  rowUpdatedAt: string;
};

export type FileIntegrityVerdict =
  | "ok"
  | "not_file"
  | "no_path"
  | "missing"
  | "modified"
  | "size_mismatch"
  | "unreadable";

/**
 * Timestamp slack only. The app always uploads bytes before the row write that
 * publishes text, so a newer object means the file changed after extraction.
 */
export const OBJECT_CLOCK_TOLERANCE_MS = 2_000;

export function knowledgeObjectFolder(companyId: string, sourceId: string) {
  return `${companyId}/${sourceId}`;
}

export function knowledgeObjectFileName(storagePath: string) {
  return storagePath.split("/").pop() ?? "";
}

export function evaluateFileSourceIntegrity(input: {
  source: FileSourceExpectation;
  object: KnowledgeObjectMeta | null;
}): FileIntegrityVerdict {
  const { source, object } = input;
  if (source.kind !== "file") return "not_file";
  if (!source.storagePath) return "no_path";
  if (!object) return "missing";

  const rowAt = Date.parse(source.rowUpdatedAt);
  const objectAt = Date.parse(object.updated_at ?? object.created_at ?? "");
  if (!Number.isFinite(rowAt) || !Number.isFinite(objectAt)) return "unreadable";
  if (objectAt > rowAt + OBJECT_CLOCK_TOLERANCE_MS) return "modified";

  const size = object.metadata?.size;
  if (typeof source.byteSize === "number" && typeof size === "number" && size !== source.byteSize) {
    return "size_mismatch";
  }
  return "ok";
}

/** Only `ok` and `not_file` may feed customer answers. */
export function isAnswerEligibleVerdict(verdict: FileIntegrityVerdict) {
  return verdict === "ok" || verdict === "not_file";
}
