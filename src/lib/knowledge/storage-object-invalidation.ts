/**
 * Write-path semantics of private.knowledge_invalidate_for_storage_object
 * (applied with 093000) plus the knowledge_sources version/approval trigger.
 * Isolated tests use this model; a live Storage/RLS run is a separate, deferred check.
 */

export type StorageObjectEvent =
  | { op: "INSERT"; bucket: string; name: string }
  | { op: "DELETE"; bucket: string; name: string }
  | {
    op: "UPDATE";
    oldBucket: string;
    oldName: string;
    newBucket: string;
    newName: string;
  };

export type PathInvalidation = { path: string; leaveIdentity: boolean };

const KNOWLEDGE_BUCKET = "company-knowledge";

/** Mirrors private.knowledge_invalidate_for_storage_object. */
export function storageObjectInvalidationOps(event: StorageObjectEvent): PathInvalidation[] {
  if (event.op === "DELETE") {
    return event.bucket === KNOWLEDGE_BUCKET
      ? [{ path: event.name, leaveIdentity: true }]
      : [];
  }

  if (event.op === "INSERT") {
    return event.bucket === KNOWLEDGE_BUCKET
      ? [{ path: event.name, leaveIdentity: false }]
      : [];
  }

  const ops: PathInvalidation[] = [];
  if (event.oldBucket === KNOWLEDGE_BUCKET) {
    if (event.newBucket !== KNOWLEDGE_BUCKET || event.oldName !== event.newName) {
      ops.push({ path: event.oldName, leaveIdentity: true });
    } else {
      ops.push({ path: event.oldName, leaveIdentity: false });
    }
  }
  if (
    event.newBucket === KNOWLEDGE_BUCKET
    && (event.oldBucket !== KNOWLEDGE_BUCKET || event.oldName !== event.newName)
  ) {
    ops.push({ path: event.newName, leaveIdentity: false });
  }
  return ops;
}

export type KnowledgeFileRow = {
  kind: string;
  storage_path: string | null;
  content: string;
  status: string;
  failure_code: string | null;
  content_version: number;
  approved_for_answers: boolean;
  approved_version: number | null;
};

/** Mirrors private.knowledge_invalidate_storage_path + version/approval side effects. */
export function applyStoragePathInvalidation(
  row: KnowledgeFileRow,
  op: PathInvalidation,
): KnowledgeFileRow | null {
  if (row.kind !== "file" || row.storage_path !== op.path) return null;

  const next: KnowledgeFileRow = {
    ...row,
    content: "",
    status: op.leaveIdentity
      ? "failed"
      : row.status === "ready" || row.status === "processing"
        ? "stored"
        : row.status,
    failure_code: op.leaveIdentity ? "extract_failed" : null,
    storage_path: op.leaveIdentity ? null : row.storage_path,
  };

  const contentChanged = next.content !== row.content;
  const pathChanged = next.storage_path !== row.storage_path;
  if (contentChanged || pathChanged) {
    next.content_version = row.content_version + 1;
  }
  if (next.status !== "ready") {
    next.approved_for_answers = false;
    next.approved_version = null;
  }
  return next;
}

export function isAnswerEligibleRow(row: KnowledgeFileRow) {
  return (
    row.approved_for_answers
    && row.status === "ready"
    && row.approved_version != null
    && row.approved_version === row.content_version
    && row.content.trim().length > 0
  );
}

export function applyStorageObjectEvent(
  row: KnowledgeFileRow,
  event: StorageObjectEvent,
): KnowledgeFileRow {
  let current = row;
  for (const op of storageObjectInvalidationOps(event)) {
    current = applyStoragePathInvalidation(current, op) ?? current;
  }
  return current;
}
