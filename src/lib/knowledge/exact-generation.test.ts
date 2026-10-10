import { describe, expect, it, vi } from "vitest";
import { readExactStorageGeneration } from "./exact-generation";
import { bindDownloadedBytesToObject } from "./invalidate";
const object = "00000000-0000-0000-0000-000000000001";
const exact = "2026-10-10T03:34:24.587754Z";
const input = { companyId: "company-a", sourceId: "source-a", storagePath: "company-a/source-a/file.txt" };
const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });
describe("exact database object generation", () => {
  it("preserves all microseconds instead of adopting JavaScript Date serialization", async () => {
    expect(await readExactStorageGeneration(client({ status: "ok", object_id: object, updated_at: exact }), input)).toEqual({ status: "ok", generation: { objectId: object, updatedAt: exact } });
  });
  it("rejects a replacement within the same millisecond", async () => {
    const before = await readExactStorageGeneration(client({ status: "ok", object_id: object, updated_at: exact }), input);
    const after = await readExactStorageGeneration(client({ status: "ok", object_id: object, updated_at: "2026-10-10T03:34:24.587755Z" }), input);
    if (before.status !== "ok" || after.status !== "ok") throw Error("READ_FAILED");
    expect(bindDownloadedBytesToObject({ captured: before.generation, verified: after.generation, downloadedBytes: new Uint8Array([1]) })).toEqual({ ok: false, reason: "conflict" });
  });
  it.each([null, [], {}, { status: "ok", object_id: null, updated_at: exact }, { status: "ok", object_id: object, updated_at: null }, { status: "ok", object_id: object, updated_at: "2026-10-10T03:34:24.587Z" }, { status: "ok", object_id: object, updated_at: "2026-99-99T99:99:99.587754Z" }])("fails closed on malformed/null metadata: %j", async data => {
    expect(await readExactStorageGeneration(client(data), input)).toEqual({ status: "unreadable" });
  });
  it("keeps missing objects distinct from unavailable contracts", async () => {
    expect(await readExactStorageGeneration(client({ status: "missing" }), input)).toEqual({ status: "missing" });
    expect(await readExactStorageGeneration(client(null, { message: "missing RPC" }), input)).toEqual({ status: "error" });
  });
  it("does not issue a metadata request after cancellation", async () => {
    const rpc = client(null); const abort = new AbortController(); abort.abort();
    expect(await readExactStorageGeneration(rpc, input, abort.signal)).toEqual({ status: "error" });
    expect(rpc.rpc).not.toHaveBeenCalled();
  });
});
