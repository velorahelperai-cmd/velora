import { describe, expect, it, vi } from "vitest";
import { refreshSelectedWorkspace } from "./workspace-switch";

describe("confirmed workspace selection", () => {
  it("refreshes the authoritative route without waiting for optional account chrome", async () => {
    let release!: () => void;
    const refreshRoute = vi.fn();
    const refreshAccount = () => new Promise<void>(resolve => { release = resolve; });
    const pending = refreshSelectedWorkspace({ refreshRoute, refreshAccount });
    expect(refreshRoute).toHaveBeenCalledOnce();
    release();
    await pending;
  });
  it("still refreshes the selected workspace when optional account refresh rejects", async () => {
    const refreshRoute = vi.fn();
    await expect(refreshSelectedWorkspace({ refreshRoute, refreshAccount: async () => { throw new Error("offline"); } })).resolves.toBeUndefined();
    expect(refreshRoute).toHaveBeenCalledOnce();
  });
});
