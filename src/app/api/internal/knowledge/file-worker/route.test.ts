import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchPorts, DueAttemptRow } from "@/lib/knowledge/file-worker/batch-core";

const secret = "s".repeat(32);
const cronSecret = "c".repeat(16);

const portsMocks = vi.hoisted(() => ({
  createPorts: vi.fn(),
}));

// We mock ONLY the admin client factory; processKnowledgeFileWorkerBatch remains REAL.
vi.mock("@/lib/knowledge/file-worker/batch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge/file-worker/batch")>();
  return {
    ...actual,
    createAdminKnowledgeFileBatchPorts: portsMocks.createPorts,
  };
});

function createDueRow(overrides: Partial<DueAttemptRow> = {}): DueAttemptRow {
  return {
    sourceId: "source-1",
    attemptId: "attempt-1",
    companyId: "company-1",
    branchId: "branch-1",
    actorId: "actor-1",
    sessionId: "session-1",
    expiresAt: new Date(1730000000000 + 60_000).toISOString(),
    providerDispatch: "none",
    contentVersion: 1,
    storagePath: "company-1/source-1/file.txt",
    objectId: "obj-1",
    objectUpdatedAt: new Date(1730000000000).toISOString(),
    ...overrides,
  };
}

describe("knowledge file worker route (Auth & Status mapping with real batch orchestration)", () => {
  let mockPorts: BatchPorts;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockResolvedValue([]),
      forAttempt: vi.fn().mockReturnValue({
        nowMs: () => 1730000000000,
        loadAttempt: vi.fn(),
        loadSource: vi.fn(),
        extract: vi.fn(),
        publish: vi.fn(),
        failAttempt: vi.fn().mockResolvedValue(true),
      }),
    };
    portsMocks.createPorts.mockReset().mockReturnValue(mockPorts);
  });

  it("rejects missing or short secrets with 503 WORKER_NOT_CONFIGURED", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", "short");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/internal/knowledge/file-worker", { method: "POST" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "WORKER_NOT_CONFIGURED" });
  });

  it("rejects unauthorized bearer with 401 UNAUTHORIZED", async () => {
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
    expect(await res.json()).toEqual({ code: "UNAUTHORIZED" });
  });

  it("stays disabled by default even with a valid secret (503 WORKER_DISABLED)", async () => {
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

  it("returns 503 ADMIN_UNAVAILABLE when admin ports factory fails", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    portsMocks.createPorts.mockReturnValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "ADMIN_UNAVAILABLE", ok: false });
  });

  it("runs real batch tick and returns 200 IDLE when backlog is empty", async () => {
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
      processed: 0,
    });
    expect(mockPorts.listDue).toHaveBeenCalledWith(10);
  });

  it("maps listDue failure to 503 LIST_UNAVAILABLE through the real route", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    mockPorts.listDue = vi.fn().mockRejectedValue(new Error("postgres timeout"));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: "LIST_UNAVAILABLE",
      ok: false,
      backlog: 0,
    });
  });

  it("signals reconciliation with 202 RECONCILIATION_REQUIRED when review holds appear", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", secret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    const stuckRow = createDueRow({
      providerDispatch: "unknown",
      expiresAt: new Date(1730000000000 - 5_000).toISOString(),
    });
    mockPorts.listDue = vi.fn().mockResolvedValue([stuckRow]);
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
      ok: true,
      backlog: 1,
      processed: 1,
      reviewRequired: 1,
      stalledDueWork: true,
      automaticRetry: false,
    });
  });

  it("accepts CRON_SECRET on GET requests for Vercel Cron invocation", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_SECRET", "");
    vi.stubEnv("CRON_SECRET", cronSecret);
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/internal/knowledge/file-worker", {
        method: "GET",
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: "IDLE",
      ok: true,
    });
  });
});
