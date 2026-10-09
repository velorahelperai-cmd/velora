import { describe, expect, it, vi } from "vitest";
import { checkReviewFiles, type ReviewFile, type ReviewStorageReader } from "./review-file-proof";

const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const generation = { objectId: "object-a", updatedAt: "2026-10-10T01:00:00Z" };
const file: ReviewFile = {
  id: "source-a", company_id: "company-a", storage_path: "company-a/source-a/menu.txt",
  byte_size: 3, prepared_file_sha256: hash, prepared_content_version: 2, content_version: 2,
};
function reader(bytes = new TextEncoder().encode("abc")): ReviewStorageReader {
  return { generation: vi.fn(async () => generation), download: vi.fn(async () => bytes) };
}

describe("G03 Storage proof observes actual bytes", () => {
  it("records the known SHA-256 and the exact generation of the extraction buffer", async () => {
    const result = await checkReviewFiles("company-a", [file], reader());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.observations[0]).toMatchObject({ source_id: file.id, sha256: hash, byte_size: 3, object_id: generation.objectId });
  });
  it("rejects different bytes with the same size, path and metadata", async () => {
    expect(await checkReviewFiles("company-a", [file], reader(new TextEncoder().encode("def")))).toMatchObject({ ok: false, code: "FILE_CHANGED" });
  });
  it("rejects legacy extraction without attributing today's hash to it", async () => {
    const storage = reader();
    expect(await checkReviewFiles("company-a", [{ ...file, prepared_file_sha256: null }], storage)).toMatchObject({ ok: false, code: "FILE_REPREPARE_REQUIRED" });
    expect(storage.download).not.toHaveBeenCalled();
  });
  it("rejects cross-company paths before reading Storage", async () => {
    const storage = reader();
    expect(await checkReviewFiles("company-b", [file], storage)).toMatchObject({ ok: false, code: "FILE_CHANGED" });
    expect(storage.download).not.toHaveBeenCalled();
  });
  it("rejects path traversal aliases before a privileged Storage read", async () => {
    const storage = reader();
    expect(await checkReviewFiles("company-a", [{ ...file, storage_path: "company-a/source-a/../../company-b/menu.txt" }], storage)).toMatchObject({ ok: false, code: "FILE_CHANGED" });
    expect(storage.download).not.toHaveBeenCalled();
  });
  it("rejects generation changes during the read", async () => {
    const storage = reader();
    vi.mocked(storage.generation).mockResolvedValueOnce(generation).mockResolvedValueOnce({ ...generation, updatedAt: "2026-10-10T01:01:00Z" });
    expect(await checkReviewFiles("company-a", [file], storage)).toMatchObject({ ok: false, code: "FILE_CHANGED" });
  });
  it("blocks missing/failed reads, oversized files and version mismatch", async () => {
    const storage = reader();
    vi.mocked(storage.download).mockRejectedValueOnce(Error("unavailable"));
    expect(await checkReviewFiles("company-a", [file], storage)).toMatchObject({ ok: false, code: "FILE_UNAVAILABLE" });
    expect(await checkReviewFiles("company-a", [{ ...file, byte_size: 10 * 1024 * 1024 + 1 }], reader())).toMatchObject({ ok: false, code: "FILE_LIMIT" });
    expect(await checkReviewFiles("company-a", [{ ...file, content_version: 3 }], reader())).toMatchObject({ ok: false, code: "FILE_REPREPARE_REQUIRED" });
  });
  it("preserves a streamed byte-limit failure as FILE_LIMIT", async () => {
    const storage = reader();
    vi.mocked(storage.download).mockRejectedValueOnce(Error("FILE_LIMIT"));
    expect(await checkReviewFiles("company-a", [file], storage)).toMatchObject({ ok: false, code: "FILE_LIMIT" });
  });
  it("caps in-flight downloads at two", async () => {
    let active = 0, maximum = 0;
    const storage = reader();
    storage.download = async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return new TextEncoder().encode("abc");
    };
    const files = Array.from({ length: 5 }, (_, i) => ({ ...file, id: `source-${i}`, storage_path: `company-a/source-${i}/menu.txt` }));
    expect((await checkReviewFiles("company-a", files, storage)).ok).toBe(true);
    expect(maximum).toBe(2);
  });
  it("aborts a stalled provider read within the check deadline", async () => {
    const storage = reader();
    storage.download = (_path, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
    });
    expect(await checkReviewFiles("company-a", [file], storage, { fileTimeoutMs: 5, totalTimeoutMs: 20 })).toMatchObject({ ok: false, code: "FILE_UNAVAILABLE" });
  });
});
