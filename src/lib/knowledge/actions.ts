"use server";
import { sessionHasCompanyCapability } from "@/lib/access/actions";
import type {CompanyCapability} from "@/lib/access/capabilities";

import { revalidatePath } from "next/cache";
import {
  KNOWLEDGE_BUCKET,
  isPreparableKnowledgeFile,
  knowledgeStoragePath,
  resolveKnowledgeContentType,
  validateKnowledgeBatch,
  validateKnowledgeFile,
} from "@/lib/knowledge/constants";
import { extractKnowledgeText } from "@/lib/knowledge/extract";
import { publishPreparedFile } from "@/lib/knowledge/prepared-publication";
import { readBoundedKnowledgeStream } from "@/lib/knowledge/bounded-read";
import { isExactMissingApprovalColumnError } from "@/lib/knowledge/foundation";
import {
  beginKnowledgeProcessing,
  clearAnswerEligibility,
  generationFromListedObject,
  objectGenerationMatches,
  bindDownloadedBytesToObject,
  type KnowledgeUpdateClient,
  type StorageObjectGeneration,
} from "@/lib/knowledge/invalidate";
import type {
  KnowledgeApprovalFoundation,
  KnowledgeFailureCode,
  KnowledgeListPayload,
  KnowledgeSourceRecord,
  KnowledgeUploadItemResult,
} from "@/lib/knowledge/types";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import type { AccessCode } from "@/lib/tenancy/types";

export type KnowledgeActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
    ok: false;
    code: AccessCode | "AUTH_ERROR" | "STORAGE_ERROR" | "INVALID_INPUT" | "CONFLICT";
    message?: string;
    data?: T;
  };

const SOURCE_SELECT_BASE =
  "id, company_id, kind, title, content, file_name, content_type, byte_size, storage_path, status, failure_code, created_by, created_at, updated_at";

/** Includes answer-approval columns from 20261005093000 — may be absent until that migration is applied. */
const SOURCE_SELECT =
  "id, company_id, kind, title, content, file_name, content_type, byte_size, storage_path, status, failure_code, content_version, approved_for_answers, approved_version, approved_at, approved_by, created_by, created_at, updated_at, usage_role, prepared_file_sha256, prepared_text_sha256, prepared_content_version" as const;

function renderedCompanyError(expected: unknown, companyId: string):
  { ok: false; code: "INVALID_INPUT" | "FORBIDDEN"; message: string } | null {
  if (typeof expected !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected)) {
    return { ok: false, code: "INVALID_INPUT", message: "invalid_company" };
  }
  return expected === companyId ? null : { ok: false, code: "FORBIDDEN", message: "workspace_changed" };
}

function asSource(
  row: unknown,
  approvalFoundation: KnowledgeApprovalFoundation = "ready",
): KnowledgeSourceRecord {
  const r = row as Partial<KnowledgeSourceRecord> & { id: string };
  const versionKnown = approvalFoundation === "ready" && typeof r.content_version === "number";
  return {
    ...(row as KnowledgeSourceRecord),
    content_version: versionKnown ? r.content_version! : null,
    approved_for_answers: approvalFoundation === "ready" ? Boolean(r.approved_for_answers) : false,
    approved_version: approvalFoundation === "ready" ? (r.approved_version ?? null) : null,
    approved_at: approvalFoundation === "ready" ? (r.approved_at ?? null) : null,
    approved_by: approvalFoundation === "ready" ? (r.approved_by ?? null) : null,
  };
}

/** List/read path only: try extended columns, then one base retry on exact missing-column errors. */
async function listKnowledgeRowsForCompany(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
): Promise<
  | { ok: true; payload: KnowledgeListPayload }
  | { ok: false; message: string }
> {
  const extended = await supabase
    .from("knowledge_sources")
    .select(SOURCE_SELECT)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });

  if (!extended.error) {
    return {
      ok: true,
      payload: {
        sources: (extended.data ?? []).map((row) => asSource(row, "ready")),
        approvalFoundation: "ready",
      },
    };
  }

  if (!isExactMissingApprovalColumnError(extended.error)) {
    return { ok: false, message: extended.error.message };
  }

  const base = await supabase
    .from("knowledge_sources")
    .select(SOURCE_SELECT_BASE)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });

  if (base.error) return { ok: false, message: base.error.message };
  return {
    ok: true,
    payload: {
      sources: (base.data ?? []).map((row) => asSource(row, "unavailable")),
      approvalFoundation: "unavailable",
    },
  };
}

/**
 * Probe whether approval columns exist so writes can use a compatible RETURNING select.
 * Save must keep working when 093000 is not applied (approval stays unavailable).
 */
