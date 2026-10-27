import {afterEach,expect,it,vi} from "vitest";
import {GET} from "./route";
const native=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:native})}));
afterEach(()=>vi.unstubAllEnvs());
it("is absent in Production and on foreign origins",async()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("NEXT_PUBLIC_SITE_URL","http://127.0.0.1:3330");
 expect((await GET(new Request("http://127.0.0.1:3330/api/billing/local-live-readiness"))).status).toBe(404);
 vi.stubEnv("NODE_ENV","development");
 expect((await GET(new Request("https://foreign.example/api/billing/local-live-readiness"))).status).toBe(404);
});
it('requires actual native readiness in addition to configured keys',async()=>{
 const env={NODE_ENV:'development',VELORA_LOCAL_CUSTOMER_MODE:'live',NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:3330',VELORA_LOCAL_LIVE_ACCOUNT_ID:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',VELORA_LOCAL_LIVE_GRANT_ID:'11111111-2222-4333-8444-555555555555',VELORA_LOCAL_LIVE_APPROVED_BAISA:'100',THAWANI_SECRET_KEY_LIVE:'fixture-secret',THAWANI_PUBLIC_KEY_LIVE:'fixture-public',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-private',VELORA_SESSION_BROKER_KEY:'fixture-broker'};
 for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
 native.mockResolvedValue({data:false,error:null});expect(await (await GET(new Request('http://127.0.0.1:3330/api/billing/local-live-readiness'))).json()).toMatchObject({checkoutEnabled:false});
 native.mockResolvedValue({data:true,error:null});const body=await (await GET(new Request('http://127.0.0.1:3330/api/billing/local-live-readiness'))).json();expect(body).toMatchObject({checkoutEnabled:true,status:'READY_FOR_USER_CHECKOUT',blockers:[]});expect(JSON.stringify(body)).not.toContain(env.VELORA_LOCAL_LIVE_ACCOUNT_ID);
});
it("reports actual missing contracts without exposing credentials or pretending checkout is ready",async()=>{
 vi.stubEnv("NODE_ENV","development");vi.stubEnv("NEXT_PUBLIC_SITE_URL","http://127.0.0.1:3330");
 vi.stubEnv("THAWANI_SECRET_KEY_LIVE","never-display-this-fixture");
 const response=await GET(new Request("http://127.0.0.1:3330/api/billing/local-live-readiness"));
 const body=await response.text();expect(body).not.toContain("never-display-this-fixture");
 expect(JSON.parse(body)).toMatchObject({checkoutEnabled:false,status:"BLOCKED",currency:"OMR",minimumBaisa:100,webhookChanged:false});
 expect(response.headers.get("cache-control")).toBe("no-store");
});
