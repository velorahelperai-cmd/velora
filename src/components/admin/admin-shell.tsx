"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { LangSwitch } from "@/components/app/ui";
import { AccountMenu } from "@/components/app/account-chrome";
import theme from "./admin-theme.module.css";
import {
  IconBuilding,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconCreditCard,
  IconDashboard,
  IconMenu,
  IconRocket,
  IconShield,
  IconSparkles,
  IconUsers,
  IconX,
} from "./admin-icons";

type NavItem = {
  label: string;
  href: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactNode;
  active: boolean;
  pill?: string;
  pillColor?: string;
};

type NavGroup = {
  group: string;
  items: NavItem[];
};

export function AdminShell({ children }: { children: ReactNode }) {
  const { locale } = useDemo();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const isRtl = locale === "ar";

  const navItems: NavGroup[] = [
    {
      group: isRtl ? "لوحة التحكم الرئيسية" : "Main Dashboard",
      items: [
        {
          label: isRtl ? "نظرة عامة والذكاء" : "Overview & AI",
          href: "/admin",
          icon: IconDashboard,
          active: pathname === "/admin",
        },
        {
          label: isRtl ? "الشركات والعملاء" : "Companies & Tenants",
          href: "/admin#companies",
          icon: IconBuilding,
          active: pathname.startsWith("/admin/companies"),
        },
        {
          label: isRtl ? "الحسابات والمستخدمين" : "Accounts & Users",
          href: "/admin#accounts",
          icon: IconUsers,
          active: false,
        },
        {
          label: isRtl ? "طلبات التوثيق والمراجعة" : "Verification Reviews",
          href: "/admin#reviews",
          icon: IconCheckCircle,
          active: false,
        },
        {
          label: isRtl ? "موجّه الذكاء وسجل التكلفة" : "AI Router & Ledger",
          href: "/admin/ai",
          icon: IconSparkles,
          active: pathname === "/admin/ai",
          pill: isRtl ? "فعلي" : "Real",
        },
      ],
    },
    {
      group: isRtl ? "الإعدادات والاشتراكات" : "Catalog & Operations",
      items: [
        {label:isRtl?"\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643":"Subscription orders",href:"/admin/billing",icon:IconCreditCard,active:pathname.startsWith("/admin/billing")},
        {
          label: isRtl ? "كتالوج الاشتراكات" : "Plans Catalog",
          href: "/admin/catalog",
          icon: IconCreditCard,
          active: pathname === "/admin/catalog",
        },
        {
          label: isRtl ? "الصلاحيات والمشرفين" : "Access & Grants",
          href: "/admin/access",
          icon: IconShield,
          active: pathname === "/admin/access",
        },
      ],
    },
    {
      group: isRtl ? "خارطة الطريق المستقبلية" : "Roadmap",
      items: [
        {
          label: isRtl ? "الميزات المؤسسية القادمة" : "Planned Modules",
          href: "/admin#future",
          icon: IconRocket,
          active: false,
          pill: isRtl ? "قريباً" : "Soon",
          pillColor: "bg-[#EFE2CF] text-[#6B4932] border-[#D7C1A5]",
        },
      ],
    },
  ];

  // Breadcrumbs calculation
  const getBreadcrumbs = () => {
    if (pathname === "/admin") {
      return [{ label: isRtl ? "الرئيسية" : "Overview", href: "/admin" }];
    }
    if (pathname.startsWith("/admin/companies")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "الشركات" : "Companies", href: "/admin#companies" },
        { label: isRtl ? "تفاصيل الشركة" : "Company Detail", href: pathname },
      ];
    }
    if (pathname === "/admin/ai") return [{label:isRtl?"الرئيسية":"Overview",href:"/admin"},{label:isRtl?"تجارب الذكاء وسجل الاستهلاك":"AI trials and usage",href:"/admin/ai"}];
    if (pathname === "/admin/catalog") {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "كتالوج الاشتراكات" : "Plans Catalog", href: "/admin/catalog" },
      ];
    }
    if (pathname === "/admin/access") {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "الصلاحيات والمشرفين" : "Access Control", href: "/admin/access" },
      ];
    }
    return [{ label: isRtl ? "لوحة الإدارة" : "Admin", href: "/admin" }];
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div
      data-admin-theme="warm"
      className={`${theme.theme} min-h-screen flex flex-col antialiased selection:bg-[#D1AE7C]/40 selection:text-[#18130F]`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* 📱 Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#6B4932]/25 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex flex-1 min-h-screen">
        {/* 🧭 Admin Sidebar */}
        <aside
          className={`fixed inset-y-0 z-50 flex flex-col bg-[#EFE2CF] border-[#D7C1A5] transition-all duration-200 ease-in-out ${
            isRtl ? "border-l right-0" : "border-r left-0"
          } ${
            mobileOpen
              ? "translate-x-0 w-64 shadow-2xl"
              : isRtl
              ? "translate-x-full lg:translate-x-0"
              : "-translate-x-full lg:translate-x-0"
          } ${collapsed ? "lg:w-20" : "lg:w-64"}`}
        >
          {/* Sidebar Brand Header */}
          <div className="flex items-center justify-between h-16 px-4 border-b border-[#D7C1A5]">
            <Link
              href="/admin"
              className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6B4932] rounded-xl p-1"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#D1AE7C] to-[#E4D3B8] font-bold text-[#18130F] shadow-md shadow-[#6B4932]/20">
                V
              </span>
              {!collapsed && (
                <div className="min-w-0 transition-opacity">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-base tracking-tight text-[#18130F] group-hover:text-[#6B4932] transition">
                      Velora
                    </span>
                    <span className="rounded bg-[#6B4932]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#6B4932] border border-[#6B4932]/30">
                      ADMIN
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B4932] font-medium truncate">
                    {isRtl ? "منصة التحكم الشاملة" : "Enterprise Control"}
                  </p>
                </div>
              )}
            </Link>

            {/* Mobile close button */}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="p-1.5 rounded-lg text-[#6B4932] hover:text-[#18130F] hover:bg-[#D7C1A5] lg:hidden"
              aria-label="Close menu"
            >
              <IconX />
            </button>
          </div>

          {/* Sidebar Navigation Items */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-stone-300">
            {navItems.map((group, idx) => (
              <div key={idx} className="space-y-1">
                {!collapsed && (
                  <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-[#6B4932]">
                    {group.group}
                  </p>
                )}
                <div className="space-y-1 pt-1">
                  {group.items.map((item, itemIdx) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={itemIdx}
                        href={item.href}
                        onClick={() => {
                          setMobileOpen(false);
                          const hash = item.href.split("#")[1];
                          if (pathname === "/admin" && hash) window.dispatchEvent(new CustomEvent("velora-admin-tab", {detail:hash}));
                        }}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all group ${
                          item.active
                            ? "bg-[#D1AE7C] text-[#18130F] font-bold shadow-sm shadow-[#6B4932]/20"
                            : "text-[#18130F] hover:text-[#18130F] hover:bg-[#D7C1A5] font-medium"
                        } ${collapsed ? "justify-center px-0" : ""}`}
                      >
                        <Icon
                          className={`shrink-0 transition-colors ${
                            item.active
                              ? "text-[#18130F]"
                              : "text-[#6B4932] group-hover:text-[#18130F]"
                          }`}
                        />
                        {!collapsed && (
                          <span className="flex-1 truncate">{item.label}</span>
                        )}
                        {!collapsed && item.pill && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                              item.pillColor ||
                              "bg-[#EFE2CF] text-[#6B4932] border-[#D7C1A5]"
                            }`}
                          >
                            {item.pill}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Sidebar Status Footer */}
          <div className="p-3 border-t border-[#D7C1A5] space-y-2">
            {!collapsed && (
              <div className="rounded-xl border border-[#D7C1A5] bg-[#FFFBF5] p-2.5 shadow-sm">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-[#6B4932] font-bold">
                    <span className="h-2 w-2 rounded-full bg-[#6B4932] animate-pulse" />
                    {isRtl ? "إدارة منصة فيلورا" : "Velora administration"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#615244]">
                  {isRtl ? "عرض البيانات وسجل الاستهلاك" : "Data and usage ledger"}
                </p>
              </div>
            )}

            {/* Collapse / Expand Toggle Button (Desktop only) */}
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="hidden lg:flex w-full items-center justify-center p-2 rounded-xl text-[#6B4932] hover:text-[#18130F] hover:bg-[#D7C1A5] transition"
              title={collapsed ? (isRtl ? "توسيع القائمة" : "Expand") : isRtl ? "طي القائمة" : "Collapse"}
            >
              {isRtl ? (
                collapsed ? <IconChevronLeft /> : <IconChevronRight />
              ) : (
                collapsed ? <IconChevronRight /> : <IconChevronLeft />
              )}
            </button>
          </div>
        </aside>

        {/* 💻 Main Workspace Area */}
        <div
          className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ${
            collapsed ? (isRtl ? "lg:mr-20" : "lg:ml-20") : isRtl ? "lg:mr-64" : "lg:ml-64"
          }`}
        >
          {/* 🔝 Persistent Admin Topbar */}
          <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 sm:px-6 bg-[#EFE2CF]/95 backdrop-blur-md border-b border-[#D7C1A5]">
            {/* Left/Start side: Mobile trigger & Breadcrumbs */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="p-2 rounded-xl text-[#6B4932] hover:text-[#18130F] hover:bg-[#D7C1A5] lg:hidden"
                aria-label="Open navigation"
              >
                <IconMenu />
              </button>

              {/* Breadcrumbs */}
              <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="text-[#6B4932] font-semibold hidden sm:inline">
                  {isRtl ? "لوحة الإدارة" : "Platform Admin"}
                </span>
                <span className="text-[#615244] hidden sm:inline">/</span>
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-[#615244]">/</span>}
                    {i === breadcrumbs.length - 1 ? (
                      <span className="font-bold text-[#18130F] truncate max-w-[150px] sm:max-w-none">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className="text-[#6B4932] hover:text-[#18130F] font-medium transition truncate max-w-[100px] sm:max-w-none"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </span>
                ))}
              </nav>
            </div>

            {/* Right/End side: Status pills, LangSwitch, AccountMenu */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* AI Router Status Indicator */}
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EFE2CF] border border-[#D7C1A5] text-xs text-[#6B4932] font-bold">
                <span className="h-2 w-2 rounded-full bg-[#6B4932]" />
                <span>{isRtl ? "تجارب الذكاء" : "AI trials"}</span>
              </div>

              {/* WhatsApp Live Safety Mode */}
              <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EFE2CF] border border-[#D7C1A5] text-xs text-[#6B4932] font-semibold">
                <span>🛡️ {isRtl ? "واتساب المباشر معطل" : "Live WhatsApp Muted"}</span>
              </div>

              {/* Language Switcher */}
              <LangSwitch />

              {/* Platform Admin Account Menu */}
              <AccountMenu compact />
            </div>
          </header>

          {/* 📄 Main Content Wrapper */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
