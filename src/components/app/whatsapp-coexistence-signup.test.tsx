import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; effects: Array<() => void>; layoutEffects: Array<() => void>; mounted: boolean; lateWrites: number };
const mocks = vi.hoisted(() => ({
  driver: null as Driver | null,
  read: vi.fn(), start: vi.fn(), complete: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(), syncRead: vi.fn(), syncRequest: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => { const d = mocks.driver!; return { d, s: d.slots[d.cursor++] ?? (d.slots[d.cursor - 1] = {}) }; };
  const changed = (a: unknown[] | undefined, b: unknown[]) => !a || a.length !== b.length || b.some((v, i) => !Object.is(a[i], v));
  return {
    ...actual,
    useState(initial: unknown) { const { d, s } = slot(); if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [s.value, (value: unknown) => { if (!d.mounted) { d.lateWrites++; return; } s.value = typeof value === "function" ? (value as (v: unknown) => unknown)(s.value) : value; }]; },
    useRef(value: unknown) { const { s } = slot(); if (!s.value) s.value = { current: value }; return s.value; },
    useCallback(fn: unknown, deps: unknown[]) { const { s } = slot(); if (changed(s.deps, deps)) { s.value = fn; s.deps = deps; } return s.value; },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const { d, s } = slot(); if (changed(s.deps, deps)) { d.effects.push(() => { s.cleanup?.(); s.cleanup = fn() || undefined; }); s.deps = deps; } },
    useLayoutEffect(fn: () => void | (() => void), deps: unknown[]) { const { d, s } = slot(); if (changed(s.deps, deps)) { d.layoutEffects.push(() => { s.cleanup?.(); s.cleanup = fn() || undefined; }); s.deps = deps; } },
  };
});
vi.mock("@/lib/whatsapp/coexistence/actions", () => ({
  getCoexistenceSetup: mocks.read, startCoexistenceSignup: mocks.start, completeCoexistenceSignup: mocks.complete,
  cancelCoexistenceSignup: mocks.cancel, disconnectCoexistenceSignup: mocks.disconnect,
  getCoexistenceSyncSetup: mocks.syncRead, requestCoexistenceHistorySync: mocks.syncRequest,
}));
vi.mock("next/script", () => ({ default: "meta-script" }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("./ui", () => ({ Button: "button", Field: "field", Notice: "notice" }));
import { WhatsappCoexistenceSignup } from "./whatsapp-coexistence-signup";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (typeof value === "function") return nodes(value({}));
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function mount(props: Parameters<typeof WhatsappCoexistenceSignup>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], layoutEffects: [], mounted: true, lateWrites: 0 };
  let currentProps = props, tree: ReactNode;
  function render(next = currentProps, flushPassive = true) {
    currentProps = next; driver.cursor = 0; mocks.driver = driver;
    tree = WhatsappCoexistenceSignup(currentProps); mocks.driver = null;
    driver.layoutEffects.splice(0).forEach(fn => fn());
    if (flushPassive) driver.effects.splice(0).forEach(fn => fn());
  }
  render();
  return { render, tree: () => tree, driver, unmount() { driver.slots.forEach(s => s.cleanup?.()); driver.mounted = false; } };
}
type Harness = ReturnType<typeof mount>;
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const config = { appId: "123", configId: "456", graphVersion: "v26.0" };
const status = (companyId = "a", connected = false) => ({
  companyId, connectionStatus: connected ? "connected" : "not_connected", displayPhoneNumber: connected ? "+96891234567" : null,
  liveVerified: false, historySyncStatus: "not_requested",
});
const setup = (companyId = "a", connected = false) => ({ ok: true, config, status: status(companyId, connected) });
const syncSetup = (ready = true) => ({ ok: true, ready, linkId: "11111111-1111-4111-8111-111111111111", linkGeneration: 2, aiEnabled: false,
  syncs: ["history", "smb_app_state_sync"].map(syncType => ({ syncType, state: "not_requested", requested: false, declined: false, errorCode: null as number | null, providerRequestId: null as string | null })) });