async function probeApprovalFoundation(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<KnowledgeApprovalFoundation> {
  const { error } = await supabase
    .from("knowledge_sources")
    .select("content_version")
    .limit(1);
  if (!error) return "ready";
  if (isExactMissingApprovalColumnError(error)) return "unavailable";
  // Non-schema errors: prefer base select so save is not blocked by probe noise.
  return "unavailable";
}

function sourceSelectFor(foundation: KnowledgeApprovalFoundation): typeof SOURCE_SELECT {
  // Dynamic column list — cast keeps Supabase client typing stable when foundation is unavailable.
  return (foundation === "ready" ? SOURCE_SELECT : SOURCE_SELECT_BASE) as typeof SOURCE_SELECT;
}

async function requireOwnerCompany(capability:CompanyCapability="knowledge.write") {
 const access=await getCompanyAccess();if(!access.ok)return {ok:false as const,code:access.code};
 const {company,membership}=access.context;
 if(!company||!membership||company.status==="suspended")return {ok:false as const,code:"FORBIDDEN" as const};
 if(membership.role!=="owner"&&await sessionHasCompanyCapability(company.id,capability)!==true)return {ok:false as const,code:"FORBIDDEN" as const};
 const supabase=await createClient(),approvalFoundation=await probeApprovalFoundation(supabase);
 return {ok:true as const,supabase,userId:access.context.userId,companyId:company.id,approvalFoundation,sourceSelect:sourceSelectFor(approvalFoundation)};
}
async function requireMemberCompany() {
 const access=await getCompanyAccess();if(!access.ok)return {ok:false as const,code:access.code};
 const {company,membership}=access.context;
 if(!company||!membership||company.status==="suspended")return {ok:false as const,code:"FORBIDDEN" as const};
 if(membership.role!=="owner"&&await sessionHasCompanyCapability(company.id,"knowledge.read")!==true)return {ok:false as const,code:"FORBIDDEN" as const};
 return {ok:true as const,supabase:await createClient(),companyId:company.id,role:membership.role};
}
function revalidateKnowledge(companyId: string) {
  revalidatePath("/app/knowledge");
  revalidatePath("/app");
  revalidatePath("/setup");
  revalidatePath(`/admin/companies/${companyId}`);
}

async function markFileFailed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  companyId: string,
  storagePath: string | null,
  failureCode: KnowledgeFailureCode | null = null,
  foundation: KnowledgeApprovalFoundation = "unavailable",
) {
  const { data } = await supabase
    .from("knowledge_sources")
    .update({
      status: "failed",
      storage_path: storagePath,
      failure_code: failureCode,
      content: "",
    })
    .eq("id", sourceId)
    .eq("company_id", companyId)
    .select(sourceSelectFor(foundation))
    .maybeSingle();
  return data ? asSource(data, foundation) : null;
}

function isStorageObjectMissingError(message?: string | null) {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("object not found")
    || m.includes("not found")
    || m.includes("no such file")
    || m.includes("404")
  );
}

type ListedStorageObject = {
  id?: string | null;
  name: string;
  updated_at?: string | null;
};

type ObjectGenerationRead =
  | { status: "ok"; generation: StorageObjectGeneration }
  | { status: "missing" }
  | { status: "unreadable" }
  | { status: "error"; message: string };

/** Object id + updated_at at this path. Presence/size alone is not a generation. */
async function readStorageObjectGeneration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  sourceId: string,
  storagePath: string,
): Promise<ObjectGenerationRead> {
  const folder = `${companyId}/${sourceId}`;
  const filePart = storagePath.split("/").pop();
  if (!filePart) return { status: "missing" };
  const { data: listed, error: listError } = await supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .list(folder, { limit: 50 }, { signal: AbortSignal.timeout(10_000) });
  if (listError) {
    if (isStorageObjectMissingError(listError.message)) return { status: "missing" };
    return { status: "error", message: listError.message };
  }
  const object = ((listed ?? []) as ListedStorageObject[]).find((o) => o.name === filePart) ?? null;
  if (!object) return { status: "missing" };
  const generation = generationFromListedObject(object);
  if (!generation) return { status: "unreadable" };
  return { status: "ok", generation };
}

/**
 * Existing prepare path: capture object identity, download those bytes, re-check
 * identity, then return only the bound pair. Never uses a caller-held upload buffer.
 */
async function loadStoredBytesBoundToObject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  sourceId: string,
  storagePath: string,
): Promise<
  | { ok: true; bytes: Uint8Array; generation: StorageObjectGeneration }
  | {
    ok: false;
    reason: "conflict" | "missing" | "unreadable" | "error" | "download_failed";
    message?: string;
  }
> {
  const captured = await readStorageObjectGeneration(supabase, companyId, sourceId, storagePath);
  if (captured.status === "missing") return { ok: false, reason: "missing" };
  if (captured.status === "unreadable") return { ok: false, reason: "unreadable" };
  if (captured.status === "error") return { ok: false, reason: "error", message: captured.message };

  const signal = AbortSignal.timeout(10_000);
  const { data: fileStream, error: downloadError } = await supabase.storage
    .from(KNOWLEDGE_BUCKET)
    .download(storagePath, {}, { signal, cache: "no-store" }).asStream();
  if (downloadError || !fileStream) {
    if (isStorageObjectMissingError(downloadError?.message)) return { ok: false, reason: "missing" };
    return { ok: false, reason: "download_failed", message: downloadError?.message };
  }

  const bytes = await readBoundedKnowledgeStream(fileStream, signal);
  const verified = await readStorageObjectGeneration(supabase, companyId, sourceId, storagePath);
  return bindDownloadedBytesToObject({
    captured: captured.generation,
    downloadedBytes: bytes,
    verified: verified.status === "ok" ? verified.generation : null,
  });
}

