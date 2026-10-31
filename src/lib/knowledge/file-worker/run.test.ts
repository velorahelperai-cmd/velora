import { beforeEach, describe, expect, it, vi } from "vitest";
import { runKnowledgeFileAttempt, type FileWorkerPorts } from "./run";

const attempt = {
  attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  state: "running" as const,
  expiresAt: "2099-01-01T00:00:00.000Z",
  contentVersion: 4,
  storagePath: "co/src/file.pdf",
};

describe("runKnowledgeFileAttempt", () => {
  const ports: FileWorkerPorts = {
    loadAttempt: vi.fn(async () => attempt),
    loadSource: vi.fn(async () => ({
      status: "processing",
      contentVersion: 4,
      storagePath: attempt.storagePath,
    })),
    extract: vi.fn(async () => ({ ok: true as const, text: "body", evidence: "none" as const })),
    publish: vi.fn(async () => ({ ok: true as const })),
    failAttempt: vi.fn(async () => true),
    nowMs: () => Date.parse("2026-10-31T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_ENABLED", "true");
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT", "false");
    vi.clearAllMocks();
    (ports.loadAttempt as ReturnType<typeof vi.fn>).mockResolvedValue(attempt);
    (ports.loadSource as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "processing",
      contentVersion: 4,
      storagePath: attempt.storagePath,
    });
    (ports.extract as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true as const,
      text: "body",
      evidence: "none" as const,
    });
    (ports.publish as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true as const });
    (ports.failAttempt as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it("publishes local offline extract while paid provider gate is off", async () => {
    const result = await runKnowledgeFileAttempt(
      { sourceId: "src", attemptId: attempt.attemptId },
      ports,
    );
    expect(result).toEqual({ ok: true, code: "PUBLISHED", extracted: true });
    expect(ports.extract).toHaveBeenCalled();
    expect(ports.publish).toHaveBeenCalledWith({
      sourceId: "src",
      attemptId: attempt.attemptId,
      text: "body",
    });
  });

  it("fails safely when extract refuses paid provider while gate is off", async () => {
    (ports.extract as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false as const,
      evidence: "safe_failure" as const,
      code: "PROVIDER_EXTRACT_DISABLED",
    });
    const result = await runKnowledgeFileAttempt(
      { sourceId: "src", attemptId: attempt.attemptId },
      ports,
    );
    expect(result).toEqual({
      ok: false,
      code: "PROVIDER_EXTRACT_DISABLED",
      extracted: false,
    });
    expect(ports.publish).not.toHaveBeenCalled();
    expect(ports.failAttempt).toHaveBeenCalledWith({
      sourceId: "src",
      attemptId: attempt.attemptId,
      code: "PROVIDER_EXTRACT_DISABLED",
    });
  });

  it("blocks a foreign attempt id before extract", async () => {
    const result = await runKnowledgeFileAttempt(
      { sourceId: "src", attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      ports,
    );
    expect(result.code).toBe("ATTEMPT_CONFLICT");
    expect(ports.extract).not.toHaveBeenCalled();
  });

  it("leaves unknown provider outcomes unretried without publish", async () => {
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_PROVIDER_EXTRACT", "true");
    vi.stubEnv("VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT", "true");
    (ports.extract as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      evidence: "unknown",
      code: "TIMEOUT",
    });
    const result = await runKnowledgeFileAttempt(
      { sourceId: "src", attemptId: attempt.attemptId },
      ports,
    );
    expect(result).toEqual({
      ok: false,
      code: "PROVIDER_OUTCOME_UNKNOWN",
      extracted: false,
    });
    expect(ports.failAttempt).not.toHaveBeenCalled();
    expect(ports.publish).not.toHaveBeenCalled();
  });
});
