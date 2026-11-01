import { beforeEach, describe, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";
import type { CustomerReadinessSnapshot } from "@/lib/tenancy/customer-readiness";
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, read: vi.fn(), scopedRead:vi.fn(), refresh: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = state.cursor++; if (!(i in state.slots)) state.slots[i] = typeof initial === "function" ? initial() : initial; return [state.slots[i], (value: unknown) => { state.slots[i] = typeof value === "function" ? value(state.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = state.cursor++; return state.slots[i] ?? (state.slots[i] = { current: initial }); },
  useEffect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/tenancy/actions", () => ({ getCustomerReadiness: state.read }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("@/lib/customer/dashboard-billing-actions", () => ({ readDashboardBilling: vi.fn() }));
vi.mock("./dashboard-branch", () => ({ DashboardBranch: "section" }));
vi.mock("@/components/app/workspace-shell", () => ({ WorkspaceShell: "main" }));
vi.mock("@/components/app/ui", () => ({ Button: "button", LinkButton: "a", Notice: "aside", useAppCopy: () => appCopy("en") }));
vi.mock("@/lib/customer/dashboard-readiness-actions",()=>({readDashboardReadiness:state.scopedRead}));
import { DashboardPage } from "./dashboard";
type Node = { type: unknown; props: Record<string, unknown> };
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
const snapshot: CustomerReadinessSnapshot = { fullName: "Original owner", email: "synthetic@example.test", role: "owner", companyId: "company", companyName: "Original business", companyStatus: "setup", items: [], nextItemId: null };
const render = () => { state.cursor = 0; return DashboardPage({ initialLeads: { ok: false, code: "FORBIDDEN" }, initialReadiness: snapshot }); };
const refresh = (tree: unknown) => { const button = nodes(tree).find(node => node.type === "button" && node.props.children === appCopy("en").app.readinessRetry)!; (button.props.onClick as () => void)(); };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); state.slots = []; });

describe("dashboard readiness reload", () => {
  it("does not expose conversations when the readiness scope is unknown", () => {
    const tree=DashboardPage({initialReadiness:null,readinessLoadFailed:true,initialLeads:{ok:true,conversations:[{id:"foreign",customer:"PRIVATE_CUSTOMER",phone:"PRIVATE_PHONE",messages:[]}],meta:{companyId:"company",counts:{all:1,awaiting_staff:0}}} as never});
    const text=nodes(tree).flatMap(node=>[node.props.children].flat()).filter(value=>typeof value==="string").join(" ");
    expect(text).not.toContain("PRIVATE_CUSTOMER");
    expect(text).not.toContain("PRIVATE_PHONE");
  });
  it("links attention and automation cards to the matching visible inbox filters",()=>{
    const tree=render();
    expect(nodes(tree).some(node=>node.props.href==="/app/conversations?channel=whatsapp&filter=staff")).toBe(true);
    expect(nodes(tree).some(node=>node.props.href==="/app/conversations?channel=whatsapp&filter=noura")).toBe(true);
  });
  it("counts only open automation-permitted chats to match the linked worklist",()=>{
    const conversation={customer:"Customer",phone:"+96800000000",messages:[],automationAllowed:true,assistantPaused:false};
    const tree=DashboardPage({initialReadiness:snapshot,initialLeads:{ok:true,conversations:[{...conversation,id:"open",status:"open"},{...conversation,id:"done",status:"resolved"}],meta:{companyId:"company",counts:{all:2,awaiting_staff:0}}} as never});
    const card=nodes(tree).find(node=>node.props.href==="/app/conversations?channel=whatsapp&filter=noura")!;
    expect(nodes(card).some(node=>node.type==="strong"&&node.props.children==="1")).toBe(true);
  });
  it("updates readiness and diagnostic from one action without scheduling a second page read", async () => {
    const diagnostic = { reference: "VEL-0123456789ABCDEF", operation: "customer_readiness", stage: "knowledge", code: "DEPENDENCY_FAILED" };
    state.read.mockResolvedValue({ ok: true, data: { ...snapshot, companyName: "Updated business" }, diagnostic });
    refresh(render()); await flush();
    const tree = render();
    expect(state.read).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
    expect(nodes(tree).some(node => [node.props.children].flat().includes("Updated business"))).toBe(true);
    expect(nodes(tree).some(node => node.props.diagnostic === diagnostic)).toBe(true);
  });
  it("retains the loaded snapshot and displays stale-data feedback if the readiness read fails", async () => {
    state.read.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    refresh(render()); await flush();
    const tree = render();
    expect(state.read).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
    expect(nodes(tree).some(node => [node.props.children].flat().includes("Original business"))).toBe(true);
    expect(nodes(tree).some(node => node.props.children === appCopy("en").app.readinessStaleSnapshot)).toBe(true);
  });
});

const workspace={actorId:"owner",companyId:"company",companyName:"Current business",fullName:"Current owner",role:"owner" as const};
const lazyRender=()=>{state.cursor=0;return DashboardPage({workspace,initialLeads:{ok:false,code:"FORBIDDEN"}});};
const toggle=(tree:unknown,open:boolean)=>{const details=nodes(tree).find(n=>n.type==="details")!;(details.props.onToggle as (event:unknown)=>void)({currentTarget:{open}});};
it("defers detailed readiness until expanded, then reads once for the current actor/company",async()=>{
 state.scopedRead.mockResolvedValue({ok:true,data:snapshot});const tree=lazyRender();expect(state.read).not.toHaveBeenCalled();expect(state.scopedRead).not.toHaveBeenCalled();
 toggle(tree,false);expect(state.scopedRead).not.toHaveBeenCalled();toggle(tree,true);await flush();toggle(lazyRender(),false);toggle(lazyRender(),true);
 expect(state.scopedRead).toHaveBeenCalledExactlyOnceWith({actorId:"owner",companyId:"company"});expect(state.read).not.toHaveBeenCalled();
});
it("does not accept a readiness result from a different company",async()=>{
 state.scopedRead.mockResolvedValue({ok:true,data:{...snapshot,companyId:"foreign",items:[{id:"account",detail:"PRIVATE_FOREIGN",tone:"complete"}]}});toggle(lazyRender(),true);await flush();
 const text=nodes(lazyRender()).flatMap(n=>[n.props.children].flat()).filter(v=>typeof v==="string").join(" ");expect(text).not.toContain("PRIVATE_FOREIGN");expect(text).toContain(appCopy("en").app.readinessLoadFailed);
});
it("uses authenticated workspace scope without waiting for readiness",()=>{const tree=lazyRender();expect(nodes(tree).some(n=>[n.props.children].flat().includes("Current business"))).toBe(true);expect(nodes(tree).some(n=>n.props.companyId==="company")).toBe(true);});
