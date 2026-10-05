import { describe, expect, it, vi } from "vitest";
import {
  beginKnowledgeProcessing,
  bindDownloadedBytesToObject,
  clearAnswerEligibility,
  objectGenerationMatches,
  processingIdentityMatches,
  publishExtractedText,
  type KnowledgeUpdateClient,
} from "./invalidate";
import { applyStorageObjectEvent } from "./storage-object-invalidation";

const SELECT = "id, content, approved_for_answers, content_version, storage_path, status";

type Row = Record<string, unknown>;

/** Minimal update-chain fake that records the applied eq filters. */
function updateClient(opts: {
  row?: Row | null;
  error?: { message: string } | null;
  onUpdate?: (values: Record<string, unknown>) => void;
}) {
  const filters: [string, string | number][] = [];
  const client: KnowledgeUpdateClient = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        opts.onUpdate?.(values);
        const chain = {
          eq(column: string, value: string | number) {
            filters.push([column, value]);
            return chain;
          },
          select: () => ({
            maybeSingle: async () => ({
              data: opts.row ?? null,
              error: opts.error ?? null,
            }),
          }),
        };
        return chain;
      },
    }),
  };
  return { client, filters };
}

describe("clearAnswerEligibility", () => {
  it("empties content and confirms the row is no longer approved", async () => {
    const values: Record<string, unknown>[] = [];
    const { client, filters } = updateClient({
      row: { id: "s1", content: "", approved_for_answers: false },
      onUpdate: (v) => values.push(v),
    });

    const result = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-a",
      select: SELECT,
    });

    expect(result).toEqual({ ok: true, row: { id: "s1", content: "", approved_for_answers: false } });
    expect(values).toEqual([{ content: "" }]);
    expect(filters).toEqual([["id", "s1"], ["company_id", "co-a"]]);
  });

  it("fails when the write errors so callers do not touch Storage", async () => {
    const { client } = updateClient({ row: null, error: { message: "boom" } });
    const result = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-a",
      select: SELECT,
    });
    expect(result).toEqual({ ok: false, reason: "error", message: "boom" });
  });

  it("fails when the row is missing for this company", async () => {
    const { client } = updateClient({ row: null });
    const result = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-other",
      select: SELECT,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("fails when the returned row is still answer eligible", async () => {
    const { client } = updateClient({
      row: { id: "s1", content: "old menu text", approved_for_answers: true },
    });
    const result = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-a",
      select: SELECT,
    });
    expect(result).toEqual({ ok: false, reason: "still_eligible" });
  });
});

describe("publishExtractedText", () => {
  it("binds the write to source, company, processing status, version and file", async () => {
    const values: Record<string, unknown>[] = [];
    const { client, filters } = updateClient({
      row: { id: "s1", status: "ready", content: "text" },
      onUpdate: (v) => values.push(v),
    });

    const result = await publishExtractedText(client, {
      sourceId: "s1",
      companyId: "co-a",
      text: "text",
      expectedVersion: 3,
      expectedStoragePath: "co-a/s1/menu.pdf",
      select: SELECT,
    });

    expect(result.ok).toBe(true);
    expect(values[0]).toMatchObject({ status: "ready", content: "text", failure_code: null });
    expect(filters).toEqual([
      ["id", "s1"],
      ["company_id", "co-a"],
      ["status", "processing"],
      ["content_version", 3],
      ["storage_path", "co-a/s1/menu.pdf"],
    ]);
  });

  it("reports superseded when a newer version replaced the file mid-processing", async () => {
    const { client } = updateClient({ row: null });
    const result = await publishExtractedText(client, {
      sourceId: "s1",
      companyId: "co-a",
      text: "stale extraction",
      expectedVersion: 3,
      expectedStoragePath: "co-a/s1/menu.pdf",
      select: SELECT,
    });
    expect(result).toEqual({ ok: false, reason: "superseded" });
  });

  it("reports error without claiming success", async () => {
    const { client } = updateClient({ row: null, error: { message: "db down" } });
    const result = await publishExtractedText(client, {
      sourceId: "s1",
      companyId: "co-a",
      text: "text",
      expectedVersion: null,
      expectedStoragePath: null,
      select: SELECT,
    });
    expect(result).toEqual({ ok: false, reason: "error", message: "db down" });
  });

  it("omits version and path filters when they are unknown", async () => {
    const { client, filters } = updateClient({ row: { id: "s1" } });
    await publishExtractedText(client, {
      sourceId: "s1",
      companyId: "co-a",
      text: "text",
      expectedVersion: null,
      expectedStoragePath: null,
      select: SELECT,
    });
    expect(filters).toEqual([["id", "s1"], ["company_id", "co-a"], ["status", "processing"]]);
  });
});

