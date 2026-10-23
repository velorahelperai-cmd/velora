import { Children, isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const REQUEST_NONCE = "synthetic-request-nonce";
const state = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  session: {
    status: "guest",
    identity: null as null | { userId: string },
    refresh: vi.fn(),
    isCurrentUser: (id: string) => state.session.identity?.userId === id,
  },
  signIn: vi.fn(),
  profile: vi.fn(),
  resolve: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  documentReplace: vi.fn(),
  ensureContinuity: vi.fn(),
  clearNonce: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const s = slot();
    if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
      s.value = fn();
      s.deps = deps;
    }
    return s.value;
  };
  return {
    ...actual,
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (v: unknown) => {
          s.value = typeof v === "function" ? (v as (p: unknown) => unknown)(s.value) : v;
        },
      ];
    },
    useRef(initial: unknown) {
      const s = slot();
      return s.value ?? (s.value = { current: initial });
    },
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const s = slot();
      if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
        state.effects.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
        s.deps = deps;
      }
    },
  };
});

const router = { replace: state.replace, refresh: state.refresh };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("next=%2Faccount"),
}));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en", state: {} }) }));
vi.mock("@/components/app/account-chrome", () => ({
  AccountMenu: () => null,
  useOptionalAccountSession: () => state.session,
}));
vi.mock("@/lib/tenancy/actions", () => ({
  signInWithEmail: state.signIn,
  getAccountProfile: state.profile,
  resolvePostAuthPath: state.resolve,
  completeProfileName: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendVerificationEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
vi.mock("@/lib/auth/broker-actions", () => ({
  readBrokerSessionStatus: vi.fn(async () => ({ ok: false, code: "UNAUTHENTICATED" })),
}));
vi.mock("@/lib/auth/browser-continuity", () => ({
  ensureBrowserContinuity: state.ensureContinuity,
  clearAuthGestureNonce: state.clearNonce,
}));

import { LoginPage, CompleteProfilePage } from "./auth-pages";
import { Button, Field, PasswordField } from "./ui";

function render() {
  state.cursor = 0;
  const tree = LoginPage();
  state.effects.splice(0).forEach((fn) => fn());
  return tree;
}
function children(tree: ReactElement): ReactElement<Record<string, unknown>>[] {
  return Children.toArray((tree.props as { children?: ReactElement[] }).children).filter(
    isValidElement,
  ) as ReactElement<Record<string, unknown>>[];
}
function form() {
  return children(render()).find((n) => n.type === "form")!;
}
function controls() {
  return children(form());
}
function fieldInput(field: ReactElement<Record<string, unknown>>) {
  const rendered = (
    field.props.children as (p: object) => ReactElement<Record<string, unknown>>
  )({});
  if (rendered.type === "input") return rendered as ReactElement<{ onChange: (e: unknown) => void }>;
  const nested = Children.toArray(rendered.props.children as React.ReactNode).find(
    (child) => isValidElement(child) && child.type === "input",
  ) as ReactElement<{ onChange: (e: unknown) => void }> | undefined;
  if (!nested) throw new Error("entry field input missing");
  return nested;
}
function fill() {
  const email = controls().find((n) => n.type === Field)!;
  fieldInput(email).props.onChange({ target: { value: "synthetic@example.invalid" } });
  const password = controls().find((n) => n.type === PasswordField)!;
  (password.props.onChange as (v: string) => void)("synthetic-password");
}
function submit() {
  (form().props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  render();
}
async function settle() {
  await vi.dynamicImportSettled();
  for (let n = 0; n < 12; n++) await Promise.resolve();
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.slots = [];
  state.effects = [];
  state.session.status = "guest";
  state.session.identity = null;
  state.ensureContinuity.mockResolvedValue({
    ok: true,
    protocolVersion: 1,
    requestNonce: REQUEST_NONCE,
  });
  state.signIn.mockResolvedValue({ ok: true, data: { next: "/account" } });
  state.resolve.mockResolvedValue({ ok: true, data: { next: "/account" } });
  state.profile.mockResolvedValue({
    ok: true,
    data: { userId: "user-b", fullName: "Saved B", email: "b@example.invalid" },
  });
  state.session.refresh.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("window", {
    location: { replace: state.documentReplace },
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
  });
});
afterEach(() => {
  for (const s of state.slots) s.cleanup?.();
  vi.unstubAllGlobals();
});

it("a late profile prefill cannot place the previous account's name in the new account form", async () => {
  const old = deferred();
  state.profile.mockReturnValueOnce(old.promise).mockResolvedValue({
    ok: true,
    data: { userId: "user-b", fullName: "Saved B", email: "b@example.invalid" },
  });
  const profile = () => {
    state.cursor = 0;
    const tree = CompleteProfilePage();
    state.effects.splice(0).forEach((fn) => fn());
    return tree;
  };
  state.session.status = "ready";
  state.session.identity = { userId: "user-a" };
  profile();
  await settle();
  state.session.identity = { userId: "user-b" };
  profile();
  profile();
  await settle();
  old.resolve({
    ok: true,
    data: { userId: "user-a", fullName: "Private A", email: "a@example.invalid" },
  });
  await settle();
  const field = children(children(profile()).find((n) => n.type === "form")!).find(
    (n) => n.type === Field,
  )!;
  const input = (field.props.children as (p: object) => ReactElement<{ value: string }>)({});
  expect(input.props.value).toBe("Saved B");
});

it("completes broker login with server-returned destination while profile refresh remains pending", async () => {
  fill();
  submit();
  await settle();
  expect(state.ensureContinuity).toHaveBeenCalledWith("login");
  expect(state.signIn).toHaveBeenCalledWith({
    email: "synthetic@example.invalid",
    password: "synthetic-password",
    next: "/account",
    requestNonce: REQUEST_NONCE,
  });
  expect(state.clearNonce).toHaveBeenCalledWith(REQUEST_NONCE);
  expect(state.documentReplace).toHaveBeenCalledWith("/account");
  expect(state.session.refresh).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});

it.each(["/account", "/setup", "/app", "/login?reason=session_expired"])("uses the authoritative broker destination %s", async (next) => {
    state.signIn.mockResolvedValueOnce({ ok: true, data: { next } });
    fill();
    submit();
    await settle();
    expect(state.documentReplace).toHaveBeenCalledWith(next);
    state.documentReplace.mockClear();
    state.signIn.mockClear();
    state.ensureContinuity.mockClear();
});

it("keeps submission locked while the successful document navigation is pending", async () => {
  fill();
  submit();
  await settle();
  const buttons = controls().filter((n) => n.type === Button);
  expect(buttons[0].props.busy).toBe(true);
  submit();
  await settle();
  expect(state.signIn).toHaveBeenCalledTimes(1);
});

it("failed broker authentication does not resolve a destination or navigate", async () => {
  state.signIn.mockResolvedValue({ ok: false, code: "AUTH_ERROR" });
  fill();
  submit();
  await settle();
  expect(state.signIn).toHaveBeenCalledWith(
    expect.objectContaining({ requestNonce: REQUEST_NONCE }),
  );
  expect(state.clearNonce).toHaveBeenCalledWith(REQUEST_NONCE);
  expect(state.documentReplace).not.toHaveBeenCalled();
  expect(state.session.refresh).not.toHaveBeenCalled();
});

it("a failed login preserves the form and permits a retry", async () => {
  state.signIn
    .mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" })
    .mockResolvedValueOnce({ ok: true, data: { next: "/account" } });
  fill();
  submit();
  await settle();
  expect(state.documentReplace).not.toHaveBeenCalled();
  expect(state.clearNonce).not.toHaveBeenCalled();
  expect(controls().find((n) => n.type === PasswordField)!.props.value).toBe("synthetic-password");
  submit();
  await settle();
  expect(state.documentReplace).toHaveBeenCalledWith("/account");
  expect(state.signIn).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestNonce: REQUEST_NONCE }),
  );
});

it("missing browser continuity nonce cannot call signIn or navigate", async () => {
  state.ensureContinuity.mockResolvedValue({ ok: false, code: "CONTINUITY_UNAVAILABLE" });
  fill();
  submit();
  await settle();
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.clearNonce).not.toHaveBeenCalled();
  expect(state.documentReplace).not.toHaveBeenCalled();
  expect(state.resolve).not.toHaveBeenCalled();
});
