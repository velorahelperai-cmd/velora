import { createClient, createBrokerBoundClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/tenancy/access";
import { KNOWLEDGE_BUCKET } from "@/lib/knowledge/constants";
import { isSetupFilePath, type SetupFileRpc } from "@/lib/tenancy/setup-file";
import { downloadSetupFile } from "@/lib/tenancy/setup-file-server";
import { randomUUID } from "node:crypto";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  let stage = "validate";
  const deny = (status: number, code: string) => {
    withLogContext({ request_id: requestId, trace_id: requestId.replaceAll("-", "") }, () => {
      logEvent("warn", "admin.knowledge_file.denied", { stage, error_code: code });
    });
    return new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  };
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const sourceId = url.searchParams.get("sourceId");

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!companyId || !sourceId || !uuid.test(companyId) || !uuid.test(sourceId)) {
    return deny(400, "INVALID_FILE_IDENTIFIERS");
  }

  // Pre-download authorization: verified platform owner with confirmed email & active session
  stage = "authorize_before_fetch";
  try {
  const adminPre = await requirePlatformAdmin();
  if (!adminPre.ok) {
    return deny(adminPre.code === "UNAUTHENTICATED" ? 401 : adminPre.code === "UNAVAILABLE" ? 503 : 403, "OWNER_AUTHORITY_DENIED");
  }

  const userIdPre = adminPre.context.userId;
  const boundPre = await createBrokerBoundClient({ fresh: true });
  if (!boundPre.bound.ok) return deny(boundPre.bound.code === "UNAUTHENTICATED" ? 401 : 503, "BROKER_AUTHORITY_UNAVAILABLE");
  const boundaryPre = boundPre.bound.resolve.boundary;
  if (boundaryPre.userId !== userIdPre || !boundaryPre.generation || !boundaryPre.boundaryFingerprint) return deny(403, "BROKER_BOUNDARY_MISMATCH");

    stage = "source_before_fetch";
    const supabase = await createClient();

    // Verify source exists, belongs to companyId, is kind=file, and path is strictly prefixed
    const { data: source, error: sourceError } = await supabase
      .from("knowledge_sources")
      .select("id, company_id, kind, file_name, storage_path, status, content_version, updated_at, byte_size, created_by")
      .eq("id", sourceId)
      .eq("company_id", companyId)
      .eq("kind", "file")
      .maybeSingle();

    if (sourceError || !source?.storage_path) {
      return deny(404, "FILE_SOURCE_UNAVAILABLE");
    }

    if (source.id !== sourceId || source.company_id !== companyId || source.kind !== "file" || !source.storage_path.startsWith(`${companyId}/`)) {
      return deny(403, "FILE_SOURCE_MISMATCH");
    }

    // Fetch storage bytes: setup files use dedicated loader (RLS on storage.objects blocks generic download)
    let fileBytes: Uint8Array;
    stage = "storage_fetch";
    if (isSetupFilePath(source.storage_path)) {
      const setupResult = await downloadSetupFile(
        supabase as unknown as SetupFileRpc,
        userIdPre,
        companyId,
        sourceId
      );
      if (!setupResult || !setupResult.bytes) {
        return deny(503, "STORAGE_FETCH_FAILED");
      }
      fileBytes = setupResult.bytes;
    } else {
      const { data: storageBlob, error: downloadError } = await supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .download(source.storage_path);

      if (downloadError || !storageBlob) {
        return deny(503, "STORAGE_FETCH_FAILED");
      }
      fileBytes = new Uint8Array(await storageBlob.arrayBuffer());
    }

    // TOCTOU GUARD: Re-check session and platform owner authorization AFTER storage fetch
    // and BEFORE releasing any bytes to the client. If session was revoked, signed out,
    // generation superseded, or actor swapped while download was in-flight, abort immediately.
    stage = "authorize_after_fetch";
    const adminPost = await requirePlatformAdmin();
    if (!adminPost.ok) {
      return deny(adminPost.code === "UNAUTHENTICATED" ? 401 : adminPost.code === "UNAVAILABLE" ? 503 : 403, "OWNER_AUTHORITY_CHANGED");
    }

    if (adminPost.context.userId !== userIdPre) {
      return deny(403, "OWNER_ACTOR_CHANGED");
    }

    const boundPost = await createBrokerBoundClient({ fresh: true });
    if (!boundPost.bound.ok) return deny(boundPost.bound.code === "UNAUTHENTICATED" ? 401 : 503, "BROKER_AUTHORITY_CHANGED");
    const boundaryPost = boundPost.bound.resolve.boundary;
    if (boundaryPost.userId !== userIdPre || boundaryPost.generation !== boundaryPre.generation || boundaryPost.boundaryFingerprint !== boundaryPre.boundaryFingerprint) {
      return deny(403, "BROKER_BOUNDARY_CHANGED");
    }

    // TOCTOU GUARD: Re-query database source version and metadata to confirm file was not replaced
    stage = "source_after_fetch";
    const { data: sourcePost, error: postErr } = await supabase
      .from("knowledge_sources")
      .select("id, company_id, kind, storage_path, content_version, updated_at, byte_size")
      .eq("id", sourceId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (
      postErr ||
      !sourcePost ||
      sourcePost.id !== source.id ||
      sourcePost.company_id !== source.company_id ||
      sourcePost.kind !== "file" ||
      sourcePost.storage_path !== source.storage_path ||
      sourcePost.content_version !== source.content_version ||
      sourcePost.updated_at !== source.updated_at ||
      (source.byte_size != null && sourcePost.byte_size !== source.byte_size) ||
      (source.byte_size != null && fileBytes.byteLength !== source.byte_size)
    ) {
      return deny(409, "FILE_SOURCE_CHANGED");
    }

    const safeFileName = (source.file_name || "file").replace(/["\r\n]/g, "_");
    return new Response(Buffer.from(fileBytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch {
    return deny(503, "ADMIN_FILE_READ_FAILED");
  }
}
