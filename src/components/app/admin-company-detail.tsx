"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminGetKnowledgeFileUrl, adminListCompanyKnowledge } from "@/lib/knowledge/actions";
import type { KnowledgeSourceRecord } from "@/lib/knowledge/types";
import {
  adminGetCompany,
  adminSetCompanyStatus,
  adminSetMemberStatus,
  adminUpdateCompany,
} from "@/lib/tenancy/actions";
import type { CompanyStatus } from "@/lib/tenancy/types";
import { useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import {
  Button, ConfirmDialog, Field, LangSwitch, Notice, isEmail, isPhone,
  useAction, useAppCopy,
} from "@/components/app/ui";

function memberStatusLabel(status: string, copy: ReturnType<typeof useAppCopy>) {
  if (status === "active") return copy.admin.memberStatusActive;
  if (status === "disabled") return copy.admin.memberStatusDisabled;
  return status;
}

function roleLabel(role: string, copy: ReturnType<typeof useAppCopy>) {
  if (role === "owner") return copy.admin.roleOwner;
  if (role === "staff") return copy.admin.roleStaff;
  return role;
}

function auditActionLabel(action: string, copy: ReturnType<typeof useAppCopy>) {
  if (action === "company.update") return copy.admin.auditCompanyUpdate;
  if (action === "company.status") return copy.admin.auditCompanyStatus;
  if (action === "member.update") return copy.admin.auditMemberUpdate;
  return action;
}

function knowledgeStatusLabel(status: string, copy: ReturnType<typeof useAppCopy>) {
  const map = copy.knowledge.statuses as Record<string, string>;
  return map[status] ?? status;
}

function formatBytes(n: number | null | undefined, copy: ReturnType<typeof useAppCopy>) {
  if (n == null) return "—";
  if (n < 1024) return fill(copy.admin.knowledgeBytes, { n: String(n) });
  if (n < 1024 * 1024) return fill(copy.admin.knowledgeKb, { n: String(Math.round(n / 1024)) });
  return fill(copy.admin.knowledgeMb, { n: (n / (1024 * 1024)).toFixed(1) });
}

export type AdminMember = {
  company_id: string;
  user_id: string;
  role: "owner" | "staff";
  status: "active" | "disabled";
  member_name: string;
  email?: string | null;
  phone?: string | null;
};

export type AdminAudit = {
  id: string;
  action: string;
  actor_user_id: string;
  actor_email?: string | null;
  created_at: string;
};

export type AdminCompany = {
  id: string;
  display_name: string;
  status: CompanyStatus;
  business_type: string;
  reply_language: "ar" | "en" | "both";
  country: string;
  city: string;
  hours: string;
  contact_phone: string;
  contact_email: string;
  created_at: string;
  updated_at?: string;
};

type Props = {
  initialCompany: AdminCompany;
  initialMembers: AdminMember[];
  initialAudits: AdminAudit[];
  initialKnowledge: KnowledgeSourceRecord[];
  knowledgeLoadFailed?: boolean;
};

function dash(value: string | null | undefined, empty: string) {
  const v = (value ?? "").trim();
  return v || empty;
}

export function AdminCompanyDetail({
  initialCompany,
  initialMembers,
  initialAudits,
  initialKnowledge,
  knowledgeLoadFailed = false,
}: Props) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const { busy, run } = useAction();
  const [company, setCompany] = useState(initialCompany);
  const [members, setMembers] = useState(initialMembers);
  const [audits, setAudits] = useState(initialAudits);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [knowledgeFailed, setKnowledgeFailed] = useState(knowledgeLoadFailed);
  const [form, setForm] = useState({
    displayName: initialCompany.display_name,
    businessType: initialCompany.business_type,
    replyLanguage: initialCompany.reply_language,
    country: initialCompany.country,
    city: initialCompany.city,
    hours: initialCompany.hours,
    contactPhone: initialCompany.contact_phone,
    contactEmail: initialCompany.contact_email,
    status: initialCompany.status,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingDisable, setPendingDisable] = useState<AdminMember | null>(null);
  const [pendingSuspendSave, setPendingSuspendSave] = useState(false);

  const owner = members.find((m) => m.role === "owner" && m.status === "active")
    ?? members.find((m) => m.role === "owner")
    ?? null;
  const empty = copy.admin.notLinked;
  const emailsDiffer =
    Boolean(owner?.email?.trim()) &&
    Boolean(company.contact_email?.trim()) &&
    owner!.email!.trim().toLowerCase() !== company.contact_email.trim().toLowerCase();

  async function refresh() {
    const result = await adminGetCompany(company.id);
    if (!result.ok) {
      setError(result.message ?? copy.errors.authFailed);
      return false;
    }
    const payload = result.data as {
      company: AdminCompany;
      members: AdminMember[];
      audits?: AdminAudit[];
    };
    setCompany(payload.company);
    setMembers(payload.members ?? []);
    setAudits(payload.audits ?? []);
    const knowledgeResult = await adminListCompanyKnowledge(company.id);
    if (knowledgeResult.ok) {
      setKnowledge(knowledgeResult.data);
      setKnowledgeFailed(false);
    } else {
      setKnowledgeFailed(true);
    }
    setForm({
      displayName: payload.company.display_name,
      businessType: payload.company.business_type,
      replyLanguage: payload.company.reply_language,
      country: payload.company.country,
      city: payload.company.city,
      hours: payload.company.hours,
      contactPhone: payload.company.contact_phone,
      contactEmail: payload.company.contact_email,
      status: payload.company.status,
    });
    router.refresh();
    return true;
  }

  function validateForm(): string | null {
    const name = form.displayName.trim();
    if (!name || name.length > 120 || !form.hours.trim()) return copy.errors.required;
    if (form.contactEmail && !isEmail(form.contactEmail)) return copy.errors.email;
    if (form.contactPhone && !isPhone(form.contactPhone)) return copy.errors.phone;
    return null;
  }

  function persistSave() {
    void run(async () => {
      const updated = await adminUpdateCompany({
        companyId: company.id,
        displayName: form.displayName.trim(),
        businessType: form.businessType,
        replyLanguage: form.replyLanguage,
        country: form.country,
        city: form.city,
        hours: form.hours,
        contactPhone: form.contactPhone,
        contactEmail: form.contactEmail,
      });
      if (!updated.ok) {
        setError(updated.message ?? copy.errors.authFailed);
        return;
      }
      if (form.status !== company.status) {
        const st = await adminSetCompanyStatus(company.id, form.status);
        if (!st.ok) {
          setError(st.message ?? copy.errors.authFailed);
          await refresh();
          return;
        }
      }
      const ok = await refresh();
      if (ok) setSuccess(copy.saved);
    });
  }

  return (
    <main className="app-shell px-4 py-6">
      <div className="mx-auto max-w-[860px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="text-sm text-[#38dc89] underline">{copy.admin.backToList}</Link>
          <LangSwitch />
        </div>
        <h1 className="mt-4 text-3xl font-bold break-words">{company.display_name}</h1>
        <p className="mt-2 text-sm text-[#adbeaf]">{copy.admin.detailBody}</p>
        <p className="mt-1 text-xs text-[#8da195]">
          {copy.admin.registeredAt}: {new Date(company.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}
        </p>
        {emailsDiffer ? (
          <p className="mt-3 rounded-xl border border-[#38dc89]/30 bg-[#38dc89]/10 px-3 py-2 text-xs text-[#9af0c3]">
            {copy.admin.emailDiffer}
          </p>
        ) : null}
        {error ? <div className="mt-4"><Notice tone="error">{error}</Notice></div> : null}
        {success ? <div className="mt-4"><Notice tone="success">{success}</Notice></div> : null}

        <section className="mt-6 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.editTitle}</h2>
          <form
            className="mt-4 grid gap-3 lg:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              setError(null);
              setSuccess(null);
              const invalid = validateForm();
              if (invalid) {
                setError(invalid);
                return;
              }
              // Suspending requires explicit confirm with company name; cancel writes nothing.
              if (form.status === "suspended" && company.status !== "suspended") {
                setPendingSuspendSave(true);
                return;
              }
              persistSave();
            }}
          >
            <Field label={copy.setup.businessName} required>
              {(p) => <input {...p} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
            </Field>
            <Field label={copy.setup.businessType}>
              {(p) => <input {...p} value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} />}
            </Field>
            <Field label={copy.setup.replyLanguage}>
              {(p) => (
                <select
                  {...p}
                  value={form.replyLanguage}
                  onChange={(e) => setForm({ ...form, replyLanguage: e.target.value as "ar" | "en" | "both" })}
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-[#0d1a14] px-3"
                >
                  <option value="both">{copy.setup.langBoth}</option>
                  <option value="ar">{copy.setup.langAr}</option>
                  <option value="en">{copy.setup.langEn}</option>
                </select>
              )}
            </Field>
            <Field label={copy.setup.country}>
              {(p) => <input {...p} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />}
            </Field>
            <Field label={copy.setup.city}>
              {(p) => <input {...p} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}
            </Field>
            <Field label={copy.setup.hours} required>
              {(p) => <input {...p} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />}
            </Field>
            <Field label={copy.setup.contactPhone}>
              {(p) => <input {...p} dir="ltr" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />}
            </Field>
            <Field label={copy.setup.contactEmail}>
              {(p) => <input {...p} dir="ltr" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />}
            </Field>
            <Field label={copy.admin.status}>
              {(p) => (
                <select
                  {...p}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as CompanyStatus })}
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-[#0d1a14] px-3"
                >
                  <option value="setup">{copy.admin.statusSetup}</option>
                  <option value="active">{copy.admin.statusActive}</option>
                  <option value="suspended">{copy.admin.statusSuspended}</option>
                </select>
              )}
            </Field>
            <div className="flex items-end lg:col-span-2">
              <Button type="submit" busy={busy} busyLabel={copy.saving}>{copy.save}</Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-[#8da195]">{copy.admin.whatsappNote} · {copy.admin.whatsappLink}: {empty}</p>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.ownerSection}</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.ownerName}</dt><dd>{dash(owner?.member_name, empty)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.ownerAccountEmail}</dt><dd dir="ltr">{dash(owner?.email, empty)}</dd></div>
          </dl>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.members}</h2>
          <ul className="mt-3 grid gap-2">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <strong className="break-words">{m.member_name || m.email || m.user_id}</strong>
                  <div className="text-xs text-[#8da195]" dir="ltr">{m.email || m.phone || m.user_id}</div>
                  <div className="text-xs text-[#8da195]">
                    {roleLabel(m.role, copy)} · {memberStatusLabel(m.status, copy)}
                  </div>
                </div>
                {m.role === "staff" ? (
                  m.status === "active" ? (
                    <Button variant="secondary" busy={busy} onClick={() => setPendingDisable(m)}>
                      {copy.admin.disable}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      busy={busy}
                      onClick={() => {
                        setError(null);
                        setSuccess(null);
                        void run(async () => {
                          const result = await adminSetMemberStatus({
                            companyId: company.id,
                            userId: m.user_id,
                            status: "active",
                          });
                          if (!result.ok) {
                            setError(result.message ?? copy.errors.authFailed);
                            return;
                          }
                          const ok = await refresh();
                          if (ok) setSuccess(copy.admin.memberEnableDone);
                        });
                      }}
                    >
                      {copy.admin.enable}
                    </Button>
                  )
                ) : (
                  <span className="text-xs text-[#8da195]">{copy.admin.ownerProtected}</span>
                )}
              </li>
            ))}
            {!members.length ? <li className="text-sm text-[#8da195]">{copy.admin.emptyMembers}</li> : null}
          </ul>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">{copy.admin.knowledgeSection}</h2>
            {!knowledgeFailed ? (
              <p className="text-xs text-[#8da195]">{fill(copy.admin.knowledgeCount, { n: String(knowledge.length) })}</p>
            ) : null}
          </div>
          {knowledgeFailed ? (
            <div className="mt-3 grid gap-3">
              <Notice tone="error">{copy.knowledge.loadFailed}</Notice>
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => {
                  void run(async () => {
                    const knowledgeResult = await adminListCompanyKnowledge(company.id);
                    if (!knowledgeResult.ok) {
                      setKnowledgeFailed(true);
                      setError(knowledgeResult.message ?? copy.knowledge.loadFailed);
                      return;
                    }
                    setKnowledge(knowledgeResult.data);
                    setKnowledgeFailed(false);
                    setError(null);
                  });
                }}
              >
                {copy.knowledge.retryLoad}
              </Button>
            </div>
          ) : !knowledge.length ? (
            <p className="mt-3 text-sm text-[#8da195]">{copy.admin.knowledgeEmpty}</p>
          ) : (
            <div className="mt-4 grid gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[#adbeaf]">{copy.admin.knowledgeTexts}</h3>
                <ul className="mt-2 grid gap-2">
                  {knowledge.filter((k) => k.kind === "text").map((k) => (
                    <li key={k.id} className="rounded-xl border border-white/10 px-3 py-2 text-sm">
                      <strong>{k.title}</strong>
                      <p className="mt-1 line-clamp-3 text-xs text-[#adbeaf]">{k.content}</p>
                      <p className="mt-1 text-[11px] text-[#8da195]">
                        {knowledgeStatusLabel(k.status, copy)} ·{" "}
                        {new Date(k.updated_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}
                      </p>
                    </li>
                  ))}
                  {!knowledge.some((k) => k.kind === "text") ? (
                    <li className="text-xs text-[#8da195]">{copy.admin.knowledgeEmpty}</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#adbeaf]">{copy.admin.knowledgeFiles}</h3>
                <ul className="mt-2 grid gap-2">
                  {knowledge.filter((k) => k.kind === "file").map((k) => (
                    <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <strong className="break-words">{k.title}</strong>
                        <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{k.file_name}</p>
                        <p className="mt-1 text-[11px] text-[#8da195]">
                          {fill(copy.admin.knowledgeFileMeta, {
                            type: k.content_type || "—",
                            size: formatBytes(k.byte_size, copy),
                            status: knowledgeStatusLabel(k.status, copy),
                            date: new Date(k.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB"),
                          })}
                        </p>
                        {k.status === "ready" && k.content ? (
                          <p className="mt-1 line-clamp-2 text-xs text-[#adbeaf]">{k.content}</p>
                        ) : null}
                        {k.failure_code ? (
                          <p className="mt-1 text-xs text-[#f3a08a]">
                            {(copy.knowledge.reasons as Record<string, string>)[k.failure_code] ?? k.failure_code}
                          </p>
                        ) : null}
                      </div>
                      {k.storage_path && k.status !== "draft" ? (
                        <Button
                          variant="secondary"
                          busy={busy}
                          onClick={() => {
                            setError(null);
                            void run(async () => {
                              const result = await adminGetKnowledgeFileUrl({
                                companyId: company.id,
                                sourceId: k.id,
                              });
                              if (!result.ok) {
                                setError(result.message ?? copy.errors.authFailed);
                                return;
                              }
                              window.open(result.data.url, "_blank", "noopener,noreferrer");
                            });
                          }}
                        >
                          {copy.admin.knowledgeOpenFile}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                  {!knowledge.some((k) => k.kind === "file") ? (
                    <li className="text-xs text-[#8da195]">{copy.admin.knowledgeEmpty}</li>
                  ) : null}
                </ul>
              </div>
            </div>
          )}
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.auditTitle}</h2>
          <ul className="mt-3 grid gap-2">
            {audits.map((a) => (
              <li key={a.id} className="rounded-xl border border-white/10 px-3 py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{auditActionLabel(a.action, copy)}</strong>
                  <span className="text-xs text-[#8da195]">
                    {new Date(a.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{a.actor_email || a.actor_user_id}</p>
              </li>
            ))}
            {!audits.length ? <li className="text-sm text-[#8da195]">{copy.admin.auditEmpty}</li> : null}
          </ul>
        </section>
      </div>

      <ConfirmDialog
        open={pendingSuspendSave}
        title={copy.admin.suspendConfirmTitle}
        body={fill(copy.admin.suspendConfirmBody, { name: form.displayName.trim() || company.display_name })}
        confirmLabel={copy.admin.suspendConfirmAction}
        danger
        onCancel={() => {
          setPendingSuspendSave(false);
          setForm((f) => ({ ...f, status: company.status }));
        }}
        onConfirm={() => {
          setPendingSuspendSave(false);
          setError(null);
          setSuccess(null);
          persistSave();
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDisable)}
        title={copy.admin.disableConfirmTitle}
        body={copy.admin.disableConfirmBody}
        confirmLabel={copy.admin.disable}
        danger
        onCancel={() => setPendingDisable(null)}
        onConfirm={() => {
          const target = pendingDisable;
          setPendingDisable(null);
          if (!target) return;
          setError(null);
          setSuccess(null);
          void run(async () => {
            const result = await adminSetMemberStatus({
              companyId: company.id,
              userId: target.user_id,
              status: "disabled",
            });
            if (!result.ok) {
              setError(result.message ?? copy.errors.authFailed);
              return;
            }
            const ok = await refresh();
            if (ok) setSuccess(copy.admin.memberDisableDone);
          });
        }}
      />
    </main>
  );
}