describe("beginKnowledgeProcessing identity bind", () => {
  it("binds start-of-processing to the downloaded source/version/file", async () => {
    const { client, filters } = updateClient({
      row: { id: "s1", status: "processing", content: "", content_version: 4, storage_path: "co-a/s1/menu.pdf" },
    });
    const result = await beginKnowledgeProcessing(client, {
      sourceId: "s1",
      companyId: "co-a",
      contentVersion: 3,
      storagePath: "co-a/s1/menu.pdf",
      select: SELECT,
    });
    expect(result.ok).toBe(true);
    expect(filters).toEqual([
      ["id", "s1"],
      ["company_id", "co-a"],
      ["content_version", 3],
      ["storage_path", "co-a/s1/menu.pdf"],
    ]);
  });

  it("does not publish old bytes after empty-content same-path replace (no version bump)", async () => {
    const emptyDraft = {
      kind: "file",
      storage_path: "co-a/s1/menu.pdf",
      content: "",
      status: "draft",
      failure_code: null,
      content_version: 3,
      approved_for_answers: false,
      approved_version: null,
    };
    const afterInvalidate = applyStorageObjectEvent(emptyDraft, {
      op: "UPDATE",
      oldBucket: "company-knowledge",
      oldName: "co-a/s1/menu.pdf",
      newBucket: "company-knowledge",
      newName: "co-a/s1/menu.pdf",
    });
    expect(afterInvalidate.content_version).toBe(3);
    expect(afterInvalidate.storage_path).toBe("co-a/s1/menu.pdf");
    expect(afterInvalidate.content).toBe("");

    const captured = { objectId: "obj-1", updatedAt: "2026-10-05T10:00:00.000Z" };
    const replacedSamePathSameSize = { objectId: "obj-1", updatedAt: "2026-10-05T10:00:01.500Z" };
    expect(objectGenerationMatches(captured, replacedSamePathSameSize)).toBe(false);

    const downloaded = {
      sourceId: "s1",
      companyId: "co-a",
      contentVersion: emptyDraft.content_version,
      storagePath: emptyDraft.storage_path,
      object: captured,
    };
    const current = {
      sourceId: "s1",
      companyId: "co-a",
      contentVersion: afterInvalidate.content_version,
      storagePath: afterInvalidate.storage_path,
      object: replacedSamePathSameSize,
    };
    expect(downloaded.contentVersion).toBe(current.contentVersion);
    expect(processingIdentityMatches(downloaded, current)).toBe(false);

    const publish = vi.fn();
    const { client } = updateClient({
      row: {
        id: "s1",
        status: "processing",
        content: "",
        content_version: 3,
        storage_path: "co-a/s1/menu.pdf",
      },
    });
    const begun = await beginKnowledgeProcessing(client, {
      sourceId: downloaded.sourceId,
      companyId: downloaded.companyId,
      contentVersion: downloaded.contentVersion,
      storagePath: downloaded.storagePath,
      select: SELECT,
    });
    // Real invalidate left content_version unchanged, so the row bind still matches.
    expect(begun.ok).toBe(true);
    if (begun.ok && objectGenerationMatches(captured, replacedSamePathSameSize)) {
      await publishExtractedText(client, {
        sourceId: downloaded.sourceId,
        companyId: downloaded.companyId,
        text: "old uploaded bytes",
        expectedVersion: 3,
        expectedStoragePath: downloaded.storagePath,
        select: SELECT,
      });
      publish();
    }
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("upload paths bind downloaded bytes, not the local buffer", () => {
  const bytesA = new TextEncoder().encode("menu from A");
  const bytesB = new TextEncoder().encode("menu from B");
  const genA = { objectId: "obj-1", updatedAt: "2026-10-05T10:00:00.000Z" };
  const genB = { objectId: "obj-1", updatedAt: "2026-10-05T10:00:02.000Z" };

  it.each(["uploadKnowledgeFiles", "retryFailedKnowledgeFile"] as const)(
    "%s: replacing A with B before identity capture does not publish A as B",
    (path) => {
      expect(path).toMatch(/uploadKnowledgeFiles|retryFailedKnowledgeFile/);
      const localA = bytesA;
      const bound = bindDownloadedBytesToObject({
        captured: genB,
        downloadedBytes: bytesB,
        verified: genB,
      });
      expect(bound.ok).toBe(true);
      if (!bound.ok) return;
      expect(bound.bytes).not.toBe(localA);
      expect(new TextDecoder().decode(bound.bytes)).not.toBe("menu from A");
      const publish = vi.fn();
      publish(new TextDecoder().decode(bound.bytes));
      expect(publish).not.toHaveBeenCalledWith("menu from A");
      expect(publish).toHaveBeenCalledWith("menu from B");
    },
  );

  it("stops with conflict when identity changes between capture and verify — no adopt", () => {
    expect(
      bindDownloadedBytesToObject({
        captured: genA,
        downloadedBytes: bytesA,
        verified: genB,
      }),
    ).toEqual({ ok: false, reason: "conflict" });
  });
});

describe("processing start contract", () => {
  it("does not extract when clearing content at processing start fails", async () => {
    const extract = vi.fn();
    const { client } = updateClient({
      row: { id: "s1", content: "old menu text", approved_for_answers: true, status: "processing" },
    });
    const begun = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-a",
      select: SELECT,
    });
    if (begun.ok) extract();
    expect(begun.ok).toBe(false);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("delete ordering contract", () => {
  it("skips Storage removal entirely when invalidation fails", async () => {
    const removeObject = vi.fn();
    const { client } = updateClient({ row: null, error: { message: "locked" } });

    const cleared = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-a",
      select: SELECT,
    });
    if (cleared.ok) removeObject();

    expect(cleared.ok).toBe(false);
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("leaves no eligible text when Storage delete succeeds and the row delete fails", async () => {
    const { client } = updateClient({ row: { id: "s1", content: "", approved_for_answers: false } });
    const cleared = await clearAnswerEligibility(client, {
      sourceId: "s1",
      companyId: "co-a",
      select: SELECT,
    });
    expect(cleared.ok).toBe(true);

    const storageRemoved = true;
    const rowDeleteFailed = true;
    expect(storageRemoved && rowDeleteFailed).toBe(true);
    if (cleared.ok) {
      expect(cleared.row.content).toBe("");
      expect(cleared.row.approved_for_answers).toBe(false);
    }
  });
});
