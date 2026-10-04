"use server";

import { revalidatePath } from "next/cache";
import {
  KNOWLEDGE_BUCKET,
  knowledgeStoragePath,
  resolveKnowledgeContentType,
  validateKnowledgeBatch,
  validateKnowledgeFile,
} from "@/lib/knowledge/constants";
import type { KnowledgeSourceRecord, KnowledgeUploadItemResult } from "@/lib/knowledge/types";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import type { AccessCode } from "@/lib/tenancy/types";

export type KnowledgeActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: AccessCode | "AUTH_ERROR" | "STORAGE_ERROR" | "INVALID_INPUT"; message?: string };

const SOURCE_SELECT =
  "id, company_id, kind, title, content, file_name, content_type, byte_size, storage_path, status, created_by, created_at, updated_at";

function asSource(row: unknown): KnowledgeSourceRecord {
  return row as KnowledgeSourceRecord;
}

async function requireOwnerCompany() {
  const access = await getCompanyAccess("owner");
  if (!access.ok) return { ok: false as const, code: access.code };
  if (!access.context.company || !access.context.membership) {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  return {
    ok: true as const,
    supabase: await createClient(),
    userId: access.context.userId,
    companyId: access.context.company.id,
  };
}

async function requireMemberCompany() {
  const access = await getCompanyAccess();
  if (!access.ok) return { ok: false as const, code: access.code };
  if (!access.context.company || !access.context.membership) {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  return {
    ok: true as const,
    supabase: await createClient(),
    companyId: access.context.company.id,
    role: access.context.membership.role,
  };
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
) {
  const { data } = await supabase
    .from("knowledge_sources")
    .update({ status: "failed", storage_path: storagePath })
    .eq("id", sourceId)
    .eq("company_id", companyId)
    .select(SOURCE_SELECT)
    .maybeSingle();
  return data ? asSource(data) : null;
}

export async function listKnowledgeSources(): Promise<KnowledgeActionResult<KnowledgeSourceRecord[]>> {
  try {
    const ctx = await requireMemberCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };
    const { data, error } = await ctx.supabase
      .from("knowledge_sources")
      .select(SOURCE_SELECT)
      .eq("company_id", ctx.companyId)
      .order("updated_at", { ascending: false });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data: (data ?? []).map(asSource) };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function saveTextKnowledgeSource(input: {
  id?: string;
  title: string;
  content: string;
}): Promise<KnowledgeActionResult<KnowledgeSourceRecord>> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || title.length > 200 || !content) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    if (input.id) {
      const { data, error } = await ctx.supabase
        .from("knowledge_sources")
        .update({ title, content, status: "ready", kind: "text" })
        .eq("id", input.id)
        .eq("company_id", ctx.companyId)
        .eq("kind", "text")
        .select(SOURCE_SELECT)
        .maybeSingle();
      if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
      if (!data) return { ok: false, code: "FORBIDDEN", message: "not_found" };
      revalidateKnowledge(ctx.companyId);
      return { ok: true, data: asSource(data) };
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
      })
      .select(SOURCE_SELECT)
      .single();
    if (error || !data) return { ok: false, code: "AUTH_ERROR", message: error?.message };
    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: asSource(data) };
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
        .select(SOURCE_SELECT)
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
        .select(SOURCE_SELECT)
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

      // 3) Upload only after path is durable in DB.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await ctx.supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .upload(path, bytes, {
          contentType,
          upsert: false,
        });

      if (uploadError) {
        // Keep reserved path for a later retry at the same location.
        const failed = await markFileFailed(ctx.supabase, row.id, ctx.companyId, path);
        results.push({
          fileName,
          ok: false,
          code: "UPLOAD_FAILED",
          message: uploadError.message,
          source: failed ?? asSource({ ...reserved, status: "failed", storage_path: path }),
        });
        continue;
      }

      const { data: stored, error: updateError } = await ctx.supabase
        .from("knowledge_sources")
        .update({
          status: "stored",
          content_type: contentType,
          byte_size: file.size,
        })
        .eq("id", row.id)
        .eq("company_id", ctx.companyId)
        .select(SOURCE_SELECT)
        .single();

      if (updateError || !stored) {
        const { error: removeError } = await ctx.supabase.storage.from(KNOWLEDGE_BUCKET).remove([path]);
        if (removeError) {
          // Path was reserved before upload — durable even if this status write fails.
          const failed = await markFileFailed(ctx.supabase, row.id, ctx.companyId, path);
          results.push({
            fileName,
            ok: false,
            code: "CLEANUP_FAILED",
            message: removeError.message,
            source: failed ?? asSource({ ...reserved, status: "failed", storage_path: path }),
          });
          continue;
        }
        const failed = await markFileFailed(ctx.supabase, row.id, ctx.companyId, null);
        results.push({
          fileName,
          ok: false,
          code: "UPLOAD_FAILED",
          message: updateError?.message ?? "update_failed",
          source: failed ?? undefined,
        });
        continue;
      }

      results.push({ fileName, ok: true, source: asSource(stored) });
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
      .select(SOURCE_SELECT)
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
    const present = (listed ?? []).some((o) => o.name === filePart);
    if (!present) {
      await markFileFailed(ctx.supabase, existing.id, ctx.companyId, null);
      return { ok: false, code: "STORAGE_ERROR", message: "object_missing" };
    }

    const { data, error } = await ctx.supabase
      .from("knowledge_sources")
      .update({ status: "stored" })
      .eq("id", existing.id)
      .eq("company_id", ctx.companyId)
      .select(SOURCE_SELECT)
      .single();
    if (error || !data) return { ok: false, code: "AUTH_ERROR", message: error?.message };

    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: asSource(data) };
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
      .select(SOURCE_SELECT)
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId)
      .eq("kind", "file")
      .maybeSingle();

    if (loadError) return { ok: false, code: "AUTH_ERROR", message: loadError.message };
    if (!existing) return { ok: false, code: "FORBIDDEN", message: "not_found" };

    const fileName = file.name.trim() || existing.file_name || "file";
    const contentType = resolveKnowledgeContentType(fileName, file.type);
    const validation = validateKnowledgeFile({ name: fileName, size: file.size, type: file.type });
    if (validation || !contentType) {
      return { ok: false, code: "INVALID_INPUT", message: validation ?? "INVALID_TYPE" };
    }

    const path = knowledgeStoragePath(ctx.companyId, existing.id, fileName);

    // If retrying to a new path, clear the old object first (path reserved next).
    if (existing.storage_path && existing.storage_path !== path) {
      const { error: removeError } = await ctx.supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .remove([existing.storage_path]);
      if (removeError) {
        return { ok: false, code: "STORAGE_ERROR", message: removeError.message };
      }
    }

    // Persist expected path BEFORE upload.
    const { data: reserved, error: reserveError } = await ctx.supabase
      .from("knowledge_sources")
      .update({
        title: fileName.slice(0, 200),
        file_name: fileName,
        content_type: contentType,
        byte_size: file.size,
        storage_path: path,
        status: "draft",
      })
      .eq("id", existing.id)
      .eq("company_id", ctx.companyId)
      .select(SOURCE_SELECT)
      .single();
    if (reserveError || !reserved) {
      return { ok: false, code: "AUTH_ERROR", message: reserveError?.message ?? "path_reserve_failed" };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await ctx.supabase.storage.from(KNOWLEDGE_BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (uploadError) {
      await markFileFailed(ctx.supabase, existing.id, ctx.companyId, path);
      return { ok: false, code: "STORAGE_ERROR", message: uploadError.message };
    }

    const { data, error } = await ctx.supabase
      .from("knowledge_sources")
      .update({ status: "stored" })
      .eq("id", existing.id)
      .eq("company_id", ctx.companyId)
      .select(SOURCE_SELECT)
      .single();

    if (error || !data) {
      const { error: removeError } = await ctx.supabase.storage.from(KNOWLEDGE_BUCKET).remove([path]);
      if (removeError) {
        await markFileFailed(ctx.supabase, existing.id, ctx.companyId, path);
        return { ok: false, code: "STORAGE_ERROR", message: removeError.message };
      }
      await markFileFailed(ctx.supabase, existing.id, ctx.companyId, null);
      return { ok: false, code: "AUTH_ERROR", message: error?.message };
    }

    revalidateKnowledge(ctx.companyId);
    return { ok: true, data: asSource(data) };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function deleteKnowledgeSource(
  sourceId: string,
): Promise<KnowledgeActionResult<{ storageDeleted: boolean }>> {
  try {
    const ctx = await requireOwnerCompany();
    if (!ctx.ok) return { ok: false, code: ctx.code };

    const { data: existing, error: loadError } = await ctx.supabase
      .from("knowledge_sources")
      .select("id, company_id, kind, storage_path")
      .eq("id", sourceId)
      .eq("company_id", ctx.companyId)
      .maybeSingle();

    if (loadError) return { ok: false, code: "AUTH_ERROR", message: loadError.message };
    if (!existing) return { ok: false, code: "FORBIDDEN", message: "not_found" };

    const storageDeleted = true;
    if (existing.storage_path) {
      const { error: storageError } = await ctx.supabase.storage
        .from(KNOWLEDGE_BUCKET)
        .remove([existing.storage_path]);
      if (storageError) {
        return { ok: false, code: "STORAGE_ERROR", message: storageError.message };
      }
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
): Promise<KnowledgeActionResult<KnowledgeSourceRecord[]>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  if (!companyId) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("knowledge_sources")
      .select(SOURCE_SELECT)
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data: (data ?? []).map(asSource) };
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
