import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import React, { Suspense, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ locale: "en", load: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: state.locale }) }));
vi.mock("@/components/app/workspace-shell", () => ({ WorkspaceShell: ({ children, actions }: {children: ReactNode; actions: ReactNode}) => React.createElement("main", null, actions, children) }));
vi.mock("@/lib/whatsapp/inbox", () => ({ loadWhatsappInboxInitialPage: state.load }));
vi.mock("@/lib/whatsapp/actions", () => ({ controlWhatsappConversation: vi.fn(), replyWhatsappConversation: vi.fn(), upsertConversationLeadState: vi.fn() }));
vi.mock("@/lib/whatsapp/inbox-actions", () => ({ refreshWhatsappInboxInitialPage: vi.fn(), refreshWhatsappInboxPage: vi.fn(), refreshWhatsappThreadPage: vi.fn(), refreshWhatsappControlAuditPage: vi.fn(), refreshWhatsappConnectionStatus: vi.fn(), markWhatsappThreadSeen: vi.fn() }));
vi.mock("@/lib/tenancy/actions", () => ({ getCustomerReadiness: async () => ({ok:false,code:"UNAVAILABLE"}) }));
vi.mock("@/lib/customer/dashboard-billing-actions", () => ({ readDashboardBilling: vi.fn() }));
vi.mock("@/lib/customer/service-inbox-actions", () => ({ readServiceInbox: state.load }));
import ConversationsRoute from "@/app/app/conversations/page";
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:async()=>({ok:true,context:{userId:"owner",fullName:"Owner",company:{id:"company",display_name:"Business"},membership:{role:"owner"}}})}));
import DashboardRoute from "@/app/app/page";
import { UnifiedInbox } from "./unified-inbox";
import { appCopy } from "@/lib/app-copy";
import { dashboardInboxMetrics } from "./onboarding-contracts";
type ReadableSnapshot = Extract<ComponentProps<typeof UnifiedInbox>["initial"], { ok: true }>;
type AsyncRouteChild = (props: unknown) => Promise<React.ReactElement>;
type SuspensePage = React.ReactElement<{ children: React.ReactElement; fallback: ReactNode }>;

async function resolveRouteTree(content: unknown) {
  if (React.isValidElement<{ children?: ReactNode }>(content) && content.type === Suspense) {
    const child = content.props.children;
    if (React.isValidElement(child) && typeof child.type === "function" && child.type.constructor.name === "AsyncFunction") {
      return await (child.type as AsyncRouteChild)(child.props);
    }
  }
  return content;
}

beforeEach(() => { vi.clearAllMocks(); state.locale = "en"; });
describe.each(["en", "ar"])("inbox failure presentation in %s", locale => {
 for (const [name, route] of [["conversations", ConversationsRoute], ["dashboard", DashboardRoute]] as const) {
  it(`${name} renders explicit denial without outage or empty-success copy`, async () => {
   state.locale=locale;state.load.mockResolvedValue({ok:false,code:"FORBIDDEN"});
   const html=renderToStaticMarkup((await resolveRouteTree(await route())) as React.ReactElement);
   expect(html).toContain(appCopy(locale as "ar"|"en").app.inboxAccessDeniedTitle);
   expect(html).toContain(appCopy(locale as "ar"|"en").app.inboxAccessDeniedBody);
   expect(html).not.toContain(locale === "ar" ? "جلستك ما زالت قائمة" : "your session is still active");
   expect(html).not.toContain(locale === "ar" ? "فشل قراءة صندوق" : "The server inbox read failed");
   expect(html).not.toContain(locale === "ar" ? "تعذّر تحميل بيانات المحادثات" : "Conversation data could not be loaded");
   expect(html).not.toContain(locale === "ar" ? "لا توجد محادثات واتساب بعد" : "No WhatsApp conversations yet");
   expect(html).not.toContain(locale === "ar" ? "لا توجد محادثات جارية حتى الآن" : "No active conversations yet");
  });
  it(`${name} keeps unavailable distinct from denial and empty success`, async () => {
   state.locale=locale;state.load.mockResolvedValue({ok:false,code:"UNAVAILABLE"});
   const html=renderToStaticMarkup((await resolveRouteTree(await route())) as React.ReactElement);
   expect(html).toContain(name === "conversations" ? (locale === "ar" ? "فشل قراءة صندوق" : "The server inbox read failed") : (locale === "ar" ? "تعذّر تحميل بيانات المحادثات" : "Conversation data could not be loaded"));
   expect(html).not.toContain(appCopy(locale as "ar"|"en").app.inboxAccessDeniedTitle);
  });
 }
});
it("does not invent dashboard counts for denied data", () => {
 expect(dashboardInboxMetrics({ok:false,code:"FORBIDDEN"})).toEqual({total:null,loadedAutomationPermitted:null,loadedAwaitingStaff:null});
});

