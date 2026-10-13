import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ switcher: vi.fn(), identity: vi.fn(), capability: vi.fn() }));
vi.mock("./actions", () => ({ getWorkspaceSwitcher: mocks.switcher, getAccountProfile: mocks.identity }));
vi.mock("@/lib/access/actions", () => ({ sessionHasCompanyCapability: mocks.capability }));
import { getWorkspaceView } from "./workspace-view";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.switcher.mockResolvedValue({ ok: true, data: { selectedCompanyId: "company", choices: [{ companyId: "company", role: "staff" }] } });
  mocks.identity.mockResolvedValue({ ok: true, data: { companyId: "company", role: "staff" } });
  mocks.capability.mockResolvedValue(false);
});

describe("workspace view", () => {
  it("starts both independent server reads before either resolves", async () => {
    let release!: (value: unknown) => void;
    mocks.switcher.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const loading = getWorkspaceView();
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.capability).not.toHaveBeenCalled();
    release({ ok: true, data: { selectedCompanyId: "company", choices: [{ companyId: "company", role: "staff" }] } });
    expect(await loading).toMatchObject({ ok: true, data: { knowledgeAllowed: false } });
  });
  it("fails closed when the identity and selected workspace disagree", async () => {
    mocks.identity.mockResolvedValue({ ok: true, data: { companyId: "other", role: "owner" } });
    expect(await getWorkspaceView()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.capability).not.toHaveBeenCalled();
  });
  it("does not turn unavailable capability evidence into a grant", async () => {
    mocks.capability.mockResolvedValue(null);
    expect(await getWorkspaceView()).toMatchObject({ ok: true, data: { knowledgeAllowed: false } });
  });
  it("returns the authoritative access failure without checking capability", async () => {
    mocks.switcher.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await getWorkspaceView()).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.capability).not.toHaveBeenCalled();
  });
});
