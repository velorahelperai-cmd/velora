import {beforeAll,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({client:null as unknown}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>state.client}));
vi.mock("../config/env",()=>({getSecureProviderKey:()=>null}));
import {executeRealAnswer} from "./execute";
import {createRealRuntimeStore} from "./store";
import {priceRealUsage,realModelPricing} from "./economics";
const enabled=process.env.C1_SECURITY_POSTGRES_TESTS==="1";
type LocalDb={sql:(q:string)=>Promise<string>;rows:(q:string)=>Promise<Array<Record<string,unknown>>>;lit:(s:string)=>string;file:(p:string)=>Promise<string>};
let db:LocalDb;
async function input(){const f=JSON.parse(await db.sql("SET ROLE service_role;SELECT test_fixture.ai_admin();"));return {actorId:f.actor,companyId:f.company,sessionId:f.session,executionId:crypto.randomUUID(),usageMode:"admin_test" as const,locale:"en" as const,model:"gpt-6-luna" as const,question:"Synthetic connection test only",chunks:[]};}
describe.skipIf(!enabled)("C1 actual PostgreSQL administrative runtime",()=>{
 beforeAll(async()=>{const p="../../../../scripts/whatsapp-integration/postgres.mjs",a="../../../../scripts/security-foundation/app-adapter.mjs";
  db=await import(p);const adapter=await import(a);state.client=adapter.appAdapter();await db.file("scripts/whatsapp-integration/fixtures.sql");},30_000);
 it("persists actual provider identity, full token breakdown and exactly one cost",async()=>{
  const usage={promptTokens:16,completionTokens:4,cachedTokens:2,cacheWriteTokens:1,reasoningTokens:3,totalTokens:20};
  const call=vi.fn().mockResolvedValue({status:"success",text:"Synthetic answer",usage,requestId:"synthetic-c1-request",responseId:"synthetic-c1-response",actualModelId:"gpt-6-luna-2026-10-01",latencyMs:3});
  const result=await executeRealAnswer(await input(),{store:createRealRuntimeStore(),call});expect(result.ok,"error" in result?result.error:undefined).toBe(true);expect(call).toHaveBeenCalledTimes(1);
  const row=(await db.rows(`SELECT * FROM ai_usage_ledger WHERE id=${db.lit(result.attempts[0].id)}::uuid`))[0];
  expect(row).toMatchObject({status:"success",actual_model_id:"gpt-6-luna-2026-10-01",response_id:"synthetic-c1-response",request_id:"synthetic-c1-request",prompt_tokens:16,completion_tokens:4,cached_tokens:2,cache_write_tokens:1,reasoning_tokens:3,total_tokens:20});
  expect(Number(row.cost_baisa)).toBe(priceRealUsage(usage,realModelPricing("gpt-6-luna")).costBaisa);
 },30_000);
 it("holds unknown cost with original provider reference and no paid retry",async()=>{
  const call=vi.fn().mockResolvedValue({status:"uncertain",text:"",responseId:"synthetic-c1-unknown",actualModelId:"gpt-6-luna",errorCode:"PROVIDER_USAGE_MISSING",latencyMs:3});
  const result=await executeRealAnswer(await input(),{store:createRealRuntimeStore(),call});expect(result.ok).toBe(false);expect(call).toHaveBeenCalledTimes(1);
  const row=(await db.rows(`SELECT * FROM ai_usage_ledger WHERE id=${db.lit(result.attempts[0].id)}::uuid`))[0];
  expect(row).toMatchObject({status:"uncertain",cost_baisa:null,cost_usd:null,response_id:"synthetic-c1-unknown",actual_model_id:"gpt-6-luna"});
  const budget=(await db.rows(`SELECT held_baisa FROM ai_budget_accounts WHERE id=${db.lit(String(row.budget_account_id))}::uuid`))[0];expect(Number(budget.held_baisa)).toBeGreaterThanOrEqual(Number(row.reserved_baisa));
 },30_000);
 it("confirmed rejection settles zero cost without losing the original evidence",async()=>{
  const call=vi.fn().mockResolvedValue({status:"rejected",text:"",requestId:"synthetic-c1-rejected",errorCode:"PROVIDER_HTTP_401",latencyMs:1});
  const result=await executeRealAnswer(await input(),{store:createRealRuntimeStore(),call});expect(result.ok).toBe(false);expect(call).toHaveBeenCalledTimes(1);
  const row=(await db.rows(`SELECT status,cost_baisa,cost_usd,request_id FROM ai_usage_ledger WHERE id=${db.lit(result.attempts[0].id)}::uuid`))[0];expect(row).toMatchObject({status:"rejected",cost_baisa:0,cost_usd:0,request_id:"synthetic-c1-rejected"});
 },30_000);
});
