import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
import { createRealRuntimeStore } from "./store";

beforeEach(() => state.rpc.mockReset());
describe("C1 administrative provider evidence persistence", () => {
  it("passes the actual model and distinct response reference to the durable administrative settlement", async () => {
    state.rpc.mockResolvedValue({ data: true, error: null });
    const usage = { promptTokens: 10, completionTokens: 4, cachedTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3, totalTokens: 14 };
    expect(await createRealRuntimeStore().settle({ id: "synthetic-attempt", status: "success", costUsd: 0.001, costBaisa: 0.384497,
      usage, requestId: "synthetic-http-request", responseId: "synthetic-provider-response", actualModelId: "gpt-6-luna-2026-10-01", latencyMs: 23 })).toBe(true);
    expect(state.rpc).toHaveBeenCalledWith("ai_settle_admin_attempt", expect.objectContaining({
      p_request_id: "synthetic-http-request", p_response_id: "synthetic-provider-response", p_actual_model_id: "gpt-6-luna-2026-10-01", p_usage: usage,
    }));
  });
  it("retains a provider reference when usage is unknown without inventing zero cost", async () => {
    state.rpc.mockResolvedValue({ data: true, error: null });
    await createRealRuntimeStore().settle({ id: "synthetic-attempt", status: "uncertain", costUsd: null, costBaisa: null, usage: {},
      responseId: "synthetic-unknown-response", actualModelId: "gemini-3.8-flash", errorCode: "PROVIDER_USAGE_MISSING", latencyMs: 12 });
    expect(state.rpc).toHaveBeenCalledWith("ai_settle_admin_attempt", expect.objectContaining({
      p_cost_usd: null, p_cost_baisa: null, p_response_id: "synthetic-unknown-response", p_actual_model_id: "gemini-3.8-flash",
    }));
  });
});
