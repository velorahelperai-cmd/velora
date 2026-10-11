import { Children, isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const state = vi.hoisted(() => ({ slots: [] as Slot[], cursor: 0, effects: [] as Array<() => void>, session: { status: "guest", identity: null as null | { userId: string }, refresh: vi.fn() }, signIn: vi.fn(), resolve: vi.fn(), replace: vi.fn(), refresh: vi.fn(), documentReplace: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  const memo = (fn: () => unknown, deps: unknown[]) => { const s = slot(); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) { s.value = fn(); s.deps = deps; } return s.value; };
  return { ...actual,
    useState(initial: unknown) { const s = slot(); if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial; return [s.value, (v: unknown) => { s.value = typeof v === "function" ? (v as (p: unknown) => unknown)(s.value) : v; }]; },
    useRef(initial: unknown) { const s = slot(); return s.value ?? (s.value = { current: initial }); },
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const s = slot(); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) { state.effects.push(() => { s.cleanup?.(); s.cleanup = fn() || undefined; }); s.deps = deps; } },
  };
});
const router = { replace: state.replace, refresh: state.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams("next=%2Faccount") }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en", state: {} }) }));
vi.mock("@/components/app/account-chrome", () => ({ AccountMenu: () => null, useOptionalAccountSession: () => state.session }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword: state.signIn } }) }));
vi.mock("@/lib/tenancy/actions", () => ({ resolvePostAuthPath: state.resolve, completeProfileName: vi.fn(), requestPasswordReset: vi.fn(), resendVerificationEmail: vi.fn(), signUpWithEmail: vi.fn(), updatePassword: vi.fn(), verifyEmailCode: vi.fn() }));
import { LoginPage } from "./auth-pages";
import { Button, Field, PasswordField } from "./ui";

function render() { state.cursor = 0; const tree = LoginPage(); state.effects.splice(0).forEach(fn => fn()); return tree; }
function children(tree: ReactElement): ReactElement<Record<string, unknown>>[] { return Children.toArray((tree.props as { children?: ReactElement[] }).children).filter(isValidElement) as ReactElement<Record<string, unknown>>[]; }
function form() { return children(render()).find(n => n.type === "form")!; }
function controls() { return children(form()); }
function fill() {
  const email = controls().find(n => n.type === Field)!;
  const input = (email.props.children as (p: object) => ReactElement<{ onChange: (e: unknown) => void }> )({});
  input.props.onChange({ target: { value: "synthetic@example.invalid" } });
  const password = controls().find(n => n.type === PasswordField)!;
  (password.props.onChange as (v: string) => void)("synthetic-password");
}
function submit() { (form().props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); render(); }
async function settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); state.slots = []; state.effects = []; state.session.status = "guest"; state.session.identity = null;
  state.signIn.mockResolvedValue({ error: null }); state.resolve.mockResolvedValue({ ok: true, data: { next: "/account" } });
  state.session.refresh.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("window", { location: { replace: state.documentReplace } });
});
afterEach(() => { for (const s of state.slots) s.cleanup?.(); vi.unstubAllGlobals(); });

it("completes native login after the resolver while profile refresh remains pending", async () => {
  fill(); submit(); await settle();
  expect(state.signIn).toHaveBeenCalledWith({ email: "synthetic@example.invalid", password: "synthetic-password" });
  expect(state.resolve).toHaveBeenCalledTimes(1);
  expect(state.documentReplace).toHaveBeenCalledWith("/account");
  expect(state.session.refresh).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
});
it("identity becoming ready during submit cannot create a competing resolver or navigation", async () => {
  const pending = deferred(); state.resolve.mockReturnValue(pending.promise);
  fill(); submit(); await settle();
  state.session.status = "ready"; state.session.identity = { userId: "synthetic-owner" }; render(); await settle();
  expect(state.resolve).toHaveBeenCalledTimes(1);
  pending.resolve({ ok: true, data: { next: "/account" } }); await settle(); render(); await settle();
  expect(state.documentReplace).toHaveBeenCalledTimes(1); expect(state.replace).not.toHaveBeenCalled();
  state.session.identity = { userId: "synthetic-owner" }; render(); await settle(); expect(state.resolve).toHaveBeenCalledTimes(1);
});
it.each(["/account", "/setup", "/app", "/login?reason=session_expired"])("uses the authoritative resolver destination %s", async next => {
  state.resolve.mockResolvedValue({ ok: true, data: { next } }); fill(); submit(); await settle();
  expect(state.documentReplace).toHaveBeenCalledWith(next);
});
it("keeps submission locked while the successful document navigation is pending", async () => {
  fill(); submit(); await settle(); const buttons = controls().filter(n => n.type === Button);
  expect(buttons[0].props.busy).toBe(true); submit(); await settle(); expect(state.signIn).toHaveBeenCalledTimes(1);
});
it("existing authenticated login uses one document navigation and ignores repeated profile objects", async () => {
  state.session.status = "ready"; state.session.identity = { userId: "synthetic-manager" }; render(); await settle(); render();
  expect(state.documentReplace).toHaveBeenCalledTimes(1); expect(state.resolve).toHaveBeenCalledTimes(1);
  state.session.identity = { userId: "synthetic-manager" }; render(); await settle(); expect(state.resolve).toHaveBeenCalledTimes(1); expect(state.replace).not.toHaveBeenCalled();
});
it("a stale identity-effect resolver is cancelled when a login submission takes ownership", async () => {
  const old = deferred(), current = deferred(); state.resolve.mockReturnValueOnce(old.promise).mockReturnValue(current.promise);
  state.session.status = "ready"; state.session.identity = { userId: "old-user" }; fill(); submit(); await settle();
  old.resolve({ ok: true, data: { next: "/admin" } }); await settle(); expect(state.documentReplace).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
  current.resolve({ ok: true, data: { next: "/account" } }); await settle(); expect(state.documentReplace).toHaveBeenCalledWith("/account");
});
it("failed native authentication does not resolve a destination or navigate", async () => {
  state.signIn.mockResolvedValue({ error: { message: "Synthetic denial" } }); fill(); submit(); await settle();
  expect(state.resolve).not.toHaveBeenCalled(); expect(state.documentReplace).not.toHaveBeenCalled(); expect(state.session.refresh).not.toHaveBeenCalled();
});
it("a failed resolver preserves the form and permits a retry", async () => {
  state.resolve.mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" }); fill(); submit(); await settle();
  expect(state.documentReplace).not.toHaveBeenCalled(); expect(controls().find(n => n.type === PasswordField)!.props.value).toBe("synthetic-password");
  submit(); await settle(); expect(state.documentReplace).toHaveBeenCalledWith("/account");
});
