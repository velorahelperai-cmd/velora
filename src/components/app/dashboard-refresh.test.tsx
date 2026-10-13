import { beforeEach, describe, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";
import type { CustomerReadinessSnapshot } from "@/lib/tenancy/customer-readiness";
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, read: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = state.cursor++; if (!(i in state.slots)) state.slots[i] = typeof initial === "function" ? initial() : initial; return [state.slots[i], (value: unknown) => { state.slots[i] = typeof value === "function" ? value(state.slots[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = state.cursor++; return state.slots[i] ?? (state.slots[i] = { current: initial }); },
  useEffect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/tenancy/actions", () => ({ getCustomerReadiness: state.read }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("@/lib/customer/dashboard-billing-actions", () => ({ readDashboardBilling: vi.fn() }));
vi.mock("@/components/app/workspace-shell", () => ({ WorkspaceShell: "main" }));
vi.mock("@/components/app/ui", () => ({ Button: "button", LinkButton: "a", Notice: "aside", useAppCopy: () => appCopy("en") }));
import { DashboardPage } from "./dashboard";
type Node = { type: unknown; props: Record<string, unknown> };
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
const snapshot: CustomerReadinessSnapshot = { fullName: "Original owner", email: "synthetic@example.test", role: "owner", companyId: "company", companyName: "Original business", companyStatus: "setup", items: [], nextItemId: null };
const render = () => { state.cursor = 0; return DashboardPage({ initialLeads: { ok: false, code: "FORBIDDEN" }, initialReadiness: snapshot }); };
const refresh = (tree: unknown) => { const button = nodes(tree).find(node => node.type === "button" && node.props.children === appCopy("en").app.readinessRetry)!; (button.props.onClick as () => void)(); };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); state.slots = []; });

describe("dashboard readiness reload", () => {
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
