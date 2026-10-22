"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { LangSwitch } from "@/components/app/ui";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
import theme from "./admin-theme.module.css";
import {
  IconAlert,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconCreditCard,
  IconDashboard,
  IconFileText,
  IconHeadphones,
  IconKey,
  IconLayers,
  IconMenu,
  IconPulse,
  IconSettings,
  IconShield,
  IconSparkles,
  IconTrending,
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
  const session = useOptionalAccountSession();
  const teamEditor =
    session?.status === "ready" &&
    session.identity?.platformIdentity.role === "owner" &&
    session.identity.platformIdentity.status === "active" &&
    !session.identity.platformIdentity.unavailable;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileMenu = () => {
    setMobileOpen(false);
    menuButtonRef.current?.focus();
  };

  useEffect(() => {
    if (mobileOpen) closeButtonRef.current?.focus();
  }, [mobileOpen]);

  // Close mobile drawer on route change
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const isRtl = locale === "ar";

  const isNavActive = (href: string) => {
    const cleanPath = pathname.split("#")[0];
    const targetPath = href.split("#")[0];
    if (targetPath === "/admin") {
      return cleanPath === "/admin";
    }
    return cleanPath.startsWith(targetPath);
  };

  const navItems: NavGroup[] = [
    {
      group: isRtl ? "الرئيسية والتشغيل" : "Main & Operations",
      items: [
        {
          label: isRtl ? "لوحة المتابعة التنفيذية" : "Executive Dashboard",
          href: "/admin",
          icon: IconDashboard,
          active: pathname === "/admin",
        },
        {
          label: isRtl ? "مركز العمليات والأعطال" : "Operations Center",
          href: "/admin/operations",
          icon: IconAlert,
          active: isNavActive("/admin/operations"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
        {
          label: isRtl ? "جاهزية وصحة المنصة" : "Platform Health",
          href: "/admin/health",
          icon: IconPulse,
          active: isNavActive("/admin/health"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
      ],
    },
    {
      group: isRtl ? "العملاء والخدمات" : "Customers & Services",
      items: [
        {
          label: isRtl ? "الشركات والفروع" : "Companies & Branches",
          href: "/admin/companies",
          icon: IconBuilding,
          active:
            isNavActive("/admin/companies") ||
            (pathname === "/admin" && typeof window !== "undefined" && window.location.hash === "#companies"),
        },
        {
          label: isRtl ? "الحسابات والمستخدمين" : "Accounts & Users",
          href: "/admin/accounts",
          icon: IconUsers,
          active:
            isNavActive("/admin/accounts") ||
            (pathname === "/admin" && typeof window !== "undefined" && window.location.hash === "#accounts"),
        },
        {
          label: isRtl ? "مركز القنوات والربط" : "Channels Hub",
          href: "/admin/channels",
          icon: IconLayers,
          active: isNavActive("/admin/channels"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
        {
          label: isRtl ? "مساعدو وتشغيل الذكاء" : "AI Assistants & Operations",
          href: "/admin/ai",
          icon: IconSparkles,
          active: isNavActive("/admin/ai"),
          pill: isRtl ? "فعلي" : "Live",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-accent)] border-[var(--service-line)]",
        },
      ],
    },
    {
      group: isRtl ? "الاشتراكات والمالية" : "Billing & Finance",
      items: [
        {
          label: isRtl ? "سجل المدفوعات والطلبات" : "Billing & Orders",
          href: "/admin/billing",
          icon: IconCreditCard,
          active: isNavActive("/admin/billing"),
        },
        {
          label: isRtl ? "كتالوج الباقات والأسعار" : "Plans Catalog",
          href: "/admin/catalog",
          icon: IconCreditCard,
          active: isNavActive("/admin/catalog"),
        },
        {
          label: isRtl ? "التقارير والتحليل المالي" : "Financial Analytics",
          href: "/admin/analytics",
          icon: IconTrending,
          active: isNavActive("/admin/analytics"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
      ],
    },
    {
      group: isRtl ? "الدعم والحوكمة" : "Support & Governance",
      items: [
        {
          label: isRtl ? "تذاكر الدعم والمراجعات" : "Support & Reviews",
          href: "/admin/support",
          icon: IconHeadphones,
          active:
            isNavActive("/admin/support") ||
            (pathname === "/admin" && typeof window !== "undefined" && window.location.hash === "#reviews"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
        {
          label: isRtl ? "الصلاحيات والمشرفين" : "Access & Grants",
          href: "/admin/access",
          icon: IconShield,
          active: isNavActive("/admin/access"),
        },
        ...(teamEditor
          ? [
              {
                label: isRtl ? "فرق المنصة الداخلية" : "Internal platform teams",
                href: "/admin/teams",
                icon: IconUsers,
                active: isNavActive("/admin/teams"),
              },
            ]
          : []),
        {
          label: isRtl ? "سجل التدقيق والامتثال" : "Audit & Compliance",
          href: "/admin/audit",
          icon: IconFileText,
          active: isNavActive("/admin/audit"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
      ],
    },
    {
      group: isRtl ? "إعدادات المنصة" : "Platform Settings",
      items: [
        {
          label: isRtl ? "أتمتة وإعدادات النظام" : "Settings & Automations",
          href: "/admin/settings",
          icon: IconSettings,
          active: isNavActive("/admin/settings"),
          pill: isRtl ? "قيد الإعداد" : "In Progress",
          pillColor: "bg-[var(--service-subtle)] text-[var(--service-warning)] border-[var(--service-line)]",
        },
        {
          label: isRtl ? "استرداد الوصول والهوية" : "Identity Recovery",
          href: "/admin/identity-recovery",
          icon: IconKey,
          active: isNavActive("/admin/identity-recovery"),
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
        { label: isRtl ? "الشركات والفروع" : "Companies & Branches", href: "/admin/companies" },
        ...(pathname !== "/admin/companies"
          ? [{ label: isRtl ? "تفاصيل الشركة" : "Company Detail", href: pathname }]
          : []),
      ];
    }
    if (pathname.startsWith("/admin/operations")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "مركز العمليات والأعطال" : "Operations Center", href: "/admin/operations" },
      ];
    }
    if (pathname.startsWith("/admin/health")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "جاهزية وصحة المنصة" : "Platform Health", href: "/admin/health" },
      ];
    }
    if (pathname.startsWith("/admin/accounts")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "الحسابات والمستخدمين" : "Accounts & Users", href: "/admin/accounts" },
      ];
    }
    if (pathname.startsWith("/admin/channels")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "مركز القنوات والربط" : "Channels Hub", href: "/admin/channels" },
      ];
    }
    if (pathname === "/admin/ai") {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "مساعدو وتشغيل الذكاء" : "AI Assistants & Operations", href: "/admin/ai" },
      ];
    }
    if (pathname.startsWith("/admin/billing")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "سجل المدفوعات والطلبات" : "Billing & Orders", href: "/admin/billing" },
      ];
    }
    if (pathname === "/admin/catalog") {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "كتالوج الباقات والأسعار" : "Plans Catalog", href: "/admin/catalog" },
      ];
    }
    if (pathname.startsWith("/admin/analytics")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "التحليلات والتقارير" : "Analytics & Reports", href: "/admin/analytics" },
      ];
    }
    if (pathname.startsWith("/admin/support")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "تذاكر الدعم والمراجعات" : "Support & Reviews", href: "/admin/support" },
      ];
    }
    if (pathname === "/admin/access") {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "الصلاحيات والمشرفين" : "Access & Grants", href: "/admin/access" },
      ];
    }
    if (pathname.startsWith("/admin/teams")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "فرق المنصة الداخلية" : "Internal platform teams", href: "/admin/teams" },
      ];
    }
    if (pathname.startsWith("/admin/audit")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "سجل التدقيق والامتثال" : "Audit & Compliance", href: "/admin/audit" },
      ];
    }
    if (pathname.startsWith("/admin/settings")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "إعدادات المنصة والأتمتة" : "Settings & Automations", href: "/admin/settings" },
      ];
    }
    if (pathname.startsWith("/admin/identity-recovery")) {
      return [
        { label: isRtl ? "الرئيسية" : "Overview", href: "/admin" },
        { label: isRtl ? "استرداد الوصول والهوية" : "Identity Recovery", href: "/admin/identity-recovery" },
      ];
    }
    return [{ label: isRtl ? "لوحة الإدارة" : "Admin", href: "/admin" }];
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div
      data-admin-theme="warm"
      data-service-theme="true"
      className={`${theme.theme} min-h-screen flex flex-col antialiased selection:bg-[var(--service-accent-soft)]/40 selection:text-[var(--service-ink)]`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* 📱 Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[var(--service-accent)]/25 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={closeMobileMenu}
        />
      )}

      <div className="flex flex-1 min-h-screen">
        {/* 🧭 Admin Sidebar */}
        <aside
          onKeyDown={(event) => {
            if (event.key === "Escape" && mobileOpen) {
              event.preventDefault();
              closeMobileMenu();
            }
          }}
          className={`fixed inset-y-0 z-50 flex-col bg-[var(--service-subtle)] border-[var(--service-line)] transition-all duration-200 ease-in-out ${
            isRtl ? "border-l right-0" : "border-r left-0"
          } ${
            mobileOpen
              ? "flex translate-x-0 w-64 shadow-2xl"
              : isRtl
              ? "hidden lg:flex translate-x-full lg:translate-x-0"
              : "hidden lg:flex -translate-x-full lg:translate-x-0"
          } ${collapsed ? "lg:w-20" : "lg:w-64"}`}
        >
          {/* Sidebar Brand Header */}
          <div className="flex items-center justify-between h-16 px-4 border-b border-[var(--service-line)]">
            <Link
              href="/admin"
              className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--service-accent)] rounded-xl p-1"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[var(--service-accent-soft)] to-[var(--service-accent-soft)] font-bold text-[var(--service-ink)] shadow-md shadow-[var(--service-accent)]/20">
                V
              </span>
              {!collapsed && (
                <div className="min-w-0 transition-opacity">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-base tracking-tight text-[var(--service-ink)] group-hover:text-[var(--service-accent)] transition">
                      Velora
                    </span>
                    <span className="rounded bg-[var(--service-accent)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[var(--service-accent)] border border-[var(--service-accent)]/30">
                      ADMIN
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--service-accent)] font-medium truncate">
                    {isRtl ? "منصة التحكم الشاملة" : "Enterprise Control"}
                  </p>
                </div>
              )}
            </Link>

            {/* Mobile close button */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeMobileMenu}
              className="p-1.5 rounded-lg text-[var(--service-accent)] hover:text-[var(--service-ink)] hover:bg-[var(--service-line)] lg:hidden"
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
                  <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-[var(--service-accent)]">
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
                          if (pathname === "/admin" && hash) {
                            window.dispatchEvent(new CustomEvent("velora-admin-tab", { detail: hash }));
                          }
                        }}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all group ${
                          item.active
                            ? "bg-[var(--service-accent-soft)] text-[var(--service-ink)] font-bold shadow-sm shadow-[var(--service-accent)]/20"
                            : "text-[var(--service-ink)] hover:text-[var(--service-ink)] hover:bg-[var(--service-line)] font-medium"
                        } ${collapsed ? "justify-center px-0" : ""}`}
                      >
                        <Icon
                          className={`shrink-0 transition-colors ${
                            item.active
                              ? "text-[var(--service-ink)]"
                              : "text-[var(--service-accent)] group-hover:text-[var(--service-ink)]"
                          }`}
                        />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {!collapsed && item.pill && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                              item.pillColor ||
                              "bg-[var(--service-subtle)] text-[var(--service-accent)] border-[var(--service-line)]"
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
          <div className="p-3 border-t border-[var(--service-line)] space-y-2">
            {!collapsed && (
              <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-2.5 shadow-sm">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--service-accent)] font-bold">
                    <span className="h-2 w-2 rounded-full bg-[var(--service-accent)] animate-pulse" />
                    {isRtl ? "إدارة منصة فيلورا" : "Velora administration"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--service-muted)]">
                  {isRtl ? "عرض البيانات وسجل الاستهلاك" : "Data and usage ledger"}
                </p>
              </div>
            )}

            {/* Collapse / Expand Toggle Button (Desktop only) */}
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="hidden lg:flex w-full items-center justify-center p-2 rounded-xl text-[var(--service-accent)] hover:text-[var(--service-ink)] hover:bg-[var(--service-line)] transition"
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
          <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 bg-[var(--service-subtle)]/95 backdrop-blur-md border-b border-[var(--service-line)]">
            {/* Left/Start side: Mobile trigger & Breadcrumbs */}
            <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMobileOpen(true)}
                className="shrink-0 p-2 rounded-xl text-[var(--service-accent)] hover:text-[var(--service-ink)] hover:bg-[var(--service-line)] lg:hidden"
                aria-label="Open navigation"
                aria-expanded={mobileOpen}
              >
                <IconMenu />
              </button>

              {/* Breadcrumbs */}
              <nav
                aria-label="Breadcrumb"
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm [overflow-wrap:anywhere]"
              >
                <span className="text-[var(--service-accent)] font-semibold hidden sm:inline">
                  {isRtl ? "لوحة الإدارة" : "Platform Admin"}
                </span>
                <span className="text-[var(--service-muted)] hidden sm:inline">/</span>
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-2">
                    {i > 0 && <span className="text-[var(--service-muted)]">/</span>}
                    {i === breadcrumbs.length - 1 ? (
                      <span className="min-w-0 font-bold text-[var(--service-ink)]">{crumb.label}</span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className="min-w-0 text-[var(--service-accent)] hover:text-[var(--service-ink)] font-medium transition"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </span>
                ))}
              </nav>
            </div>

            {/* Right/End side: Status pills, LangSwitch, AccountMenu */}
            <div className="flex w-full max-w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
              {/* AI Router Status Indicator */}
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--service-subtle)] border border-[var(--service-line)] text-xs text-[var(--service-accent)] font-bold">
                <span className="h-2 w-2 rounded-full bg-[var(--service-accent)]" />
                <span>{isRtl ? "تجارب الذكاء" : "AI trials"}</span>
              </div>

              {/* WhatsApp Live Safety Mode */}
              <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--service-subtle)] border border-[var(--service-line)] text-xs text-[var(--service-accent)] font-semibold">
                <span>🛡️ {isRtl ? "واتساب المباشر معطل" : "Live WhatsApp Muted"}</span>
              </div>

              {/* Language Switcher */}
              <LangSwitch />

              {/* Platform Admin Account Menu */}
              <AccountMenu compact />
            </div>
          </header>

          {/* 📄 Main Content Wrapper */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
