import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const f = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  liveUser: "user-a" as string | null,
  liveBoundary: "fp-a" as string | null,
  status: "ready",
  locale: "en" as "en" | "ar",
  logout: vi.fn(),
  publishLogout: vi.fn(),
  publishQuarantine: vi.fn(),
  clear: vi.fn(),
  lock: vi.fn((fp?: string | null) => {
    f.liveBoundary = fp ?? f.liveBoundary;
  }),
  update: vi.fn(),
  drafts: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => f.slots[f.cursor++] ?? (f.slots[f.cursor - 1] = {});
  return {
    ...actual,
    useId: () => "menu",
    useContext: () => ({
      status: f.status,
      identity: f.liveUser ? { userId: f.liveUser, fullName: f.liveUser === "user-a" ? "Synthetic" : "Second account", email: "synthetic@example.invalid" } : null,
      refresh: f.refresh,
      boundaryFingerprint: f.liveBoundary,
      clear: f.clear,
      lock: f.lock,
      isCurrentUser: (id: string) => f.liveUser === id,
      isCapturedBoundary: (fp: string | null | undefined) =>
        Boolean(fp) && f.liveBoundary === fp,
    }),
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = initial;
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
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const s = slot();
      if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
        f.effects.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
        s.deps = deps;
      }
    },
  };
});

const router = { replace: f.replace, refresh: f.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/tenancy/actions", () => ({ signOut: f.logout, getAccountProfile: vi.fn() }));
vi.mock("@/lib/company-draft", () => ({ clearCompanyDrafts: f.drafts }));
vi.mock("@/lib/auth/session-context", () => ({
  publishSessionLogout: f.publishLogout,
  publishSessionQuarantine: f.publishQuarantine,
  publishSessionContext: vi.fn(),
  subscribeSessionContext: vi.fn(),
}));
vi.mock("@/lib/demo-state", () => ({ emptyBusiness: {}, useDemo: () => ({ locale: "en", update: f.update }) }));
vi.mock("./ui", () => ({ useAppCopy: () => appCopy(f.locale), LangSwitch: () => null }));
vi.mock("@/lib/logging/browser.mjs", () => ({
  recordLogoutTransportFailed: vi.fn(),
  recordSessionCheckUnavailable: vi.fn(),
}));

import { AccountMenu } from "./account-chrome";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== "object" || !("props" in v)) return [];
  const n = v as Node;
  return [n, ...nodes(n.props.children)];
}
function texts(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (!v || typeof v !== "object" || !("props" in v)) return [];
  return texts((v as Node).props.children);
}
function render() {
  f.cursor = 0;
  const tree = AccountMenu({});
  f.effects.splice(0).forEach((fn) => fn());
  return tree;
}
function logout() {
  const closed = render();
  (nodes(closed).find((n) => n.props["aria-haspopup"] === "menu")!.props.onClick as () => void)();
  const tree = render();
  (nodes(tree).find((n) => n.type === "button" && n.props.role === "menuitem")!.props.onClick as () => void)();
}
async function settle() {
  for (let n = 0; n < 15; n++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  f.slots = [];
  f.effects = [];
  f.liveUser = "user-a";
  f.liveBoundary = "fp-a";
  f.status = "ready";
  f.locale = "en";
  f.logout.mockResolvedValue({ ok: true, data: { status: "confirmed" } });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("window", { location: { assign: f.assign } });
});
afterEach(() => {
  for (const s of f.slots) s.cleanup?.();
});

