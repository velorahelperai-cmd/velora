import {expect,it,vi} from "vitest";
vi.mock("next/headers",()=>({cookies:vi.fn()}));
vi.mock("@/lib/supabase/env",()=>({getSupabaseEnv:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:vi.fn(),pathForAccess:vi.fn()}));
vi.mock("@/lib/auth/broker",()=>({brokerExchangeOAuthCode:vi.fn(),commitAuthReturnForGeneration:vi.fn(),expireIntentCookie:vi.fn(),readAuthReturnForGeneration:vi.fn(),readIntentCookie:vi.fn()}));
import {GET} from "./route";
it("keeps the browser origin when Next internally represents loopback as localhost",async()=>{const response=await GET(new Request("http://localhost:3320/auth/callback?error=access_denied",{headers:{host:"127.0.0.1:3320"}}));const location=response.headers.get("location")!;expect(location).toBe("/login?error=oauth_cancelled");expect(new URL(location,"http://127.0.0.1:3320").origin).toBe("http://127.0.0.1:3320");expect(response.headers.get("cache-control")).toBe("private, no-store");});
it("never promotes forwarded headers to redirect authority",async()=>{const response=await GET(new Request("https://velora.example/auth/callback",{headers:{"x-forwarded-host":"attacker.invalid","x-forwarded-proto":"http"}}));expect(response.headers.get("location")).toBe("/login?error=auth_callback&detail=missing_code");});
