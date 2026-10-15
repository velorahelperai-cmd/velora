import {expect,it,vi} from "vitest";
import {createBrowserLogger,recordSessionCheckUnavailable} from "./browser.mjs";

it("emits a safe structured availability warning with native redaction",()=>{
 const lines:Array<Record<string,unknown>>=[];
 const logger=createBrowserLogger((line:Record<string,unknown>)=>lines.push(line));
 recordSessionCheckUnavailable({userId:"11111111-1111-4111-8111-111111111111",companyId:null},logger);
 expect(lines).toHaveLength(1);
 expect(lines[0]).toMatchObject({level:"warn",service:"velora.browser",event:"auth.session.check.unavailable",code:"UNAVAILABLE",kind:"application",user_id:"11111111-1111-4111-8111-111111111111",tenant_id:null,trace_id:null,span_id:null});
 expect(lines[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*\.\d{3}Z$/);
 expect(lines[0].request_id).toMatch(/^[a-f0-9-]{36}$/);
 expect(lines[0].version).toEqual(expect.any(String));
 logger.warn({password:"synthetic secret",headers:{authorization:"synthetic token"}});
 expect(JSON.stringify(lines)).not.toContain("synthetic secret");expect(JSON.stringify(lines)).not.toContain("synthetic token");
});
it("does not treat arbitrary account text as an identifier",()=>{
 const lines:Array<Record<string,unknown>>=[];const logger=createBrowserLogger((line:Record<string,unknown>)=>lines.push(line));
 recordSessionCheckUnavailable({userId:"secret@example.test",companyId:"unsafe\ntext"},logger);
 expect(lines[0]).toMatchObject({user_id:null,tenant_id:null});expect(JSON.stringify(lines)).not.toContain("example.test");
});
it("keeps debug disabled in production even when the configured level is debug",()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("NEXT_PUBLIC_LOG_LEVEL","debug");
 try{const lines:unknown[]=[];const logger=createBrowserLogger((line:unknown)=>lines.push(line));logger.debug({event:"test.debug"});expect(lines).toHaveLength(0);}finally{vi.unstubAllEnvs();}
});
