import "server-only";
import type { CookieReader, CookieWriter } from "./cookies";
import { readBoundBrowserContinuity } from "./continuity";
import { resolveBrokerSession } from "./resolve";

/**
 * C5-R4: require already-enrolled continuity mirror + server bind.
 * Never mints roots from request-scoped CookieReader races.
 */
export async function prepareBrokerAdmissionLineage(
  reader: CookieReader,
  _writer: CookieWriter,
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
  void _writer;
  const bound = await readBoundBrowserContinuity(reader);
  if (!bound || bound.state !== "active") {
    return { ok: false, code: "CONTINUITY_REQUIRED" };
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