it.each(["en", "ar"] as const)("keeps pending header quiet and exposes only the resolved account state (%s)", (locale) => {
  f.locale = locale;
  f.status = "loading";
  let tree = render();
  expect(tree.props["data-account-chrome"]).toBe("public");
  expect(tree.props.className).toContain("min-w-[12.5rem]");
  expect(nodes(tree).some(n => n.props.href === "/login")).toBe(true);
  expect(nodes(tree).some(n => n.props.href === "/signup")).toBe(true);
  expect(texts(tree)).not.toContain(appCopy(locale).account.identityError);
  f.status = "ready";
  tree = render();
  expect(texts(tree).some((t) => t.includes("Synthetic"))).toBe(true);
  expect(nodes(tree).some(n => n.props["aria-haspopup"] === "menu")).toBe(true);
  // Unverified identity must never flash while a new boundary is being checked.
  f.status = "loading";
  tree = render();
  expect(texts(tree).some((t) => t.includes("Synthetic"))).toBe(false);
  expect(nodes(tree).some(n => n.props.href === "/login")).toBe(true);
  f.liveUser = "user-b";
  f.status = "ready";
  tree = render();
  expect(texts(tree).some((t) => t.includes("Second account"))).toBe(true);
  expect(texts(tree).some((t) => t === "Synthetic")).toBe(false);
  f.status = "loading";
  render();
  f.liveUser = null;
  f.status = "guest";
  tree = render();
  expect(nodes(tree).some(n => n.props.href === "/login")).toBe(true);
  expect(nodes(tree).some(n => n.props.href === "/signup")).toBe(true);
  f.status = "loading";
  render();
  f.status = "error";
  tree = render();
  // Navbar never surfaces technical identity-fetch copy; keep public CTAs while provider retries.
  expect(texts(tree)).not.toContain(appCopy(locale).account.identityError);
  expect(nodes(tree).some(n => n.props.href === "/login")).toBe(true);
  expect(nodes(tree).some(n => n.props.href === "/signup")).toBe(true);
  expect(f.logout).not.toHaveBeenCalled();
});

it("logout locks immediately then confirms server revoke for the captured user", async () => {
  logout();
  await settle();
  expect(f.lock).toHaveBeenCalledWith("fp-a");
  expect(f.publishQuarantine).toHaveBeenCalledWith("user-a", "fp-a");
  expect(f.drafts).toHaveBeenCalledWith("user-a");
  expect(f.logout).toHaveBeenCalledWith("user-a", "fp-a", expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(f.clear).toHaveBeenCalledOnce();
  expect(f.publishLogout).toHaveBeenCalledWith("user-a", "fp-a");
  expect(f.assign).toHaveBeenCalledWith("/login");
});

it("logout completion cannot erase or navigate a newer boundary", async () => {
  let resolve!: (v: unknown) => void;
  f.logout.mockReturnValue(
    new Promise((ok) => {
      resolve = ok;
    }),
  );
  logout();
  await settle();
  f.liveBoundary = "fp-b";
  resolve({ ok: true, data: { status: "confirmed" } });
  await settle();
  expect(f.clear).not.toHaveBeenCalled();
  expect(f.publishLogout).not.toHaveBeenCalled();
  expect(f.assign).not.toHaveBeenCalled();
});

it("failed server logout keeps local quarantine without claiming confirmed logout", async () => {
  f.logout.mockResolvedValue({
    ok: false,
    code: "UNAVAILABLE",
    message: "LOGOUT_REVOCATION_PENDING",
  });
  logout();
  await settle();
  expect(f.lock).toHaveBeenCalled();
  expect(f.drafts).toHaveBeenCalledWith("user-a");
  expect(f.clear).not.toHaveBeenCalled();
  expect(f.publishLogout).not.toHaveBeenCalled();
  expect(f.assign).not.toHaveBeenCalled();
  expect(nodes(render()).some((n) => n.props.children === "LOGOUT_REVOCATION_PENDING")).toBe(true);
});

it("a rejected logout transport keeps quarantine and shows retryable failure", async () => {
  f.logout.mockRejectedValueOnce(new Error("synthetic transport failure"));
  logout();
  await settle();
  expect(f.lock).toHaveBeenCalled();
  expect(f.drafts).toHaveBeenCalledWith("user-a");
  expect(f.clear).not.toHaveBeenCalled();
  expect(f.publishLogout).not.toHaveBeenCalled();
  expect(f.assign).not.toHaveBeenCalled();
  expect(nodes(render()).some((n) => n.props.children === appCopy("en").auth.logoutFailed)).toBe(true);
});

it("coalesces repeated logout clicks before a React render", async () => {
  let resolve!: (v: unknown) => void;
  f.logout.mockReturnValue(
    new Promise((ok) => {
      resolve = ok;
    }),
  );
  const closed = render();
  (nodes(closed).find((n) => n.props["aria-haspopup"] === "menu")!.props.onClick as () => void)();
  const button = nodes(render()).find((n) => n.type === "button" && n.props.role === "menuitem")!;
  (button.props.onClick as () => void)();
  (button.props.onClick as () => void)();
  expect(f.logout).toHaveBeenCalledTimes(1);
  resolve({ ok: true, data: { status: "confirmed" } });
  await settle();
});
