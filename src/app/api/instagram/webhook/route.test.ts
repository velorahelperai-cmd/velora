import { afterEach, expect, it, vi } from "vitest";
vi.mock('server-only',()=>({}));
import * as config from "@/lib/instagram/config";
import { GET, POST, runtime } from "./route";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("challenge enablement cannot activate the real event POST", async () => {
  vi.stubEnv('INSTAGRAM_WEBHOOK_CHALLENGE_ENABLED','true');
  vi.stubEnv('INSTAGRAM_RECEIVE_ENABLED','false');
  const fetch=vi.spyOn(globalThis,'fetch');
  const request=new Request('http://localhost/api/instagram/webhook',{method:'POST',body:'not JSON'});
  const reader=vi.spyOn(request.body!,'getReader');
  const response=await POST(request);
  expect(response.status).toBe(503);expect(reader).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it("keeps the real GET entry disabled with no configured proof or persistence", async () => {
  expect(runtime).toBe("nodejs");
  const response = await GET(new Request("http://localhost/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=synthetic&hub.challenge=x"));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "RECEIVE_DISABLED" });
});
it("keeps the real POST entry disabled before reading a body or making network calls", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const request = new Request("http://localhost/api/instagram/webhook", { method: "POST", body: "not JSON" });
  const reader = vi.spyOn(request.body!, "getReader"); const response = await POST(request);
  expect(response.status).toBe(503); expect(reader).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("cannot activate merely by mocking the config receive flag without real-fixture readiness", async () => {
  vi.spyOn(config, "instagramConfig").mockReturnValue({ graphVersion: "v26.0", connectEnabled: false, receiveEnabled: true, sendEnabled: false });
  const response = await POST(new Request("http://localhost/api/instagram/webhook", { method: "POST" }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "NEEDS_SETUP" });
});
