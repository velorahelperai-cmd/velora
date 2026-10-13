import {beforeEach, expect, it, vi} from "vitest";
const f=vi.hoisted(()=>({exchange:vi.fn(),access:vi.fn(),path:vi.fn(),store:{get:vi.fn(),getAll:vi.fn(()=>[]),set:vi.fn()},write:null as null|((cookies:Array<{name:string;value:string;options?:object}>)=>void)}));
vi.mock("next/headers",()=>({cookies:async()=>f.store}));
vi.mock("@supabase/ssr",()=>({createServerClient:(_url:unknown,_key:unknown,options:{cookies:{setAll:typeof f.write}})=>{f.write=options.cookies.setAll;return {auth:{exchangeCodeForSession:f.exchange}};}}));
vi.mock("@/lib/supabase/env",()=>({getSupabaseEnv:()=>({ok:true,url:"https://synthetic.invalid",publishableKey:"synthetic"})}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:f.access,pathForAccess:f.path}));
import {GET} from "./route";
import {AUTH_RETURN_COOKIE} from "@/lib/auth/auth-journey";
const request=(query="code=synthetic",headers?:HeadersInit)=>new Request(`https://velora.example/auth/callback?${query}`,{headers});
const location=(response:Response)=>new URL(response.headers.get("location")!);
beforeEach(()=>{vi.clearAllMocks();f.store.get.mockReturnValue(undefined);f.exchange.mockResolvedValue({error:null});f.access.mockResolvedValue({ok:true});f.path.mockReturnValue("/app");});
it("ignores an untrusted forwarded host and protocol for redirects",async()=>{
 const url=location(await GET(request("error=access_denied",{"x-forwarded-host":"attacker.invalid","x-forwarded-proto":"http"})));
 expect(url.origin).toBe("https://velora.example");
});
it("does not reflect provider descriptions or exchange errors into login URLs",async()=>{
 const cancelled=location(await GET(request("error_description=synthetic-secret-pii")));
 expect(cancelled.searchParams.get("detail")).toBeNull();
 f.exchange.mockResolvedValue({error:{message:"synthetic-secret-pii",code:"provider_unknown"}});
 const failed=location(await GET(request()));
 expect(failed.searchParams.get("detail")).toBe("exchange_failed");
});
it("fails closed when authorization lookup throws and keeps exchanged cookies",async()=>{
 f.access.mockRejectedValue(new Error("synthetic unavailable"));
 f.exchange.mockImplementation(async()=>{f.write?.([{name:"sb-session",value:"synthetic",options:{path:"/"}}]);return {error:null};});
 const response=await GET(request("code=synthetic&next=%2Fadmin"));
 expect(location(response).pathname).toBe("/access");expect(location(response).searchParams.get("code")).toBe("UNAVAILABLE");
 expect(response.headers.get("set-cookie")).toContain("sb-session=synthetic");
});
it("preserves cookie cleanup on failed exchange and clears the consumed return cookie",async()=>{
 f.store.get.mockReturnValue({value:"/account"});
 f.exchange.mockImplementation(async()=>{f.write?.([{name:"sb-code-verifier",value:"",options:{path:"/",maxAge:0}}]);return {error:{code:"pkce_code_verifier_not_found"}};});
 const response=await GET(request());
 expect(location(response).searchParams.get("error")).toBe("verification_browser");
 expect(location(response).searchParams.get("next")).toBe("/account");
 expect(response.headers.get("set-cookie")).toContain("sb-code-verifier=");
 expect(response.headers.get("set-cookie")).toContain(`${AUTH_RETURN_COOKIE}=`);
});
it("does not leave a stale recovery return cookie after successful authentication",async()=>{
 f.store.get.mockReturnValue({value:"/reset-password"});
 const response=await GET(request());expect(location(response).pathname).toBe("/reset-password");
 expect(response.headers.get("set-cookie")).toContain(`${AUTH_RETURN_COOKIE}=`);
 expect(response.headers.get("cache-control")).toContain("no-store");
});
it("returns a safe retry path when the exchange throws",async()=>{
 f.exchange.mockRejectedValue(new Error("synthetic provider outage"));
 const response=await GET(request("code=synthetic&next=%2Faccount"));
 expect(location(response).pathname).toBe("/login");expect(location(response).searchParams.get("detail")).toBe("exchange_failed");
 expect(location(response).searchParams.get("next")).toBe("/account");
});
