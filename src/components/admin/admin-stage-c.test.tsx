import { describe, expect, it, vi } from "vitest";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; effects: Array<() => void>; mounted: boolean };
const mocked = vi.hoisted(() => ({
  driver: null as Driver | null,
  currentPathname: "/admin/accounts",
  currentLocale: "ar",
  pushMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => {
    const d = mocked.driver!;
    return { d, s: d.slots[d.cursor++] ?? (d.slots[d.cursor - 1] = {}) };
  };
  const changed = (a: unknown[] | undefined, b: unknown[]) =>
    !a || a.length !== b.length || b.some((v, i) => !Object.is(a[i], v));
  return {
    ...actual,
    // This driver checks static markup; real transition behavior has dedicated DOM tests.
    useTransition() { return [false, (action: () => void) => action()]; },
    useState(initial: unknown) {
      const { d, s } = slot();
      if (!("value" in s))
        s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (value: unknown) => {
          if (!d.mounted) return;
          s.value = typeof value === "function" ? (value as (v: unknown) => unknown)(s.value) : value;
        },
      ];
    },
    useRef(value: unknown) {
      const { s } = slot();
      if (!s.value) s.value = { current: value };
      return s.value;
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const { s } = slot();
      if (changed(s.deps, deps)) {
        s.value = fn();
        s.deps = deps;
      }
      return s.value;
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const { d, s } = slot();
      if (changed(s.deps, deps)) {
        d.effects.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
        s.deps = deps;
      }
    },
  };
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => mocked.currentPathname,
  useRouter: () => ({ refresh: vi.fn(), push: mocked.pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock demo-state for Arabic locale
vi.mock("@/lib/demo-state", () => ({
  useDemo: () => ({ locale: mocked.currentLocale }),
}));

// Mocks for AdminCompanyDetail dependencies
vi.mock("@/components/app/channel-review", () => ({
  AdminChannelReview: () => <div>ChannelReview</div>,
}));
vi.mock("@/components/app/instagram-admin-connection", () => ({
  InstagramAdminConnection: () => <div>InstagramAdmin</div>,
}));
vi.mock("@/lib/knowledge/actions", () => ({
  adminListCompanyKnowledge: vi.fn(),
  adminGetKnowledgeFileUrl: vi.fn(),
}));
vi.mock("@/lib/tenancy/actions", () => ({
  adminGetCompany: vi.fn(),
  adminUpdateCompany: vi.fn(),
  adminSetCompanyStatus: vi.fn(),
  adminSetMemberStatus: vi.fn(),
  adminApproveSetupReview: vi.fn(),
  adminRequestReviewChanges: vi.fn(),
}));
vi.mock("@/lib/whatsapp/connection-actions", () => ({
  adminGetWhatsappCompanyLink: vi.fn(),
  adminUpdateWhatsappLinkNote: vi.fn(),
  adminMarkWhatsappLinkNeedsExternal: vi.fn(),
}));

vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
  fn();
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const node = value as { props: Record<string, unknown> };
    return text(node.props.children);
  }
  return String(value ?? "");
}

function renderAccounts(props: Parameters<typeof AdminAccountsDirectory>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminAccountsDirectory(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

function renderChannels(props: Parameters<typeof AdminChannelsHub>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminChannelsHub(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

function renderCompanyDetail(props: Parameters<typeof AdminCompanyDetail>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminCompanyDetail(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

// Imports for Stage C components
import { AdminAccountsDirectory } from "./admin-accounts-directory";
import { AdminChannelsHub, type AdminChannelItem } from "./admin-channels-hub";
import { AdminCompanyDetail } from "@/components/app/admin-company-detail";
import type { AdminAccountSearchItem } from "@/lib/tenancy/types";

describe("Stage C — Admin V2 Customers & Channels", () => {
  describe("Module 02: AdminCompanyDetail Multi-Branch & Persona", () => {
    const baseCompany = {
      id: "cmp-001",
      display_name: "مطعم المذاق العماني",
      status: "active" as const,
      business_type: "restaurant",
      reply_language: "both" as const,
      country: "OM",
      city: "مسقط",
      hours: "09:00 - 23:00",
      contact_phone: "+96824112233",
      contact_email: "info@tasteofoman.om",
      created_at: "2026-10-01T00:00:00Z",
    };

    it("renders multi-branch isolation card with primary badge and timezone", () => {
      const branches = [
        {
          id: "br-01-primary",
          company_id: "cmp-001",
          name: "الفرع الرئيسي - مسقط القرم",
          timezone: "Asia/Muscat",
          status: "active",
          is_primary: true,
        },
        {
          id: "br-02-salalah",
          company_id: "cmp-001",
          name: "فرع محافظة ظفار - صلالة",
          timezone: "Asia/Muscat",
          status: "setup",
          is_primary: false,
        },
      ];

      const tree = renderCompanyDetail({
        initialCompany: baseCompany,
        initialMembers: [],
        initialAudits: [],
        initialKnowledge: [],
        initialBranches: branches,
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("فروع المنشأة ومواعيد العمل");
      expect(renderedText).toContain("الفرع الرئيسي - مسقط القرم");
      expect(renderedText).toContain("فرع محافظة ظفار - صلالة");
      expect(renderedText).toContain("الفرع الرئيسي");
      expect(renderedText).toContain("Asia/Muscat");
      expect(renderedText).toContain("2 فرع مسجل");
    });

    it("renders assistant persona card with correct business type and language", () => {
      const tree = renderCompanyDetail({
        initialCompany: baseCompany,
        initialMembers: [],
        initialAudits: [],
        initialKnowledge: [],
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("المساعد الذكي والتخصيص");
      expect(renderedText).toContain("نورة (Noura)");
      expect(renderedText).toContain("عربي وإنجليزي (Bilingual)");
      expect(renderedText).toContain("Gemini 3.8 Flash Engine");
    });
  });

  describe("Module 03: AdminAccountsDirectory", () => {
    const sampleAccounts: AdminAccountSearchItem[] = [
      {
        user_id: "usr-001-active",
        email: "salim@example.om",
        email_confirmed: true,
        account_phone: "+96891234567",
        full_name: "سالم الحارثي",
        support_code: "VEL-SALIM-01",
        companies: [
          {
            company_id: "cmp-001",
            display_name: "مطعم المذاق العماني",
            role: "owner",
            status: "active",
            company_status: "active",
            business_phone: "+96824112233",
          },
        ],
      },
      {
        user_id: "usr-002-unverified",
        email: "unconfirmed@example.com",
        email_confirmed: false,
        account_phone: null,
        full_name: "زائر جديد",
        support_code: null,
        companies: [],
      },
    ];

    it("renders account list with verified and unverified badges", () => {
      const tree = renderAccounts({
        initialQuery: "",
        initialOffset: 0,
        initialLimit: 20,
        accounts: sampleAccounts,
        hasMore: false,
        maxOffset: 500,
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("سالم الحارثي");
      expect(renderedText).toContain("salim@example.om");
      expect(renderedText).toContain("مطعم المذاق العماني");
      expect(renderedText).toContain("unconfirmed@example.com");
      expect(renderedText).toContain("مؤكد"); // verified email badge
      expect(renderedText).toContain("غير مؤكد"); // unverified badge
    });

    it("renders empty state when no accounts found", () => {
      const tree = renderAccounts({
        initialQuery: "nonexistent",
        initialOffset: 0,
        initialLimit: 20,
        accounts: [],
        hasMore: false,
        maxOffset: 500,
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("لا توجد حسابات");
    });

    it("renders pagination indicators when hasMore is true", () => {
      const tree = renderAccounts({
        initialQuery: "",
        initialOffset: 0,
        initialLimit: 20,
        accounts: sampleAccounts,
        hasMore: true,
        maxOffset: 500,
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("التالي");
    });
  });

  describe("Module 04: AdminChannelsHub", () => {
    const sampleChannels: AdminChannelItem[] = [
      {
        id: "chn-wa-01",
        companyId: "cmp-001",
        companyName: "مطعم المذاق العماني",
        channelType: "whatsapp",
        status: "verified",
        identifier: "+96891234567",
        wabaId: "waba-123456",
        coexistence: true,
        lastActiveAt: "2026-10-22T06:00:00Z",
      },
      {
        id: "chn-ig-01",
        companyId: "cmp-002",
        companyName: "مقهى السحاب",
        channelType: "instagram",
        status: "bound",
        identifier: "@alsahab_cafe",
        coexistence: false,
        lastActiveAt: "2026-10-22T05:30:00Z",
      },
      {
        id: "chn-wa-02",
        companyId: "cmp-003",
        companyName: "متجر العطور الفاخرة",
        channelType: "whatsapp",
        status: "needs_external_action",
        identifier: "+96899887766",
        coexistence: false,
        lastActiveAt: null,
      },
    ];

    it("renders KPI summary cards and channel rows", () => {
      const tree = renderChannels({
        channels: sampleChannels,
        stats: {
          totalChannels: 3,
          totalWhatsapp: 2,
          totalInstagram: 1,
          activeConnected: 2,
          needsAction: 1,
          coexistenceCount: 1,
        },
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("مركز القنوات");
      expect(renderedText).toContain("مطعم المذاق العماني");
      expect(renderedText).toContain("مقهى السحاب");
      expect(renderedText).toContain("متجر العطور الفاخرة");
      expect(renderedText).toContain("WhatsApp");
      expect(renderedText).toContain("Instagram");
      expect(renderedText).toContain("Coexistence");
    });

    it("renders empty state when channel list is empty", () => {
      const tree = renderChannels({
        channels: [],
        stats: {
          totalChannels: 0,
          totalWhatsapp: 0,
          totalInstagram: 0,
          activeConnected: 0,
          needsAction: 0,
          coexistenceCount: 0,
        },
      });

      const renderedText = text(tree);
      expect(renderedText).toContain("لا توجد قنوات مربوطة حالياً");
    });
  });
});
