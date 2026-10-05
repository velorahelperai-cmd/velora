"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { emptyCompanyDraft, readCompanyDraft, writeCompanyDraft } from "@/lib/company-draft";
import { type Member, uid, useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import { landingCopy, type PlanId } from "@/lib/landing-copy";
import { AccountSettingsLinkCard } from "@/components/app/account-page";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { createClient } from "@/lib/supabase/client";
import { saveOwnerBusiness } from "@/lib/tenancy/actions";
import {
  Button, Card, ConfirmDialog, EmptyState, Field, FieldErrorKey, Notice, SimTag, Tabs,
  isEmail, useAction, useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";

type Tab = "account" | "business" | "team" | "whatsapp" | "plan";

export function SettingsPage() {
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
              <Card title={copy.app.tabs.whatsapp}>
                <dl className="grid gap-3 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.app.numberLabel}</dt><dd dir="ltr">{state.activation.whatsappNumber || "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.app.whatsappStatus}</dt><dd className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{state.activation.status === "pending_review" ? copy.setup.pending : copy.setup.notConnected}</dd></div>
                </dl>
                <p className="mt-4 text-sm leading-6 text-[#adbeaf]">{copy.setup.pendingBody}</p>
                <Link href="/setup" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 text-sm">{copy.setup.title}</Link>
              </Card>
            ) : null}
            {tab === "plan" ? (
              <Card title={copy.app.tabs.plan} aside={<SimTag />}>
                <p className="text-sm text-[#adbeaf]">{copy.app.planLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {landingCopy(locale).plans.map((p) => (
                    <button key={p.id} type="button" aria-pressed={state.planInterest === p.id} onClick={() => update({ planInterest: p.id as PlanId })} className={`min-h-11 rounded-full px-4 text-sm ${state.planInterest === p.id ? "bg-[#38dc89] text-[#072317]" : "border border-white/15"}`}>{p.name}</button>
                  ))}
                  <button type="button" aria-pressed={state.planInterest === null} onClick={() => update({ planInterest: null })} className={`min-h-11 rounded-full px-4 text-sm ${state.planInterest === null ? "bg-[#38dc89] text-[#072317]" : "border border-white/15"}`}>{copy.app.none}</button>
                </div>
                <p className="mt-3 text-xs text-[#8da195]">{copy.app.planNote}</p>
                <h3 className="mt-6 font-bold">{copy.app.usage}</h3>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[18%] bg-[#38dc89]" /></div>
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
  const { state, update } = useDemo();
  const [form, setForm] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState<Partial<Record<"name" | "email", FieldErrorKey>>>({});
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [pending, setPending] = useState<Member | null>(null);
  const { busy, run } = useAction();
  const nameError = useErrorText(errors.name);
  const emailError = useErrorText(errors.email);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "required";
    if (!isEmail(form.email)) next.email = "email";
    setErrors(next);
    if (Object.keys(next).length) return;
    void run(() => {
      const member: Member = { id: uid(), name: form.name.trim(), email: form.email.trim(), role: "staff", status: "invited" };
      update((s) => ({ team: [...s.team, member] }));
      setInviteLink(`/accept-invite?state=valid&invite=${member.id}`);
      setForm({ name: "", email: "" });
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card title={copy.app.tabs.team}>
        {state.team.length === 0 ? (
          <EmptyState title={copy.app.teamEmpty} />
        ) : (
          <ul className="grid gap-2">
            {state.team.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3 text-sm">
                <div>
                  <p className="font-medium">{m.name} <span className="ms-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{m.role === "owner" ? copy.app.owner : copy.app.staff}</span></p>
                  <p className="text-xs text-[#8da195]" dir="ltr">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${m.status === "active" ? "bg-[#38dc89]/15 text-[#9af0c3]" : "bg-[#d9a467]/15 text-[#f0cf9d]"}`}>{m.status === "active" ? copy.app.active : copy.app.invited}</span>
                  <Button variant="danger" onClick={() => setPending(m)}>{copy.app.removeMember}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={copy.app.invite}>
        <form className="grid gap-3" noValidate onSubmit={invite}>
          <Field label={copy.app.inviteName} required error={nameError}>{(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label={copy.app.inviteEmail} required error={emailError}>{(p) => <input {...p} type="email" dir="ltr" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Button type="submit" busy={busy} busyLabel={copy.loading}>{copy.app.invite}</Button>
          {inviteLink ? (
            <Notice tone="success">
              {copy.app.inviteSent}<br />
              <Link href={inviteLink} className="text-[#38dc89] underline">{copy.app.openInvite}</Link>
            </Notice>
          ) : null}
        </form>
      </Card>
      <ConfirmDialog
        open={Boolean(pending)}
        title={copy.app.removeMember}
        body={pending ? fill(copy.app.confirmRemove, { name: pending.name }) : undefined}
        confirmLabel={copy.app.removeMember}
        danger
        onConfirm={() => { if (pending) update((s) => ({ team: s.team.filter((m) => m.id !== pending.id) })); setPending(null); }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
