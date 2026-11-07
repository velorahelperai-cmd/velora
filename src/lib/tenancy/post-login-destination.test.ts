import { expect, it, vi } from "vitest";
import { resolvePostLoginDestination } from "./post-login-destination";

it("soft-lands on preferred path when access stays UNAVAILABLE after commit", async () => {
  await expect(
    resolvePostLoginDestination("/app/conversations", async () => ({
      ok: false as const,
      code: "UNAVAILABLE" as const,
    })),
  ).resolves.toBe("/app/conversations");
});

it("soft-lands on /app when the access probe exceeds the budget", async () => {
  vi.useFakeTimers();
  const pending = resolvePostLoginDestination("", () => new Promise(() => undefined), 1_000);
  const expectation = expect(pending).resolves.toBe("/app");
  await vi.advanceTimersByTimeAsync(1_000);
  await expectation;
  vi.useRealTimers();
});

it("preserves UNVERIFIED routing when access resolves in budget", async () => {
  await expect(
    resolvePostLoginDestination("/app/conversations", async () => ({
      ok: false as const,
      code: "UNVERIFIED" as const,
    })),
  ).resolves.toContain("/verify-email");
});
