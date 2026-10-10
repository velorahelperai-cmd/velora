import type { StorageObjectGeneration } from "./invalidate";

type RpcResult = { data: unknown; error: unknown };
export type ExactGenerationRpc = {
  rpc(name: "g03_read_file_generation", args: { p_source_id: string; p_company_id: string; p_storage_path: string; p_action: string }):
    PromiseLike<RpcResult> & { abortSignal?(signal: AbortSignal): PromiseLike<RpcResult> };
};
export type ExactGenerationRead =
  | { status: "ok"; generation: StorageObjectGeneration }
  | { status: "missing" }
  | { status: "unreadable" }
  | { status: "error" };

/** Preserve the canonical database string. Storage list/JS Date loses microseconds. */
export async function readExactStorageGeneration(
  client: ExactGenerationRpc,
  input: { sourceId: string; companyId: string; storagePath: string; action?: "publish" | "submit" | "resubmit" | "approve" },
  signal = AbortSignal.timeout(10_000),
): Promise<ExactGenerationRead> {
  try {
    signal.throwIfAborted();
    const request = client.rpc("g03_read_file_generation", {
      p_source_id: input.sourceId, p_company_id: input.companyId,
      p_storage_path: input.storagePath, p_action: input.action ?? "publish",
    });
    const { data, error } = await (request.abortSignal ? request.abortSignal(signal) : request);
    signal.throwIfAborted();
    if (error) return { status: "error" };
    if (!data || typeof data !== "object" || Array.isArray(data)) return { status: "unreadable" };
    const row = data as Record<string, unknown>;
    if (row.status === "missing") return { status: "missing" };
    if (row.status === "error") return { status: "error" };
    if (row.status !== "ok" || typeof row.object_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.object_id)
      || typeof row.updated_at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.updated_at)
      || !Number.isFinite(Date.parse(row.updated_at))) return { status: "unreadable" };
    return { status: "ok", generation: { objectId: row.object_id, updatedAt: row.updated_at } };
  } catch { return { status: "error" }; }
}