async function loadSourceRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: KnowledgeSourceRecord,
  companyId: string,
  select: string,
  foundation: KnowledgeApprovalFoundation,
) {
  const { data: current } = await supabase
    .from("knowledge_sources")
    .select(select)
    .eq("id", source.id)
    .eq("company_id", companyId)
    .maybeSingle();
  return current
    ? asSource(current, foundation)
    : asSource({ ...source, status: "failed", failure_code: "extract_failed", content: "" }, foundation);
}

/**
 * Replaces extracted text on the same source row. Bytes are bound to the Storage
 * object generation captured when they were uploaded or downloaded — not to a
 * row fetched later, and not to an assumed content_version bump.
 */
async function prepareStoredFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: KnowledgeSourceRecord,
  companyId: string,
  bytes: Uint8Array,
  capturedGeneration: StorageObjectGeneration,
  foundation: KnowledgeApprovalFoundation = "unavailable",
) {
  const select = sourceSelectFor(foundation);
  const storagePath = source.storage_path;
  if (!storagePath) {
    return asSource({ ...source, status: "failed", failure_code: "extract_failed", content: "" }, foundation);
  }

  const stillCapturedObject = async () => {
    const read = await readStorageObjectGeneration(supabase, companyId, source.id, storagePath);
    return read.status === "ok" && objectGenerationMatches(capturedGeneration, read.generation);
  };

  if (!(await stillCapturedObject())) {
    return loadSourceRow(supabase, source, companyId, select, foundation);
  }

  const begun = await beginKnowledgeProcessing(
    supabase as unknown as KnowledgeUpdateClient,
    {
      sourceId: source.id,
      companyId,
      contentVersion: source.content_version,
      storagePath,
      select,
    },
  );

  if (!begun.ok) {
    if (begun.reason === "superseded") {
      return loadSourceRow(supabase, source, companyId, select, foundation);
    }
    const failed = await markFileFailed(
      supabase,
      source.id,
      companyId,
      storagePath,
      "extract_failed",
      foundation,
    );
    return failed ?? asSource({ ...source, status: "failed", failure_code: "extract_failed", content: "" }, foundation);
  }

  const started = asSource(begun.row, foundation);
  const extracted = await extractKnowledgeText({
    fileName: started.file_name,
    contentType: started.content_type,
    bytes,
  });

  if (!extracted.ok) {
    const failed = await markFileFailed(
      supabase,
      source.id,
      companyId,
      storagePath,
      extracted.code,
      foundation,
    );
    return failed ?? asSource({ ...started, status: "failed", failure_code: extracted.code, content: "" }, foundation);
  }

  if (!(await stillCapturedObject())) {
    return loadSourceRow(supabase, source, companyId, select, foundation);
  }

  const published = await publishPreparedFile(
    supabase,
    {
      sourceId: source.id,
      companyId,
      text: extracted.text,
      expectedVersion: started.content_version,
      storagePath,
      bytes,
      generation: capturedGeneration,
    },
  );

  if (published.ok) return asSource(published.row, foundation);

  if (published.reason === "superseded") {
    // A newer upload/version owns this source now — never publish the older text.
    const { data: current } = await supabase
      .from("knowledge_sources")
      .select(select)
      .eq("id", source.id)
      .eq("company_id", companyId)
      .maybeSingle();
    return current
      ? asSource(current, foundation)
      : asSource({ ...started, status: "failed", failure_code: "extract_failed", content: "" }, foundation);
  }

  const failed = await markFileFailed(
    supabase,
    source.id,
    companyId,
    started.storage_path,
    "extract_failed",
    foundation,
  );
  return failed ?? asSource({ ...started, status: "failed", failure_code: "extract_failed", content: "" }, foundation);
}

