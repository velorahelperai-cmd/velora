/** Opt-in native browser acceptance. No mocked provider route, injected helper or fallback status assertion. */
import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
const enabled=process.env.VELORA_WP01A_BROWSER_PROTOCOL==="1";
it.skipIf(!enabled)("R4-A1..A7 actual local UI, reversed cookies, exact-tip, logout and password revocation",()=>{
 const fixture=process.env.VELORA_WP01A_BROWSER_FIXTURE_JSON;
 expect(fixture,"fresh memory-only synthetic local fixture required").toBeTruthy();
 const childEnv:NodeJS.ProcessEnv={NODE_ENV:"test",VELORA_WP01A_BROWSER_FIXTURE_JSON:fixture,CI:"true"};
 for(const name of ["PATH","Path","SystemRoot","TEMP","TMP","USERPROFILE","LOCALAPPDATA"])if(process.env[name])childEnv[name]=process.env[name];
 const result=spawnSync(process.execPath,[path.resolve("scripts/integration/wp01a-browser-protocol.mjs")],{encoding:"utf8",windowsHide:true,env:childEnv,timeout:300000});
 expect(result.error).toBeUndefined();expect(result.status,result.stdout+result.stderr).toBe(0);
 const report=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);expect(report.status).toBe("pass");
 const selected=JSON.parse(fixture!).cases as string[]|undefined;
 expect(report.results).toHaveLength(selected?selected.length+(selected.includes("A4")?1:0):8);
},310000);
export const WP01A_CONTINUITY_PROTOCOL={acceptanceIds:["R4-A1","R4-A2","R4-A3","R4-A4","R4-A5","R4-A6","R4-A7"] as const,gateEnv:"VELORA_WP01A_BROWSER_PROTOCOL=1",fixtureEnv:"VELORA_WP01A_BROWSER_FIXTURE_JSON",note:"Real native local fixture required; coverage is recorded per case in Brain."} as const;
