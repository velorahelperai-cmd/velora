import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {recordWorkerTiming} from "./worker-timing";

const job="12345678-1234-4234-8234-123456789abc";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("worker timing diagnostics",()=>{
 it("stays disabled by default",()=>{const log=vi.spyOn(console,"info").mockImplementation(()=>{});recordWorkerTiming(job,"claimed_at");expect(log).not.toHaveBeenCalled();});
 it("emits only a hashed job identity and allowlisted time",()=>{
  vi.stubEnv("WHATSAPP_WORKER_TIMING_ENABLED","true");const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  recordWorkerTiming(job,"provider_accepted_at",0);
  const line=String(log.mock.calls[0][0]),parsed=JSON.parse(line);
  expect(parsed).toEqual({event:"whatsapp.worker.timing",job_hash:expect.stringMatching(/^[a-f0-9]{64}$/),stage:"provider_accepted_at",at:"1970-01-01T00:00:00.000Z"});
  expect(line).not.toContain(job);expect(parsed).not.toHaveProperty("message");
 });
 it("rejects arbitrary identifiers, stages, and invalid times",()=>{
  vi.stubEnv("WHATSAPP_WORKER_TIMING_ENABLED","true");const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  recordWorkerTiming("customer message", "claimed_at");recordWorkerTiming(job,"customer message" as never);recordWorkerTiming(job,"claimed_at",NaN);
  expect(log).not.toHaveBeenCalled();
 });
 it("never affects processing if diagnostics fail",()=>{
  vi.stubEnv("WHATSAPP_WORKER_TIMING_ENABLED","true");vi.spyOn(console,"info").mockImplementation(()=>{throw Error("synthetic logger failure");});
  expect(()=>recordWorkerTiming(job,"claimed_at")).not.toThrow();
 });
});
