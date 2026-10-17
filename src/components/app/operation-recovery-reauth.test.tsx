import { beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({cursor:0,states:[] as unknown[],reauth:vi.fn(),resume:vi.fn(),ack:vi.fn(),clearNonce:vi.fn()}));
vi.mock("react",async()=>({...await vi.importActual("react"),useState:()=>[f.states[f.cursor++],vi.fn()],useRef:(value:unknown)=>({current:value})}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("@/lib/auth/broker-actions",()=>({recoveryReauthForOperationAction:f.reauth,resumeBrokerOperationAction:f.resume,acknowledgeBrokerClientCleanupAction:f.ack}));
vi.mock("@/lib/auth/browser-continuity",()=>({ensureBrowserContinuity:async()=>({ok:true,requestNonce:"original-gesture"}),clearAuthGestureNonce:f.clearNonce}));
vi.mock("./ui",()=>({Button:"button",Notice:"aside",Field:"field",PasswordField:"password"}));
import { OperationRecovery } from "./operation-recovery";
type Node={props:Record<string,unknown>};
function nodes(value:unknown):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props"in value))return[];const node=value as Node;return[node,...nodes(node.props.children)];}
async function submit(){const tree=OperationRecovery({receipt:{operationKey:"original-op",userId:"actor",boundaryFingerprint:"capture",kind:"logout"},isCaptured:()=>true});(nodes(tree).find(n=>n.props.onSubmit)!.props.onSubmit as (event:unknown)=>void)({preventDefault:()=>{}});for(let i=0;i<20;i++)await Promise.resolve();}
beforeEach(()=>{vi.clearAllMocks();f.cursor=0;f.states=[false,false,"synthetic@example.invalid","synthetic-password",true];});
it("definite reauth rejection releases only that gesture so a corrected credential submission can use a new intent",async()=>{f.reauth.mockResolvedValue({ok:false,code:"AUTH_ERROR"});await submit();expect(f.clearNonce).toHaveBeenCalledWith("original-gesture");expect(f.resume).not.toHaveBeenCalled();expect(f.ack).not.toHaveBeenCalled();});
it("unknown reauth response keeps original gesture and cannot acknowledge cleanup",async()=>{f.reauth.mockResolvedValue({ok:false,code:"UNAVAILABLE"});await submit();expect(f.clearNonce).not.toHaveBeenCalled();expect(f.resume).not.toHaveBeenCalled();expect(f.ack).not.toHaveBeenCalled();});
