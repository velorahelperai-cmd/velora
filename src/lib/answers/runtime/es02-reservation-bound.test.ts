import {describe,expect,it} from "vitest";
import {buildAnswerSystemPrompt,formatAnswerUserPrompt} from "../adapters/prompt";
import {ANSWER_MAX_CONTEXT_CHARS,ANSWER_MAX_QUESTION_CHARS,ANSWER_MAX_SOURCES} from "../constants";
import type {AnswerContextChunk,AnswerPersona,AIModelId} from "../types";
import {realModelPricing,reserveRealCost} from "./economics";

describe("the internal launch cap per reply",()=>{
 it("covers the modeled reservation ceiling for maximum-size supported input across live models",()=>{
  const perSource=Math.floor((ANSWER_MAX_CONTEXT_CHARS-ANSWER_MAX_SOURCES)/ANSWER_MAX_SOURCES);
  const chunks:AnswerContextChunk[]=Array.from({length:ANSWER_MAX_SOURCES},(_,i)=>({sourceId:`source-${i}`,title:"界",text:"界".repeat(perSource),contentVersion:2147483647,retrievalMode:"passages_v1"}));
  for(const locale of ["ar","en"] as const) for(const persona of ["noura","lina","dana"] as AnswerPersona[]) for(const model of ["gemini-3.8-flash","gpt-6-luna","gpt-6.1-sol"] as AIModelId[]){
   const system=buildAnswerSystemPrompt(locale,persona)+"界".repeat(1000)+" ".repeat(2048);
   const prompt=formatAnswerUserPrompt("界".repeat(ANSWER_MAX_QUESTION_CHARS),chunks,locale);
   for(const date of [new Date("2026-11-02T00:00:00Z"),new Date("2027-01-02T00:00:00Z")])
    expect(reserveRealCost(model,system,prompt,realModelPricing(model,date),512)).toBeLessThanOrEqual(100);
  }
 });
});
