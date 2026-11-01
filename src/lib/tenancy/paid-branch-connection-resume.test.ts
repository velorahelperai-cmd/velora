import {describe,expect,it,vi} from "vitest";
import {resumeOwnedWhatsappLaunch} from "./paid-branch-connection-resume";
const ids={expectedAccountId:"00000000-0000-4000-8000-000000000001",companyId:"00000000-0000-4000-8000-000000000002",branchId:"00000000-0000-4000-8000-000000000003"};
const attemptId="00000000-0000-4000-8000-000000000004",sessionId="00000000-0000-4000-8000-000000000005";
const scope={...ids,channel:"whatsapp" as const};
const read=(status="pending")=>({schemaVersion:1,sourceStatus:"ready",...scope,asOf:"2026-11-01T00:00:00Z",revision:"3",connection:{state:"pending",flow:"wa_coexistence",attempt:{id:attemptId,generation:1,expiresAt:"2099-01-01T00:00:00Z",status},link:null,verified:false,reasonCodes:[]},capabilities:{canStart:false,canRecover:false,canCancel:true,allowedFlows:[]}});
const launch={flow:"wa_coexistence",attemptId,nonce:"b".repeat(64),appId:"111",configId:"222",graphVersion:"v25.0"};
const material={wa_coexistence:{appId:"111",configId:"222",graphVersion:"v25.0"},wa_new_number:null};
const client=(data:unknown,error:unknown=null)=>({rpc:vi.fn(async()=>({data,error}))});
describe("F5 resume launch",()=>{
 it("re-issues the stored launch for the same pending attempt and session",async()=>{
  const c=client({ok:true,read:read(),launch});
  const r=await resumeOwnedWhatsappLaunch(c,{...scope,attemptId,sessionId},material);
  expect(r.ok).toBe(true);
  expect(c.rpc).toHaveBeenCalledWith("es02_b3_resume_owned_branch_launch",{p_expected_account_id:ids.expectedAccountId,p_company_id:ids.companyId,p_branch_id:ids.branchId,p_attempt_id:attemptId,p_session_id:sessionId});
  expect(c.rpc).toHaveBeenCalledTimes(1);
 });
 it("refuses when the database denies, the attempt is not pending, or config changed",async()=>{
  await expect(resumeOwnedWhatsappLaunch(client({ok:false,code:"not_resumable"}),{...scope,attemptId,sessionId},material)).resolves.toEqual({ok:false,code:"not_resumable"});
  await expect(resumeOwnedWhatsappLaunch(client({ok:true,read:read("claimed"),launch}),{...scope,attemptId,sessionId},material)).resolves.toEqual({ok:false,code:"not_resumable"});
  await expect(resumeOwnedWhatsappLaunch(client({ok:true,read:read(),launch}),{...scope,attemptId,sessionId},{...material,wa_coexistence:{appId:"111",configId:"999",graphVersion:"v25.0"}})).resolves.toEqual({ok:false,code:"not_resumable"});
  await expect(resumeOwnedWhatsappLaunch(client({ok:true,read:read(),launch}),{...scope,attemptId,sessionId},{wa_coexistence:null,wa_new_number:null})).resolves.toEqual({ok:false,code:"setup_required"});
  await expect(resumeOwnedWhatsappLaunch(client(null,{message:"x"}),{...scope,attemptId,sessionId},material)).resolves.toEqual({ok:false,code:"source_failed"});
 });
});
