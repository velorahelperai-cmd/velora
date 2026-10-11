import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/lib/answers/runtime/admin-actions",()=>({readAdminAIState:vi.fn(),runAdminAITrial:vi.fn()}));
vi.mock("@/lib/answers/runtime/synthetic-gemini-actions",()=>({readSyntheticGeminiFreeState:vi.fn(),runSyntheticGeminiFreeTest:vi.fn()}));
import { AdminAIConsole } from "./admin-ai-console";
const initial={companies:[],models:[],recent:[],budget:{enabled:true,limit_baisa:1000,spent_baisa:0,held_baisa:0}};
describe("owner console synthetic control",()=>{
 it("renders a separately disabled Free test when not configured",()=>{
  const markup=renderToStaticMarkup(createElement(AdminAIConsole,{initial,freeState:{ready:false,code:"FREE_SYNTHETIC_NEEDS_SETUP"}} as never));
  expect(markup).toContain("Gemini Free synthetic test");
  expect(markup).toContain("FREE_SYNTHETIC_NEEDS_SETUP");
 });
});

import { SyntheticGeminiConsole } from "./synthetic-gemini-console";
it("requires a fresh explicit confirmation even when server readiness is true",()=>{
 const markup=renderToStaticMarkup(createElement(SyntheticGeminiConsole,{ar:false,initial:{ready:true,code:"READY",projectRef:"velora-510615",modelId:"gemini-3.8-flash",expiresAt:"2026-10-11T00:00:00Z"}}));
 expect(markup).toMatch(/type="checkbox"/);expect(markup).not.toContain('checked=""');expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);expect(markup).not.toContain('<select');expect(markup).not.toContain('<textarea');
});
it("renders Arabic owner instructions",()=>{const markup=renderToStaticMarkup(createElement(SyntheticGeminiConsole,{ar:true,initial:{ready:false,code:"FREE_SYNTHETIC_NEEDS_SETUP"}}));expect(markup).toMatch(/[\u0600-\u06ff]/);expect(markup).not.toContain("Gemini Free synthetic test");});