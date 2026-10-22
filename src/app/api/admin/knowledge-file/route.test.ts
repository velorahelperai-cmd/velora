import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  owner: vi.fn(), bound: vi.fn(), download: vi.fn(), source: vi.fn(),
  log: vi.fn(), context: vi.fn(),
}));
vi.mock("@/lib/tenancy/access", () => ({ requirePlatformAdmin: state.owner }));
vi.mock("@/lib/supabase/server", () => ({
  createBrokerBoundClient: state.bound,
  createClient: async () => ({
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: state.source };
      return query;
    },
    storage: { from: () => ({ download: state.download }) },
  }),
}));
vi.mock("@/lib/tenancy/setup-file-server", () => ({ downloadSetupFile: vi.fn() }));
vi.mock("@/lib/logging/logger.mjs", () => ({ logEvent: state.log, withLogContext: state.context }));
import { GET } from "./route";

function boundary(userId = "owner", fingerprint = "boundary-a") {
  return { bound: { ok: true, resolve: { boundary: { userId, generation: "generation-a", boundaryFingerprint: fingerprint } } } };
}
function request(company = companyId) {
  return new Request(`http://127.0.0.1/api/admin/knowledge-file?companyId=${company}&sourceId=${sourceId}`);
}
beforeEach(() => {
  vi.resetAllMocks();
  state.context.mockImplementation((_ctx: unknown, operation: () => unknown) => operation());
  state.owner.mockResolvedValue({ ok: true, context: { userId: "owner" } });
  state.bound.mockResolvedValue(boundary());
  state.source.mockResolvedValue({ data: {
    id: sourceId, company_id: companyId, kind: "file", storage_path: `${companyId}/${sourceId}/sample.pdf`,
    file_name: "sample.pdf", content_version: 1, updated_at: "2026-10-22T00:00:00Z", byte_size: 3,
  }, error: null });
  state.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
});

describe("admin file authority and metadata boundaries", () => {
  it("binds diagnostic context to the reference returned to the caller", async () => {
    const response = await GET(request("invalid-company"));
    const id = response.headers.get("X-Request-Id")!;
    expect(state.context).toHaveBeenCalledWith({ request_id: id, trace_id: id.replaceAll("-", "") }, expect.any(Function));
    expect(state.log).toHaveBeenCalledWith("warn", "admin.knowledge_file.denied", expect.objectContaining({ stage: "validate", error_code: "INVALID_FILE_IDENTIFIERS" }));
  });
  it("denies a missing broker boundary before any database or storage read", async () => {
    state.bound.mockResolvedValue({ bound: { ok: false, code: "UNAUTHENTICATED" } });
    expect((await GET(request())).status).toBe(401);
    expect(state.source).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it("denies a broker actor that differs from the verified owner", async () => {
    state.bound.mockResolvedValue(boundary("other-actor"));
    expect((await GET(request())).status).toBe(403);
    expect(state.download).not.toHaveBeenCalled();
  });
  it("rejects an identity-boundary swap even when generation strings match", async () => {
    state.bound.mockResolvedValueOnce(boundary()).mockResolvedValueOnce(boundary("owner", "boundary-b"));
    expect((await GET(request())).status).toBe(403);
  });
  it("requires fresh broker checks on both sides of the fetch", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(state.bound).toHaveBeenNthCalledWith(1, { fresh: true });
    expect(state.bound).toHaveBeenNthCalledWith(2, { fresh: true });
  });
  it("rejects malformed identifiers before reading authority or data", async () => {
    expect((await GET(request("invalid-company"))).status).toBe(400);
    expect(state.owner).not.toHaveBeenCalled();
    expect(state.source).not.toHaveBeenCalled();
  });
});