export async function listKnowledgeSources(input?: { expectedCompanyId?: string }): Promise<KnowledgeActionResult<KnowledgeListPayload>> {
  try {
    const ctx = await requireMemberCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };
    if (input && "expectedCompanyId" in input) {
      const error = renderedCompanyError(input.expectedCompanyId, ctx.companyId);
      if (error) return error;
    }
    const listed = await listKnowledgeRowsForCompany(ctx.supabase, ctx.companyId);
    if (!listed.ok) return { ok: false, code: "AUTH_ERROR", message: listed.message };
    return { ok: true, data: listed.payload };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function saveTextKnowledgeSource(input: {
  id?: string;
  title: string;
  content: string;
  usageRole?: "knowledge" | "business_instructions";
  expectedCompanyId?: string;
}): Promise<KnowledgeActionResult<KnowledgeSourceRecord>> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || title.length > 200 || !content) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (input.usageRole !== undefined && !["knowledge", "business_instructions"].includes(input.usageRole)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const roleChange = input.usageRole === undefined ? {} : { usage_role: input.usageRole };

  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    if ("expectedCompanyId" in input) {
      const error = renderedCompanyError(input.expectedCompanyId, ctx.companyId);
      if (error) return error;
    }

    if (input.id) {
      const { data, error } = await ctx.supabase
        .from("knowledge_sources")
        .update({ title, content, status: "ready", kind: "text", ...roleChange })
        .eq("id", input.id)
        .eq("company_id", ctx.companyId)
        .eq("kind", "text")
        .select(ctx.sourceSelect)
        .maybeSingle();
      if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
      if (!data) return { ok: false, code: "FORBIDDEN", message: "not_found" };
      revalidateKnowledge(ctx.companyId);
      return { ok: true, data: asSource(data, ctx.approvalFoundation) };
    }

    const { data, error } = await ctx.supabase
      .from("knowledge_sources")
      .insert({
        company_id: ctx.companyId,
        kind: "text",
        title,
        content,
        status: "ready",
        created_by: ctx.userId,
        ...roleChange,
      })
      .select(ctx.sourceSelect)
      .single();
    if (error || !data) return { ok: false, code: "AUTH_ERROR", message: error?.message };
    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: asSource(data, ctx.approvalFoundation) };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function uploadKnowledgeFiles(
  formData: FormData,
): Promise<KnowledgeActionResult<KnowledgeUploadItemResult[]>> {
  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    const expectedCompanies = formData.getAll("expectedCompanyId");
    if (expectedCompanies.length > 1) return { ok: false, code: "INVALID_INPUT", message: "invalid_company" };
    if (expectedCompanies.length === 1) {
      const error = renderedCompanyError(expectedCompanies[0], ctx.companyId);
      if (error) return error;
    }

    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    const batchError = validateKnowledgeBatch(
      files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    );
    if (batchError) {
      return { ok: false, code: "INVALID_INPUT", message: batchError };
    }

    const results: KnowledgeUploadItemResult[] = [];

    for (const file of files) {
      const fileName = file.name.trim() || "file";
      const contentType = resolveKnowledgeContentType(fileName, file.type);
      if (!contentType) {
        results.push({ fileName, ok: false, code: "INVALID_TYPE" });
        continue;
      }

      const title = fileName.slice(0, 200);
      // 1) Create row to obtain source id (no upload yet).
      const { data: row, error: insertError } = await ctx.supabase
        .from("knowledge_sources")
        .insert({
          company_id: ctx.companyId,
          kind: "file",
          title,
          content: "",
          file_name: fileName,
          content_type: contentType,
          byte_size: file.size,
          status: "draft",
          created_by: ctx.userId,
        })
        .select(ctx.sourceSelect)
        .single();

      if (insertError || !row) {
        results.push({ fileName, ok: false, code: "UPLOAD_FAILED", message: insertError?.message });
        continue;
      }

      const path = knowledgeStoragePath(ctx.companyId, row.id, fileName);

      // 2) Persist expected path BEFORE upload so reload can recover after crashes.
      const { data: reserved, error: reserveError } = await ctx.supabase
        .from("knowledge_sources")
        .update({
          storage_path: path,
          content_type: contentType,
          byte_size: file.size,
          file_name: fileName,
          title,
          status: "draft",
        })
        .eq("id", row.id)
        .eq("company_id", ctx.companyId)
        .select(ctx.sourceSelect)
        .single();

      if (reserveError || !reserved) {
        await ctx.supabase
          .from("knowledge_sources")
          .delete()
          .eq("id", row.id)
          .eq("company_id", ctx.companyId);
        results.push({
          fileName,
          ok: false,
          code: "UPLOAD_FAILED",
          message: reserveError?.message ?? "path_reserve_failed",
        });
        continue;
      }

      // 3) Upload only after path is durable in DB. Path reserve alone is not upload success.
      const { error: uploadError } = await ctx.supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .upload(path, new Uint8Array(await file.arrayBuffer()), {
          contentType,
          upsert: false,
        });

      if (uploadError) {
        // Keep reserved path for a later retry at the same location.
        const failed = await markFileFailed(
          ctx.supabase,
          row.id,
          ctx.companyId,
          path,
          null,
          ctx.approvalFoundation,
        );
        results.push({
          fileName,
          ok: false,
          code: "UPLOAD_FAILED",
          message: uploadError.message,
          source: failed ?? asSource({ ...reserved, status: "failed", storage_path: path }, ctx.approvalFoundation),
        });
        continue;
      }

      const preparable = isPreparableKnowledgeFile(fileName);
      let boundBytes: Uint8Array | null = null;
      let boundGeneration: StorageObjectGeneration | null = null;
      if (preparable) {
        const loaded = await loadStoredBytesBoundToObject(
          ctx.supabase,
          ctx.companyId,
          row.id,
          path,
        );
        if (!loaded.ok) {
          if (loaded.reason === "conflict") {
            results.push({
              fileName,
              ok: false,
              code: "CONFLICT",
              message: "OBJECT_IDENTITY_CONFLICT",
            });
            continue;
          }
          const failed = await markFileFailed(
            ctx.supabase,
            row.id,
            ctx.companyId,
            path,
            null,
            ctx.approvalFoundation,
          );
          results.push({
            fileName,
            ok: false,
            uploaded: true,
            code: loaded.reason === "missing" ? "UPLOAD_FAILED" : "STORAGE_ERROR",
            message:
              loaded.reason === "error" || loaded.reason === "download_failed"
                ? loaded.message
                : loaded.reason === "missing"
                  ? "OBJECT_MISSING"
                  : "OBJECT_IDENTITY_UNREADABLE",
            source: failed ?? asSource({ ...reserved, status: "failed", storage_path: path }, ctx.approvalFoundation),
          });
          continue;
        }
        boundBytes = loaded.bytes;
        boundGeneration = loaded.generation;
      }

      const { data: stored, error: updateError } = await ctx.supabase
        .from("knowledge_sources")
        .update({
          status: preparable ? "processing" : "stored",
          failure_code: null,
          content: "",
          content_type: contentType,
          byte_size: file.size,
        })
        .eq("id", row.id)
        .eq("company_id", ctx.companyId)
        .select(ctx.sourceSelect)
        .single();

      if (updateError || !stored) {
        const { error: removeError } = await ctx.supabase.storage.from(KNOWLEDGE_BUCKET).remove([path]);
        if (removeError) {
          // Path was reserved before upload — durable even if this status write fails.
          const failed = await markFileFailed(
            ctx.supabase,
            row.id,
            ctx.companyId,
            path,
            null,
            ctx.approvalFoundation,
          );
          results.push({
            fileName,
            ok: false,
            code: "CLEANUP_FAILED",
            message: removeError.message,
            source: failed ?? asSource({ ...reserved, status: "failed", storage_path: path }, ctx.approvalFoundation),
          });
          continue;
        }
        const failed = await markFileFailed(
          ctx.supabase,
          row.id,
          ctx.companyId,
          null,
          null,
          ctx.approvalFoundation,
        );
        results.push({
          fileName,
          ok: false,
          code: "UPLOAD_FAILED",
          message: updateError?.message ?? "update_failed",
          source: failed ?? undefined,
        });
        continue;
      }

      const prepared = preparable && boundBytes && boundGeneration
        ? await prepareStoredFile(
          ctx.supabase,
          asSource(reserved, ctx.approvalFoundation),
          ctx.companyId,
          boundBytes,
          boundGeneration,
          ctx.approvalFoundation,
        )
        : asSource(stored, ctx.approvalFoundation);
      if (prepared.status === "failed") {
        results.push({
          fileName,
          ok: false,
          uploaded: true,
          code: "UPLOAD_OK_EXTRACT_FAILED",
          message: prepared.failure_code ?? "extract_failed",
          source: prepared,
        });
        continue;
      }
      results.push({
        fileName,
        ok: true,
        uploaded: true,
        source: prepared,
      });
    }

    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: results };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Repair a failed row that still has a storage object (cleanup failure path). */
