import { describe, expect, it, vi, beforeEach,afterEach } from "vitest";
afterEach(()=>vi.unstubAllEnvs());
vi.mock('server-only',()=>({}));
import type { AccessResult } from "@/lib/tenancy/access";
import type { CompanyContext } from "@/lib/tenancy/types";
const state = vi.hoisted(() => ({ path: "", access: null as AccessResult | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-velora-return-path": state.path }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/tenancy/access", async (original) => ({ ...await original<typeof import("@/lib/tenancy/access")>(), getCompanyAccess: async () => state.access }));
vi.mock("@/lib/knowledge/actions", () => ({ listKnowledgeSources: vi.fn() }));
vi.mock("@/lib/tenancy/actions", () => ({ getCompanyReviewRequest: vi.fn() }));
vi.mock('@/lib/tenancy/setup-draft-actions',()=>({readActiveSetupDraft:vi.fn().mockResolvedValue({ok:true,data:null})}));
vi.mock("@/components/app/setup-wizard", () => ({ SetupWizard: () => null }));
vi.mock("@/components/app/access-gate", () => ({ AccessGate: () => null }));
import SetupLayout from "./layout";
import SetupPage from "./page";
import { listKnowledgeSources } from "@/lib/knowledge/actions";
import { getCompanyReviewRequest } from "@/lib/tenancy/actions";
const selected = "/app/settings?tab=plan&term=monthly&persona=level_1&package=basic&version=fixture-version&amount=45000&currency=OMR";
const returnTo = `/setup?next=${encodeURIComponent(selected)}`;
const context: CompanyContext = {
  userId: "owner", email: "owner@example.test", phone: "", fullName: "Owner", supportCode: "",
  needsProfileName: false, emailConfirmed: true, identityVerified: true, isPlatformAdmin: false,
  company: null, membership: null, needsCompanyContext: false, workspaceChoices: [],
};
beforeEach(() => {vi.clearAllMocks();vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true'); state.path = returnTo; state.access = { ok: true, context }; });
describe("setup server routes retain the package selection", () => {
  it('rollout-off preserves baseline onboarding before company creation',async()=>{vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','false');const page=await SetupPage();expect(page.props.children.props.initialCompany).toBeNull();expect(page.props.children.props.preferredNext).toBe(selected);expect(page.props.children.props.masterJourneyEnabled).toBe(false);});
  it("permits setup for a platform admin with an explicitly selected owner membership", async () => {
    state.access = { ok: true, context: { ...context, isPlatformAdmin: true, company: { id: "company", status: "setup" } as CompanyContext["company"], membership: { role: "owner" } as CompanyContext["membership"] } };
    expect(await SetupLayout({ children: "owner setup" })).toBe("owner setup");
  });
  it("redirects unselected memberships to the chooser before rendering setup", async () => {
    state.access = { ok: true, context: { ...context, needsCompanyContext: true } };
    const target = `redirect:/app?next=${encodeURIComponent(returnTo)}`;
    await expect(SetupLayout({ children: "protected setup" })).rejects.toThrow(target);
    await expect(SetupPage()).rejects.toThrow(target);
  });
  it("starts the owner's independent review read while knowledge is still pending", async () => {
    let release!: (value: Awaited<ReturnType<typeof listKnowledgeSources>>) => void;
    vi.mocked(listKnowledgeSources).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    vi.mocked(getCompanyReviewRequest).mockResolvedValueOnce({ ok: true, data: null });
    state.access = { ok: true, context: { ...context, company: { id: "company" } as CompanyContext["company"], membership: { role: "owner" } as CompanyContext["membership"] } };
    const loading = SetupPage();
    await vi.waitFor(() => expect(listKnowledgeSources).toHaveBeenCalled());
    const reviewStarted = vi.mocked(getCompanyReviewRequest).mock.calls.length;
    release({ ok: true, data: { sources: [], approvalFoundation: "ready" } });
    await loading;
    expect(reviewStarted).toBe(1);
  });
  it("retains the selected package through the separate new-business journey", async () => {
    expect(await SetupLayout({ children: "setup content" })).toBe("setup content");
    await expect(SetupPage()).rejects.toThrow(`redirect:/account/businesses/new?next=${encodeURIComponent(returnTo)}`);
  });
  it("passes the selected package into the wizard for an existing owner business", async () => {
    state.access={ok:true,context:{...context,company:{id:'company'} as CompanyContext['company'],membership:{role:'owner'} as CompanyContext['membership']}};
    vi.mocked(listKnowledgeSources).mockResolvedValueOnce({ok:true,data:{sources:[],approvalFoundation:'ready'}});
    vi.mocked(getCompanyReviewRequest).mockResolvedValueOnce({ok:true,data:null});
    const page = await SetupPage();
    expect(page.props.children.props.preferredNext).toBe(selected);
    expect(page.props.children.props.initialCompany?.id).toBe('company');
  });
  it("enables the new journey only with an explicit server rollout flag", async () => {
    state.access={ok:true,context:{...context,company:{id:'company',status:'setup'} as CompanyContext['company'],membership:{role:'owner',status:'active'} as CompanyContext['membership']}};
    vi.mocked(listKnowledgeSources).mockResolvedValue({ok:false,code:'UNAVAILABLE'});
    vi.mocked(getCompanyReviewRequest).mockResolvedValue({ok:false,code:'UNAVAILABLE'});
    vi.stubEnv("VELORA_SMART_ONBOARDING_ENABLED", "false");
    expect((await SetupPage()).props.children.props.smartOnboardingEnabled).toBe(false);
    vi.stubEnv("VELORA_SMART_ONBOARDING_ENABLED", "true");
    vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED", "false");
    expect((await SetupPage()).props.children.props.smartOnboardingEnabled).toBe(false);
    vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED", "true");
    expect((await SetupPage()).props.children.props.smartOnboardingEnabled).toBe(true);
    vi.unstubAllEnvs();
  });
  it("preserves selection through both missing-session route redirects", async () => {
    state.access = { ok: false, code: "UNAUTHENTICATED" };
    const target = `redirect:/login?next=${encodeURIComponent(returnTo)}`;
    await expect(SetupLayout({ children: null })).rejects.toThrow(target);
    await expect(SetupPage()).rejects.toThrow(target);
  });
  it("preserves selection through verification and profile completion", async () => {
    state.access = { ok: false, code: "UNVERIFIED" };
    const target = `redirect:/verify-email?next=${encodeURIComponent(returnTo)}`;
    await expect(SetupLayout({ children: null })).rejects.toThrow(target);
    await expect(SetupPage()).rejects.toThrow(target);
    state.access = { ok: true, context: { ...context, needsProfileName: true } };
    await expect(SetupLayout({ children: null })).rejects.toThrow(`redirect:/complete-profile?next=${encodeURIComponent(returnTo)}`);
  });
  it("does not turn a service outage into a login redirect or grant access", async () => {
    state.access = { ok: false, code: "UNAVAILABLE" };
    expect((await SetupLayout({ children: "protected" }) as { props: { code: string } }).props.code).toBe("UNAVAILABLE");
    expect((await SetupPage()).props.code).toBe("UNAVAILABLE");
  });
});
