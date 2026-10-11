import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({ai:vi.fn(),free:vi.fn()}));
vi.mock("@/lib/answers/runtime/admin-actions",()=>({readAdminAIState:state.ai}));
vi.mock("@/lib/answers/runtime/synthetic-gemini-actions",()=>({readSyntheticGeminiFreeState:state.free}));
vi.mock("@/components/app/admin-ai-console",()=>({AdminAIConsole:()=>null}));
vi.mock("@/components/app/access-gate",()=>({AccessGate:()=>null}));
import Page from "./page";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("VELORA_GEMINI_FREE_ENABLED","false");state.ai.mockResolvedValue({ok:true,data:{}});state.free.mockResolvedValue({ok:true,data:{ready:false,code:"FREE_SYNTHETIC_NEEDS_SETUP"}});});
it("does not run a second authorization waterfall for disabled Free readiness",async()=>{await Page();expect(state.free).not.toHaveBeenCalled();});
it("starts independently authorized enabled readiness before paid snapshot finishes",async()=>{vi.stubEnv("VELORA_GEMINI_FREE_ENABLED","true");let finish!: (value:unknown)=>void;state.ai.mockReturnValue(new Promise(resolve=>{finish=resolve}));const page=Page();await Promise.resolve();expect(state.free).toHaveBeenCalledOnce();finish({ok:true,data:{}});await page;});
it("keeps the whole console denied when paid owner authorization fails",async()=>{state.ai.mockResolvedValue({ok:false,error:"OWNER_REQUIRED"});const result=await Page();expect(result.props.code).toBe("FORBIDDEN");});

it("measures the disabled Free route orchestration with fixed synthetic latency",async()=>{const samples:number[]=[];state.ai.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({ok:true,data:{}}),50)));state.free.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({ok:true,data:{ready:false,code:"FREE_SYNTHETIC_NEEDS_SETUP"}}),50)));for(let i=0;i<5;i++){const at=performance.now();await Page();samples.push(Number((performance.now()-at).toFixed(1)));}console.log("SYNTHETIC_PAGE_MS",JSON.stringify(samples));});
it("keeps overlapping page requests isolated when an older response finishes last",async()=>{const finish:Array<(v:unknown)=>void>=[];state.ai.mockImplementation(()=>new Promise(resolve=>finish.push(resolve)));const old=Page(),latest=Page();finish[1]!({ok:true,data:{marker:"latest"}});expect((await latest).props.initial.marker).toBe("latest");finish[0]!({ok:true,data:{marker:"old"}});expect((await old).props.initial.marker).toBe("old");expect(state.ai).toHaveBeenCalledTimes(2);});
it("rechecks owner authorization for every repeated navigation",async()=>{await Page();state.ai.mockResolvedValue({ok:false,error:"OWNER_REQUIRED"});expect((await Page()).props.code).toBe("FORBIDDEN");expect(state.ai).toHaveBeenCalledTimes(2);});