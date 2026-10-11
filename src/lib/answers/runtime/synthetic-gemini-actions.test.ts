import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const ids = vi.hoisted(() => ({ actorId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", companyId: "33333333-3333-4333-8333-333333333333", executionId: "44444444-4444-4444-8444-444444444444" }));
const state = vi.hoisted(() => ({ verified: true, owner: true, session: ids.sessionId, run: vi.fn(), company: { id: ids.companyId, status: "setup" } as { id: string; status: string } | null, snapshot: { budget: { enabled: true, limit_baisa: 1000, spent_baisa: 0, held_baisa: 0 }, recent: [] as { id?: string; execution_id?: string }[] } }));
vi.mock("@/lib/tenancy/access", () => ({ requireVerifiedUser: async () => state.verified ? { ok: true, context: { userId: ids.actorId } } : { ok: false, code: "UNAUTHENTICATED" } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async () => ({ data: state.owner, error: null }), auth: { getClaims: async () => ({ data: { claims: { session_id: state.session } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.company, error: null }) }; return { from: () => query, rpc: async () => ({ data: state.snapshot, error: null }) }; } }));
vi.mock("./synthetic-gemini", () => ({ executeSyntheticGemini: state.run }));
import * as actions from "./synthetic-gemini-actions";
beforeEach(() => { vi.clearAllMocks(); state.verified=true; state.owner=true; state.session=ids.sessionId; state.company={id:ids.companyId,status:"setup"}; state.snapshot={budget:{enabled:true,limit_baisa:1000,spent_baisa:0,held_baisa:0},recent:[]}; state.run.mockResolvedValue({ ok: true, text: "VELORA_SYNTHETIC_OK", synthetic: true });
 vi.stubEnv("VELORA_GEMINI_FREE_ENABLED","true"); vi.stubEnv("VELORA_GEMINI_FREE_KEY_REFERENCE","AI_GEMINI_API_KEY"); vi.stubEnv("AI_GEMINI_API_KEY","synthetic-not-a-key"); vi.stubEnv("VELORA_GEMINI_FREE_ATTESTATION",JSON.stringify({ version:1,verifiedAt:new Date().toISOString(),projectRef:"velora-510615",modelId:"gemini-3.8-flash",keyReference:"AI_GEMINI_API_KEY",billingDisabled:true,freeModelVerified:true,regionAllowed:true,unpaidTermsAccepted:true,ledgerVerified:true,quota:{modelId:"gemini-3.8-flash",verifiedAt:new Date().toISOString(),requestsAvailable:1,promptTokensAvailable:1024},actorId:ids.actorId,sessionId:ids.sessionId,companyId:ids.companyId,executionId:ids.executionId }));
});
describe("owner-only synthetic console actions", () => {
 it("binds company and execution from trusted configuration and session from the server", async () => {
  const result=await actions.runSyntheticGeminiFreeTest({executeConfirmed:true} as never); expect(result.ok).toBe(true);
  expect(state.run).toHaveBeenCalledWith({...ids,executeConfirmed:true});
 });
 it("provides a secret-free owner readiness action", async () => {
  expect(actions).toHaveProperty("readSyntheticGeminiFreeState");
 });
 it.each([{executeConfirmed:false},{executeConfirmed:true,companyId:ids.companyId},{executeConfirmed:true,question:"customer question"}])("rejects unconfirmed or client-supplied binding/content: %j",async input=>{
  expect((await actions.runSyntheticGeminiFreeTest(input as never)).ok).toBe(false); expect(state.run).not.toHaveBeenCalled();
 });
 it.each(["verified","owner"] as const)("denies %s failure before execution",async flag=>{state[flag]=false;expect((await actions.runSyntheticGeminiFreeTest({executeConfirmed:true} as never)).ok).toBe(false);expect(state.run).not.toHaveBeenCalled();});
 it("suppresses output when the owner session changes during execution",async()=>{state.run.mockImplementation(async()=>{state.session="55555555-5555-4555-8555-555555555555";return {ok:true,text:"VELORA_SYNTHETIC_OK"};});expect(await actions.runSyntheticGeminiFreeTest({executeConfirmed:true} as never)).toMatchObject({ok:false,error:"ACCESS_CHANGED_AFTER_EXECUTION"});});
});
 
describe("owner Free readiness and durable replay projection",()=>{
 it("returns only nonsecret readiness metadata",async()=>{
  const result=await actions.readSyntheticGeminiFreeState();expect(result).toMatchObject({ok:true,data:{ready:true,projectRef:"velora-510615",modelId:"gemini-3.8-flash"}});
  const serialized=JSON.stringify(result);for(const value of ["synthetic-not-a-key",ids.sessionId,ids.companyId,ids.executionId])expect(serialized).not.toContain(value);
 });
 it("blocks a previously recorded configured attempt using the canonical ledger ID",async()=>{
  state.snapshot.recent=[{id:ids.executionId}];expect(await actions.readSyntheticGeminiFreeState()).toMatchObject({ok:true,data:{ready:false,code:"EXECUTION_ALREADY_RECORDED"}});
  expect((await actions.runSyntheticGeminiFreeTest({executeConfirmed:true})).ok).toBe(false);expect(state.run).not.toHaveBeenCalled();
 });
 it.each(["suspended","missing"])( "blocks an unavailable configured QA company: %s",async status=>{
  state.company=status==="missing"?null:{id:ids.companyId,status};expect((await actions.runSyntheticGeminiFreeTest({executeConfirmed:true})).ok).toBe(false);expect(state.run).not.toHaveBeenCalled();
 });
 it("blocks exhausted budget before execution",async()=>{state.snapshot.budget.held_baisa=1000;expect((await actions.runSyntheticGeminiFreeTest({executeConfirmed:true})).ok).toBe(false);expect(state.run).not.toHaveBeenCalled();});
 it("blocks another configured actor",async()=>{const a=JSON.parse(process.env.VELORA_GEMINI_FREE_ATTESTATION!);a.actorId="55555555-5555-4555-8555-555555555555";vi.stubEnv("VELORA_GEMINI_FREE_ATTESTATION",JSON.stringify(a));expect((await actions.runSyntheticGeminiFreeTest({executeConfirmed:true})).ok).toBe(false);expect(state.run).not.toHaveBeenCalled();});
});

it.each([undefined,"55555555-5555-4555-8555-555555555555"])("rejects missing or different attested session: %s", async sessionId=>{const a=JSON.parse(process.env.VELORA_GEMINI_FREE_ATTESTATION!);a.sessionId=sessionId;vi.stubEnv("VELORA_GEMINI_FREE_ATTESTATION",JSON.stringify(a));expect((await actions.runSyntheticGeminiFreeTest({executeConfirmed:true})).ok).toBe(false);expect(state.run).not.toHaveBeenCalled();});