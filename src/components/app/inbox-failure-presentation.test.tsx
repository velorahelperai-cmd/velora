import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
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
import ConversationsRoute from "@/app/app/conversations/page";
import DashboardRoute from "@/app/app/page";
import { appCopy } from "@/lib/app-copy";
import { dashboardInboxMetrics } from "./onboarding-contracts";

beforeEach(() => { vi.clearAllMocks(); state.locale = "en"; });
describe.each(["en", "ar"])("inbox failure presentation in %s", locale => {
 for (const [name, route] of [["conversations", ConversationsRoute], ["dashboard", DashboardRoute]] as const) {
  it(`${name} renders explicit denial without outage or empty-success copy`, async () => {
   state.locale=locale;state.load.mockResolvedValue({ok:false,code:"FORBIDDEN"});
   const html=renderToStaticMarkup(await route());
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
   const html=renderToStaticMarkup(await route());
   expect(html).toContain(name === "conversations" ? (locale === "ar" ? "فشل قراءة صندوق" : "The server inbox read failed") : (locale === "ar" ? "تعذّر تحميل بيانات المحادثات" : "Conversation data could not be loaded"));
   expect(html).not.toContain(appCopy(locale as "ar"|"en").app.inboxAccessDeniedTitle);
  });
 }
});
it("does not invent dashboard counts for denied data", () => {
 expect(dashboardInboxMetrics({ok:false,code:"FORBIDDEN"})).toEqual({total:null,loadedAutomationPermitted:null,loadedAwaitingStaff:null});
});