export async function repairStoredKnowledgeFile(
  sourceId: string,
): Promise<KnowledgeActionResult<KnowledgeSourceRecord>> {
  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    const { data: existing, error: loadError } = await ctx.supabase
      .from("knowledge_sources")
      .select(ctx.sourceSelect)
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId)
      .eq("kind", "file")
      .maybeSingle();

    if (loadError) return { ok: false, code: "AUTH_ERROR", message: loadError.message };
    if (!existing?.storage_path) {
      return { ok: false, code: "INVALID_INPUT", message: "not_found" };
    }
    if (existing.status !== "failed" && existing.status !== "draft") {
      return { ok: false, code: "INVALID_INPUT", message: "not_repairable" };
    }

    const { data: listed, error: listError } = await ctx.supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .list(`${ctx.companyId}/${existing.id}`, { limit: 20 });
    if (listError) return { ok: false, code: "STORAGE_ERROR", message: listError.message };
    const filePart = existing.storage_path.split("/").pop();
    const object = ((listed ?? []) as ListedStorageObject[]).find((o) => o.name === filePart) ?? null;
    const captured = generationFromListedObject(object);
    if (!captured) {
      const failed = await markFileFailed(
        ctx.supabase,
        existing.id,
        ctx.companyId,
        existing.storage_path,
        null,
        ctx.approvalFoundation,
      );
      revalidateKnowledge(ctx.companyId);
      return {
        ok: false,
        code: "STORAGE_ERROR",
        message: object ? "OBJECT_IDENTITY_UNREADABLE" : "OBJECT_MISSING",
        data: failed ?? undefined,
      };
    }

    if (!isPreparableKnowledgeFile(existing.file_name)) {
      const { data, error } = await ctx.supabase
        .from("knowledge_sources")
        .update({ status: "stored", failure_code: null, content: "" })
        .eq("id", existing.id)
        .eq("company_id", ctx.companyId)
        .select(ctx.sourceSelect)
        .single();
      if (error || !data) return { ok: false, code: "AUTH_ERROR", message: error?.message };
      revalidateKnowledge(ctx.companyId);
      return { ok: true, data: asSource(data, ctx.approvalFoundation) };
    }

    const { data: fileBlob, error: downloadError } = await ctx.supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .download(existing.storage_path);
    if (downloadError || !fileBlob) {
      await markFileFailed(
        ctx.supabase,
        existing.id,
        ctx.companyId,
        existing.storage_path,
        "extract_failed",
        ctx.approvalFoundation,
      );
      revalidateKnowledge(ctx.companyId);
      return { ok: false, code: "STORAGE_ERROR", message: downloadError?.message ?? "download_failed", };
    }
    const prepared = await prepareStoredFile(
      ctx.supabase,
      asSource(existing, ctx.approvalFoundation),
      ctx.companyId,
      new Uint8Array(await fileBlob.arrayBuffer()),
      captured,
      ctx.approvalFoundation,
    );
    revalidateKnowledge(ctx.companyId);
    if (prepared.status === "failed") {
      return { ok: false, code: "INVALID_INPUT", message: prepared.failure_code ?? "extract_failed" };
    }
    return { ok: true, data: prepared };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function retryFailedKnowledgeFile(
  sourceId: string,
  formData: FormData,
): Promise<KnowledgeActionResult<KnowledgeSourceRecord>> {
  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, code: "INVALID_INPUT" };

    const { data: existing, error: loadError } = await ctx.supabase
      .from("knowledge_sources")
      .select(ctx.sourceSelect)
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId)
      .eq("kind", "file")
      .maybeSingle();

    if (loadError) return { ok: false, code: "AUTH_ERROR", message: loadError.message };
    if (!existing) return { ok: false, code: "FORBIDDEN", message: "not_found" };
    if (existing.status === "processing") {
      return { ok: false, code: "INVALID_INPUT", message: "busy" };
    }

    const fileName = file.name.trim() || existing.file_name || "file";
    const contentType = resolveKnowledgeContentType(fileName, file.type);
    const validation = validateKnowledgeFile({ name: fileName, size: file.size, type: file.type });
    if (validation || !contentType) {
      return { ok: false, code: "INVALID_INPUT", message: validation ?? "INVALID_TYPE" };
    }

    const path = knowledgeStoragePath(ctx.companyId, existing.id, fileName);

    // Stop answering from the old text BEFORE the old object can disappear.
    const cleared = await clearAnswerEligibility(
      ctx.supabase as unknown as KnowledgeUpdateClient,
      { sourceId: existing.id, companyId: ctx.companyId, select: ctx.sourceSelect },
    );
    if (!cleared.ok) {
      return {
        ok: false,
        code: cleared.reason === "not_found" ? "FORBIDDEN" : "AUTH_ERROR",
        message: cleared.reason === "not_found" ? "not_found" : "INVALIDATE_FAILED",
      };
    }

    // If retrying to a new path, clear the old object (path reserved next).
    if (existing.storage_path && existing.storage_path !== path) {
      const { error: removeError } = await ctx.supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .remove([existing.storage_path]);
      if (removeError) {
        return { ok: false, code: "STORAGE_ERROR", message: removeError.message };
      }
    }

    // Persist expected path BEFORE upload. Clears prior extracted text so approval cannot stick.
    const { data: reserved, error: reserveError } = await ctx.supabase
      .from("knowledge_sources")
      .update({
        title: fileName.slice(0, 200),
        file_name: fileName,
        content_type: contentType,
        byte_size: file.size,
        storage_path: path,
        status: "draft",
        content: "",
        failure_code: null,
      })
      .eq("id", existing.id)
      .eq("company_id", ctx.companyId)
      .select(ctx.sourceSelect)
      .single();
    if (reserveError || !reserved) {
      return { ok: false, code: "AUTH_ERROR", message: reserveError?.message ?? "path_reserve_failed" };
    }

    const { error: uploadError } = await ctx.supabase.storage.from(KNOWLEDGE_BUCKET).upload(
      path,
      new Uint8Array(await file.arrayBuffer()),
      {
        contentType,
        upsert: true,
      },
    );
    if (uploadError) {
      await markFileFailed(ctx.supabase, existing.id, ctx.companyId, path, null, ctx.approvalFoundation);
      return { ok: false, code: "STORAGE_ERROR", message: uploadError.message };
    }

    const preparable = isPreparableKnowledgeFile(fileName);
    let boundBytes: Uint8Array | null = null;
    let boundGeneration: StorageObjectGeneration | null = null;
    if (preparable) {
      const loaded = await loadStoredBytesBoundToObject(
        ctx.supabase,
        ctx.companyId,
        existing.id,
        path,
      );
      if (!loaded.ok) {
        if (loaded.reason === "conflict") {
          return { ok: false, code: "CONFLICT", message: "OBJECT_IDENTITY_CONFLICT" };
        }
        await markFileFailed(ctx.supabase, existing.id, ctx.companyId, path, null, ctx.approvalFoundation);
        return {
          ok: false,
          code: "STORAGE_ERROR",
          message:
            loaded.reason === "error" || loaded.reason === "download_failed"
              ? loaded.message
              : loaded.reason === "missing"
                ? "OBJECT_MISSING"
                : "OBJECT_IDENTITY_UNREADABLE",
        };
      }
      boundBytes = loaded.bytes;
      boundGeneration = loaded.generation;
    }

    const { data, error } = await ctx.supabase
      .from("knowledge_sources")
      .update({ status: preparable ? "processing" : "stored", failure_code: null, content: "" })
      .eq("id", existing.id)
      .eq("company_id", ctx.companyId)
      .select(ctx.sourceSelect)
      .single();

    if (error || !data) {
      const { error: removeError } = await ctx.supabase.storage.from(KNOWLEDGE_BUCKET).remove([path]);
      if (removeError) {
        await markFileFailed(ctx.supabase, existing.id, ctx.companyId, path, null, ctx.approvalFoundation);
        return { ok: false, code: "STORAGE_ERROR", message: removeError.message };
      }
      await markFileFailed(ctx.supabase, existing.id, ctx.companyId, null, null, ctx.approvalFoundation);
      return { ok: false, code: "AUTH_ERROR", message: error?.message };
    }

    const finished = preparable && boundBytes && boundGeneration
      ? await prepareStoredFile(
        ctx.supabase,
        asSource(reserved, ctx.approvalFoundation),
        ctx.companyId,
        boundBytes,
        boundGeneration,
        ctx.approvalFoundation,
      )
      : asSource(data, ctx.approvalFoundation);
    revalidateKnowledge(ctx.companyId);
    if (finished.status === "failed") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `UPLOAD_OK_EXTRACT_FAILED:${finished.failure_code ?? "extract_failed"}`,
        data: finished,
      };
    }
    return { ok: true, data: finished };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Re-reads the stored file and replaces its prepared text. Does not create another source. */
