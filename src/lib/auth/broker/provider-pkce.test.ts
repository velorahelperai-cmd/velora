import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/supabase/env",()=>({getSupabaseEnv:()=>({ok:true,url:"http://127.0.0.1:3330",publishableKey:"synthetic-anon"})}));
import {createProviderAuthClient} from "./provider";
afterEach(()=>vi.unstubAllGlobals());
it("durably persists PKCE verifier before recovery request leaves memory",async()=>{const events:string[]=[];let verifier="";vi.stubGlobal("fetch",vi.fn(async()=>{events.push("request");return new Response("{}",{status:200,headers:{"content-type":"application/json"}});}));
 const bundle=createProviderAuthClient({persistPkceVerifier:async(value:string)=>{verifier=value;events.push("persist");}})!;
 const result=await bundle.client.auth.resetPasswordForEmail("synthetic@example.invalid",{redirectTo:"http://127.0.0.1:3320/auth/callback?vel_intent=synthetic"});expect(result.error).toBeNull();expect(verifier.length).toBeGreaterThan(16);expect(events).toEqual(["persist","request"]);
});
it("failed durable verifier write prevents recovery request",async()=>{const send=vi.fn();vi.stubGlobal("fetch",send);const bundle=createProviderAuthClient({persistPkceVerifier:async()=>{throw Error("SYNTHETIC_PERSIST_FAILURE");}})!;await expect(bundle.client.auth.resetPasswordForEmail("synthetic@example.invalid")).rejects.toThrow("SYNTHETIC_PERSIST_FAILURE");expect(send).not.toHaveBeenCalled();});

it.each(["signup", "resend"] as const)("actual SDK persists PKCE before %s transport", async operation => {
 const events: string[] = [];
 const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
  expect(JSON.parse(String(init?.body)).code_challenge).toBeTruthy();
  events.push("request");
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
 });
 vi.stubGlobal("fetch", send);
 const bundle = createProviderAuthClient({ persistPkceVerifier: async verifier => {
  expect(verifier.length).toBeGreaterThan(16); events.push("persist");
 } })!;
 if (operation === "signup") await bundle.client.auth.signUp({ email: "synthetic@example.invalid", password: "synthetic-password" });
 else await bundle.client.auth.resend({ type: "signup", email: "synthetic@example.invalid" });
 expect(send).toHaveBeenCalledTimes(1);
 expect(events).toEqual(["persist", "request"]);
});

it.each(["signup", "resend"] as const)("failed durable PKCE prevents actual SDK %s transport", async operation => {
 const send = vi.fn(); vi.stubGlobal("fetch", send);
 const bundle = createProviderAuthClient({ persistPkceVerifier: async () => { throw new Error("SYNTHETIC_PERSIST_FAILURE"); } })!;
 const request = operation === "signup"
  ? bundle.client.auth.signUp({ email: "synthetic@example.invalid", password: "synthetic-password" })
  : bundle.client.auth.resend({ type: "signup", email: "synthetic@example.invalid" });
 await expect(request).rejects.toThrow("SYNTHETIC_PERSIST_FAILURE");
 expect(send).not.toHaveBeenCalled();
});