const find = (h: Harness, predicate: (node: Node) => boolean) => nodes(h.tree()).find(predicate)!;
const button = (h: Harness, name: string) => find(h, n => n.type === "button" && text(n) === name);
const click = (node: Node) => (node.props.onClick as () => void)();
const callbacks: Array<(response: unknown) => void> = [];
const listeners = new Set<(event: MessageEvent) => void>();
const timers = new Map<number, () => void>();
let clock = Date.parse("2026-10-12T00:00:00.000Z");
const emit = (data: object, origin = "https://www.facebook.com") => listeners.forEach(fn => fn({ origin, data: JSON.stringify(data) } as MessageEvent));
const finish = (phone = true) => ({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "123", ...(phone ? { phone_number_id: "456" } : {}) } });
async function prepared(h: Harness) {
  await flush(); h.render();
  (find(h, n => n.props.type === "tel").props.onChange as (event: unknown) => void)({ target: { value: "+96891234567" } }); h.render();
  (find(h, n => n.props.type === "checkbox").props.onChange as (event: unknown) => void)({ target: { checked: true } }); h.render();
  (find(h, n => n.type === "meta-script").props.onReady as () => void)(); h.render();
  click(button(h, "Prepare secure connection")); await flush(); h.render();
}

beforeEach(() => {
  vi.clearAllMocks(); callbacks.length = 0; listeners.clear(); timers.clear();
  clock = Date.parse("2026-10-12T00:00:00.000Z"); vi.spyOn(Date, "now").mockImplementation(() => clock);
  let id = 0;
  vi.stubGlobal("window", {
    FB: { init: vi.fn(), login: vi.fn((callback: (response: unknown) => void) => { callbacks.push(callback); }) },
    addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
    setInterval: (fn: () => void) => { timers.set(++id, fn); return id; }, clearInterval: (key: number) => timers.delete(key),
  });
  mocks.read.mockImplementation(async (companyId: string) => setup(companyId));
  mocks.start.mockResolvedValue({ ok: true, attemptId: "attempt-a", nonce: "nonce", expiresAt: "2026-10-12T00:10:00.000Z", config });
  mocks.complete.mockResolvedValue({ ok: true }); mocks.cancel.mockResolvedValue({ ok: true }); mocks.disconnect.mockResolvedValue({ ok: true });
  mocks.syncRead.mockResolvedValue(syncSetup()); mocks.syncRequest.mockResolvedValue({ ok: true, status: "pending" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real Coexistence component async paths", () => {
  it("shows the failed sync read stage and support reference without enabling sync, then clears on company switch", async () => {
    mocks.syncRead.mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE", diagnostic: {
      reference: "VEL-1234567890ABCDEF", operation: "whatsapp_connect", stage: "channel", code: "UNEXPECTED_FAILURE",
    } });
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("VEL-1234567890ABCDEF");
    expect(text(h.tree())).toContain("Step: Checking the connection");
    expect(text(h.tree())).toContain("Saved synchronization status unavailable");
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    h.render({ companyId: "b" }); await flush(); h.render();
    expect(text(h.tree())).not.toContain("VEL-1234567890ABCDEF"); h.unmount();
  });
  it("shows a bounded support reference for a failed status read and clears it on company switch", async () => {
    mocks.read.mockResolvedValueOnce({ok:false,code:"UNAVAILABLE",diagnostic:{reference:"VEL-1234567890ABCDEF",operation:"whatsapp_connect",stage:"channel",code:"UNAVAILABLE"}});
    const h=mount({companyId:"a"});await flush();h.render();
    expect(text(h.tree())).toContain("VEL-1234567890ABCDEF");
    h.render({companyId:"b"});await flush();h.render();
    expect(text(h.tree())).not.toContain("VEL-1234567890ABCDEF");h.unmount();
  });
  it("invalidates old company reads before passive effects run after the new company commits", async () => {
    const oldRead = deferred<unknown>(), newRead = deferred<unknown>();
    mocks.read.mockImplementation((companyId: string) => companyId === "a" ? oldRead.promise : newRead.promise);
    const h = mount({ companyId: "a" });
    h.render({ companyId: "b" }, false);
    oldRead.resolve({ ...setup("a", true), status: { ...status("a", true), displayPhoneNumber: "+96892222222" } });
    await flush(); h.render({ companyId: "b" }, false);
    expect(text(h.tree())).not.toContain("Meta authorization saved");
    expect(text(h.tree())).not.toContain("+96892222222");
    expect(text(h.tree())).not.toContain("Loading saved connection status");
    expect(text(h.tree())).not.toContain("Not connected");
    expect(mocks.read).toHaveBeenCalledWith("b");
    newRead.resolve(setup("b")); await flush(); h.render();
    expect(text(h.tree())).toContain("Not connected"); h.unmount();
  });

  it("requires separate explicit consent for each owner-requested sync and binds the request to the saved generation", async () => {
    mocks.read.mockResolvedValue({ ...setup("a", true), config: null });
    const pending = deferred<unknown>(); mocks.syncRequest.mockReturnValueOnce(pending.promise);
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    expect(button(h, "Request app state").props.disabled).toBe(true);
    const consent = find(h, n => n.props["aria-label"] === "Consent to chat history synchronization");
    expect(consent.props.checked).toBe(false);
    (consent.props.onChange as (event: unknown) => void)({ target: { checked: true } }); h.render();
    expect(button(h, "Request chat history").props.disabled).toBe(false);
    expect(button(h, "Request app state").props.disabled).toBe(true);
    const requestButton = button(h, "Request chat history"); click(requestButton); click(requestButton); h.render();
    expect(mocks.syncRequest).toHaveBeenCalledTimes(1);
    expect(mocks.syncRequest).toHaveBeenCalledWith({ companyId: "a", linkId: syncSetup().linkId, linkGeneration: 2, syncType: "history", consent: true });
    expect(text(h.tree())).not.toContain("Synchronization complete");
    pending.resolve({ ok: true, status: "pending" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Request accepted");
    expect(text(h.tree())).toContain("Not yet verified");
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    expect(button(h, "Request app state").props.disabled).toBe(true);
    const appConsent = find(h, n => n.props["aria-label"] === "Consent to app state synchronization");
    (appConsent.props.onChange as (event: unknown) => void)({ target: { checked: true } }); h.render();
    click(button(h, "Request app state")); await flush(); h.render();
    expect(mocks.syncRequest.mock.calls[1][0].syncType).toBe("smb_app_state_sync"); h.unmount();
  });

  it.each(["pending", "syncing", "completed", "failed", "reconcile_required"])("prevents replay of persisted %s synchronization", async state => {
    mocks.read.mockResolvedValue({ ...setup("a", true), config: null });
    const saved = syncSetup(); saved.syncs[0] = { ...saved.syncs[0], state };
    mocks.syncRead.mockResolvedValue(saved);
    const h = mount({ companyId: "a" }); await flush(); h.render();
    const consent = find(h, n => n.props["aria-label"] === "Consent to chat history synchronization");
    expect(consent.props.disabled).toBe(true); expect(button(h, "Request chat history").props.disabled).toBe(true);
    click(button(h, "Request chat history")); expect(mocks.syncRequest).not.toHaveBeenCalled(); h.unmount();
  });

  it("keeps ambiguous sync requests blocked after readback instead of retrying automatically", async () => {
    mocks.read.mockResolvedValue({ ...setup("a", true), config: null }); mocks.syncRequest.mockRejectedValueOnce(new Error("unknown transport result"));
    const h = mount({ companyId: "a" }); await flush(); h.render();
    (find(h, n => n.props["aria-label"] === "Consent to chat history synchronization").props.onChange as (event: unknown) => void)({ target: { checked: true } }); h.render();
    click(button(h, "Request chat history")); await flush(); h.render();
    expect(text(h.tree())).toContain("needs review"); expect(button(h, "Request chat history").props.disabled).toBe(true);
    click(button(h, "Request chat history")); expect(mocks.syncRequest).toHaveBeenCalledTimes(1); h.unmount();
  });

  it.each([false, true])("does not request sync when readiness=%s but the company is disconnected", async ready => {
    mocks.read.mockResolvedValue({ ...setup(), config: null, status: { ...status(), connectionStatus: "disconnected" } }); mocks.syncRead.mockResolvedValue(syncSetup(ready));
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    click(button(h, "Request chat history")); expect(mocks.syncRequest).not.toHaveBeenCalled(); h.unmount();
  });

  it("does not request synchronization for a connected company while setup readiness is false", async () => {
    mocks.read.mockResolvedValue({ ...setup("a", true), config: null }); mocks.syncRead.mockResolvedValue(syncSetup(false));
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Synchronization is awaiting setup");
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    click(button(h, "Request chat history")); expect(mocks.syncRequest).not.toHaveBeenCalled(); h.unmount();
  });

  it("shows saved declined sharing and keeps the consumed type disabled", async () => {
    mocks.read.mockResolvedValue({ ...setup("a", true), config: null });
    const saved = syncSetup(); saved.syncs[0] = { ...saved.syncs[0], state: "failed", declined: true, errorCode: 2593109 };
    mocks.syncRead.mockResolvedValue(saved);
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Sharing declined");
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    expect(text(h.tree())).toContain("Not yet verified"); h.unmount();
  });

  it("requires fresh explicit consent when the saved connection generation changes", async () => {
    mocks.read.mockResolvedValue({ ...setup("a", true), config: null });
    const h = mount({ companyId: "a" }); await flush(); h.render();
    (find(h, n => n.props["aria-label"] === "Consent to chat history synchronization").props.onChange as (event: unknown) => void)({ target: { checked: true } }); h.render();
    expect(button(h, "Request chat history").props.disabled).toBe(false);
    mocks.syncRead.mockResolvedValueOnce({ ...syncSetup(), linkGeneration: 3 });
    click(button(h, "Refresh saved status")); await flush(); h.render();
    expect(find(h, n => n.props["aria-label"] === "Consent to chat history synchronization").props.checked).toBe(false);
    expect(button(h, "Request chat history").props.disabled).toBe(true);
    click(button(h, "Request chat history")); expect(mocks.syncRequest).not.toHaveBeenCalled(); h.unmount();
  });

  it("drops old-company sync results and displays only persisted projection recovery counts", async () => {
    mocks.read.mockImplementation(async (companyId: string) => ({ ...setup(companyId, true), config: null, status: { ...status(companyId, true), projectionRecovery: { pending: 3, conflicts: 2 } } }));
    const pending = deferred<unknown>(); mocks.syncRequest.mockReturnValueOnce(pending.promise);
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("3 pending"); expect(text(h.tree())).toContain("2 conflicts");
    expect(text(h.tree())).not.toContain("Recovery complete");
    (find(h, n => n.props["aria-label"] === "Consent to chat history synchronization").props.onChange as (event: unknown) => void)({ target: { checked: true } }); h.render();
    click(button(h, "Request chat history")); h.render({ companyId: "b" }); await flush(); h.render();
    pending.resolve({ ok: true, status: "pending" }); await flush(); h.render();
    expect(text(h.tree())).not.toContain("Request accepted");
    expect(find(h, n => n.props["aria-label"] === "Consent to chat history synchronization").props.checked).toBe(false);
    expect(h.driver.lateWrites).toBe(0); h.unmount();
  });

  it.each([
    ["completed", "Synchronization complete"],
    ["failed", "Synchronization failed"],
  ])("shows the saved %s history state after a fresh server read", async (historySyncStatus, label) => {
    mocks.read.mockResolvedValueOnce({ ...setup("a", true), config: null });
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Not requested");
    const readback = deferred<unknown>(); mocks.read.mockReturnValueOnce(readback.promise);
    click(button(h, "Refresh saved status")); h.render();
    expect(text(h.tree())).not.toContain(label);
    readback.resolve({ ...setup("a", true), config: null, status: { ...status("a", true), historySyncStatus } });
    await flush(); h.render();
    expect(text(h.tree())).toContain(label);
    expect(text(h.tree())).toContain("Meta authorization saved");
    expect(text(h.tree())).toContain("Not yet verified");
    expect(text(h.tree())).not.toContain("Needs review");
    expect(text(h.tree())).not.toMatch(/\d+%/);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
    h.unmount();
  });

  it("retains read/disconnect when signup is disabled and never equates connection with live verification", async () => {
    mocks.read.mockResolvedValueOnce({ ...setup("a", true), config: null });
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Meta authorization saved"); expect(text(h.tree())).toContain("Not yet verified");
    expect(nodes(h.tree()).some(n => n.type === "meta-script" || n.props.type === "tel")).toBe(false);
    expect(button(h, "Disconnect Velora access").props.disabled).toBe(false);
    h.unmount();
  });

  it("keeps Meta disconnection guidance for a known number needing review, without showing it for an unlinked company", async () => {
    mocks.read.mockResolvedValueOnce({ ...setup(), config: null, status: { ...status(), connectionStatus: "needs_review", displayPhoneNumber: "+96891234567" } });
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Stopping Velora access does not remove the Meta connection");
    mocks.read.mockResolvedValueOnce({ ...setup(), config: null });
    click(button(h, "Refresh saved status")); await flush(); h.render();
    expect(text(h.tree())).not.toContain("Business Platform"); h.unmount();
  });

  it("retains Meta unlink guidance after reloading a disconnected connection whose number is no longer projected", async () => {
    mocks.read.mockResolvedValueOnce({ ...setup(), config: null, status: { ...status(), connectionStatus: "disconnected", displayPhoneNumber: null } });
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(text(h.tree())).toContain("Velora access stopped");
    expect(text(h.tree())).toContain("Stopping Velora access does not remove the Meta connection");
    expect(text(h.tree())).toContain("Business Platform");
    expect(text(h.tree())).not.toContain("Meta authorization saved");
    expect(nodes(h.tree()).some(n => n.type === "meta-script")).toBe(false);
    h.unmount();
  });

  it("waits for authoritative disconnect readback even while signup is disabled", async () => {
    const disconnect = deferred<unknown>(), readback = deferred<unknown>(), onDisconnected = vi.fn();
    mocks.read.mockResolvedValueOnce({ ...setup("a", true), config: null }); mocks.disconnect.mockReturnValueOnce(disconnect.promise);
    const h = mount({ companyId: "a", onDisconnected }); await flush(); h.render();
    click(button(h, "Disconnect Velora access")); h.render();
    expect(mocks.disconnect).toHaveBeenCalledWith("a"); expect(onDisconnected).not.toHaveBeenCalled();
    mocks.read.mockReturnValueOnce(readback.promise); disconnect.resolve({ ok: true }); await flush(); h.render();
    expect(text(h.tree())).toContain("Meta authorization saved"); expect(onDisconnected).not.toHaveBeenCalled();
    readback.resolve({ ...setup(), config: null, status: { ...status(), connectionStatus: "disconnected", displayPhoneNumber: "+96891234567" } }); await flush(); h.render();
    expect(text(h.tree())).toContain("Velora access stopped"); expect(text(h.tree())).not.toContain("Meta authorization saved");
    expect(text(h.tree())).toContain("Stopping Velora access does not remove the Meta connection");
    expect(text(h.tree())).toContain("Business Platform");
    expect(onDisconnected).toHaveBeenCalledTimes(1); h.unmount();
  });

  it("requires a confirmed country-code number and clears confirmation on edits", async () => {
    const h = mount({ companyId: "a" }); await flush(); h.render();
    expect(find(h, n => n.props.type === "tel").props.value).toBe("");
    expect(button(h, "Prepare secure connection").props.disabled).toBe(true);
    await prepared(h); expect(mocks.start).toHaveBeenCalledWith({ companyId: "a", internationalPhoneNumber: "+96891234567", confirmed: true });
    click(button(h, "Cancel signup")); await flush(); h.render();
    (find(h, n => n.props.type === "tel").props.onChange as (event: unknown) => void)({ target: { value: "+96891111111" } }); h.render();
    expect(find(h, n => n.props.type === "checkbox").props.checked).toBe(false);
    h.unmount();
  });

  it("joins actual SDK and dedicated message signals, submits exact selectors, and waits for durable readback", async () => {
    const completion = deferred<unknown>(), readback = deferred<unknown>(), onConnected = vi.fn();
    mocks.complete.mockReturnValueOnce(completion.promise);
    const h = mount({ companyId: "a", onConnected }); await prepared(h); click(button(h, "Continue to Meta")); h.render();
    emit(finish(), "https://evilfacebook.com"); callbacks[0]({ authResponse: { code: "exchange-code" } });
    expect(mocks.complete).not.toHaveBeenCalled();
    emit(finish()); h.render();
    expect(mocks.complete).toHaveBeenCalledWith({ attemptId: "attempt-a", nonce: "nonce", confirmedPhoneNumber: "+96891234567", code: "exchange-code", wabaId: "123", phoneNumberId: "456" });
    expect(text(h.tree())).toContain("Verifying the authorized account");
    mocks.read.mockReturnValueOnce(readback.promise); completion.resolve({ ok: true }); await flush(); h.render();
    expect(onConnected).not.toHaveBeenCalled(); expect(text(h.tree())).not.toContain("Meta authorization saved");
    readback.resolve(setup("a", true)); await flush(); h.render();
    expect(text(h.tree())).toContain("Meta authorization saved"); expect(text(h.tree())).toContain("Not yet verified");
    expect(onConnected).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
    h.unmount();
  });

  it("supports waba-only compatibility without manufacturing a phone ID", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta"));
    emit({ ...finish(false), version: 3 }); callbacks[0]({ authResponse: { code: "exchange-code" } }); await flush(); h.render();
    expect(mocks.complete.mock.calls[0][0]).not.toHaveProperty("phoneNumberId");
    expect(mocks.complete.mock.calls[0][0].confirmedPhoneNumber).toBe("+96891234567"); h.unmount();
  });

  it("rejects generic Cloud API FINISH in the Business app flow without submitting a code", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta"));
    emit({ ...finish(), event: "FINISH", data: { waba_id: "123", phone_number_id: "456", business_id: "789" } });
    callbacks[0]({ authResponse: { code: "code" } }); await flush(); h.render();
    expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(text(h.tree())).toContain("supported WhatsApp Business app completion"); h.unmount();
  });

  it("cancels a late prepared server attempt after unmount instead of adopting it", async () => {
    const pending = deferred<unknown>(); mocks.start.mockReturnValueOnce(pending.promise);
    const h = mount({ companyId: "a" }); await prepared(h); h.unmount();
    pending.resolve({ ok: true, attemptId: "late-attempt", nonce: "late-nonce", expiresAt: "2026-10-12T00:10:00.000Z", config }); await flush();
    expect(mocks.cancel).toHaveBeenCalledWith({ attemptId: "late-attempt", nonce: "late-nonce" });
    expect(mocks.complete).not.toHaveBeenCalled(); expect(h.driver.lateWrites).toBe(0);
  });

  it("expires a received code while waiting for session data and discards its late finish", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta"));
    callbacks[0]({ authResponse: { code: "exchange-code" } }); clock += 25_001;
    timers.forEach(fn => fn()); await flush(); h.render(); emit(finish());
    expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(text(h.tree())).toContain("signup expired"); expect(listeners.size).toBe(0); h.unmount();
  });

  it("drops late prior-company completion after the component changes scope", async () => {
    const completion = deferred<unknown>(), onConnected = vi.fn(); mocks.complete.mockReturnValueOnce(completion.promise);
    const h = mount({ companyId: "a", onConnected }); await prepared(h); click(button(h, "Continue to Meta"));
    emit(finish()); callbacks[0]({ authResponse: { code: "exchange-code" } });
    h.render({ companyId: "b", onConnected }); await flush(); h.render();
    completion.resolve({ ok: true }); await flush(); h.render();
    expect(onConnected).not.toHaveBeenCalled(); expect(text(h.tree())).not.toContain("Meta authorization saved");
    expect(mocks.read.mock.calls.at(-1)?.[0]).toBe("b"); h.unmount(); expect(h.driver.lateWrites).toBe(0);
  });

  it("does not let a cancelled attempt's callback complete its replacement", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta")); h.render();
    click(button(h, "Cancel signup")); await flush(); h.render();
    expect(button(h, "Prepare secure connection").props.disabled).toBe(true);
    callbacks[0]({ authResponse: { code: "late-old-code" } }); h.render();
    mocks.start.mockResolvedValueOnce({ ok: true, attemptId: "attempt-b", nonce: "new-nonce", expiresAt: "2026-10-12T00:10:00.000Z", config });
    click(button(h, "Prepare secure connection")); await flush(); h.render(); click(button(h, "Continue to Meta"));
    callbacks[0]({ authResponse: { code: "old-again" } }); emit(finish());
    expect(mocks.complete).not.toHaveBeenCalled();
    callbacks[1]({ authResponse: { code: "new-code" } }); await flush();
    expect(mocks.complete.mock.calls[0][0]).toMatchObject({ attemptId: "attempt-b", code: "new-code" }); h.unmount();
  });

  it("ignores an older status read after a newer read has reported disconnection", async () => {
    const oldRead = deferred<unknown>(); const h = mount({ companyId: "a" }); await flush(); h.render();
    mocks.read.mockReturnValueOnce(oldRead.promise); click(button(h, "Refresh saved status"));
    mocks.read.mockResolvedValueOnce({ ...setup(), status: { ...status(), connectionStatus: "disconnected" } });
    click(button(h, "Refresh saved status")); await flush(); h.render();
    expect(text(h.tree())).toContain("Velora access stopped");
    oldRead.resolve(setup("a", true)); await flush(); h.render();
    expect(text(h.tree())).not.toContain("Meta authorization saved"); h.unmount();
  });

  it("preserves a Coexistence attempt when callback has no code", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta")); h.render();
    callbacks[0]({}); await flush(); h.render();
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
    callbacks[0]({ authResponse: { code: "late" } }); emit(finish()); await flush();
    expect(mocks.complete).not.toHaveBeenCalled();
    clock += 700_000; timers.forEach(fn => fn()); await flush(); h.render();
    expect(mocks.cancel).not.toHaveBeenCalled();
    h.unmount(); await flush(); expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("does not let an old SDK callback release a newer still-open popup", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta")); h.render();
    click(button(h, "Cancel signup")); await flush(); h.render();
    callbacks[0]({}); h.render();
    mocks.start.mockResolvedValueOnce({ ok: true, attemptId: "attempt-b", nonce: "new-nonce", expiresAt: "2026-10-12T00:10:00.000Z", config });
    click(button(h, "Prepare secure connection")); await flush(); h.render(); click(button(h, "Continue to Meta")); h.render();
    callbacks[0]({}); h.render(); click(button(h, "Cancel signup")); await flush(); h.render();
    expect(button(h, "Prepare secure connection").props.disabled).toBe(true);
    callbacks[1]({}); h.render(); expect(button(h, "Prepare secure connection").props.disabled).toBe(false);
    h.unmount();
  });

  it("cleans up pending SDK callbacks without late state writes after unmount", async () => {
    const h = mount({ companyId: "a" }); await prepared(h); click(button(h, "Continue to Meta")); h.unmount();
    callbacks[0]({ authResponse: { code: "late" } }); emit(finish()); await flush();
    expect(mocks.complete).not.toHaveBeenCalled(); expect(listeners.size).toBe(0); expect(h.driver.lateWrites).toBe(0);
  });
});
