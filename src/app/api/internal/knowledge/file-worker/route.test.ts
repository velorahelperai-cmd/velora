import { beforeEach, describe, expect, it, vi } from "vitest";

const secret = "s".repeat(32);

const batchMocks = vi.hoisted(() => ({
  process: vi.fn(),
  createPorts: vi.fn(),
}));

vi.mock("@/lib/knowledge/file-worker/batch", () => ({
  processKnowledgeFileWorkerBatch: batchMocks.process,
  createAdminKnowledgeFileBatchPorts: batchMocks.createPorts,
}));

describe("knowledge file worker route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    batchMocks.process.mockReset();
    batchMocks.createPorts.mockReset().mockReturnValue({ listDue: async () => [] });
    batchMocks.process.mockResolvedValue({
      lastTickAt: "2026-10-31T12:00:00.000Z",
      ok: true,
      code: "IDLE",
      backlog: 0,
      processed: 0,
      extracted: 0,
      unknown: 0,
      failed: 0,
      reviewRequired: 0,
      automaticRetry: false,
      stalledDueWork: false,
    });
  });

  it("rejects missing or short secrets", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", "short");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/internal/knowledge/file-worker", { method: "POST" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "WORKER_NOT_CONFIGURED" });
  });

  it("rejects unauthorized bearer", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "POST",
        headers: { authorization: "Bearer " + "x".repeat(32) },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("stays disabled by default even with a valid secret", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "false");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "WORKER_DISABLED", automaticRetry: false });
  });

  it("runs a tick and returns observation when enabled", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: "IDLE",
      ok: true,
      automaticRetry: false,
      backlog: 0,
    });
    expect(batchMocks.process).toHaveBeenCalledOnce();
  });

  it("signals reconciliation when review holds appear", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    batchMocks.process.mockResolvedValue({
      lastTickAt: "2026-10-31T12:00:00.000Z",
      ok: true,
      code: "RECONCILIATION_REQUIRED",
      backlog: 1,
      processed: 1,
      extracted: 0,
      unknown: 1,
      failed: 0,
      reviewRequired: 1,
      automaticRetry: false,
      stalledDueWork: true,
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      code: "RECONCILIATION_REQUIRED",
      reviewRequired: 1,
      stalledDueWork: true,
      automaticRetry: false,
    });
  });
});
