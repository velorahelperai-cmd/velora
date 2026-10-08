import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("./config/env",()=>({getSecureProviderKey:()=>null,isProviderKeyConfigured:()=>false}));
import {OpenAIAnswerAdapter} from "./adapters/openai";
import {GeminiAnswerAdapter} from "./adapters/gemini";
import {simulateAdminAIAnswer} from "./admin-test";
import {calculateTokensCostBaisa,MODEL_PRICING_CATALOG} from "./config/pricing";
const input={question:"Working hours?",locale:"en" as const,chunks:[]};
afterEach(()=>vi.unstubAllEnvs());
describe("Phase 1 cannot make paid provider calls",()=>{
 it("blocks both providers in development even with injected clients",async()=>{
  vi.stubEnv("NODE_ENV","development");const create=vi.fn(),generateContent=vi.fn();
  const openai=new OpenAIAnswerAdapter({client:{responses:{create}} as unknown as import("openai").default});
  const gemini=new GeminiAnswerAdapter({client:{models:{generateContent}} as unknown as import("@google/genai").GoogleGenAI});
  expect(await openai.complete(input)).toMatchObject({ok:false,code:"NEEDS_SETUP"});
  expect(await gemini.complete(input)).toMatchObject({ok:false,code:"NEEDS_SETUP"});
  expect(create).not.toHaveBeenCalled();expect(generateContent).not.toHaveBeenCalled();
 });
 it("blocks OpenAI network use in production even with an injected client",async()=>{vi.stubEnv("NODE_ENV","production");const create=vi.fn();const adapter=new OpenAIAnswerAdapter({client:{chat:{completions:{create}}} as unknown as import("openai").default});expect(await adapter.complete(input)).toMatchObject({ok:false,code:"NEEDS_SETUP"});expect(create).not.toHaveBeenCalled();});
 it("blocks Gemini network use in production",async()=>{vi.stubEnv("NODE_ENV","production");const generateContent=vi.fn();const adapter=new GeminiAnswerAdapter({client:{models:{generateContent}} as unknown as import("@google/genai").GoogleGenAI});expect(await adapter.complete(input)).toMatchObject({ok:false,code:"NEEDS_SETUP"});expect(generateContent).not.toHaveBeenCalled();});
 it("rejects attempts to turn the simulator into live answering",async()=>{expect(await simulateAdminAIAnswer({question:"hello",dryRun:false})).toMatchObject({ok:false,error:"LIVE_SIMULATION_DISABLED"});});
 it("keeps explicit dry runs available with live answering off",async()=>{vi.stubEnv("NODE_ENV","production");expect(await new OpenAIAnswerAdapter().complete({...input,dryRun:true})).toMatchObject({ok:true});});
});
describe("simulation economics",()=>{
 it("charges Luna reasoning at its standard output rate",()=>{expect(calculateTokensCostBaisa("gpt-6-luna",{promptTokens:0,completionTokens:100,reasoningTokens:50})).toBe(0.04);});
 it("does not charge the OpenAI reasoning subset twice",()=>{const cost=calculateTokensCostBaisa("gpt-6.1-sol",{promptTokens:0,completionTokens:100,reasoningTokens:50});expect(cost).toBe(MODEL_PRICING_CATALOG["gpt-6.1-sol"].completionBaisaPerMillion*100/1000000);});
});


