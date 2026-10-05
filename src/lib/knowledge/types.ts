export type KnowledgeKind = "text" | "file";
export type KnowledgeStatus = "draft" | "stored" | "processing" | "ready" | "failed";
export type KnowledgeFailureCode = "no_text" | "corrupt" | "unsupported" | "extract_failed";

export type KnowledgeSourceRecord = {
  id: string;
  company_id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  storage_path: string | null;
  status: KnowledgeStatus;
  failure_code: KnowledgeFailureCode | null;
  content_version: number;
  approved_for_answers: boolean;
  approved_version: number | null;
  approved_at: string | null;
  approved_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeUploadItemResult = {
  fileName: string;
  ok: boolean;
  source?: KnowledgeSourceRecord;
  code?: string;
  message?: string;
  /** True when Storage accepted the bytes even if extract failed. */
  uploaded?: boolean;
};

/** True when this version is eligible for customer-answer context. */
export function isApprovedForAnswers(src: Pick<
  KnowledgeSourceRecord,
  "status" | "approved_for_answers" | "approved_version" | "content_version" | "content"
>) {
  return (
    src.status === "ready"
    && src.approved_for_answers
    && src.approved_version != null
    && src.approved_version === src.content_version
    && src.content.trim().length > 0
  );
}
