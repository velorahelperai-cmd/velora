import {afterEach,beforeEach,expect,it,vi} from "vitest";
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
const f=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,effects:[] as Array<()=>void>,session:null as unknown,currentIdentity:null as unknown,currentUser:"user-a" as string|null,check:vi.fn(),expire:vi.fn(),clear:vi.fn(),signOut:vi.fn(),update:vi.fn(),replace:vi.fn(),refresh:vi.fn(),listeners:new Map<string,(e:Event)=>void>()}));
vi.mock("react",()=>({useRef(initial:unknown){const i=f.cursor++;const s=f.slots[i]??(f.slots[i]={});return s.value??(s.value={current:initial});},useEffect(fn:()=>void|(()=>void),deps:unknown[]){const i=f.cursor++;const s=f.slots[i]??(f.slots[i]={});if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps![i]))){f.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}}}));
const router={replace:f.replace,refresh:f.refresh};
vi.mock("next/navigation",()=>({usePathname:()=>"/app",useRouter:()=>router}));
vi.mock("@/components/app/account-chrome",()=>({useOptionalAccountSession:()=>f.session}));
vi.mock("@/lib/supabase/client",()=>({tryCreateClient:()=>({auth:{signOut:f.signOut}})}));
vi.mock("./session-actions",()=>({checkSessionActivity:f.check}));
vi.mock("@/lib/demo-state",()=>({emptyBusiness:{},useDemo:()=>({locale:"en",update:f.update})}));
vi.mock("./auth-journey",()=>({clearPendingSignup:vi.fn()}));
import {SessionActivityTracker} from "./session-activity-tracker";
function render(){f.cursor=0;SessionActivityTracker();f.effects.splice(0).forEach(fn=>fn());}
function session(status="ready",userId="user-a"){const identity=status==="ready"?{userId,sessionExpiresAt:"invalid"}:null;f.currentIdentity=identity;return {status,identity,expire:f.expire,clear:f.clear,isCurrentUser:(id:string,expected?:unknown)=>f.currentUser===id&&(!expected||expected===f.currentIdentity),hasCurrentUser:()=>f.currentUser!==null};}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};}
async function settle(){for(let n=0;n<12;n++)await Promise.resolve();}
function event(name:string){f.listeners.get(name)?.({isTrusted:true,type:name} as Event);}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));vi.clearAllMocks();f.slots=[];f.effects=[];f.listeners.clear();f.currentUser="user-a";f.session=session();f.check.mockResolvedValue({ok:true,expiresAt:"2026-10-14T02:00:00Z"});f.signOut.mockResolvedValue({error:null});vi.stubGlobal("document",{visibilityState:"visible"});vi.stubGlobal("window",{location:{search:""},addEventListener:(name:string,fn:(e:Event)=>void)=>f.listeners.set(name,fn),removeEventListener:(name:string)=>f.listeners.delete(name)});});
afterEach(()=>{for(const s of f.slots)s.cleanup?.();vi.useRealTimers();});
it("focus and visibility only check expiry while real input touches activity",async()=>{
 render();await settle();f.check.mockClear();event("focus");await settle();expect(f.check).toHaveBeenLastCalledWith(false);
 f.check.mockClear();event("visibilitychange");await settle();expect(f.check).toHaveBeenLastCalledWith(false);
 f.check.mockClear();event("pointerdown");await settle();expect(f.check).toHaveBeenLastCalledWith(true);
});
it("programmatic scroll does not extend idle activity",async()=>{
 render();await settle();f.check.mockClear();event("scroll");await settle();expect(f.check).not.toHaveBeenCalled();
});
it.each(["wheel","touchmove"])("real %s scrolling touches idle activity",async name=>{
 render();await settle();event(name);await settle();expect(f.check).toHaveBeenLastCalledWith(true);
});
it("a late expiry check cannot expire an account that switched before the next render",async()=>{
 const pending=deferred();f.check.mockReturnValue(pending.promise);render();f.currentUser="user-b";
 pending.resolve({ok:false,code:"UNAUTHENTICATED"});await settle();expect(f.expire).not.toHaveBeenCalled();
});
it("a late expiry check cannot expire a replacement session for the same user",async()=>{
 const pending=deferred();f.check.mockReturnValue(pending.promise);render();f.currentIdentity={userId:"user-a",sessionExpiresAt:"2026-10-14T04:00:00Z"};
 pending.resolve({ok:false,code:"UNAUTHENTICATED"});await settle();expect(f.expire).not.toHaveBeenCalled();
});
it("an old expiry logout completion cannot clear or navigate a new login",async()=>{
 const pending=deferred();f.signOut.mockReturnValue(pending.promise);f.currentUser=null;f.session=session("expired");render();
 f.currentUser="user-b";pending.resolve({error:null});await settle();expect(f.clear).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();
});
it("an expiry logout completion is ignored after peer invalidation unmounts its effect",async()=>{
 const pending=deferred();f.signOut.mockReturnValue(pending.promise);f.currentUser=null;f.session=session("expired");render();
 for(const slot of f.slots)slot.cleanup?.();pending.resolve({error:null});await settle();
 expect(f.clear).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();
});
it("real activity during an in-flight read check is not discarded",async()=>{
 const pending=deferred();f.check.mockReturnValueOnce(pending.promise);render();event("pointerdown");
 pending.resolve({ok:true,expiresAt:"2026-10-14T02:00:00Z"});await settle();expect(f.check).toHaveBeenLastCalledWith(true);
});
