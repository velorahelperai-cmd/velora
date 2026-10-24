import { expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [initial, vi.fn()],
    useCallback: (fn: unknown) => fn,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "ar", state: {}, update: vi.fn() }) }));
const accountMenu = vi.hoisted(() => ({ type: "account-menu-sentinel" }));
vi.mock("./account-chrome", () => ({
  AccountMenu: accountMenu.type,
  useOptionalAccountSession: () => ({ status: "guest" }),
}));
vi.mock("./auth-motion-canvas", () => ({ AuthMotionCanvas: "canvas" }));
vi.mock("@/lib/auth/auth-entry-morph", () => ({
  AUTH_ENTRY_MORPH_MS: 580,
  consumeAuthEntryMorph: () => false,
  markAuthEntryMorph: vi.fn(),
  prefersReducedMotion: () => true,
}));
vi.mock("./ui", () => ({
  Button: "button",
  Field: "field",
  PasswordField: "password",
  Notice: "aside",
  LangSwitch: () => null,
  PreviewBadge: () => null,
  LinkButton: "a",
  useUnsavedWarning: vi.fn(),
  useErrorText: () => null,
  isEmail: (v: string) => v.includes("@"),
  useAppCopy: () => appCopy("ar"),
  useAction: () => ({ busy: false, run: (fn: () => unknown) => fn() }),
}));

import { AuthShell, LoginPage, SignupPage } from "./auth-pages";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

it("uses the approved entry chrome on login and signup without create/login top tabs", () => {
  const login = nodes(LoginPage());
  const signup = nodes(SignupPage());
  expect(login.some((n) => n.type === AuthShell && n.props.entry === true)).toBe(true);
  expect(signup.some((n) => n.type === AuthShell && n.props.entry === true)).toBe(true);
  const rendered = nodes(AuthShell({ entry: true, title: appCopy("ar").auth.loginTitle, children: null }));
  expect(rendered.some((n) => n.props?.["data-auth-entry-card"] === "true")).toBe(true);
  expect(rendered.some((n) => n.props?.["data-auth-entry-shell"] === "true")).toBe(true);
  expect(rendered.some((n) => n.type === "canvas")).toBe(true);
  expect(login.some((n) => n.type === AuthShell && n.props.title === appCopy("ar").auth.loginTitle)).toBe(true);
  expect(signup.some((n) => n.type === AuthShell && n.props.title === appCopy("ar").auth.signupTitle)).toBe(true);
  expect(login.some((n) => n.type === "form" && n.props["data-auth-entry-form"] === "login")).toBe(true);
  expect(signup.some((n) => n.type === "form" && n.props["data-auth-entry-form"] === "signup")).toBe(true);
  expect(login.some((n) => n.type === "button" && n.props.variant === "entry")).toBe(true);
  expect(signup.some((n) => n.type === "button" && n.props.variant === "entry")).toBe(true);
  expect(login.some((n) => n.type === "password" && n.props.tone === "entry")).toBe(true);
  expect(signup.some((n) => n.type === "field" && n.props.tone === "entry")).toBe(true);
  // Demo extras from the HTML reference stay out of product pages.
  expect(login.some((n) => typeof n.props.children === "string" && /OTP|Remember me/i.test(n.props.children))).toBe(false);
  // Entry auth pages keep navbar without public login/signup CTAs (already on those routes).
  expect(rendered.some((n) => n.type === accountMenu.type)).toBe(false);
  expect(JSON.stringify(signup)).not.toMatch(/planInterest|الباقة التي أبديت|Plan you showed interest/i);
});
