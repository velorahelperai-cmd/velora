import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StorageObjectGeneration, PublishExtractedResult } from "./invalidate";
import type { createClient } from "@/lib/supabase/server";

/** Publish only the bytes actually used by extraction; never a later download. */
export async function publishPreparedFile(
  authenticated: Awaited<ReturnType<typeof createClient>>,
  input: { sourceId: string; companyId: string; expectedVersion: number | null; storagePath: string;
    text: string; bytes: Uint8Array; generation: StorageObjectGeneration },
): Promise<PublishExtractedResult> {
  const service = createAdminClient();
  if (!service || input.expectedVersion === null) return { ok: false, reason: "error" };
  try {
    const { data: identity, error: identityError } = await authenticated.auth.getClaims();
    const actor = identity?.claims.sub, session = identity?.claims.session_id;
    if (identityError || typeof actor !== "string" || typeof session !== "string") return { ok: false, reason: "error" };
    const { data, error } = await service.rpc("g03_publish_prepared_file", {
      p_actor_id: actor, p_session_id: session, p_source_id: input.sourceId, p_company_id: input.companyId,
      p_expected_version: input.expectedVersion, p_storage_path: input.storagePath, p_text: input.text,
      p_file_sha256: createHash("sha256").update(input.bytes).digest("hex"), p_byte_size: input.bytes.byteLength,
      p_object_id: input.generation.objectId, p_object_updated_at: input.generation.updatedAt,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "error" };
    if (data.ok !== true || !data.source || typeof data.source !== "object" || Array.isArray(data.source)) return { ok: false, reason: "superseded" };
    return { ok: true, row: data.source as Record<string, unknown> };
  } catch { return { ok: false, reason: "error" }; }
}
