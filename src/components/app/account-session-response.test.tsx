import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountProfileView } from "@/lib/tenancy/access";
import type { RecoveryReceipt } from "./operation-recovery";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const state = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  read: vi.fn(),
  broker: vi.fn(),
  peerSignal: null as null | ((signal: unknown) => void),
  publish: vi.fn(),
  logout: vi.fn(),
  quarantine: vi.fn(),
  reload: vi.fn(),
  path: "/",
  refresh: vi.fn(),
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
    useMemo: memo,
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

const router = { refresh: state.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => state.path }));
vi.mock("@/lib/auth/session-context", () => ({
  readLocalQuarantine: () => null,
  publishSessionContext: state.publish,
  publishSessionLogout: state.logout,
  publishSessionQuarantine: state.quarantine,
  subscribeSessionContext: (fn: typeof state.peerSignal) => {
    state.peerSignal = fn;
    return () => {
      state.peerSignal = null;
    };
  },
}));
vi.mock("@/lib/tenancy/actions", () => ({ getAccountProfile: state.read, signOut: vi.fn() }));
vi.mock("@/lib/auth/broker-actions", () => ({
  readBrokerSessionStatus: state.broker,
  quarantineCurrentBrokerSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/demo-state", () => ({ emptyBusiness: {}, useDemo: () => ({ locale: "en" }) }));

import { AccountSessionProvider } from "./account-chrome";

const profile = (userId = "user-a"): AccountProfileView => ({
  userId,
  fullName: "Confirmed name",
  email: "synthetic@example.invalid",
  supportCode: "SYNTHETIC",
  isPlatformAdmin: true,
  role: null,
  companyName: null,
  companyId: null,
  needsCompanyContext: false,
  adminHref: "/admin",
  workspaceHref: null,
  workHref: "/admin",
  platformIdentity: { role: "owner", status: "active", unavailable: false },
});
const initial = profile();

function renderTree() {
  state.cursor = 0;
  const tree = AccountSessionProvider({ initial, children: "private-content" });
  state.effects.splice(0).forEach((fn) => fn());
  return tree;
}
function render() {
  return renderTree().props.value;
}
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}

const memoryStore = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    length: 0,
    store,
  };
};
const throwingStorage = {
  getItem: () => {
    throw new Error("sessionStorage unavailable");
  },
  setItem: () => {
    throw new Error("sessionStorage unavailable");
  },
  removeItem: () => {
    throw new Error("sessionStorage unavailable");
  },
  clear: () => {
    throw new Error("sessionStorage unavailable");
  },
  key: () => null,
  length: 0,
};
const receipt = (boundaryFingerprint = "fp-a"): RecoveryReceipt => ({
  operationKey: "11111111-1111-4111-8111-111111111111",
  userId: "user-a",
  boundaryFingerprint,
  kind: "logout",
});
function lockedReceipt(): RecoveryReceipt | null {
  const main = renderTree().props.children as {
    props?: { children?: unknown };
  };
  const kids = main?.props?.children;
  const list = Array.isArray(kids) ? kids : kids == null ? [] : [kids];
  for (const node of list) {
    if (node && typeof node === "object" && "props" in node) {
      const props = (node as { props: { receipt?: RecoveryReceipt | null } }).props;
      if ("receipt" in props) return props.receipt ?? null;
    }
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.read.mockReset();
  state.broker.mockReset();
  state.slots = [];
  state.effects = [];
  state.peerSignal = null;
  state.path = "/";
  state.broker.mockResolvedValue({
    ok: true,
    userId: "user-a",
    boundaryFingerprint: "fp-a",
    nativeSessionId: "11111111-1111-4111-8111-111111111111",
    contextGeneration: 1,
  });
  vi.stubGlobal("window", {
    location: { reload: state.reload },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    sessionStorage: memoryStore(),
  });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  for (const slot of state.slots) slot.cleanup?.();
  vi.useRealTimers();
});

it("mount shares one in-flight authoritative identity read via broker status", async () => {
  vi.useFakeTimers();
  const pending = deferred();
  state.read.mockReturnValue(pending.promise);
  const frames: Array<() => void> = [];
  vi.stubGlobal("window", {
    location: { reload: state.reload },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    sessionStorage: memoryStore(),
  });
  render();
  frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.broker).toHaveBeenCalledTimes(2);
  expect(state.read).toHaveBeenCalledTimes(1);
  pending.resolve({ ok: true, data: profile() });
  await vi.advanceTimersByTimeAsync(0);
  expect(render().identity?.userId).toBe("user-a");
  expect(render().boundaryFingerprint).toBe("fp-a");
});

