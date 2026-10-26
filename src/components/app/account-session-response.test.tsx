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
  locale: "en" as "en" | "ar",
  refresh: vi.fn(),
  localQuarantine: null as null | {type:'quarantine';userId:string;boundaryFingerprint:string},
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
  readLocalQuarantine: () => state.localQuarantine,
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
vi.mock("@/lib/demo-state", () => ({ emptyBusiness: {}, useDemo: () => ({ locale: state.locale }) }));

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
  state.localQuarantine = null;
  state.path = "/";
  state.locale = "en";
  state.broker.mockResolvedValue({
    ok: true,
    userId: "user-a",
    boundaryFingerprint: "fp-a",
    nativeSessionId: "11111111-1111-4111-8111-111111111111",
    contextGeneration: 1,
    generation: "gen-a-1",
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

const brokerOk = (
  userId = "user-a",
  boundaryFingerprint = "fp-a",
  generation = "gen-a-1",
) => ({
  ok: true as const,
  userId,
  boundaryFingerprint,
  nativeSessionId:
    userId === "user-b"
      ? "22222222-2222-4222-8222-222222222222"
      : "11111111-1111-4111-8111-111111111111",
  contextGeneration: 1,
  generation,
});

it("mounts a genuinely unauthenticated visitor as guest without reading a private profile", async () => {
  vi.useFakeTimers();
  state.path = "/login";
  state.broker.mockResolvedValue({ok:false,code:"UNAUTHENTICATED"});
  const frames: Array<() => void> = [];
  window.requestAnimationFrame = (fn: FrameRequestCallback) => {frames.push(() => fn(0));return 1;};
  render(); frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  const result = render();
  expect(result.status).toBe("guest");
  expect(result.identity).toBeNull();
  expect(result.hasCurrentUser()).toBe(false);
  expect(state.read).not.toHaveBeenCalled();
  expect(state.broker).toHaveBeenCalledTimes(1);
  expect(state.publish).not.toHaveBeenCalled();
});

it.each(["UNAVAILABLE","QUARANTINED"])("mount does not downgrade broker %s to a guest success", async code => {
  vi.useFakeTimers();
  state.broker.mockResolvedValue({ok:false,code});
  const frames: Array<() => void> = [];
  window.requestAnimationFrame = (fn: FrameRequestCallback) => {frames.push(() => fn(0));return 1;};
  render(); frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  expect(render().status).toBe("error");
  expect(render().identity).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it("mount preserves a captured quarantine when the native session has gone", async () => {
  vi.useFakeTimers();
  state.localQuarantine={type:'quarantine',userId:'user-a',boundaryFingerprint:'fp-a'};
  state.broker.mockResolvedValue({ok:false,code:"UNAUTHENTICATED"});
  const frames: Array<() => void> = [];
  window.requestAnimationFrame = (fn: FrameRequestCallback) => {frames.push(() => fn(0));return 1;};
  render(); frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  expect(render().status).toBe("locked");
  expect(render().identity).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it.each(["en", "ar"] as const)("delegates protected pending identity to the approved loader (%s)", async locale => {
  state.locale = locale;
  state.path = "/setup";
  const pending = deferred();
  state.read.mockReturnValue(pending.promise);
  const first = renderTree();
  const loader = first.props.children;
  expect(typeof loader.type).toBe("function");
  expect(loader.type.name).toBe("ApprovedAccountLoader");
  expect(loader.props.label).toBeTruthy();
  expect(JSON.stringify(loader)).not.toContain("motion-safe:animate-spin");
  expect(JSON.stringify(loader)).not.toContain("private-content");
  const refresh = first.props.value.refresh();
  pending.resolve({ ok: true, data: profile() });
  await refresh;
  const finishing=renderTree();
  expect(finishing.props.value.status).toBe("ready");
  expect(finishing.props.children.type.name).toBe("ApprovedAccountLoader");
  expect(finishing.props.children.props.ready).toBe(true);
  finishing.props.children.props.onComplete();
  expect(renderTree().props.children).toBe("private-content");
});

it("keeps account errors and recovery controls visible after branded loading", async () => {
  state.path = "/setup";
  state.broker.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  await render().refresh();
  const main = renderTree().props.children;
  expect(main.props["data-account-loading"]).toBeUndefined();
  expect(main.props.className).toContain("bg-[#f6fafb]");
  expect(JSON.stringify(main)).not.toContain("private-content");
  const children = main.props.children as Array<{ type?: unknown; props?: { onClick?: unknown } }>;
  expect(children.some(child => child?.type === "button" && typeof child.props?.onClick === "function")).toBe(true);
});

it("retains an already-ready setup session across later transient UNAVAILABLE reattest", async () => {
  vi.useFakeTimers();
  state.path = "/setup";
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("ready");
  const finishing = renderTree();
  expect(finishing.props.children.props.ready).toBe(true);
  finishing.props.children.props.onComplete();
  expect(renderTree().props.children).toBe("private-content");

  state.broker.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  await render().refresh();
  expect(render().status).toBe("ready");
  expect(render().identity?.userId).toBe("user-a");
  expect(renderTree().props.children).toBe("private-content");

  // Soft retry recovers without wiping the page.
  state.broker.mockResolvedValue(brokerOk());
  await vi.advanceTimersByTimeAsync(2500);
  await Promise.resolve();
  expect(render().status).toBe("ready");
  expect(renderTree().props.children).toBe("private-content");
});

it("retains ready across a later TRANSPORT throw during reattest", async () => {
  state.path = "/setup";
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("ready");
  renderTree().props.children.props.onComplete();
  expect(renderTree().props.children).toBe("private-content");
  state.broker.mockRejectedValue(new Error("network"));
  await render().refresh();
  expect(render().status).toBe("ready");
  expect(render().identity?.userId).toBe("user-a");
  expect(renderTree().props.children).toBe("private-content");
});

it("still fails closed on tip mismatch after ready", async () => {
  state.path = "/setup";
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("ready");
  renderTree().props.children.props.onComplete();
  expect(renderTree().props.children).toBe("private-content");
  state.broker
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-1"))
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-2"));
  await render().refresh();
  expect(render().status).toBe("error");
  expect(renderTree().props.children).not.toBe("private-content");
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
  // Mount broker seed reused for pre-profile; profile still pending — no second pre-read.
  expect(state.broker).toHaveBeenCalledTimes(1);
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(render().status).not.toBe("ready");
  pending.resolve({ ok: true, data: profile() });
  await vi.advanceTimersByTimeAsync(0);
  // Fresh post-profile broker reattest retained.
  expect(state.broker).toHaveBeenCalledTimes(2);
  expect(render().identity?.userId).toBe("user-a");
  expect(render().boundaryFingerprint).toBe("fp-a");
  expect(render().status).toBe("ready");
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

it("standalone refresh always performs a fresh pre-profile broker read", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  state.broker.mockClear();
  state.read.mockClear();
  state.broker.mockResolvedValue(brokerOk("user-a", "fp-a", "gen-a-2"));
  await render().refresh();
  // Fresh pre-read + fresh post-profile reattest (no mount seed).
  expect(state.broker).toHaveBeenCalledTimes(2);
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(render().status).toBe("ready");
});

it("clear while mount broker pending does not ready from late seed", async () => {
  vi.useFakeTimers();
  const pendingBroker = deferred();
  state.broker.mockReturnValue(pendingBroker.promise);
  state.read.mockResolvedValue({ ok: true, data: profile() });
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
  const session = render();
  frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  session.clear();
  expect(render().status).toBe("guest");
  pendingBroker.resolve(brokerOk());
  await vi.advanceTimersByTimeAsync(0);
  expect(render().status).toBe("guest");
  expect(render().identity).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it("lock while mount broker pending keeps locked and drops late seed", async () => {
  vi.useFakeTimers();
  const pendingBroker = deferred();
  state.broker.mockReturnValue(pendingBroker.promise);
  state.read.mockResolvedValue({ ok: true, data: profile() });
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
  const session = render();
  frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  session.lock("fp-a");
  expect(render().status).toBe("locked");
  pendingBroker.resolve(brokerOk());
  await vi.advanceTimersByTimeAsync(0);
  expect(render().status).toBe("locked");
  expect(render().identity).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it("expire while profile await pending does not restore ready from late profile", async () => {
  const pendingProfile = deferred();
  const profileEntered = deferred();
  state.read.mockImplementationOnce(() => {
    profileEntered.resolve(true);
    return pendingProfile.promise;
  });
  const session = render();
  const request = session.refresh();
  await profileEntered.promise;
  expect(state.read).toHaveBeenCalledTimes(1);
  session.expire();
  expect(render().status).toBe("expired");
  pendingProfile.resolve({ ok: true, data: profile() });
  await request;
  expect(render().status).toBe("expired");
  expect(render().identity).toBeNull();
});

it("peer B during profile await discards A and reloads without unlocking B", async () => {
  vi.useFakeTimers();
  state.path = "/app";
  const pending = deferred();
  const profileEntered = deferred();
  state.read.mockImplementationOnce(() => {
    profileEntered.resolve(true);
    return pending.promise;
  });
  const old = render().refresh();
  await profileEntered.promise;
  expect(state.read).toHaveBeenCalledTimes(1);
  state.peerSignal?.({ type: "context", userId: "user-b", companyId: null });
  expect(render().identity).toBeNull();
  expect(render().status).toBe("loading");
  pending.resolve({ ok: true, data: profile("user-a") });
  await old;
  expect(render().identity).toBeNull();
  expect(state.reload).toHaveBeenCalled();
});

it("same-user new tip during pre-profile read reloads instead of ready", async () => {
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().boundaryFingerprint).toBe("fp-a");
  state.broker
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a-next", "gen-a-9"))
    .mockResolvedValue(brokerOk("user-a", "fp-a-next", "gen-a-9"));
  state.read.mockResolvedValue({ ok: true, data: profile() });
  state.reload.mockClear();
  await render().refresh();
  // Unchanged tip-mismatch branch: reload + loading; identity retention is baseline behavior.
  expect(state.reload).toHaveBeenCalled();
  expect(render().status).toBe("loading");
  expect(render().status).not.toBe("ready");
});

it("profile owner mismatch against post-profile broker rejects ready", async () => {
  state.broker
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-1"))
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-1"));
  state.read.mockResolvedValue({ ok: true, data: profile("user-b") });
  await render().refresh();
  expect(render().status).toBe("error");
  expect(render().identity).toBeNull();
});

it("final post-profile broker throw leaves error not ready", async () => {
  state.broker
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-1"))
    .mockRejectedValueOnce(new Error("broker unavailable"));
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("error");
  expect(render().identity).toBeNull();
});

it("post-profile generation change or session revocation rejects stale profile and never grants ready", async () => {
  // 1. Generation changes between pre-profile broker read (gen-a-1) and post-profile reattest (gen-a-2)
  state.broker
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-1"))
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-2"));
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("error");
  expect(render().identity).toBeNull();
  expect(render().hasCurrentUser()).toBe(false);

  // 2. Session revoked (UNAUTHENTICATED) between pre-profile broker read and post-profile reattest
  state.broker
    .mockResolvedValueOnce(brokerOk("user-a", "fp-a", "gen-a-2"))
    .mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED" });
  state.read.mockResolvedValue({ ok: true, data: profile() });
  await render().refresh();
  expect(render().status).toBe("error");
  expect(render().identity).toBeNull();
  expect(render().hasCurrentUser()).toBe(false);
});

it("same-operation focus join reuses in-flight bootstrap without a new pre-read", async () => {
  vi.useFakeTimers();
  const pending = deferred();
  state.read.mockReturnValue(pending.promise);
  const frames: Array<() => void> = [];
  const listeners = new Map<string, Array<() => void>>();
  vi.stubGlobal("window", {
    location: { reload: state.reload },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
    addEventListener: (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: vi.fn(),
    sessionStorage: memoryStore(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: vi.fn(),
  });
  render();
  frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.broker).toHaveBeenCalledTimes(1);
  expect(state.read).toHaveBeenCalledTimes(1);
  for (const fn of listeners.get("focus") ?? []) fn();
  await vi.advanceTimersByTimeAsync(0);
  // Same epoch join — no additional pre-profile broker read.
  expect(state.broker).toHaveBeenCalledTimes(1);
  expect(state.read).toHaveBeenCalledTimes(1);
  pending.resolve({ ok: true, data: profile() });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.broker).toHaveBeenCalledTimes(2);
  expect(render().status).toBe("ready");
});

it("stale finally cannot clear a newer in-flight refresh", async () => {
  vi.useFakeTimers();
  const firstProfile = deferred();
  const secondProfile = deferred();
  state.read.mockReturnValueOnce(firstProfile.promise);
  const frames: Array<() => void> = [];
  const listeners = new Map<string, Array<() => void>>();
  vi.stubGlobal("window", {
    location: { reload: state.reload },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
    addEventListener: (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: vi.fn(),
    sessionStorage: memoryStore(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: (type: string, fn: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: vi.fn(),
  });
  // Mount bootstrap enters profile await (signalRead owns the operation).
  render();
  frames[0]!();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.read).toHaveBeenCalledTimes(1);
  render().clear();
  expect(render().status).toBe("guest");
  // Newer standalone refresh after invalidation.
  state.read.mockReturnValueOnce(secondProfile.promise);
  state.broker.mockResolvedValue(brokerOk("user-a", "fp-a", "gen-a-2"));
  const second = render().refresh();
  firstProfile.resolve({ ok: true, data: profile() });
  await vi.advanceTimersByTimeAsync(0);
  expect(render().status).not.toBe("ready");
  expect(render().identity).toBeNull();
  secondProfile.resolve({ ok: true, data: profile() });
  await second;
  expect(render().status).toBe("ready");
  expect(render().identity?.userId).toBe("user-a");
});

it('links every authoritative session read to the requesting auth operation',async()=>{
 const packet={request_id:'VEL-0123456789ABCDEF',trace_id:'1234567890abcdef1234567890abcdef',parent_span_id:'1234567890abcdef'};state.read.mockResolvedValue({ok:true,data:profile()});const value=render();await value.refresh(packet);
 const child=state.read.mock.calls.at(-1)?.[0];expect(child).toMatchObject({request_id:packet.request_id,trace_id:packet.trace_id});expect(child.parent_span_id).not.toBe(packet.parent_span_id);expect(state.broker.mock.calls.slice(-2).every(args=>args[0]?.request_id===packet.request_id&&args[0]?.trace_id===packet.trace_id)).toBe(true);
});

it('correlates session-check timeout as UNKNOWN without logging the thrown payload',async()=>{
 const packet={request_id:'VEL-ABCDEFABCDEFABCD',trace_id:'abcdefabcdefabcdefabcdefabcdefab',parent_span_id:'abcdefabcdefabcd'};const info=vi.spyOn(console,'info').mockImplementation(()=>{});state.broker.mockRejectedValue(Error('private broker transport payload'));
 try{const value=render();await value.refresh(packet);const rows=info.mock.calls.map(([row])=>JSON.parse(String(row)));expect(rows.some(row=>row.request_id===packet.request_id&&row.code==='OUTCOME_UNKNOWN')).toBe(true);expect(JSON.stringify(rows)).not.toContain('private broker transport payload');expect(state.read).not.toHaveBeenCalled();}finally{info.mockRestore();}
});

it('traces direct session refresh through profile completion and final reattestation',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 state.read.mockResolvedValue({ok:true,data:profile()});
 try{
  await render().refresh();
  const rows=info.mock.calls.map(([row])=>JSON.parse(String(row))).filter(row=>row.operation==='auth_session_check');
  expect(rows.some(row=>row.stage==='profile'&&row.code==='OK')).toBe(true);
  expect(rows.some(row=>row.stage==='refresh'&&row.code==='STARTED')).toBe(true);
  expect(rows.at(-1)).toMatchObject({stage:'completed',code:'OK'});
  expect(rows.at(-1).request_id).toMatch(/^VEL-[A-F0-9]{16}$/);
  expect(JSON.stringify(rows)).not.toContain('synthetic@example.invalid');
 }finally{info.mockRestore();}
});

it.each(['broker','profile','reattest'])('bounds a stalled %s read and ignores its late result',async stage=>{
 vi.useFakeTimers();const late=deferred();
 state.broker.mockResolvedValue(brokerOk());state.read.mockResolvedValue({ok:true,data:profile()});
 if(stage==='broker')state.broker.mockReturnValueOnce(late.promise);
 if(stage==='profile')state.read.mockReturnValueOnce(late.promise);
 if(stage==='reattest')state.broker.mockResolvedValueOnce(brokerOk()).mockReturnValueOnce(late.promise);
 const pending=render().refresh();await vi.advanceTimersByTimeAsync(30000);await pending;
 expect(render().status).toBe('error');expect(render().hasCurrentUser()).toBe(false);
 const reads=state.read.mock.calls.length,brokers=state.broker.mock.calls.length;
 await vi.advanceTimersByTimeAsync(60000);
 expect(state.read).toHaveBeenCalledTimes(reads);expect(state.broker).toHaveBeenCalledTimes(brokers);
 await render().refresh();expect(render().status).toBe('ready');
 late.resolve(stage==='profile'?{ok:true,data:profile('user-b')}:brokerOk('user-b','fp-b','gen-b'));
 await vi.advanceTimersByTimeAsync(0);expect(render().identity?.userId).toBe('user-a');
});

it('bounds the initial mount broker read and removes its timer on unmount',async()=>{
 vi.useFakeTimers();state.broker.mockReturnValue(new Promise(()=>{}));
 const frames:Array<()=>void>=[];window.requestAnimationFrame=(fn:FrameRequestCallback)=>{frames.push(()=>fn(0));return 1;};
 render();frames[0]!();await vi.advanceTimersByTimeAsync(0);
 for(const slot of state.slots)slot.cleanup?.();
 await vi.advanceTimersByTimeAsync(0);expect(vi.getTimerCount()).toBe(0);expect(state.read).not.toHaveBeenCalled();
});

it('shares the mount deadline and trace across a slow seed broker and profile',async()=>{
 vi.useFakeTimers();const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 state.broker.mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(brokerOk()),20000)));
 state.read.mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve({ok:true,data:profile()}),11000)));
 const frames:Array<()=>void>=[];window.requestAnimationFrame=(fn:FrameRequestCallback)=>{frames.push(()=>fn(0));return 1;};
 try{
  render();frames[0]!();await vi.advanceTimersByTimeAsync(30000);
  expect(render().status).toBe('error');expect(render().hasCurrentUser()).toBe(false);
  const rows=info.mock.calls.map(([row])=>JSON.parse(String(row))).filter(row=>row.operation==='auth_session_check');
  const first=rows[0];expect(first.stage).toBe('session');
  expect(rows.some(row=>row.request_id===first.request_id&&row.duration_ms===30000&&row.code==='UNAVAILABLE')).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);expect(render().hasCurrentUser()).toBe(false);
 }finally{info.mockRestore();}
});
