import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({env:vi.fn(),browser:vi.fn()}));
vi.mock("@supabase/ssr",()=>({createBrowserClient:state.browser}));
vi.mock("@/lib/supabase/env",()=>({getSupabaseEnv:state.env}));
import {createClient,tryCreateClient} from "./client";
beforeEach(()=>{vi.resetAllMocks();});
describe("optional public-page auth observer",()=>{
 it("does not instantiate an unconfigured client or throw across public-page effects",()=>{state.env.mockReturnValue({ok:false});expect(tryCreateClient()).toBeNull();expect(state.browser).not.toHaveBeenCalled();expect(()=>createClient()).toThrow("Supabase public env is incomplete");});
 it("keeps the configured client path unchanged",()=>{const client={auth:{}};state.env.mockReturnValue({ok:true,url:"http://localhost.invalid",publishableKey:"synthetic-public-key"});state.browser.mockReturnValue(client);expect(tryCreateClient()).toBe(client);});
 it("keeps SDK initialization failure unavailable without an uncaught observer error",()=>{state.env.mockReturnValue({ok:true,url:"http://localhost.invalid",publishableKey:"synthetic-public-key"});state.browser.mockImplementation(()=>{throw Error("synthetic init failure");});expect(tryCreateClient()).toBeNull();});
});
