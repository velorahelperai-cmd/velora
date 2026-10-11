import { vi } from "vitest";
// Provider calls are forbidden. Individual existing tests may replace this with synthetic responses.
vi.stubGlobal("fetch", async () => { throw new Error("OFFLINE_TEST_EXTERNAL_FETCH_FORBIDDEN"); });
export {};