export async function retryKnowledgePrepare(
  sourceId: string,
): Promise<KnowledgeActionResult<KnowledgeSourceRecord>> {
  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    const { data: existing, error: loadError } = await ctx.supabase
      .from("knowledge_sources")
      .select(ctx.sourceSelect)
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId)
      .eq("kind", "file")
      .maybeSingle();
    if (loadError) return { ok: false, code: "AUTH_ERROR", message: loadError.message };
    if (!existing?.storage_path || !isPreparableKnowledgeFile(existing.file_name)) {
      return { ok: false, code: "INVALID_INPUT", message: "not_preparable" };
    }

    const loaded = await loadStoredBytesBoundToObject(
      ctx.supabase,
      ctx.companyId,
      existing.id,
      existing.storage_path,
    );
    if (!loaded.ok) {
      if (loaded.reason === "conflict") {
        return { ok: false, code: "CONFLICT", message: "OBJECT_IDENTITY_CONFLICT" };
      }
      if (loaded.reason === "error") {
        return { ok: false, code: "STORAGE_ERROR", message: loaded.message };
      }
      if (loaded.reason === "missing") {
        const failed = await markFileFailed(
          ctx.supabase,
          existing.id,
          ctx.companyId,
          null,
          null,
          ctx.approvalFoundation,
        );
        revalidateKnowledge(ctx.companyId);
        return {
          ok: false,
          code: "STORAGE_ERROR",
          message: "OBJECT_MISSING",
          data: failed ?? undefined,
        };
      }
      if (loaded.reason === "unreadable") {
        return { ok: false, code: "STORAGE_ERROR", message: "OBJECT_IDENTITY_UNREADABLE" };
      }
      const failed = await markFileFailed(
        ctx.supabase,
        existing.id,
        ctx.companyId,
        existing.storage_path,
        "extract_failed",
        ctx.approvalFoundation,
      );
      revalidateKnowledge(ctx.companyId);
      return {
        ok: false,
        code: "STORAGE_ERROR",
        message: loaded.message ?? "download_failed",
        data: failed ?? undefined,
      };
    }

    const prepared = await prepareStoredFile(
      ctx.supabase,
      asSource(existing, ctx.approvalFoundation),
      ctx.companyId,
      loaded.bytes,
      loaded.generation,
      ctx.approvalFoundation,
    );
    revalidateKnowledge(ctx.companyId);
    if (prepared.status === "failed") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: prepared.failure_code ?? "extract_failed",
        data: prepared,
      };
    }
    return { ok: true, data: prepared };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/**
 * Owner-only: approve the current ready version for customer-answer context.
 * Version/time/actor are stamped server-side via RPC — not client UPDATE fields.
 */
