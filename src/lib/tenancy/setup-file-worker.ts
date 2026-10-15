import { isSetupFilePath } from "./setup-file";
export type SetupFileDeletionClaim = { jobId: string; claimToken: string; bucket: string; path: string; objectId: string | null; objectUpdatedAt: string | null; companyId?: string; sourceId?: string; reason?: string; pathBindingVerified?: boolean };
export function validSetupFileDeletionClaim(c: SetupFileDeletionClaim): boolean {
  if (c.bucket !== "company-knowledge" || !c.path || /[\\%\u0000-\u001f\u007f]/.test(c.path) || c.path.split("/").some(p => !p || p === "." || p === "..")) return false;
  if (isSetupFilePath(c.path)) return true;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return c.reason === "paid_retention" && c.pathBindingVerified === true && typeof c.companyId === "string" && uuid.test(c.companyId)
    && typeof c.sourceId === "string" && uuid.test(c.sourceId) && c.path.startsWith(`${c.companyId}/${c.sourceId}/`);
}
export type SetupFileDeletionDb = {
  claim: () => Promise<{ ok: true; claim: SetupFileDeletionClaim | null } | { ok: false; code: string }>;
  finish: (jobId: string, claimToken: string, outcome: "absent" | "retry" | "generation_conflict") => Promise<boolean>;
};
export type SetupFileStoragePort = { inspect: (path: string) => Promise<{ id: string; updatedAt: string } | null>; remove: (path: string) => Promise<void> };
/** The database commits irreversible deletion_started before returning this claim. */
export async function runSetupFileDeletion(db: SetupFileDeletionDb, storage: SetupFileStoragePort) {
  const result = await db.claim(); if (!result.ok) return result;
  const c = result.claim; if (!c) return { ok: true, deleted: false };
  if (!validSetupFileDeletionClaim(c)) { await db.finish(c.jobId, c.claimToken, "generation_conflict"); return { ok: false, code: "INVALID_DELETION_SCOPE" }; }
  try {
    const before = await storage.inspect(c.path);
    if (before && (before.id !== c.objectId || before.updatedAt !== c.objectUpdatedAt)) {
      await db.finish(c.jobId, c.claimToken, "generation_conflict"); return { ok: false, code: "OBJECT_GENERATION_CHANGED" };
    }
    if (before) await storage.remove(c.path);
    if (await storage.inspect(c.path)) { await db.finish(c.jobId, c.claimToken, "retry"); return { ok: false, code: "ABSENCE_NOT_VERIFIED" }; }
    return await db.finish(c.jobId, c.claimToken, "absent") ? { ok: true, deleted: true } : { ok: false, code: "STALE_CLAIM" };
  } catch { await db.finish(c.jobId, c.claimToken, "retry"); return { ok: false, code: "ABSENCE_NOT_VERIFIED" }; }
}
