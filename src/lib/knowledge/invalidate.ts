/**
 * Ordering helpers for knowledge writes that can strand approved text.
 *
 * Rules enforced here:
 * - Old text must stop being answer-eligible BEFORE a file is replaced or deleted.
 * - Extraction output is published only onto the exact source/version/file it was read from.
 */

type MaybeSingleResult = {
  data: unknown;
  error: { message?: string } | null;
};

type UpdateChain = {
  eq(column: string, value: string | number): UpdateChain;
  select(columns: string): { maybeSingle(): Promise<MaybeSingleResult> };
};

export type KnowledgeUpdateClient = {
  from(table: "knowledge_sources"): {
    update(values: Record<string, unknown>): UpdateChain;
  };
};

export type ClearEligibilityResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: "not_found" | "error" | "still_eligible"; message?: string };

/**
 * Drops answer eligibility by emptying content. The database trigger also bumps
 * content_version and clears approval columns, so no client write touches them.
 */
export async function clearAnswerEligibility(
  client: KnowledgeUpdateClient,
  input: { sourceId: string; companyId: string; select: string },
): Promise<ClearEligibilityResult> {
  const { data, error } = await client
    .from("knowledge_sources")
    .update({ content: "" })
    .eq("id", input.sourceId)
    .eq("company_id", input.companyId)
    .select(input.select)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "not_found" };

  const row = data as Record<string, unknown>;
  const content = typeof row.content === "string" ? row.content.trim() : "";
  const approved = row.approved_for_answers === true;
  if (content.length > 0 || approved) {
    return { ok: false, reason: "still_eligible" };
  }
  return { ok: true, row };
}

export type StorageObjectGeneration = {
  objectId: string;
  updatedAt: string;
};

export type ProcessingIdentity = {
  sourceId: string;
  companyId: string;
  contentVersion: number | null;
  storagePath: string | null;
  object?: StorageObjectGeneration | null;
};

export function generationFromListedObject(object: {
  id?: string | null;
  updated_at?: string | null;
} | null | undefined): StorageObjectGeneration | null {
  const objectId = typeof object?.id === "string" ? object.id.trim() : "";
  const updatedAt = typeof object?.updated_at === "string" ? object.updated_at.trim() : "";
  if (!objectId || !updatedAt) return null;
  return { objectId, updatedAt };
}

/** Exact object generation — not size, not an assumed content_version bump. */
export function objectGenerationMatches(
  captured: StorageObjectGeneration | null | undefined,
  current: StorageObjectGeneration | null | undefined,
): boolean {
  if (!captured || !current) return false;
  return captured.objectId === current.objectId && captured.updatedAt === current.updatedAt;
}

/**
 * Bytes stay bound to the source and the Storage object generation they were
 * read from. content_version is recorded but is not the match key: same-path
 * replace with empty content does not bump it.
 */
export function processingIdentityMatches(
  downloaded: ProcessingIdentity,
  current: ProcessingIdentity,
): boolean {
  if (downloaded.sourceId !== current.sourceId) return false;
  if (downloaded.companyId !== current.companyId) return false;
  if (downloaded.storagePath !== current.storagePath) return false;
  return objectGenerationMatches(downloaded.object, current.object);
}

/**
 * After upload, extract only bytes downloaded from the captured object.
 * Local upload buffers must not be paired with a later listing.
 */
export function bindDownloadedBytesToObject(input: {
  captured: StorageObjectGeneration | null;
  downloadedBytes: Uint8Array | null;
  verified: StorageObjectGeneration | null;
}):
  | { ok: true; bytes: Uint8Array; generation: StorageObjectGeneration }
  | { ok: false; reason: "conflict" | "unreadable" } {
  if (!input.captured || !input.verified || !input.downloadedBytes) {
    return { ok: false, reason: "unreadable" };
  }
  if (!objectGenerationMatches(input.captured, input.verified)) {
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, bytes: input.downloadedBytes, generation: input.captured };
}

export type BeginProcessingResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: "superseded" | "error"; message?: string };

function bindIdentity(chain: UpdateChain, identity: ProcessingIdentity): UpdateChain {
  let next = chain.eq("id", identity.sourceId).eq("company_id", identity.companyId);
  if (typeof identity.contentVersion === "number") {
    next = next.eq("content_version", identity.contentVersion);
  }
  if (identity.storagePath) {
    next = next.eq("storage_path", identity.storagePath);
  }
  return next;
}

/**
 * Starts processing on this source/path. content_version is an extra bind when
 * known; same-path replace with empty content may leave it unchanged, so callers
 * must also require objectGenerationMatches on the captured Storage generation.
 */
export async function beginKnowledgeProcessing(
  client: KnowledgeUpdateClient,
  input: ProcessingIdentity & { select: string },
): Promise<BeginProcessingResult> {
  const { data, error } = await bindIdentity(
    client
      .from("knowledge_sources")
      .update({ status: "processing", failure_code: null, content: "" }),
    input,
  )
    .select(input.select)
    .maybeSingle();

  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "superseded" };
  return { ok: true, row: data as Record<string, unknown> };
}

export type PublishExtractedResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: "superseded" | "error"; message?: string };

/**
 * Writes extracted text only if the source is still the processing row for the
 * same version and file. A slower run must not overwrite a newer upload.
 */
export async function publishExtractedText(
  client: KnowledgeUpdateClient,
  input: {
    sourceId: string;
    companyId: string;
    text: string;
    expectedVersion: number | null;
    expectedStoragePath: string | null;
    select: string;
  },
): Promise<PublishExtractedResult> {
  let chain = client
    .from("knowledge_sources")
    .update({ status: "ready", failure_code: null, content: input.text })
    .eq("id", input.sourceId)
    .eq("company_id", input.companyId)
    .eq("status", "processing");

  if (typeof input.expectedVersion === "number") {
    chain = chain.eq("content_version", input.expectedVersion);
  }
  if (input.expectedStoragePath) {
    chain = chain.eq("storage_path", input.expectedStoragePath);
  }

  const { data, error } = await chain.select(input.select).maybeSingle();
  if (error) return { ok: false, reason: "error", message: error.message };
  if (!data) return { ok: false, reason: "superseded" };
  return { ok: true, row: data as Record<string, unknown> };
}
