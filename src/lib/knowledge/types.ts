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
};
