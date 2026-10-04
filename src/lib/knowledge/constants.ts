export const KNOWLEDGE_BUCKET = "company-knowledge";

/** Per-file limit (matches Storage bucket). */
export const KNOWLEDGE_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

/** Max files in one upload request. */
export const KNOWLEDGE_MAX_FILES_PER_BATCH = 5;

/** Max total bytes across one batch (Server Action body sized above this + overhead). */
export const KNOWLEDGE_MAX_BATCH_BYTES = 25 * 1024 * 1024; // 25MB

export const KNOWLEDGE_ALLOWED_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "csv",
  "xlsx",
] as const;

/** Canonical MIME types used for validation, upload Content-Type, and the Storage bucket. */
export const KNOWLEDGE_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const EXT_TO_MIME: Record<string, (typeof KNOWLEDGE_ALLOWED_MIME_TYPES)[number]> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const KNOWLEDGE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.csv,.xlsx";

export type KnowledgeFileErrorCode =
  | "EMPTY"
  | "TOO_LARGE"
  | "INVALID_TYPE"
  | "BATCH_TOO_LARGE"
  | "BATCH_TOO_MANY"
  | "UPLOAD_FAILED"
  | "CLEANUP_FAILED"
  | "DELETE_STORAGE_FAILED"
  | "DELETE_PARTIAL"
  | "NOT_FOUND"
  | "FORBIDDEN";

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i < 0) return "";
  return fileName.slice(i + 1).toLowerCase();
}

export function isAllowedKnowledgeExtension(fileName: string): boolean {
  const ext = extensionOf(fileName);
  return (KNOWLEDGE_ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export function isAllowedKnowledgeMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return (KNOWLEDGE_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/** Resolve the MIME that will be sent to Storage. Rejects empty/octet-stream mismatches. */
export function resolveKnowledgeContentType(
  fileName: string,
  declared?: string | null,
): string | null {
  if (!isAllowedKnowledgeExtension(fileName)) return null;
  const canonical = EXT_TO_MIME[extensionOf(fileName)];
  if (!canonical) return null;

  const t = (declared ?? "").trim().toLowerCase();
  if (!t || t === "application/octet-stream") return canonical;
  if (t === canonical) return canonical;
  // Legacy Excel MIME occasionally reported for .xlsx — normalize to bucket canonical.
  if (
    canonical === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    t === "application/vnd.ms-excel"
  ) {
    return canonical;
  }
  return null;
}

export function validateKnowledgeFile(file: {
  name: string;
  size: number;
  type?: string | null;
}): KnowledgeFileErrorCode | null {
  const name = file.name.trim();
  if (!name || file.size <= 0) return "EMPTY";
  if (file.size > KNOWLEDGE_MAX_FILE_BYTES) return "TOO_LARGE";
  if (!resolveKnowledgeContentType(name, file.type)) return "INVALID_TYPE";
  return null;
}

export function validateKnowledgeBatch(files: { name: string; size: number; type?: string | null }[]): KnowledgeFileErrorCode | null {
  if (!files.length) return "EMPTY";
  if (files.length > KNOWLEDGE_MAX_FILES_PER_BATCH) return "BATCH_TOO_MANY";
  let total = 0;
  for (const file of files) {
    const err = validateKnowledgeFile(file);
    if (err) return err;
    total += file.size;
  }
  if (total > KNOWLEDGE_MAX_BATCH_BYTES) return "BATCH_TOO_LARGE";
  return null;
}

export function sanitizeStorageFileName(fileName: string): string {
  const base = fileName.trim().replace(/[/\\]/g, "_").replace(/\s+/g, "_");
  return base.slice(0, 180) || "file";
}

export function knowledgeStoragePath(companyId: string, sourceId: string, fileName: string): string {
  return `${companyId}/${sourceId}/${sanitizeStorageFileName(fileName)}`;
}
