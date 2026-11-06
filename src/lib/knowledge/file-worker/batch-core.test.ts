import { describe, expect, it, vi } from "vitest";
import { processKnowledgeFileWorkerBatch, type BatchPorts, type DueAttemptRow } from "./batch-core";
import { LEASE_EXPIRED_CODE, PROVIDER_OUTCOME_UNKNOWN_CODE } from "./recovery";

function createSampleDueRow(overrides: Partial<DueAttemptRow> = {}): DueAttemptRow {
  return {
    sourceId: "source-1",
    attemptId: "attempt-1",
    companyId: "company-1",
    branchId: "branch-1",
    actorId: "actor-1",
    sessionId: "session-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    providerDispatch: "none",
    contentVersion: 1,
    storagePath: "company-1/source-1/file.txt",
    objectId: "obj-1",
    objectUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("processKnowledgeFileWorkerBatch (production batch orchestration)", () => {
  it("returns IDLE when no attempts are due", async () => {
    const ports: BatchPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockResolvedValue([]),
      forAttempt: vi.fn(),
    };

    const observation = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(observation).toMatchObject({
      ok: true,
      code: "IDLE",
      backlog: 0,
      processed: 0,
      extracted: 0,
      unknown: 0,
      failed: 0,
      reviewRequired: 0,
      automaticRetry: false,
    });
  });

  it("handles listDue failure fail-closed with LIST_UNAVAILABLE", async () => {
    const ports: BatchPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      forAttempt: vi.fn(),
    };

    const observation = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(observation).toMatchObject({
      ok: false,
      code: "LIST_UNAVAILABLE",
      backlog: 0,
      processed: 0,
    });
  });

  it("handles stuck review-required attempts without blind retry", async () => {
    const failAttempt = vi.fn().mockResolvedValue(true);
    const row = createSampleDueRow({
      // providerDispatch unknown with expired lease -> review_required
      providerDispatch: "unknown",
      expiresAt: new Date(1730000000000 - 10_000).toISOString(),
    });

    const ports: BatchPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockResolvedValue([row]),
      forAttempt: vi.fn().mockReturnValue({
        nowMs: () => 1730000000000,
        loadAttempt: vi.fn(),
        loadSource: vi.fn(),
        extract: vi.fn(),
        publish: vi.fn(),
        failAttempt,
      }),
    };

    const observation = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(observation).toMatchObject({
      ok: true,
      code: "RECONCILIATION_REQUIRED",
      backlog: 1,
      processed: 1,
      reviewRequired: 1,
      unknown: 1,
      stalledDueWork: true,
    });
    expect(failAttempt).toHaveBeenCalledWith({
      sourceId: "source-1",
      attemptId: "attempt-1",
      code: PROVIDER_OUTCOME_UNKNOWN_CODE,
    });
  });

  it("skips extraction on pre-provider expired attempts and marks them failed (recover_expired)", async () => {
    const extract = vi.fn();
    const failAttempt = vi.fn().mockResolvedValue(true);
    const row = createSampleDueRow({
      providerDispatch: "none",
      expiresAt: new Date(1730000000000 - 10_000).toISOString(),
    });

    const ports: BatchPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockResolvedValue([row]),
      forAttempt: vi.fn().mockReturnValue({
        nowMs: () => 1730000000000,
        loadAttempt: vi.fn(),
        loadSource: vi.fn(),
        extract,
        publish: vi.fn(),
        failAttempt,
      }),
    };

    const observation = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(observation).toMatchObject({
      ok: true,
      code: "COMPLETE",
      backlog: 1,
      processed: 1,
      failed: 1,
      extracted: 0,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(failAttempt).toHaveBeenCalledWith({
      sourceId: "source-1",
      attemptId: "attempt-1",
      code: LEASE_EXPIRED_CODE,
    });
  });

  it("processes successful attempts and increments extracted counter", async () => {
    const row = createSampleDueRow();
    const ports: BatchPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockResolvedValue([row]),
      forAttempt: vi.fn().mockReturnValue({
        nowMs: () => 1730000000000,
        loadAttempt: vi.fn().mockResolvedValue({
          attemptId: "attempt-1",
          state: "running",
          expiresAt: row.expiresAt,
          contentVersion: 1,
          storagePath: row.storagePath,
        }),
        loadSource: vi.fn().mockResolvedValue({
          status: "processing",
          contentVersion: 1,
          storagePath: row.storagePath,
        }),
        extract: vi.fn().mockResolvedValue({
          ok: true,
          text: "Sample extracted text from knowledge document.",
          evidence: "none",
        }),
        publish: vi.fn().mockResolvedValue({ ok: true }),
        failAttempt: vi.fn().mockResolvedValue(true),
      }),
    };

    const observation = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(observation).toMatchObject({
      ok: true,
      code: "COMPLETE",
      backlog: 1,
      processed: 1,
      extracted: 1,
      failed: 0,
      unknown: 0,
    });
  });

  it("CLN-17: prevents 10 expired pre-provider attempts from starving the 11th valid attempt", async () => {
    const nowMs = 1730000000000;
    type SimItem = {
      row: DueAttemptRow;
      state: "running" | "failed" | "published";
    };

    const store: SimItem[] = [];
    for (let i = 1; i <= 10; i++) {
      store.push({
        row: createSampleDueRow({
          sourceId: `source-expired-${i}`,
          attemptId: `attempt-expired-${i}`,
          providerDispatch: "none",
          expiresAt: new Date(nowMs - (1000 - i * 10) * 1000).toISOString(),
        }),
        state: "running",
      });
    }

    // 11th valid runnable attempt
    store.push({
      row: createSampleDueRow({
        sourceId: "source-valid-11",
        attemptId: "attempt-valid-11",
        providerDispatch: "none",
        expiresAt: new Date(nowMs + 60_000).toISOString(),
      }),
      state: "running",
    });

    // Simulating SQL order: sorted by expiresAt asc (which previously trapped expired attempts first)
    const listDue = vi.fn().mockImplementation(async (limit: number) => {
      return store
        .filter((item) => item.state === "running")
        .sort((a, b) => Date.parse(a.row.expiresAt) - Date.parse(b.row.expiresAt))
        .slice(0, limit)
        .map((item) => item.row);
    });

    const ports: BatchPorts = {
      nowMs: () => nowMs,
      listDue,
      forAttempt: (row) => ({
        nowMs: () => nowMs,
        loadAttempt: vi.fn().mockResolvedValue({
          attemptId: row.attemptId,
          state: "running",
          expiresAt: row.expiresAt,
          contentVersion: 1,
          storagePath: row.storagePath,
        }),
        loadSource: vi.fn().mockResolvedValue({
          status: "processing",
          contentVersion: 1,
          storagePath: row.storagePath,
        }),
        extract: vi.fn().mockResolvedValue({
          ok: true,
          text: "extracted content",
          evidence: "none",
        }),
        publish: vi.fn().mockImplementation(async () => {
          const item = store.find((s) => s.row.attemptId === row.attemptId);
          if (item) item.state = "published";
          return { ok: true };
        }),
        failAttempt: vi.fn().mockImplementation(async () => {
          const item = store.find((s) => s.row.attemptId === row.attemptId);
          if (item) item.state = "failed";
          return true;
        }),
      }),
    };

    // Cycle 1: batch limit 10
    const obs1 = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(obs1).toMatchObject({
      ok: true,
      processed: 10,
      failed: 10,
      extracted: 0,
    });
    // All 10 expired attempts were transitioned to failed with LEASE_EXPIRED_CODE
    expect(store.filter((s) => s.state === "failed")).toHaveLength(10);
    // The valid attempt remains running and was not starved
    expect(store.find((s) => s.row.attemptId === "attempt-valid-11")?.state).toBe("running");

    // Cycle 2: within a bounded cycle (cycle 2), the valid attempt is reached and extracted!
    const obs2 = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(obs2).toMatchObject({
      ok: true,
      code: "COMPLETE",
      processed: 1,
      extracted: 1,
      failed: 0,
    });
    expect(store.find((s) => s.row.attemptId === "attempt-valid-11")?.state).toBe("published");
  });

  it("CLN-17: unknown external provider outcomes remain pending on review hold without blind retry", async () => {
    const failAttempt = vi.fn().mockResolvedValue(true);
    const extract = vi.fn();
    const row = createSampleDueRow({
      sourceId: "source-unknown",
      attemptId: "attempt-unknown",
      providerDispatch: "dispatched",
      expiresAt: new Date(1730000000000 - 5_000).toISOString(),
    });

    const ports: BatchPorts = {
      nowMs: () => 1730000000000,
      listDue: vi.fn().mockResolvedValue([row]),
      forAttempt: () => ({
        nowMs: () => 1730000000000,
        loadAttempt: vi.fn(),
        loadSource: vi.fn(),
        extract,
        publish: vi.fn(),
        failAttempt,
      }),
    };

    const obs = await processKnowledgeFileWorkerBatch(ports, 10);
    expect(obs).toMatchObject({
      ok: true,
      code: "RECONCILIATION_REQUIRED",
      backlog: 1,
      processed: 1,
      reviewRequired: 1,
      unknown: 1,
    });
    expect(failAttempt).toHaveBeenCalledWith({
      sourceId: "source-unknown",
      attemptId: "attempt-unknown",
      code: PROVIDER_OUTCOME_UNKNOWN_CODE,
    });
    expect(extract).not.toHaveBeenCalled();
  });
});
