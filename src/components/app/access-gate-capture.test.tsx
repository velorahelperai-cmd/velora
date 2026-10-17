import { beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({quarantine:vi.fn(),clear:vi.fn(),lock:vi.fn(),replace:vi.fn(),refresh:vi.fn(),live:{ready:false,boundaryFingerprint:"fp-a"}}));
vi.mock("react",async()=>({...await vi.importActual("react"),useCallback:(fn:unknown)=>fn,useRef:(value:unknown)=>({current:value}),useState:(value:unknown)=>[value,vi.fn()],useEffect:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>"/account",useRouter:()=>({replace:f.replace,refresh:f.refresh})}));
vi.mock("./account-chrome",()=>({useOptionalAccountSession:()=>({clear:f.clear,lock:f.lock,cleanupCapture:()=>({userId:"actor-a",boundaryFingerprint:"fp-a"}),liveSnapshot:()=>f.live})}));
vi.mock("@/lib/auth/broker-actions",()=>({quarantineCurrentBrokerSession:f.quarantine}));
vi.mock("@/lib/auth/session-context",()=>({publishSessionQuarantine:vi.fn()}));
vi.mock("@/components/app/ui",()=>({Button:"button",Notice:"aside",useAppCopy:()=>({errors:{},admin:{}})}));
import { AccessGate } from "./access-gate";
type Node={props:Record<string,unknown>};
function nodes(value:unknown):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props"in value))return[];const node=value as Node;return[node,...nodes(node.props.children)];}
function exit(){const tree=AccessGate({code:"UNAVAILABLE"});(nodes(tree).find(node=>node.props.variant==="secondary")!.props.onClick as ()=>void)();}
async function settle(){for(let i=0;i<15;i++)await Promise.resolve();}
beforeEach(()=>{vi.clearAllMocks();f.live={ready:false,boundaryFingerprint:"fp-a"};f.quarantine.mockResolvedValue({ok:true});vi.stubGlobal("window",{location:{search:""}});});
it("M18 status-only render never invokes cleanup",()=>{AccessGate({code:"UNAVAILABLE"});expect(f.quarantine).not.toHaveBeenCalled();expect(f.lock).not.toHaveBeenCalled();});
it("M18 explicit exit quarantines original capture and retains it on transport failure",async()=>{f.quarantine.mockRejectedValue(new Error("lost"));exit();await settle();expect(f.lock).toHaveBeenCalledWith("fp-a");expect(f.quarantine).toHaveBeenCalledWith("fp-a");expect(f.clear).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();});
it.each([true,false])("M18 delayed exit cannot clear newer boundary with ready=%s",async ready=>{let resolve!:(value:unknown)=>void;f.quarantine.mockReturnValue(new Promise(ok=>resolve=ok));exit();f.live={ready,boundaryFingerprint:"fp-b"};resolve({ok:true});await settle();expect(f.quarantine).toHaveBeenCalledWith("fp-a");expect(f.clear).not.toHaveBeenCalled();expect(f.replace).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();});
