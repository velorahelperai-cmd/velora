import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; effects: Array<() => void>; mounted: boolean; lateWrites: number };
const mocked = vi.hoisted(() => ({ driver: null as Driver | null, locale: "en", account: "user-a", read: vi.fn(), create: vi.fn(), replace: vi.fn(), cancel: vi.fn(), clipboard: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => { const d = mocked.driver!; return { d, s: d.slots[d.cursor++] ?? (d.slots[d.cursor - 1] = {}) }; };
  return { ...actual,
    startTransition: (fn: () => void) => fn(),
    useState(initial: unknown) { const { d, s } = slot(); if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial; return [s.value, (value: unknown) => { if (!d.mounted) { d.lateWrites++; return; } s.value = typeof value === "function" ? (value as (v: unknown) => unknown)(s.value) : value; }]; },
    useRef(value: unknown) { const { s } = slot(); return s.value ?? (s.value = { current: value }); },
    useMemo(fn: () => unknown, deps: unknown[]) { const { s } = slot(); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) { s.value = fn(); s.deps = deps; } return s.value; },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const { d, s } = slot(); if (!s.deps || s.deps.length !== deps.length || deps.some((v, i) => !Object.is(v, s.deps![i]))) { d.effects.push(() => { s.cleanup?.(); s.cleanup = fn() || undefined; }); s.deps = deps; } },
  };
});
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: mocked.locale }) }));
vi.mock("./account-chrome", () => ({ useOptionalAccountSession: () => ({ identity: { userId: mocked.account }, isCurrentUser: (id: string) => id === mocked.account }) }));
vi.mock("@/lib/tenancy/staff-invitations", () => ({ listCompanyTeam: mocked.read, createStaffInvitation: mocked.create, replaceStaffInvitation: mocked.replace, cancelStaffInvitation: mocked.cancel }));
vi.mock("./ui", () => ({ Button: "button", Card: "section", Notice: "aside", Field: ({ children }: { children: (p: object) => ReactNode }) => children({}), useAction: () => ({ busy: false, run: (fn: () => unknown) => fn() }), useAppCopy: () => ({ loading: "Loading", app: { tabs: { team: "Team and permissions" }, owner: "Owner", staff: "Staff", active: "Active", invited: "Invited", teamEmpty: "No members", inviteName: "Name", inviteEmail: "Email", invite: "Add employee", openInvite: "Invitation link" } }) }));
import { CompanyTeamPanel } from "./company-team-panel";
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const n = value as Node;
  const children = typeof n.type === "function" ? (n.type as (p: object) => unknown)(n.props) : n.props.children;
  return [n, ...nodes(children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function mount() {
  const d: Driver = { slots: [], cursor: 0, effects: [], mounted: true, lateWrites: 0 }; let tree: ReactNode; let props = { companyId: "company-a", accountId: "user-a" };
  function render(next = props) { props = next; d.cursor = 0; mocked.driver = d; tree = CompanyTeamPanel(props); mocked.driver = null; d.effects.splice(0).forEach(fn => fn()); return tree; }
  render(); return { render, tree: () => tree, driver: d, unmount() { d.slots.forEach(s => s.cleanup?.()); d.mounted = false; } };
}
type Harness = ReturnType<typeof mount>;
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const invitation = { id: "invite-a", name: "Staff", email: "staff@example.invalid", status: "invited", expiresAt: "2099-01-01T00:00:00Z", revision: 3 };
const team = (invitations: unknown[] = []) => ({ ok: true, data: { companyId: "company-a", members: [], invitations } });
const saved = (overrides = {}) => ({ ok: true, data: { outcome: "created", replayed: false, invitation, inviteUrl: "https://synthetic.invalid/accept-invite?token=synthetic", ...overrides } });
const button = (h: Harness, label: string) => nodes(h.tree()).find(n => n.type === "button" && text(n.props.children) === label)!;
const click = (h: Harness, label: string) => (button(h, label).props.onClick as () => void)();
const submit = (h: Harness) => (nodes(h.tree()).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
function fill(h: Harness, name = "Staff", email = "staff@example.invalid") {
  let inputs = nodes(h.tree()).filter(n => n.type === "input" && !n.props.readOnly);
  (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: name } }); h.render();
  inputs = nodes(h.tree()).filter(n => n.type === "input" && !n.props.readOnly);
  (inputs[1].props.onChange as (e: unknown) => void)({ target: { value: email } }); h.render();
}
async function ready(invitations: unknown[] = []) { mocked.read.mockResolvedValue(team(invitations)); const h = mount(); await flush(); h.render(); return h; }
beforeEach(() => { vi.clearAllMocks(); mocked.locale = "en"; mocked.account = "user-a"; mocked.clipboard.mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText: mocked.clipboard } }); });

