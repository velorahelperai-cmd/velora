import {describe,expect,it} from "vitest";
import {cycleCreditSnapshot,type CycleCreditSnapshot} from "./cycle-credits";
const units={granted:500,consumed:30,held:1,forfeited:0,expired:0,remaining:469};
const empty={granted:0,consumed:0,held:0,forfeited:0,expired:0,remaining:0};
const value:CycleCreditSnapshot={companyId:"company",cycleId:"cycle",subscriptionId:"subscription",startsAt:"2026-10-01T00:00:00Z",expiresAt:"2026-10-31T00:00:00Z",active:true,baseCap:500,credits:{base:units,topup:empty,compensation:empty},totalConsumed:30,totalRemaining:469,topupConfiguration:"UNCONFIGURED",compensationConfiguration:"UNCONFIGURED"};
describe("cycle credit display authority",()=>{
 it("accepts exact server company/cycle binding and separate counters",()=>expect(cycleCreditSnapshot(value,"company")).toEqual(value));
 it("rejects a late result from another workspace",()=>expect(cycleCreditSnapshot(value,"other")).toBeNull());
 it("rejects inconsistent or unsafe counters rather than inventing balance",()=>{expect(cycleCreditSnapshot({...value,totalRemaining:500},"company")).toBeNull();expect(cycleCreditSnapshot({...value,credits:{...value.credits,base:{...units,consumed:-1}}},"company")).toBeNull();});
 it("expired credits are never presented as usable",()=>expect(cycleCreditSnapshot({...value,active:false},"company")).toBeNull());
 it("preserves separate historical forfeiture when upgrade replaces old base",()=>{const upgraded={...value,baseCap:1500 as const,credits:{...value.credits,base:{granted:2000,consumed:30,held:0,forfeited:470,expired:0,remaining:1500}},totalRemaining:1500};expect(cycleCreditSnapshot(upgraded,"company")).toEqual(upgraded);});
});
