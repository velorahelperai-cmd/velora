import { beforeEach, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";

type Node = { type: unknown; props: Record<string, unknown> };
const state = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, signup: vi.fn(), resolve: vi.fn(),
  replace: vi.fn(), routerRefresh: vi.fn(), accountRefresh: vi.fn(), navigate: vi.fn(),
  remember: vi.fn(), save: vi.fn(), clear: vi.fn(), continuity: vi.fn(), clearNonce: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useContext: () => null,
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) {
        state.slots[index] = initial && typeof initial === "object" && "confirm" in initial
          ? { name: "Synthetic signup test", email: "signup@example.test", password: "synthetic-fixture-only", confirm: "synthetic-fixture-only" }
          : typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [state.slots[index], (value: unknown) => {
        state.slots[index] = typeof value === "function" ? (value as (prev: unknown) => unknown)(state.slots[index]) : value;
      }];
    },
    useEffect: vi.fn(),
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace, refresh: state.routerRefresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en", state: {} }) }));
vi.mock("./account-chrome", () => ({ AccountMenu: "aside", useOptionalAccountSession: () => ({ status: "guest", refresh: state.accountRefresh }) }));
vi.mock("@/lib/tenancy/actions", () => ({ signUpWithEmail: state.signup, resolvePostAuthPath: state.resolve }));
vi.mock("@/lib/auth/browser-continuity", () => ({ ensureBrowserContinuity: state.continuity, clearAuthGestureNonce: state.clearNonce }));
vi.mock("@/lib/auth/auth-journey", async () => ({ ...await vi.importActual<typeof import("@/lib/auth/auth-journey")>("@/lib/auth/auth-journey"), savePendingSignup: state.save, clearPendingSignup: state.clear }));
vi.mock("./ui", () => ({ Button: "button", Field: "field", PasswordField: "password", Notice: "aside", useUnsavedWarning: vi.fn(), useErrorText: () => null, isEmail: (v: string) => v.includes("@"), useAppCopy: () => appCopy("en"), useAction: () => ({ busy: false, run: (fn: () => unknown) => fn() }) }));
vi.mock("./use-verification-cooldown", () => ({ rememberVerificationResend: state.remember }));
import { SignupPage } from "./auth-pages";
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function submit() { state.cursor = 0; const tree = SignupPage(); (nodes(tree).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); }
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.resetAllMocks(); state.slots = []; state.cursor = 0;
  vi.stubGlobal("window", { location: { replace: state.navigate } });
  state.continuity.mockResolvedValue({ ok: true, requestNonce: "synthetic-request-nonce" });
  state.signup.mockResolvedValue({ ok: true, data: { needsVerification: false, email: "signup@example.test" } });
  state.resolve.mockResolvedValue({ ok: true, data: { next: "/setup" } });
});
it("opens a fresh protected document after confirmed signup without competing account or RSC refresh", async () => {
  state.accountRefresh.mockReturnValue(new Promise(() => {}));
  submit(); await settle();
  expect(state.signup).toHaveBeenCalledOnce();
  expect(state.navigate).toHaveBeenCalledWith("/setup");
  expect(state.accountRefresh).not.toHaveBeenCalled();
  expect(state.routerRefresh).not.toHaveBeenCalled();
});
it("preserves verification for unconfirmed signup without navigating into setup", async () => {
  state.signup.mockResolvedValue({ ok: true, data: { needsVerification: true, email: "signup@example.test" } });
  submit(); await settle();
  expect(state.save).toHaveBeenCalledWith("signup@example.test", "");
  expect(state.remember).toHaveBeenCalledWith("signup@example.test");
  expect(state.replace).toHaveBeenCalledWith("/verify-email?email=signup%40example.test");
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.resolve).not.toHaveBeenCalled();
});
it("does not navigate when signup is denied or post-auth access cannot be resolved", async () => {
  state.signup.mockResolvedValue({ ok: false, code: "AUTH_ERROR" });
  submit(); await settle();
  expect(state.navigate).not.toHaveBeenCalled(); expect(state.resolve).not.toHaveBeenCalled();
  state.signup.mockResolvedValue({ ok: true, data: { needsVerification: false, email: "signup@example.test" } });
  state.resolve.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  submit(); await settle();
  expect(state.navigate).not.toHaveBeenCalled(); expect(state.routerRefresh).not.toHaveBeenCalled();
});
