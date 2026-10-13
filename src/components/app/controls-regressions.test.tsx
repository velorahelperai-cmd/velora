import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { CompanyRecord } from "@/lib/tenancy/types";
import { appCopy } from "@/lib/app-copy";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; changed: boolean; effects: Array<() => void> };
const state = vi.hoisted(() => ({ driver: null as Driver | null, tab: "business", save: vi.fn(), select: vi.fn(), knowledgeSave: vi.fn(), refresh: vi.fn(), confirm: vi.fn(), locale: "en" as "en" | "ar" }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => { const d = state.driver!; return { d, s: d.slots[d.cursor++] ?? (d.slots[d.cursor - 1] = {}) }; };
  return { ...actual,
    useState(initial: unknown) { const { d, s } = slot(); if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial; return [s.value, (v: unknown) => { const next = typeof v === "function" ? (v as (p: unknown) => unknown)(s.value) : v; if (!Object.is(next, s.value)) { s.value = next; d.changed = true; } }]; },
    useRef(value: unknown) { const { s } = slot(); if (!s.value) s.value = { current: value }; return s.value; },
    useMemo(fn: () => unknown, deps: unknown[]) { const { s } = slot(); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) { s.value = fn(); s.deps = deps; } return s.value; },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const { d, s } = slot(); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) { d.effects.push(() => { s.cleanup?.(); s.cleanup = fn() || undefined; }); s.deps = deps; } },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh, replace: vi.fn() }), useSearchParams: () => new URLSearchParams("tab=" + state.tab) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: state.locale }) }));
vi.mock("@/lib/tenancy/actions", () => ({ saveOwnerBusiness: state.save, selectWorkspaceCompany: state.select }));
vi.mock("@/lib/tenancy/staff-invitations", () => ({ createStaffInvitation: vi.fn(), listCompanyTeam: vi.fn() }));
vi.mock("./account-chrome", () => ({ useOptionalAccountSession: () => null }));
vi.mock("./account-page", () => ({ AccountSettingsLinkCard: "section" }));
vi.mock("./subscription-panel", () => ({ SubscriptionPanel: "section" }));
vi.mock("./whatsapp-settings-panel", () => ({ WhatsappSettingsPanel: "section" }));
vi.mock("./workspace-shell", () => ({ WorkspaceShell: "main" }));
vi.mock("@/lib/knowledge/actions", () => ({ saveTextKnowledgeSource: state.knowledgeSave, listKnowledgeSources: vi.fn(), deleteKnowledgeSource: vi.fn(), repairStoredKnowledgeFile: vi.fn(), retryFailedKnowledgeFile: vi.fn(), retryKnowledgePrepare: vi.fn(), setKnowledgeSourceApproval: vi.fn(), uploadKnowledgeFiles: vi.fn() }));
import { SettingsPage } from "./settings";
import { KnowledgeEditor } from "./knowledge-editor";
import { useAction } from "./ui";

