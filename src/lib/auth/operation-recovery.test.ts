import { expect, it, vi } from "vitest";
import { createRecoveryReceipt, readRecoveryReceipt, reconcileOriginalOperation } from "./operation-recovery";

it("retains original correlation before a lost response without storing credentials or granting authority", () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: { setItem: (key: string, value: string) => stored.set(key, value), getItem: (key: string) => stored.get(key) ?? null } });
  const receipt = createRecoveryReceipt("actor-a", "0123456789abcdef", "logout");
  expect(readRecoveryReceipt("0123456789abcdef")).toEqual(receipt);
  expect(readRecoveryReceipt("fedcba9876543210")).toBeNull();
  expect([...stored.values()].join("")).not.toMatch(/password|access_token|refresh_token/);
  vi.unstubAllGlobals();
});

it("never acknowledges before actual capture cleanup succeeds", async () => {
  const ports = { resume: vi.fn(), cleanup: vi.fn().mockRejectedValue(new Error("storage unavailable")), acknowledge: vi.fn() };
  expect(await reconcileOriginalOperation("original-op", () => true, ports)).toBe("pending");
  expect(ports.resume).not.toHaveBeenCalled();
  expect(ports.acknowledge).not.toHaveBeenCalled();
});
it("requires durable true acknowledgment and confirmed original receipt", async () => {
  const ports = { resume: vi.fn().mockResolvedValue({ ok: true, status: "confirmed" }), cleanup: vi.fn(), acknowledge: vi.fn().mockResolvedValue({ ok: false }) };
  expect(await reconcileOriginalOperation("original-op", () => true, ports)).toBe("pending");
  expect(ports.resume).toHaveBeenCalledWith({ operationKey: "original-op" });
  expect(ports.acknowledge).toHaveBeenCalledWith({ operationKey: "original-op" });
  ports.acknowledge.mockResolvedValue({ ok: true });
  expect(await reconcileOriginalOperation("original-op", () => true, ports)).toBe("confirmed");
});
it("stale capture cannot acknowledge or report success after a newer boundary", async () => {
  let current = true;
  const ports = { cleanup: vi.fn(), resume: vi.fn(async () => { current = false; return { ok: true, status: "confirmed" }; }), acknowledge: vi.fn() };
  expect(await reconcileOriginalOperation("original-op", () => current, ports)).toBe("stale");
  expect(ports.acknowledge).not.toHaveBeenCalled();
});
it("unknown or thrown resume never becomes success and never repeats a credential mutation", async () => {
  const ports = { cleanup: vi.fn(), resume: vi.fn().mockRejectedValue(new Error("response lost")), acknowledge: vi.fn() };
  expect(await reconcileOriginalOperation("original-op", () => true, ports)).toBe("pending");
  expect(ports.acknowledge).not.toHaveBeenCalled();
});