it("a late refresh cannot restore platform owner identity after logout", async () => {
  const pending = deferred();
  state.read.mockReturnValue(pending.promise);
  const current = render();
  const request = current.refresh();
  current.clear();
  pending.resolve({ ok: true, data: profile() });
  await request;
  const next = render();
  expect(next.status).toBe("guest");
  expect(next.identity).toBeNull();
  expect(current.isCurrentUser("user-a")).toBe(false);
});

it("lock quarantines immediately and blocks refresh restore", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  const current = render();
  await current.refresh();
  current.lock("fp-a");
  expect(render().status).toBe("locked");
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("locked");
  expect(render().identity).toBeNull();
});

it("peer quarantine of A cannot lock B", async () => {
  state.broker.mockResolvedValue({
    ok: true,
    userId: "user-b",
    boundaryFingerprint: "fp-b",
    nativeSessionId: "22222222-2222-4222-8222-222222222222",
    contextGeneration: 1,
  });
  state.read.mockResolvedValue({ ok: true, data: profile("user-b") });
  await render().refresh();
  state.peerSignal?.({ type: "quarantine", userId: "user-a", boundaryFingerprint: "fp-a" });
  expect(render().identity?.userId).toBe("user-b");
  expect(render().status).toBe("ready");
});

it("peer quarantine of captured boundary locks without unlocking newer generation", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  state.peerSignal?.({ type: "quarantine", userId: "user-a", boundaryFingerprint: "fp-a" });
  expect(render().status).toBe("locked");
  expect(render().identity).toBeNull();
});

it("a verified login after logout publishes again even for the same user", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  render().clear();
  await render().refresh();
  expect(state.publish).toHaveBeenCalledTimes(2);
});

it("peer account changes discard pending identity and protected content before server reload", async () => {
  vi.useFakeTimers();
  state.path = "/app";
  const pending = deferred();
  state.read.mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true, data: profile("user-b") });
  const old = render().refresh();
  state.peerSignal?.({ type: "context", userId: "user-b", companyId: null });
  expect(render().identity).toBeNull();
  expect(renderTree().props.children).not.toBe("private-content");
  expect(state.refresh).toHaveBeenCalled();
  pending.resolve({ ok: true, data: profile() });
  await old;
  expect(render().identity).toBeNull();
  expect(state.reload).toHaveBeenCalledOnce();
});

it("a stale peer logout for A cannot erase B", async () => {
  render().clear();
  state.broker.mockResolvedValue({
    ok: true,
    userId: "user-b",
    boundaryFingerprint: "fp-b",
    nativeSessionId: "22222222-2222-4222-8222-222222222222",
    contextGeneration: 1,
  });
  state.read.mockResolvedValue({ ok: true, data: profile("user-b") });
  await render().refresh();
  state.refresh.mockClear();
  state.read.mockClear();
  state.peerSignal?.({ type: "logout", userId: "user-a" });
  expect(render().identity?.userId).toBe("user-b");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.read).not.toHaveBeenCalled();
});

it("publishes verified server context once per change and preserves public pages", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  await render().refresh();
  expect(state.publish).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue({ ok: true, data: { ...profile(), companyId: "company-b" } });
  await render().refresh();
  expect(state.publish).toHaveBeenLastCalledWith({ userId: "user-a", companyId: "company-b" });
  render().clear();
  expect(renderTree().props.children).toBe("private-content");
});

it("lock hydrates stored recovery receipt for the captured boundary", async () => {
  state.path = "/account";
  const stored = receipt("fp-a");
  window.sessionStorage.setItem(`velora:wp01a:operation:fp-a`, JSON.stringify(stored));
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  render().lock("fp-a");
  expect(render().status).toBe("locked");
  expect(lockedReceipt()).toEqual(stored);
});

it("recoverOperation retains explicit memory receipt when storage unavailable", async () => {
  state.path = "/account";
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: throwingStorage });
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  const memory = receipt("fp-a");
  render().recoverOperation?.(memory);
  expect(render().status).toBe("locked");
  expect(lockedReceipt()).toEqual(memory);
});

it("explicit memory receipt survives repeated same-boundary quarantine when storage throws", async () => {
  state.path = "/account";
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: throwingStorage });
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  const memory = receipt("fp-a");
  render().recoverOperation?.(memory);
  expect(lockedReceipt()).toEqual(memory);
  state.peerSignal?.({ type: "quarantine", userId: "user-a", boundaryFingerprint: "fp-a" });
  expect(render().status).toBe("locked");
  expect(lockedReceipt()).toEqual(memory);
  render().lock("fp-a");
  expect(lockedReceipt()).toEqual(memory);
});

it("recoverOperation rejects a foreign-boundary receipt without locking", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  render().recoverOperation?.(receipt("fp-foreign"));
  expect(render().status).toBe("ready");
  expect(render().identity?.userId).toBe("user-a");
});
