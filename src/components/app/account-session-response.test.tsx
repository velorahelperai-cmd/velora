import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {AccountProfileView} from "@/lib/tenancy/access";
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
const state=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,effects:[] as Array<()=>void>,read:vi.fn(),authEvent:null as null|((event:string,session:unknown)=>void),peerSignal:null as null|((signal:unknown)=>void),publish:vi.fn(),logout:vi.fn(),reload:vi.fn(),path:"/",refresh:vi.fn()}));
vi.mock("react",async()=>{const actual=await vi.importActual<typeof import("react")>("react");const slot=()=>state.slots[state.cursor++]??(state.slots[state.cursor-1]={});const memo=(fn:()=>unknown,deps:unknown[])=>{const s=slot();if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps![i]))){s.value=fn();s.deps=deps;}return s.value;};return {...actual,useState(initial:unknown){const s=slot();if(!("value"in s))s.value=typeof initial==="function"?(initial as()=>unknown)():initial;return[s.value,(v:unknown)=>{s.value=typeof v==="function"?(v as(p:unknown)=>unknown)(s.value):v;}];},useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},useMemo:memo,useCallback:(fn:()=>unknown,deps:unknown[])=>memo(()=>fn,deps),useEffect(fn:()=>void|(()=>void),deps:unknown[]){const s=slot();if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps![i]))){state.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}}};});
const router={refresh:state.refresh};
vi.mock("next/navigation",()=>({useRouter:()=>router,usePathname:()=>state.path}));
vi.mock("@/lib/auth/session-context",()=>({publishSessionContext:state.publish,publishSessionLogout:state.logout,subscribeSessionContext:(fn:typeof state.peerSignal)=>{state.peerSignal=fn;return ()=>{state.peerSignal=null;};}}));
vi.mock("@/lib/tenancy/actions",()=>({getAccountProfile:state.read,signOut:vi.fn()}));
vi.mock("@/lib/supabase/client",()=>({tryCreateClient:()=>({auth:{onAuthStateChange:(fn:typeof state.authEvent)=>{state.authEvent=fn;return {data:{subscription:{unsubscribe:vi.fn()}}};}}}),createClient:vi.fn()}));
vi.mock("@/lib/demo-state",()=>({emptyBusiness:{},useDemo:()=>({locale:"en"})}));
import {AccountSessionProvider} from "./account-chrome";
const profile=(userId="user-a"):AccountProfileView=>({userId,fullName:"Confirmed name",email:"synthetic@example.invalid",supportCode:"SYNTHETIC",isPlatformAdmin:true,role:null,companyName:null,companyId:null,needsCompanyContext:false,adminHref:"/admin",workspaceHref:null,workHref:"/admin",platformIdentity:{role:"owner",status:"active",unavailable:false}});
const initial=profile();
function renderTree(){state.cursor=0;const tree=AccountSessionProvider({initial,children:"private-content"});state.effects.splice(0).forEach(fn=>fn());return tree;}
function render(){return renderTree().props.value;}
function deferred(){let resolve!:(v:unknown)=>void;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};}
beforeEach(()=>{vi.clearAllMocks();state.slots=[];state.effects=[];state.authEvent=null;state.peerSignal=null;state.path="/";vi.stubGlobal("window",{location:{reload:state.reload},requestAnimationFrame:()=>1,cancelAnimationFrame:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal("document",{addEventListener:vi.fn(),removeEventListener:vi.fn()});});
afterEach(()=>{for(const slot of state.slots)slot.cleanup?.();vi.useRealTimers();});
it("mount and INITIAL_SESSION share one in-flight authoritative identity read",async()=>{
 vi.useFakeTimers();const pending=deferred();state.read.mockReturnValue(pending.promise);
 const frames:Array<()=>void>=[];
 vi.stubGlobal("window",{location:{reload:state.reload},requestAnimationFrame:(fn:()=>void)=>{frames.push(fn);return 1;},cancelAnimationFrame:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});
 render();frames[0]!();state.authEvent?.("INITIAL_SESSION",{user:{id:"user-a"}});
 await vi.advanceTimersByTimeAsync(0);
 expect(state.read).toHaveBeenCalledTimes(1);
 pending.resolve({ok:true,data:profile()});await vi.advanceTimersByTimeAsync(0);
 expect(render().identity?.userId).toBe("user-a");
});
it("a new identity generation never shares the prior account's signal read",async()=>{
 vi.useFakeTimers();const old=deferred();state.read.mockReturnValueOnce(old.promise).mockResolvedValue({ok:true,data:profile("user-b")});
 const frames:Array<()=>void>=[];
 vi.stubGlobal("window",{location:{reload:state.reload},requestAnimationFrame:(fn:()=>void)=>{frames.push(fn);return 1;},cancelAnimationFrame:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const current=render();frames[0]!();current.clear();
 state.authEvent?.("INITIAL_SESSION",{user:{id:"user-b"}});await vi.advanceTimersByTimeAsync(0);
 expect(state.read).toHaveBeenCalledTimes(2);expect(render().identity?.userId).toBe("user-b");
 old.resolve({ok:true,data:profile("user-a")});await vi.advanceTimersByTimeAsync(0);
 expect(render().identity?.userId).toBe("user-b");
});
it("a late refresh cannot restore platform owner identity after logout",async()=>{const pending=deferred();state.read.mockReturnValue(pending.promise);const current=render();const request=current.refresh();current.clear();pending.resolve({ok:true,data:profile()});await request;const next=render();expect(next.status).toBe("guest");expect(next.identity).toBeNull();expect(current.isCurrentUser("user-a")).toBe(false);current.setIdentityName("Late name","user-a");expect(render().identity).toBeNull();});
it("an older owner's refresh/name cannot restore identity during a newer account reload",async()=>{const pending=deferred();state.read.mockReturnValueOnce(pending.promise).mockResolvedValue({ok:true,data:{...profile("user-b"),isPlatformAdmin:false,adminHref:null,platformIdentity:{role:null,status:null,unavailable:false}}});const current=render();const old=current.refresh();const nextRequest=current.refresh();await nextRequest;pending.resolve({ok:true,data:profile()});await old;current.setIdentityName("Old account name","user-a");const next=render();expect(next.identity).toBeNull();expect(next.status).toBe("loading");expect(next.isCurrentUser("user-a")).toBe(false);expect(state.reload).toHaveBeenCalledOnce();});
it("a second account switch while loading invalidates the first account's pending response",async()=>{
 vi.useFakeTimers();const pending=deferred();state.read.mockReturnValueOnce(pending.promise).mockResolvedValue({ok:true,data:profile("user-c")});
 render().clear();state.authEvent?.("SIGNED_IN",{user:{id:"user-b"}});await vi.advanceTimersByTimeAsync(0);
 state.authEvent?.("SIGNED_IN",{user:{id:"user-c"}});
 pending.resolve({ok:true,data:profile("user-b")});for(let n=0;n<6;n++)await Promise.resolve();
 expect(render().identity).toBeNull();expect(render().isCurrentUser("user-b")).toBe(false);
 expect(state.reload).toHaveBeenCalledOnce();expect(render().identity).toBeNull();
});
it("a browser account switch cannot restore an old server identity while the switch is loading",async()=>{
 vi.useFakeTimers();state.read.mockResolvedValue({ok:true,data:profile("user-a")});render();
 state.authEvent?.("SIGNED_IN",{user:{id:"user-b"}});await render().refresh();
 expect(render().identity).toBeNull();expect(render().isCurrentUser("user-a")).toBe(false);
});
it("SDK account switches reload protected routes but first INITIAL_SESSION does not loop",async()=>{
 vi.useFakeTimers();state.path="/setup";render();state.authEvent?.("SIGNED_IN",{user:{id:"user-b"}});
 expect(state.reload).toHaveBeenCalledOnce();expect(renderTree().props.children).not.toBe("private-content");
 render().clear();state.reload.mockClear();state.read.mockResolvedValue({ok:true,data:profile("user-b")});
 state.authEvent?.("INITIAL_SESSION",{user:{id:"user-b"}});await vi.advanceTimersByTimeAsync(0);expect(state.reload).not.toHaveBeenCalled();
});
it("a verified login after logout publishes again even for the same user",async()=>{
 state.read.mockResolvedValue({ok:true,data:profile()});await render().refresh();render().clear();await render().refresh();expect(state.publish).toHaveBeenCalledTimes(2);
});
it("peer account changes discard pending identity and protected content before server reload",async()=>{
 vi.useFakeTimers();state.path="/app";const pending=deferred();state.read.mockReturnValueOnce(pending.promise).mockResolvedValue({ok:true,data:profile("user-b")});
 const old=render().refresh();state.peerSignal?.({type:"context",userId:"user-b",companyId:null});
 expect(render().identity).toBeNull();expect(renderTree().props.children).not.toBe("private-content");expect(state.refresh).toHaveBeenCalled();
 pending.resolve({ok:true,data:profile()});await old;expect(render().identity).toBeNull();
 expect(state.reload).toHaveBeenCalledOnce();expect(render().identity).toBeNull();
});
it("peer workspace changes invalidate but never grant the advertised workspace",async()=>{
 vi.useFakeTimers();state.read.mockResolvedValue({ok:true,data:profile()});render();
 state.peerSignal?.({type:"context",userId:"user-a",companyId:"untrusted-company"});expect(render().identity).toBeNull();
 expect(state.reload).toHaveBeenCalledOnce();expect(render().identity).toBeNull();
});
it("a refetch cannot uncover old protected children while document reload is in flight",async()=>{
 state.path="/app";state.read.mockResolvedValue({ok:true,data:profile("user-b")});render();state.peerSignal?.({type:"context",userId:"user-b",companyId:null});
 await render().refresh();expect(render().status).toBe("loading");expect(renderTree().props.children).not.toBe("private-content");
});
it("a stale peer logout for A cannot erase B",async()=>{
 render().clear();state.read.mockResolvedValue({ok:true,data:profile("user-b")});await render().refresh();state.refresh.mockClear();state.read.mockClear();
 state.peerSignal?.({type:"logout",userId:"user-a"});expect(render().identity?.userId).toBe("user-b");expect(state.refresh).not.toHaveBeenCalled();expect(state.read).not.toHaveBeenCalled();
});
it("a server identity change keeps protected old RSC content hidden until document reload",async()=>{
 state.path="/setup";state.read.mockResolvedValue({ok:true,data:profile("user-b")});await render().refresh();
 expect(render().status).toBe("loading");expect(renderTree().props.children).not.toBe("private-content");expect(state.reload).toHaveBeenCalledOnce();
});
it("publishes verified server context once per change and preserves public pages",async()=>{
 state.read.mockResolvedValue({ok:true,data:profile()});await render().refresh();await render().refresh();expect(state.publish).toHaveBeenCalledTimes(1);
 state.read.mockResolvedValue({ok:true,data:{...profile(),companyId:"company-b"}});await render().refresh();expect(state.publish).toHaveBeenLastCalledWith({userId:"user-a",companyId:"company-b"});
 render().clear();expect(renderTree().props.children).toBe("private-content");
});