describe("Conversations page Suspense boundary and key regression", () => {
 it("wraps service inbox read inside Suspense and includes error code in failure key", async () => {
  state.load.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
  const pageTree = ConversationsRoute() as SuspensePage;
  expect(React.isValidElement(pageTree)).toBe(true);
  expect(pageTree.type).toBe(Suspense);
  expect(pageTree.props.fallback).toBeDefined();

  const childEl = await resolveRouteTree(pageTree) as React.ReactElement;
  expect(childEl.key).toBe("unavailable:UNAVAILABLE");

  state.load.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
  const forbiddenEl = await resolveRouteTree(pageTree) as React.ReactElement;
  expect(forbiddenEl.key).toBe("unavailable:FORBIDDEN");

  state.load.mockResolvedValue({
   ok: true,
   actorId: "actor-123",
   companyId: "company-456",
   waAllowed: false,
   igAllowed: false,
   channelContract: null,
   channel_access: { whatsapp: false, instagram: false },
   wa: { ok: false, code: "UNAVAILABLE" },
   ig: { ok: false, code: "UNAVAILABLE" },
  });
  const successEl = await resolveRouteTree(pageTree) as React.ReactElement;
  expect(successEl.key).toBe("actor-123:company-456");
 });
});

describe.each(["en", "ar"])("UnifiedInbox failure presentation in %s", locale => {
  const baseInitial: ReadableSnapshot = {
  ok: true as const,
  companyId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  owner: false,
  companyInSetup: false,
  waAllowed: true,
  igAllowed: false,
  igAssignAllowed: false,
  channelContract: {
   plan_entitlements: {
    status: "UNCONFIGURED" as const,
   },
  } as ReadableSnapshot["channelContract"],
  channel_access: {
   whatsapp: true,
   instagram: false,
  },
  wa: {
   ok: false as const,
   code: "UNAVAILABLE" as const,
  },
  ig: {
   ok: false as const,
   code: "UNAVAILABLE" as const,
  },
 };

 it("separates channel failure from empty state and includes retry for temporary error", () => {
  state.locale = locale;
  const html = renderToStaticMarkup(React.createElement(UnifiedInbox, { initial: baseInitial }));
  expect(html).toContain(locale === "ar" ? "تعذّر تحميل القناة. أعد التحديث." : "This channel could not be loaded. Refresh to retry.");
  // Must NOT display "No conversations yet" when the channel failed
  expect(html).not.toContain(locale === "ar" ? "لا توجد محادثات بعد" : "No conversations yet");
  // Temporary error UNAVAILABLE must render Retry button
  expect(html).toContain(locale === "ar" ? "إعادة المحاولة" : "Retry");
 });

 it("omits retry button for FORBIDDEN channel error", () => {
  state.locale = locale;
  const forbiddenInitial = {
   ...baseInitial,
   wa: { ok: false as const, code: "FORBIDDEN" as const },
  };
  const html = renderToStaticMarkup(React.createElement(UnifiedInbox, { initial: forbiddenInitial }));
  expect(html).toContain(locale === "ar" ? "القراءة غير متاحة. راجع صلاحيات القناة والاشتراك." : "Reading unavailable. Check channel permissions and subscription.");
  expect(html).not.toContain(locale === "ar" ? "إعادة المحاولة" : "Retry");
  expect(html).not.toContain(locale === "ar" ? "لا توجد محادثات بعد" : "No conversations yet");
 });

 it("renders empty state when channel loaded successfully with 0 conversations", () => {
  state.locale = locale;
   const emptyInitial: ReadableSnapshot = {
   ...baseInitial,
   wa: {
    ok: true as const,
    conversations: [],
    page: {
      kind: "partial",
      companyId: baseInitial.companyId,
      conversationScope: "all_company",
      ordering: "newest_created",
     conversations: [],
      total: 0,
      unreadTotal: 0,
      interventionTotal: 0,
     hasMore: false,
     nextCursor: null,
     membershipFingerprint: "fp-1",
    },
    meta: {
     companyId: baseInitial.companyId, conversationScope: "all_company", timezone: null, timezoneAnnouncedUtc: true,
     canReply: false, canAssign: false, assignees: [],
     counts: { all: 0, awaiting_staff: 0, follow_up_today: 0, overdue: 0, trial_or_quote: 0 },
    },
   },
  };
  const html = renderToStaticMarkup(React.createElement(UnifiedInbox, { initial: emptyInitial }));
  expect(html).toContain(locale === "ar" ? "لا توجد محادثات بعد" : "No conversations yet");
  expect(html).toContain(locale === "ar" ? "تظهر الرسائل الواردة بعد ربط القناة والتحقق من استقبالها." : "Inbound messages appear after connecting and verifying the channel.");
 });
});
