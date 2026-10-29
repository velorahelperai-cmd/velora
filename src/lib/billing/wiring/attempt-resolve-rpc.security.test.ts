import { expect, it, vi } from "vitest";
import { createResolveOrCreateAttemptRpc, createConfirmFailedAttemptRpc, createOpenAfterFailedAttemptRpc } from "./attempt-resolve-rpc";

it.each([
  ["resolve_rpc_failed", (rpc: Parameters<typeof createResolveOrCreateAttemptRpc>[0]["rpc"]) => createResolveOrCreateAttemptRpc({ rpc })("order", "company")],
  ["confirm_failed_rpc_failed", (rpc: Parameters<typeof createResolveOrCreateAttemptRpc>[0]["rpc"]) => createConfirmFailedAttemptRpc({ rpc })("attempt", "company", {})],
  ["open_after_failed_rpc_failed", (rpc: Parameters<typeof createResolveOrCreateAttemptRpc>[0]["rpc"]) => createOpenAfterFailedAttemptRpc({ rpc })("order", "company", "prior", "operation")],
] as const)("bounds %s database failures", async (code, invoke) => {
  for (const error of [{ message: "private schema and token" }, { code: "private provider detail", message: "secret" }]) {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    expect(await invoke(rpc)).toEqual({ ok: false, code });
    expect(rpc).toHaveBeenCalledOnce();
  }
});
