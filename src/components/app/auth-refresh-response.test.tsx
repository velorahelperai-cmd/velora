import { beforeEach, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";
type Node = { type: unknown; props: Record<string, unknown> };
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, read: vi.fn(), accept: vi.fn(), refresh: vi.fn(), replace: vi.fn(), routerRefresh: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState(initial: unknown) { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [state.slots[index], (value: unknown) => { state.slots[index] = value; }]; },
  useEffect(fn: () => void) { const index = state.cursor++; if (!(index in state.slots)) { state.slots[index] = true; state.effects.push(fn); } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace, refresh: state.routerRefresh }), useSearchParams: () => new URLSearchParams({ token: "a".repeat(43) }) }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("./account-chrome", () => ({ AccountMenu: "aside", useOptionalAccountSession: () => ({ status: "ready", identity: { userId: "user-a", emailConfirmed: true }, refresh: state.refresh }) }));
vi.mock("@/lib/tenancy/staff-invitations", () => ({ acceptStaffInvitation: state.accept, readStaffInvitation: state.read }));
vi.mock("@/lib/tenancy/actions", () => ({}));
vi.mock("./ui", () => ({ Button: "button", LinkButton: "a", Notice: "aside", useAppCopy: () => appCopy("en"), useAction: () => ({ busy: false, run: (fn: () => unknown) => fn() }) }));
import { AcceptInvitePage } from "./auth-pages";
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  // Inspect the page's children without rendering the decorative AuthShell.
  return [node, ...nodes(node.props.children)];
}
function render() { state.cursor = 0; const tree = AcceptInvitePage(); state.effects.splice(0).forEach(fn => fn()); return tree; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.resetAllMocks(); state.slots = []; state.effects = [];
  vi.stubGlobal("window", { requestAnimationFrame: (fn: () => void) => { fn(); return 1; }, cancelAnimationFrame: vi.fn() });
  state.read.mockResolvedValue({ ok: true, data: { business: "Business", maskedEmail: "s***@example.test", expiresAt: "2099-01-01", role: "staff" } });
});
it("navigates after confirmed invitation acceptance even if optional account refresh rejects", async () => {
  state.accept.mockResolvedValue({ ok: true, data: { companyId: "company-a" } });
  state.refresh.mockRejectedValue(new Error("offline optional refresh failure"));
  render(); await flush();
  const button = nodes(render()).find(node => node.type === "button")!;
  (button.props.onClick as () => void)(); await flush();
  expect(state.accept).toHaveBeenCalledOnce();
  expect(state.replace).toHaveBeenCalledWith("/app/conversations");
  expect(state.routerRefresh).toHaveBeenCalledOnce();
});
it("does not navigate or refresh after denied invitation acceptance", async () => {
  state.accept.mockResolvedValue({ ok: false, code: "EMAIL_MISMATCH" });
  render(); await flush();
  (nodes(render()).find(node => node.type === "button")!.props.onClick as () => void)(); await flush();
  expect(state.replace).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
});
