import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  bound: vi.fn(),
  resolve: vi.fn(),
  log: vi.fn(),
}));

vi.mock("./continuity", () => ({ readBoundBrowserContinuity: m.bound }));
vi.mock("./resolve", () => ({ resolveBrokerSession: m.resolve }));
vi.mock("./log", () => ({ brokerLog: m.log }));

import { prepareBrokerAdmissionLineage } from "./lineage-auth";

const stale = "vel_sh_" + "a".repeat(32);

beforeEach(() => {
  vi.resetAllMocks();
  m.bound.mockResolvedValue({
    state: "active",
    browserLineageId: "lineage",
    bootstrapHash: "root",
  });
});

it("password login rotates stale handles without probing resolve/capability", async () => {
  const jar = new Map<string, string>([[stale, "stale-handle"]]);
  const writer = {
    set(name: string, value: string, options?: { maxAge?: number }) {
      if (options?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
  };
  const reader = { getAll: () => [...jar].map(([name, value]) => ({ name, value })) };
  await expect(
    prepareBrokerAdmissionLineage(reader, writer, { rotateStaleHandles: true }),
  ).resolves.toMatchObject({
    ok: true,
    parentHandleHash: null,
    bootstrapHash: "root",
  });
  expect(jar.has(stale)).toBe(false);
  expect(m.resolve).not.toHaveBeenCalled();
  expect(m.log).toHaveBeenCalledWith(
    "info",
    "auth.broker.lineage.stale_handles_rotated",
    expect.objectContaining({ count: 1 }),
  );
});

it("non-rotating path still resolves an active tip when handles are present", async () => {
  m.resolve.mockResolvedValue({ ok: true, handleHash: "parent-hash" });
  const jar = new Map<string, string>([[stale, "live-opaque-handle-value-0123456789abcd"]]);
  const writer = { set: vi.fn() };
  const reader = { getAll: () => [...jar].map(([name, value]) => ({ name, value })) };
  await expect(prepareBrokerAdmissionLineage(reader, writer)).resolves.toMatchObject({
    ok: true,
    parentHandleHash: "parent-hash",
  });
  expect(m.resolve).toHaveBeenCalledOnce();
  expect(writer.set).not.toHaveBeenCalled();
});