describe("company invitations", () => {
  it("blocks immediate duplicate submission before React renders and keeps one operation across uncertain retries", async () => {
    const h = await ready(); fill(h); const pending = deferred<unknown>(); mocked.create.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(saved({ replayed: true, inviteUrl: null }));
    submit(h); submit(h); h.render(); expect(mocked.create).toHaveBeenCalledTimes(1); expect(button(h, "Add employee").props.busy).toBe(true);
    pending.reject(new Error("LOST_RESPONSE")); await flush(); h.render(); expect(button(h, "Add employee").props.busy).toBe(false);
    expect(nodes(h.tree()).filter(n => n.type === "input" && !n.props.readOnly).map(n => n.props.value)).toEqual(["Staff", "staff@example.invalid"]);
    submit(h); await flush(); h.render(); expect(mocked.create.mock.calls[0][0].operationId).toMatch(/^[a-f0-9-]{36}$/); expect(mocked.create.mock.calls[1][0].operationId).toBe(mocked.create.mock.calls[0][0].operationId);
    expect(text(h.tree())).toContain("unavailable"); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
  });
  it("assigns a new operation when the normalized create draft changes", async () => {
    const h = await ready(); fill(h); mocked.create.mockRejectedValue(new Error("UNKNOWN")); submit(h); await flush(); h.render();
    fill(h, "Staff", "other@example.invalid"); submit(h); await flush(); expect(mocked.create.mock.calls[1][0].operationId).not.toBe(mocked.create.mock.calls[0][0].operationId);
  });
  it("retains a successful link when the subsequent list refresh fails and offers refresh only recovery", async () => {
    const h = await ready(); fill(h); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockRejectedValueOnce(new Error("REFRESH_ONLY")); submit(h); await flush(); h.render();
    expect(nodes(h.tree()).find(n => n.props.readOnly)?.props.value).toBe(saved().data.inviteUrl); expect(text(h.tree())).toContain("Invitation saved"); expect(text(h.tree())).toContain("Refresh team"); expect(text(h.tree())).not.toContain("Could not create");
    mocked.read.mockResolvedValue(team([invitation])); click(h, "Refresh team"); await flush(); h.render(); expect(mocked.create).toHaveBeenCalledTimes(1); expect(nodes(h.tree()).find(n => n.props.readOnly)?.props.value).toBe(saved().data.inviteUrl);
  });
  it("shows a real explicit replacement flow after reload without claiming to recover a token", async () => {
    const h = await ready([invitation]); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false); click(h, "Replace invitation"); h.render();
    expect(mocked.replace).not.toHaveBeenCalled(); expect(text(h.tree())).toContain("pending links"); expect(text(h.tree())).toContain("Memberships and history");
    mocked.replace.mockResolvedValueOnce(saved({ outcome: "replaced", invitation: { ...invitation, id: "invite-new", revision: 4 } })); mocked.read.mockResolvedValue(team([{ ...invitation, id: "invite-new", revision: 4 }])); click(h, "Confirm replacement"); click(h, "Confirm replacement"); await flush(); h.render();
    expect(mocked.replace).toHaveBeenCalledTimes(1); expect(mocked.replace.mock.calls[0][0]).toMatchObject({ companyId: "company-a", invitationId: "invite-a", expectedRevision: 3 }); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(true);
  });
  it("cancels only after explicit confirmation and preserves an uncertain cancellation operation", async () => {
    const h = await ready([invitation]); click(h, "Cancel invitation"); h.render(); expect(mocked.cancel).not.toHaveBeenCalled(); expect(text(h.tree())).toContain("pending links");
    mocked.cancel.mockRejectedValueOnce(new Error("UNKNOWN")).mockResolvedValueOnce(saved({ outcome: "cancelled", invitation: { ...invitation, status: "cancelled", revision: 4 }, inviteUrl: null })); click(h, "Confirm cancellation"); await flush(); h.render(); click(h, "Confirm cancellation"); await flush(); h.render();
    expect(mocked.cancel.mock.calls[1][0].operationId).toBe(mocked.cancel.mock.calls[0][0].operationId); expect(text(h.tree())).toContain("Invitation cancelled"); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
  });
  it("shows stale revision conflict and requires fresh confirmation instead of changing expected revision", async () => {
    const h = await ready([invitation]); click(h, "Replace invitation"); h.render(); mocked.replace.mockResolvedValueOnce({ ok: false, code: "STALE_REVISION" }); click(h, "Confirm replacement"); await flush(); h.render();
    expect(text(h.tree())).toContain("changed"); expect(button(h, "Confirm replacement").props.disabled).toBe(true);
    mocked.read.mockResolvedValueOnce(team([{ ...invitation, revision: 4 }])); click(h, "Refresh team"); await flush(); h.render(); expect(button(h, "Confirm replacement")).toBeUndefined();
    click(h, "Replace invitation"); h.render(); mocked.replace.mockResolvedValueOnce(saved()); click(h, "Confirm replacement"); await flush(); expect(mocked.replace.mock.calls[1][0].expectedRevision).toBe(4);
  });
  it("preserves accepted history without exposing replace/cancel controls for accepted or cancelled invitations", async () => {
    const h = await ready([{ ...invitation, status: "accepted" }, { ...invitation, id: "cancelled", status: "cancelled" }]); expect(text(h.tree())).toContain("Accepted"); expect(text(h.tree())).toContain("Cancelled"); expect(button(h, "Replace invitation")).toBeUndefined(); expect(button(h, "Cancel invitation")).toBeUndefined();
  });
  it("contains legacy conflicts with explicit recipient replacement and cancellation controls", async () => {
    const h = await ready([{ ...invitation, status: "conflicted" }]); expect(text(h.tree())).toContain("Conflicting"); expect(button(h, "Replace invitation")).toBeDefined(); expect(button(h, "Cancel invitation")).toBeDefined();
  });
  it("discards mutation success and failed list response after unmount", async () => {
    const h = await ready(); fill(h); const pending = deferred<unknown>(); mocked.create.mockReturnValueOnce(pending.promise); submit(h); h.unmount(); pending.resolve(saved()); await flush(); expect(h.driver.lateWrites).toBe(0); expect(mocked.read).toHaveBeenCalledTimes(1);
    const readPending = deferred<unknown>(); mocked.read.mockReturnValueOnce(readPending.promise); const other = mount(); other.unmount(); readPending.reject(new Error("LATE_READ")); await flush(); expect(other.driver.lateWrites).toBe(0);
  });
  it("suppresses old account mutation, list and copy handlers even before an account-switch rerender", async () => {
    const h = await ready(); fill(h); const pending = deferred<unknown>(); mocked.create.mockReturnValueOnce(pending.promise); submit(h); mocked.account = "user-b"; pending.resolve(saved()); await flush(); h.render({ companyId: "company-a", accountId: "user-b" }); await flush(); h.render(); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
    mocked.account = "user-a"; const old = await ready(); fill(old); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockResolvedValue(team([invitation])); submit(old); await flush(); old.render(); const copy = button(old, "Copy link").props.onClick as () => void;
    mocked.account = "user-b"; copy(); expect(mocked.clipboard).not.toHaveBeenCalled();
  });
  it("does not apply clipboard completion after unmount and prevents duplicate pending copy", async () => {
    const h = await ready(); fill(h); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockResolvedValue(team([invitation])); submit(h); await flush(); h.render(); const pending = deferred<void>(); mocked.clipboard.mockReturnValueOnce(pending.promise); click(h, "Copy link"); click(h, "Copy link"); expect(mocked.clipboard).toHaveBeenCalledTimes(1); h.unmount(); pending.resolve(); await flush(); expect(h.driver.lateWrites).toBe(0);
  });
  it("handles a lost create response followed by reload with explicit replacement and no recovered link", async () => {
    const h = await ready(); fill(h); mocked.create.mockRejectedValueOnce(new Error("RESPONSE_LOST_AFTER_COMMIT")); submit(h); await flush(); h.render(); h.unmount();
    const reloaded = await ready([invitation]); expect(text(reloaded.tree())).toContain("unavailable"); expect(nodes(reloaded.tree()).some(n => n.props.readOnly)).toBe(false);
    click(reloaded, "Replace invitation"); reloaded.render(); mocked.replace.mockResolvedValueOnce(saved({ outcome: "replaced", invitation: { ...invitation, id: "replacement", revision: 4 } })); mocked.read.mockResolvedValueOnce(team([{ ...invitation, id: "replacement", revision: 4 }])); click(reloaded, "Confirm replacement"); await flush(); reloaded.render();
    expect(mocked.create).toHaveBeenCalledTimes(1); expect(nodes(reloaded.tree()).find(n => n.props.readOnly)?.props.value).toBe(saved().data.inviteUrl);
  });
  it("hides an old link after confirmed acceptance and suppresses its stale copy handler", async () => {
    const h = await ready(); fill(h); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockResolvedValueOnce(team([invitation])); submit(h); await flush(); h.render(); const oldCopy = button(h, "Copy link").props.onClick as () => void;
    mocked.read.mockResolvedValueOnce(team([{ ...invitation, status: "accepted", revision: 4 }])); click(h, "Refresh team"); await flush(); h.render(); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false); expect(text(h.tree())).toContain("Accepted"); oldCopy(); expect(mocked.clipboard).not.toHaveBeenCalled();
  });
  it("keeps a known current link when a separate create finds the same existing invitation", async () => {
    const h = await ready(); fill(h); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockResolvedValueOnce(team([invitation])); submit(h); await flush(); h.render();
    fill(h); mocked.create.mockResolvedValueOnce(saved({ outcome: "existing", inviteUrl: null })); mocked.read.mockResolvedValueOnce(team([invitation])); submit(h); await flush(); h.render(); expect(mocked.create.mock.calls[1][0].operationId).not.toBe(mocked.create.mock.calls[0][0].operationId); expect(nodes(h.tree()).find(n => n.props.readOnly)?.props.value).toBe(saved().data.inviteUrl);
  });
  it("discards an old company's pending list on company change and starts with an empty draft", async () => {
    const pending = deferred<unknown>(); mocked.read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: true, data: { companyId: "company-b", members: [], invitations: [] } }); const h = mount(); h.render({ companyId: "company-b", accountId: "user-a" }); await flush(); pending.resolve(team([{ ...invitation, name: "Old company staff" }])); await flush(); h.render(); expect(text(h.tree())).not.toContain("Old company staff"); expect(button(h, "Add employee").props.disabled).toBe(true);
  });
  it("starts a fresh create operation for an identical recipient after confirmed create and cancellation", async () => {
    const h = await ready(); fill(h); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockResolvedValueOnce(team([invitation])); submit(h); await flush(); h.render();
    click(h, "Cancel invitation"); h.render(); mocked.cancel.mockResolvedValueOnce(saved({ outcome: "cancelled", invitation: { ...invitation, status: "cancelled", revision: 4 }, inviteUrl: null })); mocked.read.mockResolvedValueOnce(team([{ ...invitation, status: "cancelled", revision: 4 }])); click(h, "Confirm cancellation"); await flush(); h.render();
    fill(h); mocked.create.mockResolvedValueOnce(saved({ invitation: { ...invitation, id: "second", revision: 5 } })); mocked.read.mockResolvedValueOnce(team([{ ...invitation, id: "second", revision: 5 }])); submit(h); await flush(); h.render(); expect(mocked.create.mock.calls[1][0].operationId).not.toBe(mocked.create.mock.calls[0][0].operationId); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(true);
  });
  for (const action of ["replace", "cancel"] as const) {
    it(action + ": clears the old link as soon as an explicit change starts and keeps it hidden after a lost response", async () => {
      const h = await ready(); fill(h); mocked.create.mockResolvedValueOnce(saved()); mocked.read.mockResolvedValueOnce(team([invitation])); submit(h); await flush(); h.render(); const oldCopy = button(h, "Copy link").props.onClick as () => void;
      click(h, action === "replace" ? "Replace invitation" : "Cancel invitation"); h.render(); const pending = deferred<unknown>(); const mutate = action === "replace" ? mocked.replace : mocked.cancel; mutate.mockReturnValueOnce(pending.promise); click(h, action === "replace" ? "Confirm replacement" : "Confirm cancellation"); h.render(); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
      pending.reject(new Error("COMMITTED_RESPONSE_LOST")); await flush(); h.render(); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false); oldCopy(); expect(mocked.clipboard).not.toHaveBeenCalled(); expect(text(h.tree())).toContain("Could not confirm");
    });
  }
  it("reconciles confirmed cancellation locally when refresh fails without leaving stale actionable invitations", async () => {
    const h = await ready([invitation, { ...invitation, id: "accepted-history", status: "accepted", name: "Accepted history" }]); click(h, "Cancel invitation"); h.render(); mocked.cancel.mockResolvedValueOnce(saved({ outcome: "cancelled", invitation: { ...invitation, status: "cancelled", revision: 4 }, inviteUrl: null })); mocked.read.mockRejectedValueOnce(new Error("READ_FAILED_AFTER_COMMIT")); click(h, "Confirm cancellation"); await flush(); h.render();
    expect(text(h.tree())).toContain("Invitation cancelled"); expect(text(h.tree())).toContain("Accepted history"); expect(button(h, "Cancel invitation")).toBeUndefined(); expect(button(h, "Replace invitation")).toBeUndefined();
  });
  it("reconciles a confirmed replacement locally when refresh fails and uses its new revision for later actions", async () => {
    const h = await ready([invitation]); click(h, "Replace invitation"); h.render(); mocked.replace.mockResolvedValueOnce(saved({ outcome: "replaced", invitation: { ...invitation, id: "replacement", revision: 4 } })); mocked.read.mockRejectedValueOnce(new Error("READ_FAILED_AFTER_COMMIT")); click(h, "Confirm replacement"); await flush(); h.render();
    expect(nodes(h.tree()).find(n => n.props.readOnly)?.props.value).toBe(saved().data.inviteUrl); click(h, "Cancel invitation"); h.render(); mocked.cancel.mockResolvedValueOnce(saved({ outcome: "cancelled", invitation: { ...invitation, id: "replacement", revision: 5, status: "cancelled" }, inviteUrl: null })); click(h, "Confirm cancellation"); await flush(); expect(mocked.cancel.mock.calls[0][0]).toMatchObject({ invitationId: "replacement", expectedRevision: 4 });
  });
  for (const action of ["replace", "cancel"] as const) {
    it(action + ": historical operation replay preserves a newer pending recipient invitation when refresh fails", async () => {
      const h = await ready([invitation]); click(h, action === "replace" ? "Replace invitation" : "Cancel invitation"); h.render();
      const retry = button(h, action === "replace" ? "Confirm replacement" : "Confirm cancellation").props.onClick as () => void;
      const mutate = action === "replace" ? mocked.replace : mocked.cancel; mutate.mockRejectedValueOnce(new Error("HISTORICAL_COMMIT_RESPONSE_LOST")); retry(); await flush(); h.render(); click(h, "Back"); h.render();
      const historical = { ...invitation, id: action === "replace" ? "historical-replacement" : invitation.id, status: "cancelled", revision: 6 };
      const newer = { ...invitation, id: "newer-pending", name: "Newer pending", revision: 6 };
      mocked.read.mockResolvedValueOnce(team([historical, newer])); click(h, "Refresh team"); await flush(); h.render();
      mutate.mockResolvedValueOnce(saved({ outcome: action === "replace" ? "replaced" : "cancelled", replayed: true, invitation: historical, inviteUrl: null })); mocked.read.mockRejectedValueOnce(new Error("REFRESH_FAILED")); retry(); await flush(); h.render();
      expect(text(h.tree())).toContain("Newer pending"); expect(button(h, "Cancel invitation")).toBeDefined(); click(h, "Cancel invitation"); h.render();
      mocked.cancel.mockResolvedValueOnce(saved({ outcome: "cancelled", invitation: { ...newer, status: "cancelled", revision: 7 }, inviteUrl: null })); click(h, "Confirm cancellation"); await flush();
      expect(mocked.cancel.mock.lastCall?.[0]).toMatchObject({ invitationId: "newer-pending", expectedRevision: 6 });
    });
  }
});

