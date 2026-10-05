"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { emptyCompanyDraft, readCompanyDraft, writeCompanyDraft } from "@/lib/company-draft";
import { useDemo } from "@/lib/demo-state";
import { landingCopy, type PlanId } from "@/lib/landing-copy";
import { AccountSettingsLinkCard } from "@/components/app/account-page";
import { WhatsappSettingsPanel } from "@/components/app/whatsapp-settings-panel";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { createClient } from "@/lib/supabase/client";
import { saveOwnerBusiness } from "@/lib/tenancy/actions";
import {
  Button, Card, Field, Notice, Tabs,
  useAction, useAppCopy, useUnsavedWarning,
} from "@/components/app/ui";

type Tab = "account" | "business" | "team" | "whatsapp" | "plan";

export function SettingsPage({
  initialWhatsappLink = null,
  whatsappLinkLoadFailed = false,
}: {
  initialWhatsappLink?: import("@/lib/whatsapp/connection").WhatsappCompanyLink | null;
  whatsappLinkLoadFailed?: boolean;
}) {
  const copy = useAppCopy();
  const { state, update, effectiveRole, locale } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const requested = (params.get("tab") as Tab) || "account";
  const ownerTabs: Tab[] = ["business", "team", "whatsapp", "plan"];
  const tabs = (Object.keys(copy.app.tabs) as Tab[])
    .filter((id) => effectiveRole === "owner" || !ownerTabs.includes(id))
    .map((id) => ({ id, label: copy.app.tabs[id] }));
  const tab = tabs.some((t) => t.id === requested) ? requested : "account";
  const locked = effectiveRole !== "owner" && ownerTabs.includes(requested);

  return (
    <WorkspaceShell title={copy.app.settingsTitle}>
      <Tabs tabs={tabs} value={tab} onChange={(t) => router.replace(`/app/settings?tab=${t}`)} />
      <div className="mt-5">
        {locked ? (
          <Notice tone="warn">{copy.app.ownerOnly}</Notice>
        ) : (
          <>
            {tab === "account" ? <AccountTab /> : null}
            {tab === "business" ? <BusinessTab /> : null}
            {tab === "team" ? <TeamTab /> : null}
            {tab === "whatsapp" ? (
              <WhatsappSettingsPanel
                initialLink={initialWhatsappLink}
                initialLoadFailed={whatsappLinkLoadFailed}
              />
            ) : null}
            {tab === "plan" ? (
              <Card title={copy.app.tabs.plan}>
                <Notice tone="warn">{copy.app.planNotConfigured}</Notice>
                <p className="mt-3 text-sm text-[#adbeaf]">{copy.app.planLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {landingCopy(locale).plans.map((p) => (
                    <button key={p.id} type="button" aria-pressed={state.planInterest === p.id} onClick={() => update({ planInterest: p.id as PlanId })} className={`min-h-11 rounded-full px-4 text-sm ${state.planInterest === p.id ? "bg-[#38dc89] text-[#072317]" : "border border-white/15"}`}>{p.name}</button>
                  ))}
                  <button type="button" aria-pressed={state.planInterest === null} onClick={() => update({ planInterest: null })} className={`min-h-11 rounded-full px-4 text-sm ${state.planInterest === null ? "bg-[#38dc89] text-[#072317]" : "border border-white/15"}`}>{copy.app.none}</button>
                </div>
                <p className="mt-3 text-xs text-[#8da195]">{copy.app.planNote}</p>
                <h3 className="mt-6 font-bold">{copy.app.usage}</h3>
                <p className="mt-2 text-xs text-[#8da195]">{copy.app.usageNote}</p>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function AccountTab() {
  return <AccountSettingsLinkCard />;
}

function BusinessTab() {
  const copy = useAppCopy();
  const { state, update } = useDemo();
  const [form, setForm] = useState(state.business);
  const [saved, setSaved] = useState(false);
  const { busy, run } = useAction();
  const dirty = JSON.stringify(form) !== JSON.stringify(state.business);
  useUnsavedWarning(dirty && !busy);
  return (
    <Card title={copy.app.tabs.business}>
      <form className="grid gap-4 lg:grid-cols-2" noValidate onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const result = await saveOwnerBusiness({
            displayName: form.name,
            businessType: form.type,
            replyLanguage: form.replyLanguage,
            country: form.country,
            city: form.city,
            hours: form.hours,
            contactPhone: form.contactPhone,
            contactEmail: form.contactEmail,
          });
          if (!result.ok) {
            window.alert(result.message ?? copy.errors.authFailed);
            return;
          }
          const business = {
            name: result.data.display_name,
            type: form.type,
            replyLanguage: result.data.reply_language,
            country: result.data.country,
            city: result.data.city,
            hours: result.data.hours,
            contactPhone: result.data.contact_phone,
            contactEmail: result.data.contact_email,
          };
          update({ business, businessSaved: true });
          setForm(business);
          const supabase = createClient();
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData.user?.id;
          if (userId) {
            const existing = readCompanyDraft(userId) ?? emptyCompanyDraft(userId);
            writeCompanyDraft({
              ...existing,
              userId,
              companyId: result.data.id,
              business,
              businessSaved: true,
            });
          }
          setSaved(true);
        });
      }}>
        {saved && !dirty ? <div className="lg:col-span-2"><Notice tone="success">{copy.saved}</Notice></div> : null}
        <Field label={copy.setup.businessName} required>{(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label={copy.setup.city}>{(p) => <input {...p} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
        <Field label={copy.setup.hours} required>{(p) => <input {...p} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />}</Field>
        <Field label={copy.setup.contactPhone}>{(p) => <input {...p} dir="ltr" inputMode="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />}</Field>
        <div className="lg:col-span-2"><Button type="submit" busy={busy} busyLabel={copy.saving} disabled={!dirty || !form.name.trim()}>{copy.save}</Button></div>
      </form>
    </Card>
  );
}

function TeamTab() {
  const copy = useAppCopy();
  return (
    <Card title={copy.app.tabs.team}>
      <Notice tone="warn">{copy.app.teamInviteUnavailable}</Notice>
    </Card>
  );
}
