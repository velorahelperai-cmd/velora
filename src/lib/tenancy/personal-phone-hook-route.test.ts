import {afterEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({admin:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:f.admin}));
import {POST} from "@/app/api/auth/sms-hook/route";
import {personalPhoneSmsRuntimeConfigured} from "./personal-phone-hook-config";
afterEach(()=>vi.unstubAllEnvs());
describe("unconfigured real SMS hook route",()=>{
 it("environment approval flags cannot select an unapproved delivery provider",async()=>{
   vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED","true");vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_APPROVED","true");vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_HOOK_REGISTERED","true");vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_HOOK_SECRET","whsec_"+Buffer.alloc(32,1).toString("base64"));
   expect(personalPhoneSmsRuntimeConfigured()).toBe(false);
   const response=await POST(new Request("https://local.invalid/api/auth/sms-hook",{method:"POST",body:JSON.stringify({sms:{otp:"654321"}})}));
   expect(response.status).toBe(503);expect(await response.text()).not.toContain("654321");expect(f.admin).not.toHaveBeenCalled();
 });
});
