import "server-only";
import {
  listHandleCookies,
  rotateHandleCookies,
  selectCandidateHandles,
  type CookieReader,
  type CookieWriter,
} from "./cookies";
import { readBoundBrowserContinuity } from "./continuity";
import { brokerLog } from "./log";
import { resolveBrokerSession } from "./resolve";

export type BrokerAdmissionLineageOptions = {
  /**
   * Password/OAuth admit: clear conflicting vel_sh_* cookies up front so a stale
   * tip/jar cannot force capability probes or block a fresh admit. Continuity
   * (vel_bc) is preserved.
   */
  rotateStaleHandles?: boolean;
};

/**
 * C5-R4: require already-enrolled continuity mirror + server bind.
 * Never mints roots from request-scoped CookieReader races.
 */
export async function prepareBrokerAdmissionLineage(
  reader: CookieReader,
  writer: CookieWriter,
  options?: BrokerAdmissionLineageOptions,
): Promise<
  | {
      ok: true;
      browserLineageId: string;
      parentHandleHash: string | null;
      bootstrapHash: string;
      attemptId: string;
    }
  | { ok: false; code: "UNAVAILABLE" | "CONTINUITY_REQUIRED" }
> {
  const bound = await readBoundBrowserContinuity(reader);
  if (!bound || bound.state !== "active") {
    return { ok: false, code: "CONTINUITY_REQUIRED" };
  }

  if (options?.rotateStaleHandles) {
    const rotated = rotateHandleCookies(writer, reader);
    if (rotated.length > 0) {
      brokerLog("info", "auth.broker.lineage.stale_handles_rotated", {
        error_code: "STALE_HANDLE_ROTATE",
        count: rotated.length,
      });
    }
    return {
      ok: true,
      browserLineageId: bound.browserLineageId,
      parentHandleHash: null,
      bootstrapHash: bound.bootstrapHash,
      attemptId: bound.browserLineageId,
    };
  }

  const candidates = selectCandidateHandles(reader);
  if (!("failClosed" in candidates) && candidates.length === 0) {
    return {
      ok: true,
      browserLineageId: bound.browserLineageId,
      parentHandleHash: null,
      bootstrapHash: bound.bootstrapHash,
      attemptId: bound.browserLineageId,
    };
  }

  const resolved = await resolveBrokerSession(reader, {
    browserLineageId: bound.browserLineageId,
    admissionScope: "app",
    bootstrapHash: bound.bootstrapHash,
  });
  if (resolved.ok) {
    return {
      ok: true,
      browserLineageId: bound.browserLineageId,
      parentHandleHash: resolved.handleHash,
      bootstrapHash: bound.bootstrapHash,
      attemptId: bound.browserLineageId,
    };
  }
  if (resolved.code === "UNAVAILABLE") {
    // Stale multi-handle jars hit capability fail-closed here. Prefer rotating
    // over hammering Supabase when the writer can clear the conflict.
    if ("failClosed" in candidates || listHandleCookies(reader).length > 0) {
      const rotated = rotateHandleCookies(writer, reader);
      if (rotated.length > 0) {
        brokerLog("warn", "auth.broker.lineage.unavailable_rotated", {
          error_code: "STALE_HANDLE_ROTATE_AFTER_UNAVAILABLE",
          count: rotated.length,
        });
        return {
          ok: true,
          browserLineageId: bound.browserLineageId,
          parentHandleHash: null,
          bootstrapHash: bound.bootstrapHash,
          attemptId: bound.browserLineageId,
        };
      }
    }
    return { ok: false, code: "UNAVAILABLE" };
  }
  return {
    ok: true,
    browserLineageId: bound.browserLineageId,
    parentHandleHash: null,
    bootstrapHash: bound.bootstrapHash,
    attemptId: bound.browserLineageId,
  };
}
