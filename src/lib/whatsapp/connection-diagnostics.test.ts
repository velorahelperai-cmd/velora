import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from "vitest";
import {diagnoseWhatsAppConnection,diagnosedWhatsAppPorts} from "./connection-diagnostics";
import {validDiagnostic} from "@/lib/diagnostics/contract";

describe("WhatsApp connection diagnostics",()=>{
 let logs:MockInstance<typeof console.info>;
 beforeEach(()=>{logs=vi.spyOn(console,"info").mockImplementation(()=>undefined);});
 afterEach(()=>vi.restoreAllMocks());
 it("records the actual failing port with one reference, without replaying provider work or logging arguments",async()=>{
  const provider=vi.fn(async(code:string)=>{expect(code).toBe("private-code");return {ok:true as const,token:"private-token"};});
  const checkpoint=vi.fn(async(token:string)=>{expect(token).toBe("private-token");return {ok:false as const,code:"RECONCILIATION_REQUIRED"};});
  const result=await diagnoseWhatsAppConnection(async trace=>{
   const ports=diagnosedWhatsAppPorts({provider,checkpoint},trace);
   const ready=await ports.provider("private-code");return ports.checkpoint(ready.token);
  });
  expect(result).toMatchObject({ok:false,code:"RECONCILIATION_REQUIRED",diagnostic:{stage:"vault",code:"OUTCOME_UNKNOWN"}});
  expect(validDiagnostic(result.diagnostic)).toBe(true);expect(provider).toHaveBeenCalledTimes(1);expect(checkpoint).toHaveBeenCalledTimes(1);
  const entries=logs.mock.calls.map(call=>JSON.parse(String(call[0])));
  expect(new Set(entries.map(row=>row.reference))).toEqual(new Set([result.diagnostic!.reference]));
  expect(JSON.stringify(entries)).not.toMatch(/private-token|private-code/);
  entries.forEach(({durationMs,...detail})=>{expect(validDiagnostic(detail)).toBe(true);expect(durationMs).toBeGreaterThanOrEqual(0);});
 });
 it("preserves successful results and exception semantics even when logging fails",async()=>{
  logs.mockImplementation(()=>{throw Error("logger unavailable");});
  const success={ok:true as const,status:"connected"};expect(await diagnoseWhatsAppConnection(async()=>success)).toBe(success);
  const error=Error("secret provider error");await expect(diagnoseWhatsAppConnection(async()=>{throw error;})).rejects.toBe(error);
 });
 it("bounds arbitrary failure codes and gives each request a new reference",async()=>{
  const first=await diagnoseWhatsAppConnection(async()=>({ok:false as const,code:"secret provider payload"}));
  const second=await diagnoseWhatsAppConnection(async()=>({ok:false as const,code:"FORBIDDEN"}));
  expect(first.diagnostic?.code).toBe("UNEXPECTED_FAILURE");expect(first.diagnostic?.reference).not.toBe(second.diagnostic?.reference);
  expect(JSON.stringify(logs.mock.calls)).not.toContain("secret provider payload");
 });
 it("keeps the last failed provider stage when a flow translates the failure code",async()=>{
  const ports={provider:async()=>({ok:false as const,code:"META_EXCHANGE_REJECTED"})};
  const result=await diagnoseWhatsAppConnection(async trace=>{
   trace.stage("claim");
   const observed=diagnosedWhatsAppPorts(ports,trace);
   const provider=await observed.provider();
   return provider.ok?provider:{ok:false as const,code:"RECONCILIATION_REQUIRED"};
  });
  expect(result.diagnostic).toMatchObject({stage:"provider",code:"OUTCOME_UNKNOWN"});
 });
});
