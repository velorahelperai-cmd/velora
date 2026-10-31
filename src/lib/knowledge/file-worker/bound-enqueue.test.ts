import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdmin: vi.fn(),
  enqueue: vi.fn(),
  generation: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdmin }));
vi.mock("./enqueue", () => ({ enqueueKnowledgeFilePrepare: mocks.enqueue }));
vi.mock("../exact-generation", () => ({ readExactStorageGeneration: mocks.generation }));

import { enqueueBoundBranchKnowledgeFilePrepare } from "./bound-enqueue";

const liveAttempt = {
  ok: true,
  attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  state: "running",
  expires_at: "2099-01-01T00:00:00.000Z",
  provider_dispatch: "none",
  actor_id: "actor",
  session_id: "session",
};

describe("enqueueBoundBranchKnowledgeFilePrepare", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    mocks.createClient.mockReset();
    mocks.createAdmin.mockReset().mockReturnValue({
      rpc: async () => ({ data: liveAttempt, error: null }),
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: { status: "processing", failure_code: null },
            error: null,
          }),
        };
        return q;
      },
    });
    mocks.enqueue.mockReset().mockResolvedValue({
      mode: "queued",
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "processing",
      replayed: true,
    });
    mocks.generation.mockReset().mockResolvedValue({
      status: "ok",
      generation: {
        objectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        updatedAt: "2026-10-31T09:00:00.000000Z",
      },
    });
  });

  it("returns unavailable while the worker gate is off", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "false");
    expect(
      await enqueueBoundBranchKnowledgeFilePrepare({
        actorId: "a",
        sessionId: "s",
        companyId: "c",
        branchId: "b",
        sourceId: "src",
      }),
    ).toEqual({ mode: "unavailable", code: "UNAVAILABLE" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("claims after resolving source identity and exact generation", async () => {
    mocks.createClient.mockResolvedValue({
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: {
              id: "src",
              company_id: "c",
              kind: "file",
              status: "stored",
              file_name: "menu.pdf",
              storage_path: "c/src/menu.pdf",
              content_version: 2,
              updated_at: "2026-10-31T08:00:00.000Z",
              failure_code: null,
            },
            error: null,
          }),
        };
        return q;
      },
    });
    const result = await enqueueBoundBranchKnowledgeFilePrepare({
      actorId: "actor",
      sessionId: "session",
      companyId: "c",
      branchId: "branch",
      sourceId: "src",
    });
    expect(result).toEqual({
      mode: "queued",
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "processing",
      replayed: true,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "actor",
        sessionId: "session",
        companyId: "c",
        branchId: "branch",
        sourceId: "src",
        expectedVersion: 2,
        storagePath: "c/src/menu.pdf",
        objectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );
  });

  it("replays the same attemptId while processing lease is active", async () => {
    mocks.createClient.mockResolvedValue({
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: {
              id: "src",
              status: "processing",
              file_name: "menu.pdf",
              storage_path: "c/src/menu.pdf",
              content_version: 2,
              updated_at: "2026-10-31T08:00:00.000Z",
              failure_code: null,
            },
            error: null,
          }),
        };
        return q;
      },
    });
    await enqueueBoundBranchKnowledgeFilePrepare({
      actorId: "actor",
      sessionId: "session",
      companyId: "c",
      branchId: "b",
      sourceId: "src",
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recoverAttemptId: null,
      }),
    );
  });

  it("recovers an expired pre-provider lease with a new attemptId", async () => {
    mocks.createAdmin.mockReturnValue({
      rpc: async () => ({
        data: {
          ...liveAttempt,
          expires_at: "2020-01-01T00:00:00.000Z",
          provider_dispatch: "none",
        },
        error: null,
      }),
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: { status: "processing", failure_code: null },
            error: null,
          }),
        };
        return q;
      },
    });
    mocks.createClient.mockResolvedValue({
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: {
              id: "src",
              status: "processing",
              file_name: "menu.pdf",
              storage_path: "c/src/menu.pdf",
              content_version: 2,
              updated_at: "2026-10-31T08:00:00.000Z",
              failure_code: null,
            },
            error: null,
          }),
        };
        return q;
      },
    });
    mocks.enqueue.mockResolvedValue({
      mode: "queued",
      attemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "processing",
      replayed: false,
    });
    await enqueueBoundBranchKnowledgeFilePrepare({
      actorId: "actor",
      sessionId: "session",
      companyId: "c",
      branchId: "b",
      sourceId: "src",
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        recoverAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );
    expect(mocks.enqueue.mock.calls[0][0].attemptId).not.toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("returns review required when provider outcome is unknown", async () => {
    mocks.createAdmin.mockReturnValue({
      rpc: async () => ({
        data: {
          ...liveAttempt,
          expires_at: "2020-01-01T00:00:00.000Z",
          provider_dispatch: "dispatched",
        },
        error: null,
      }),
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: { status: "processing", failure_code: null },
            error: null,
          }),
        };
        return q;
      },
    });
    mocks.createClient.mockResolvedValue({
      from: () => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: {
              id: "src",
              status: "processing",
              file_name: "menu.pdf",
              storage_path: "c/src/menu.pdf",
              content_version: 2,
              updated_at: "2026-10-31T08:00:00.000Z",
              failure_code: null,
            },
            error: null,
          }),
        };
        return q;
      },
    });
    expect(
      await enqueueBoundBranchKnowledgeFilePrepare({
        actorId: "actor",
        sessionId: "session",
        companyId: "c",
        branchId: "b",
        sourceId: "src",
      }),
    ).toEqual({
      mode: "busy",
      code: "REVIEW_REQUIRED",
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