for (const code of ["FORBIDDEN", "UNAUTHENTICATED", "UNVERIFIED"]) {
 it("review regression: mutation " + code + " clears protected rows and old links", async () => {
  const h = await ready([invitation]);
  fill(h); mocked.create.mockResolvedValueOnce(saved()); submit(h); await flush(); h.render();
  expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(true);
  fill(h,"Other staff","other@example.invalid");
  mocked.create.mockResolvedValueOnce({ok:false,code}); submit(h); await flush(); h.render();
  expect(text(h.tree())).toContain("Permissions changed. Check your account.");
  expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
  expect(text(h.tree())).not.toContain("staff@example.invalid");
 });
}
it("review regression: denied mutation prevents copying a previously saved token", async () => {
 const h = await ready([invitation]);fill(h);mocked.create.mockResolvedValueOnce(saved());submit(h);await flush();h.render();
 fill(h,"Other staff","other@example.invalid");mocked.create.mockResolvedValueOnce({ok:false,code:"FORBIDDEN"});submit(h);await flush();h.render();
 const copy = button(h,"Copy link"); if(copy)(copy.props.onClick as () => void)();await flush();
 expect(mocked.clipboard).not.toHaveBeenCalled();
});
for (const action of ["create", "replace", "cancel"] as const) {
  for (const code of ["FORBIDDEN", "UNAUTHENTICATED", "UNVERIFIED"]) {
    it(action + ": review regression: authority denial clears protected data and invalidates captured handlers until fresh read", async () => {
      const h = await ready([invitation]); fill(h); mocked.create.mockResolvedValueOnce(saved()); submit(h); await flush(); h.render();
      const oldCopy = button(h, "Copy link").props.onClick as () => void;
      let retry: () => void;
      if (action === "create") { fill(h, "Other", "other@example.invalid"); retry = () => submit(h); mocked.create.mockResolvedValueOnce({ ok: false, code }); }
      else { click(h, action === "replace" ? "Replace invitation" : "Cancel invitation"); h.render(); retry = button(h, action === "replace" ? "Confirm replacement" : "Confirm cancellation").props.onClick as () => void; (action === "replace" ? mocked.replace : mocked.cancel).mockResolvedValueOnce({ ok: false, code }); }
      retry(); await flush(); h.render();
      expect(text(h.tree())).not.toContain(invitation.email); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
      expect(button(h, "Add employee").props.disabled).toBe(true); oldCopy(); retry(); await flush();
      expect(mocked.clipboard).not.toHaveBeenCalled(); expect(mocked.create.mock.calls.length + mocked.replace.mock.calls.length + mocked.cancel.mock.calls.length).toBe(2);
      mocked.read.mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" }); click(h, "Refresh team"); await flush(); h.render(); expect(button(h, "Add employee").props.disabled).toBe(true);
      mocked.read.mockResolvedValueOnce(team([invitation])); click(h, "Refresh team"); await flush(); h.render(); expect(text(h.tree())).toContain(invitation.email); oldCopy();
      expect(mocked.clipboard).not.toHaveBeenCalled();
      if (action !== "create") { retry(); await flush(); expect(mocked.replace.mock.calls.length + mocked.cancel.mock.calls.length).toBe(1); }
    });
  }
}
it("review regression: clipboard completion cannot restore copy feedback after authority denial", async () => {
  const h = await ready([invitation]); fill(h); mocked.create.mockResolvedValueOnce(saved()); submit(h); await flush(); h.render();
  const pending = deferred<void>(); mocked.clipboard.mockReturnValueOnce(pending.promise); click(h, "Copy link");
  fill(h, "Other", "other@example.invalid"); mocked.create.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN" }); submit(h); await flush(); h.render();
  pending.resolve(); await flush(); h.render(); expect(text(h.tree())).not.toContain("Copied"); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
});
it("review regression: fresh authority does not reactivate an old create callback or operation", async () => {
  const h = await ready(); fill(h); const oldSubmit = nodes(h.tree()).find(n => n.type === "form")!.props.onSubmit as (e: unknown) => void;
  mocked.create.mockResolvedValueOnce({ ok: false, code: "UNVERIFIED" }); oldSubmit({ preventDefault() {} }); await flush(); h.render();
  click(h, "Refresh team"); await flush(); h.render(); oldSubmit({ preventDefault() {} }); await flush(); expect(mocked.create).toHaveBeenCalledTimes(1);
  mocked.create.mockResolvedValueOnce(saved()); submit(h); await flush(); expect(mocked.create).toHaveBeenCalledTimes(2); expect(mocked.create.mock.calls[1][0].operationId).not.toBe(mocked.create.mock.calls[0][0].operationId);
});
for (const action of ["create", "replace", "cancel"] as const) {
  it(action + ": review regression: dispatch binds the originating actor and ignores late success after account switch", async () => {
    const h = await ready([invitation]); const pending = deferred<unknown>(); const mutate = action === "create" ? mocked.create : action === "replace" ? mocked.replace : mocked.cancel;
    mutate.mockReturnValueOnce(pending.promise);
    if (action === "create") { fill(h); submit(h); } else { click(h, action === "replace" ? "Replace invitation" : "Cancel invitation"); h.render(); click(h, action === "replace" ? "Confirm replacement" : "Confirm cancellation"); }
    expect(mutate.mock.lastCall?.[0].expectedUserId).toBe("user-a"); mocked.account = "user-b"; pending.resolve(saved()); await flush();
    h.render({ companyId: "company-a", accountId: "user-b" }); await flush(); h.render(); expect(nodes(h.tree()).some(n => n.props.readOnly)).toBe(false);
  });
}
