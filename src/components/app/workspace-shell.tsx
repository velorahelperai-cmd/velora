"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clearCompanyDrafts } from "@/lib/company-draft";
import { type Business, emptyBusiness, useDemo } from "@/lib/demo-state";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/lib/tenancy/actions";
import type { CompanyRole } from "@/lib/tenancy/types";
import { Button, LangSwitch, PreviewBadge, useAppCopy } from "@/components/app/ui";

function toBusiness(company: {
  display_name: string;
  business_type: string;
  reply_language: string;
  country: string;
  city: string;
  hours: string;
  contact_phone: string;
  contact_email: string;
}): Business {
  const allowed: Business["type"][] = ["restaurant", "retail", "services", "other"];
  const type = allowed.includes(company.business_type as Business["type"])
    ? (company.business_type as Business["type"])
    : "other";
  const langs: Business["replyLanguage"][] = ["ar", "en", "both"];
  const replyLanguage = langs.includes(company.reply_language as Business["replyLanguage"])
    ? (company.reply_language as Business["replyLanguage"])
    : "both";
  return {
    name: company.display_name,
    type,
    replyLanguage,
    country: company.country,
    city: company.city,
    hours: company.hours,
    contactPhone: company.contact_phone,
    contactEmail: company.contact_email,
  };
}

export function WorkspaceShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const copy = useAppCopy();
  const { state, update, reset } = useDemo();
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<{
    name: string;
    email: string;
    role: CompanyRole;
    companyName: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) return;
        const { data: membership } = await supabase
          .from("company_members")
          .select("role, member_name, company_id, status")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!membership || cancelled) return;
        const { data: company } = await supabase
          .from("companies")
          .select("id, display_name, business_type, reply_language, country, city, hours, contact_phone, contact_email")
          .eq("id", membership.company_id)
          .maybeSingle();
        if (cancelled) return;
        setProfile({
          name: membership.member_name || (user.user_metadata?.full_name as string) || user.email || "User",
          email: user.email ?? "",
          role: membership.role,
          companyName: company?.display_name ?? "",
        });
        update({
          account: {
            name: membership.member_name || (user.user_metadata?.full_name as string) || "User",
            email: user.email ?? "",
            role: membership.role,
          },
          signedIn: true,
          stage: "active",
          viewAs: membership.role,
          ...(company
            ? {
                business: toBusiness(company),
                businessSaved: true,
              }
            : {}),
        });
      } catch {
        /* layout already enforces auth */
      }
    })();
    return () => { cancelled = true; };
  }, [update]);

  async function logout() {
    let userId: string | undefined;
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id;
    } catch {
      /* continue — signOut still authoritative */
    }
    const result = await signOut();
    if (!result.ok) {
      window.alert(result.message ?? copy.auth.logoutFailed);
      return;
    }
    if (userId) clearCompanyDrafts(userId);
    update({
      account: null,
      signedIn: false,
      stage: "guest",
      business: emptyBusiness,
      businessSaved: false,
      setupStep: 0,
      setupDone: [false, false, false, false],
    });
    router.replace("/login");
    router.refresh();
  }

  const nav = [
    { href: "/app", label: copy.app.nav.dashboard },
    { href: "/app/conversations", label: copy.app.nav.conversations },
    { href: "/app/knowledge", label: copy.app.nav.knowledge },
    { href: "/app/test", label: copy.app.nav.test },
    { href: "/app/settings", label: copy.app.nav.settings },
  ];
  const role = profile?.role ?? "owner";
  const effectiveRole = role === "owner" ? state.viewAs : role;

  if (!profile) {
    return <main className="app-shell" aria-busy="true" />;
  }

  return (
    <div className="app-shell overflow-x-hidden lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="app-shell-aside sticky top-0 z-20 border-b backdrop-blur lg:h-svh lg:border-b-0 lg:border-e lg:backdrop-blur-none">
        <div className="flex items-center justify-between gap-2 px-4 py-3 lg:flex-col lg:items-stretch lg:gap-4 lg:py-5">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xl font-bold tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317]">V</span>
            {copy.brand}
          </Link>
          <div className="flex items-center gap-2 lg:justify-between">
            <PreviewBadge note />
            <LangSwitch />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2 lg:hidden">
          <p className="app-muted truncate text-xs">{profile.name} · {effectiveRole === "owner" ? copy.app.owner : copy.app.staff}</p>
          <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => void logout()}>{copy.logout}</Button>
        </div>
        <nav aria-label={copy.app.nav.dashboard} className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] lg:flex-col lg:overflow-visible lg:px-3 [&::-webkit-scrollbar]:hidden">
          {nav.map((item) => {
            const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition ${active ? "bg-[#38dc89]/15 text-[#9af0c3]" : "text-[#dfe9e2] hover:bg-white/5"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-[color:var(--color-line)] px-4 py-4 text-sm lg:block">
          <p className="font-semibold tracking-tight">{profile.name}</p>
          <p className="app-muted-soft text-xs" dir="ltr">{profile.email}</p>
          <p className="app-muted mt-1 text-xs">{profile.companyName}</p>
          <p className="app-muted mt-1 text-xs">{copy.app.roleLabel}: {role === "owner" ? copy.app.owner : copy.app.staff}</p>
          {role === "owner" ? (
            <label className="app-muted-soft mt-3 grid gap-1 text-xs">
              {copy.app.viewAs}
              <select
                value={state.viewAs}
                onChange={(e) => update({ viewAs: e.target.value as "owner" | "staff" })}
                className="min-h-10 rounded-lg border border-white/15 bg-[#14221b] px-2 text-sm text-[#f7fbf8]"
              >
                <option value="owner">{copy.app.owner}</option>
                <option value="staff">{copy.app.staff}</option>
              </select>
            </label>
          ) : null}
          <div className="mt-4 grid gap-1">
            <Button variant="ghost" className="justify-start px-2" onClick={() => void logout()}>{copy.logout}</Button>
            <Button variant="ghost" className="app-muted justify-start px-2" onClick={() => { reset(); }}>{copy.resetPreview}</Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 overflow-x-hidden px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8">
        <div className="mb-6 flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-[color:var(--color-line)] pb-4">
          <h1 className="app-title min-w-0 break-words text-2xl lg:text-[2rem]">{title}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  );
}