export async function setKnowledgeSourceApproval(
  sourceId: string,
  approved: boolean,
): Promise<KnowledgeActionResult<KnowledgeSourceRecord>> {
  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };
    if (!sourceId) return { ok: false, code: "INVALID_INPUT" };

    // Probe foundation before calling the approval RPC — do not hide missing migration as auth noise.
    const probe = await listKnowledgeRowsForCompany(ctx.supabase, ctx.companyId);
    if (!probe.ok) return { ok: false, code: "AUTH_ERROR", message: probe.message };
    if (probe.payload.approvalFoundation === "unavailable") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "APPROVAL_FOUNDATION_UNAVAILABLE",
      };
    }

    const { data, error } = await ctx.supabase.rpc("set_knowledge_source_approval", {
      p_source_id: sourceId,
      p_approved: approved,
    });

    if (error) {
      const msg = error.message ?? "";
      const lower = msg.toLowerCase();
      if (
        (lower.includes("set_knowledge_source_approval")
          && (lower.includes("could not find") || lower.includes("does not exist") || lower.includes("schema cache")))
        || lower.includes("pgrst202")
        || isExactMissingApprovalColumnError(error)
      ) {
        return { ok: false, code: "INVALID_INPUT", message: "APPROVAL_FOUNDATION_UNAVAILABLE" };
      }
      if (msg.includes("not_ready")) return { ok: false, code: "INVALID_INPUT", message: "not_ready" };
      if (msg.includes("not_found")) return { ok: false, code: "FORBIDDEN", message: "not_found" };
      if (msg.includes("forbidden") || msg.includes("not_authenticated")) {
        return { ok: false, code: "FORBIDDEN" };
      }
      if (msg.includes("version_changed")) {
        return { ok: false, code: "FORBIDDEN", message: "version_changed" };
      }
      return { ok: false, code: "AUTH_ERROR", message: error.message };
    }
    if (!data) return { ok: false, code: "FORBIDDEN", message: "not_found" };

    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: asSource(data, "ready") };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function deleteKnowledgeSource(
  sourceId: string,
): Promise<KnowledgeActionResult<{ storageDeleted: boolean }>> {
  try {
    const ctx = await requireOwnerCompany("knowledge.delete");
    if (!ctx.ok) return { ok: false, code: ctx.code };

    const { data: existing, error: loadError } = await ctx.supabase
      .from("knowledge_sources")
      .select("id, company_id, kind, storage_path")
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId)
      .maybeSingle();

    if (loadError) return { ok: false, code: "AUTH_ERROR", message: loadError.message };
    if (!existing) return { ok: false, code: "FORBIDDEN", message: "not_found" };

    // Invalidate first: if the row delete later fails, no approved text remains.
    const cleared = await clearAnswerEligibility(
      ctx.supabase as unknown as KnowledgeUpdateClient,
      { sourceId, companyId: ctx.companyId, select: ctx.sourceSelect },
    );
    if (!cleared.ok) {
      return {
        ok: false,
        code: cleared.reason === "not_found" ? "FORBIDDEN" : "AUTH_ERROR",
        message: cleared.reason === "not_found" ? "not_found" : "INVALIDATE_FAILED",
      };
    }

    let storageDeleted = !existing.storage_path;
    if (existing.storage_path) {
      const { error: storageError } = await ctx.supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .remove([existing.storage_path]);
      if (storageError) {
        return { ok: false, code: "STORAGE_ERROR", message: storageError.message };
      }
      storageDeleted = true;
    }

    const { error: deleteError } = await ctx.supabase
      .from("knowledge_sources")
      .delete()
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId);

    if (deleteError) {
      return {
        ok: false,
        code: "AUTH_ERROR",
        message: existing.storage_path
          ? `DELETE_PARTIAL:${deleteError.message}`
          : deleteError.message,
      };
    }

    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: { storageDeleted } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminListCompanyKnowledge(
  companyId: string,
): Promise<KnowledgeActionResult<KnowledgeListPayload>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  if (!companyId) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const listed = await listKnowledgeRowsForCompany(supabase, companyId);
    if (!listed.ok) return { ok: false, code: "AUTH_ERROR", message: listed.message };
    return { ok: true, data: listed.payload };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminGetKnowledgeFileUrl(input: {
  companyId: string;
  sourceId: string;
}): Promise<KnowledgeActionResult<{ url: string; fileName: string }>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  if (!input.companyId || !input.sourceId) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("knowledge_sources")
      .select("id, company_id, kind, file_name, storage_path, status")
      .eq("id", input.sourceId)
      .eq("company_id", input.companyId)
      .eq("kind", "file")
      .maybeSingle();

    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    if (!data?.storage_path) return { ok: false, code: "FORBIDDEN", message: "not_found" };
    if (!data.storage_path.startsWith(`${input.companyId}/`)) {
      return { ok: false, code: "FORBIDDEN", message: "path_mismatch" };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .createSignedUrl(data.storage_path, 60);

    if (signError || !signed?.signedUrl) {
      return { ok: false, code: "STORAGE_ERROR", message: signError?.message };
    }

    return {
      ok: true,
      data: { url: signed.signedUrl, fileName: data.file_name || "file" },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
