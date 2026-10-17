import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {appCopy} from "@/lib/app-copy";
type Node={type:unknown;props:Record<string,unknown>};
const m=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,effects:[] as Array<()=>void>,locale:"en" as "en"|"ar",read:vi.fn(),accept:vi.fn(),refresh:vi.fn(),replace:vi.fn(),routerRefresh:vi.fn()}));
vi.mock("react",async()=>({...await vi.importActual<typeof import("react")>("react"),useState(initial:unknown){const i=m.cursor++;if(!(i in m.slots))m.slots[i]=typeof initial==="function"?(initial as ()=>unknown)():initial;return[m.slots[i],(v:unknown)=>{m.slots[i]=v;}];},useEffect(fn:()=>void){const i=m.cursor++;if(!(i in m.slots)){m.slots[i]=true;m.effects.push(fn);}}}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:m.replace,refresh:m.routerRefresh}),useSearchParams:()=>new URLSearchParams({token:"a".repeat(43)})}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:m.locale})}));
vi.mock("./account-chrome",()=>({AccountMenu:"aside",useOptionalAccountSession:()=>({status:"ready",identity:{userId:"synthetic-actor-a",emailConfirmed:true},refresh:m.refresh})}));
vi.mock("@/lib/tenancy/staff-invitations",()=>({readStaffInvitation:m.read,acceptStaffInvitation:m.accept}));
vi.mock("@/lib/tenancy/actions",()=>({}));
vi.mock("./ui",()=>({Button:"button",LinkButton:"a",Notice:"aside",useAppCopy:()=>appCopy(m.locale),useAction:()=>({busy:false,run:(fn:()=>unknown)=>fn()})}));
import {AcceptInvitePage} from "./auth-pages";
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=="object"||!("props"in v))return[];const n=v as Node;return[n,...nodes(n.props.children)];}
function text(v:unknown):string{if(typeof v==="string")return v;if(Array.isArray(v))return v.map(text).join(" ");return v&&typeof v==="object"&&"props"in v?text((v as Node).props.children):"";}
function render(){m.cursor=0;const result=AcceptInvitePage();m.effects.splice(0).forEach(fn=>fn());return result;}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
beforeEach(()=>{vi.resetAllMocks();m.slots=[];m.effects=[];m.locale="en";vi.stubGlobal("window",{requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},cancelAnimationFrame:vi.fn()});m.read.mockResolvedValue({ok:true,data:{business:"Synthetic business",maskedEmail:"s***@example.invalid",role:"staff",expiresAt:"2099-01-01"}});m.accept.mockResolvedValue({ok:true,data:{companyId:"synthetic-company"}});});
afterEach(()=>vi.unstubAllGlobals());
it.each(["en","ar"] as const)("M22 durable acceptance remains truthful in %s when account refresh fails",async locale=>{m.locale=locale;m.refresh.mockRejectedValue(Error("SYNTHETIC_CACHE_FAILURE"));render();await flush();(nodes(render()).find(n=>n.type==="button")!.props.onClick as ()=>void)();await flush();const tree=render();expect(text(tree)).toContain(appCopy(locale).auth.inviteAccepted);expect(nodes(tree).find(n=>n.type==="button")!.props.disabled).toBe(true);expect(m.accept).toHaveBeenCalledTimes(1);});
it.each(["replace","routerRefresh"] as const)("M22 %s failure after durable acceptance cannot claim acceptance failed or reaccept",async method=>{m[method].mockImplementation(()=>{throw Error("SYNTHETIC_ROUTE_REFRESH_FAILURE");});render();await flush();(nodes(render()).find(n=>n.type==="button")!.props.onClick as ()=>void)();await flush();const tree=render();expect(text(tree)).toContain(appCopy("en").auth.inviteAccepted);expect(text(tree)).not.toContain("Could not load or accept this invitation");const button=nodes(tree).find(n=>n.type==="button")!;expect(button.props.disabled).toBe(true);(button.props.onClick as ()=>void)();await flush();expect(m.accept).toHaveBeenCalledTimes(1);});