type Node = { type: unknown; key?: string | null; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const n = value as Node;
  const children = typeof n.props.children === "function" ? (n.props.children as (p: object) => unknown)({}) : n.props.children;
  return [n, ...nodes(children)];
}
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(" "); if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children); return typeof value === "string" ? value : ""; }
function mount<P, T>(component: (props: P) => T, initial: P) {
  const d: Driver = { slots: [], cursor: 0, changed: false, effects: [] }; let props = initial;
  const render = (next = props): T => { props = next; let tree: T; let attempts = 0; do { d.changed = false; d.cursor = 0; state.driver = d; tree = component(props); state.driver = null; d.effects.splice(0).forEach(fn => fn()); if (++attempts > 15) throw new Error("render loop"); } while (d.changed); return tree!; };
  return { render, unmount: () => d.slots.forEach(s => s.cleanup?.()) };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const company = (id = "company-a", name = "Saved name", updated = "1"): CompanyRecord => ({ id, display_name: name, updated_at: updated, created_at: "1", created_by: "owner", status: "active", business_type: "service", reply_language: "en", country: "Oman", city: "Muscat", hours: "9-17", contact_phone: "", contact_email: "" });
const props = (c = company()): ComponentProps<typeof SettingsPage> => ({ initialAccess: { userId: "fixture-user", email: null, companyId: c.id, companyName: c.display_name, role: "owner", needsCompanyContext: false, isPlatformAdmin: false, choices: [company(), company("company-b")].map(row => ({ companyId: row.id, displayName: row.display_name, role: "owner" })) }, initialCompany: c, initialSubscription: { state: "empty", currentTier: null, cycle: null, paidThrough: null }, initialOffersView: { status: "empty", offers: [] } });
function settings() {
  const page = mount(SettingsPage, props()); let child: ReturnType<typeof mount<Record<string, unknown>, ReactNode>> | undefined; let key: unknown;
  let root: ReactNode; let business: ReactNode;
  const render = (next = props()) => { root = page.render(next); const n = nodes(root).find(n => typeof n.type === "function" && (n.type as { name: string }).name === "BusinessTab"); if (!n) { child?.unmount(); child = undefined; business = null; } else { if (!child || key !== n.key) { child?.unmount(); key = n.key; child = mount(n.type as (p: Record<string, unknown>) => ReactNode, n.props); } business = child.render(n.props); } return business; };
  render();
  return { render, root: () => root, business: () => business };
}
function input(tree: unknown, label: string) { const field = nodes(tree).find(n => n.props.label === label)!; return nodes(field).find(n => n.type === "input" || n.type === "textarea")!; }
const change = (n: Node, value: string) => (n.props.onChange as (e: unknown) => void)({ target: { value } });
beforeEach(() => { vi.clearAllMocks(); state.tab = "business"; state.locale = "en"; state.confirm.mockReturnValue(false); state.select.mockResolvedValue({ ok: true }); vi.stubGlobal("window", { location: { pathname: "/app/settings", search: "?tab=business", replace: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: state.confirm }); });
describe("business drafts", () => {
  it("binds a settings draft to its rendered account as well as its company", async () => {
    const h = settings(); const p = props();
    h.render({ ...p, initialAccess: { ...p.initialAccess, userId: "rendered-user" } } as ComponentProps<typeof SettingsPage>);
    change(input(h.business(), appCopy("en").setup.businessName), "Draft name");
    state.save.mockResolvedValue({ ok: false });
    (nodes(h.business()).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); await flush();
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: "rendered-user", expectedCompanyId: "company-a" }));
  });
  it("preserves dirty name while refreshing untouched city on the same company", () => { const h = settings(); change(input(h.business(), appCopy("en").setup.businessName), "Draft name"); h.render({ ...props(), initialCompany: { ...company("company-a", "Saved name", "2"), city: "Salalah" } }); expect(input(h.business(), appCopy("en").setup.businessName).props.value).toBe("Draft name"); expect(input(h.business(), appCopy("en").setup.city).props.value).toBe("Salalah"); });
  it("preserves draft through Team then Business", () => { const h = settings(); change(input(h.business(), appCopy("en").setup.businessName), "Draft name"); h.render(); state.tab = "team"; h.render(); state.tab = "business"; h.render(); expect(input(h.business(), appCopy("en").setup.businessName).props.value).toBe("Draft name"); });
  it("guards a dirty company switch", async () => { const h = settings(); change(input(h.business(), appCopy("en").setup.businessName), "Draft A"); h.render(); change(nodes(h.root()).find(n => n.type === "select")!, "company-b"); await flush(); expect(state.confirm).toHaveBeenCalledWith(appCopy("en").unsaved); expect(state.select).not.toHaveBeenCalled(); });
  it("permits an explicitly confirmed switch and binds the next draft to B", async () => { const h = settings(); change(input(h.business(), appCopy("en").setup.businessName), "Draft A"); h.render(); state.confirm.mockReturnValue(true); change(nodes(h.root()).find(n => n.type === "select")!, "company-b"); await flush(); expect(state.select).toHaveBeenCalledWith("company-b", expect.objectContaining({ expectedUserId: "fixture-user" })); h.render(props(company("company-b", "Saved B"))); expect(input(h.business(), appCopy("en").setup.businessName).props.value).toBe("Saved B"); });
  it("blocks company switching while a save is pending",async()=>{const h=settings();change(input(h.business(),appCopy("en").setup.businessName),"Draft A");h.render();let resolve!:(value:unknown)=>void;state.save.mockReturnValue(new Promise(ok=>{resolve=ok;}));(nodes(h.business()).find(n=>n.type==="form")!.props.onSubmit as(e:unknown)=>void)({preventDefault(){}});h.render();change(nodes(h.root()).find(n=>n.type==="select")!,"company-b");await flush();expect(state.confirm).not.toHaveBeenCalled();expect(state.select).not.toHaveBeenCalled();resolve({ok:false});await flush();h.render();change(nodes(h.root()).find(n=>n.type==="select")!,"company-b");await flush();expect(state.confirm).toHaveBeenCalledWith(appCopy("en").unsaved);});
  it("keeps conflicting edits visible and blocks save until latest values are adopted", async () => { const h = settings(); change(input(h.business(), appCopy("en").setup.businessName), "Draft A"); const refreshed=props(company("company-a", "New saved name", "2")); h.render(refreshed); expect(input(h.business(), appCopy("en").setup.businessName).props.value).toBe("Draft A"); expect(nodes(h.business()).find(n=>n.props.type==="submit")!.props.disabled).toBe(true); (nodes(h.business()).find(n=>n.type==="form")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}}); await flush(); expect(state.save).not.toHaveBeenCalled(); (nodes(h.business()).find(n=>text(n.props.children)==="Use latest conflicting values")!.props.onClick as ()=>void)(); h.render(refreshed); expect(input(h.business(), appCopy("en").setup.businessName).props.value).toBe("New saved name"); });
  it("never saves A's draft into B after company props change", async () => { const h = settings(); change(input(h.business(), appCopy("en").setup.businessName), "Draft A"); h.render(props(company("company-b", "Saved B"))); expect(input(h.business(), appCopy("en").setup.businessName).props.value).toBe("Saved B"); change(input(h.business(), appCopy("en").setup.businessName), "Draft B"); h.render(props(company("company-b", "Saved B"))); state.save.mockResolvedValue({ ok: false }); (nodes(h.business()).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); await flush(); expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ expectedCompanyId: "company-b", displayName: "Draft B" })); });
});
describe("synchronous action ownership", () => {
  it("executes one mutation for two calls before the next render", async () => { const h = mount(useAction, undefined); const action = h.render(); const pending = deferred(); const mutation = vi.fn(() => pending.promise); const a = action.run(mutation), b = action.run(mutation); expect(mutation).toHaveBeenCalledTimes(1); expect(h.render().busy).toBe(true); pending.resolve(); await Promise.all([a, b]); expect(h.render().busy).toBe(false); await h.render().run(mutation); expect(mutation).toHaveBeenCalledTimes(2); });
  it("propagates rejection and releases the lock for retry", async () => { const h = mount(useAction, undefined); const pending = deferred(); const action = h.render(); const rejected = action.run(() => pending.promise); pending.reject(new Error("Synthetic rejection")); await expect(rejected).rejects.toThrow("Synthetic rejection"); expect(h.render().busy).toBe(false); const mutation = vi.fn(); await h.render().run(mutation); expect(mutation).toHaveBeenCalledTimes(1); });
  it("an older run function still respects a new pending action", async () => { const h=mount(useAction,undefined); const old=h.render().run; await old(()=>{}); const pending=deferred(); const mutation=vi.fn(()=>pending.promise); const running=h.render().run(mutation); await old(mutation); expect(mutation).toHaveBeenCalledTimes(1); pending.resolve(); await running; });
  it("releases the lock after a synchronous throw",async()=>{const h=mount(useAction,undefined); await expect(h.render().run(()=>{throw new Error("Synthetic throw");})).rejects.toThrow("Synthetic throw"); const mutation=vi.fn(); await h.render().run(mutation); expect(mutation).toHaveBeenCalledTimes(1);});
});
it.each(["en", "ar"] as const)("rejected knowledge save shows a localized failure and permits retry (%s)", async locale => {
  state.locale = locale; const copy = appCopy(locale); const h = mount(KnowledgeEditor, { companyId: "company-a", canWrite: true, initialSources: [], focusTitle: "Synthetic title" }); let tree = h.render(); change(input(tree, copy.knowledge.sourceContent), "Synthetic content"); tree = h.render(); state.knowledgeSave.mockRejectedValueOnce(new Error("Synthetic rejection")); const submit = () => (nodes(tree).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); submit(); await flush(); tree = h.render(); expect(text(tree)).toContain(copy.knowledge.saveFailed); expect(nodes(tree).find(n => n.props.type === "submit")!.props.busy).toBe(false); expect(input(tree, copy.knowledge.sourceContent).props.value).toBe("Synthetic content"); state.knowledgeSave.mockResolvedValue({ ok: false, code: "INVALID_INPUT" }); submit(); await flush(); expect(state.knowledgeSave).toHaveBeenCalledTimes(2);
});
