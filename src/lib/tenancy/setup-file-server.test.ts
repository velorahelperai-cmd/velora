import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), download: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { downloadSetupFile, runConfiguredSetupFileDeletion } from "./setup-file-server";
const binding = { path: "e1000000-0000-4000-8000-000000000201/e1000000-0000-4000-8000-000000000301/setup/e1000000-0000-4000-8000-000000000401/file.pdf", objectId: "object", objectUpdatedAt: "2026-10-14", fileName: "file.pdf", contentType: "application/pdf", byteSize: 3 };
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockReturnValue({ storage: { from: () => ({ download: mocks.download }) } }); mocks.download.mockReturnValue({ asStream: async () => ({ data: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }), error: null }) }); });
it("closed scope after download cannot leak bytes through the proxy", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ok: true, data: binding }, error: null }).mockResolvedValueOnce({ data: { ok: false, code: "FORBIDDEN" }, error: null });
  expect(await downloadSetupFile({ rpc: mocks.rpc }, "owner", "company", "source")).toBeNull();
});
it("disabled worker does not even construct a privileged provider client", async () => {
  expect(await runConfiguredSetupFileDeletion(false)).toMatchObject({ ok: false, code: "SETUP_FILE_WORKER_DISABLED" }); expect(mocks.admin).not.toHaveBeenCalled();
});
it("unauthorized scope is rejected before downloading", async () => {
  mocks.rpc.mockResolvedValue({ data: { ok: false, code: "FORBIDDEN" }, error: null });
  expect(await downloadSetupFile({ rpc: mocks.rpc }, "owner", "company", "source")).toBeNull(); expect(mocks.download).not.toHaveBeenCalled();
});
