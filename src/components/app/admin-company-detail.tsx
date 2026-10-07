"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminGetKnowledgeFileUrl, adminListCompanyKnowledge } from "@/lib/knowledge/actions";
import type { KnowledgeApprovalFoundation, KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { AppTopBar } from "@/components/app/account-chrome";
import {
  adminApproveSetupReview,
  adminGetCompany,
  adminRequestReviewChanges,
  adminSetCompanyStatus,
  adminSetMemberStatus,
  adminUpdateCompany,
} from "@/lib/tenancy/actions";
import {
  adminGetWhatsappCompanyLink,
  adminMarkWhatsappLinkNeedsExternal,
  adminUpdateWhatsappLinkNote,
} from "@/lib/whatsapp/connection-actions";
import type { WhatsappCompanyLink } from "@/lib/whatsapp/connection";
import type { CompanyReviewRequest, CompanyStatus } from "@/lib/tenancy/types";
import { useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import {
  Button, ConfirmDialog, Field, Notice, isEmail, isPhone,
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
  initialReview?: CompanyReviewRequest | null;
  initialWhatsappLink?: WhatsappCompanyLink | null;
  whatsappLinkLoadFailed?: boolean;
  knowledgeLoadFailed?: boolean;
  approvalFoundation?: KnowledgeApprovalFoundation;
};

function dash(value: string | null | undefined, empty: string) {
  const v = (value ?? "").trim();
  return v || empty;
}

function formatStamp(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function AdminCompanyDetail({
  initialCompany,
  initialMembers,
  initialAudits,
  initialKnowledge,
  initialReview = null,
  initialWhatsappLink = null,
  whatsappLinkLoadFailed = false,
  knowledgeLoadFailed = false,
  approvalFoundation: initialApprovalFoundation = "ready",
}: Props) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router = useRouter();
  const { busy, run } = useAction();
  const [company, setCompany] = useState(initialCompany);
  const [members, setMembers] = useState(initialMembers);
  const [audits, setAudits] = useState(initialAudits);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [approvalFoundation, setApprovalFoundation] = useState(initialApprovalFoundation);
  const [review, setReview] = useState<CompanyReviewRequest | null>(initialReview);
  const [waLink, setWaLink] = useState<WhatsappCompanyLink | null>(initialWhatsappLink);
  const [waLinkFailed, setWaLinkFailed] = useState(whatsappLinkLoadFailed);
  const [waNote, setWaNote] = useState(initialWhatsappLink?.adminNote ?? "");
  const [adminNote, setAdminNote] = useState(initialReview?.owner_note ?? "");
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
  const [reviewInfo, setReviewInfo] = useState<string | null>(null);
  const [reviewViewRefreshFailed, setReviewViewRefreshFailed] = useState(false);
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

  async function refresh(opts?: { preserveCompanyForm?: boolean }) {
    const result = await adminGetCompany(company.id);
    if (!result.ok) {
      setError(result.message ?? copy.errors.authFailed);
      return false;
    }
    const payload = result.data as {
      company: AdminCompany;
      members: AdminMember[];
      audits?: AdminAudit[];
      review_request?: CompanyReviewRequest | null;
    };
    setCompany(payload.company);
    setMembers(payload.members ?? []);
    setAudits(payload.audits ?? []);
    const nextReview = payload.review_request ?? null;
    setReview(nextReview);
    if (nextReview) {
      setAdminNote((prev) => (prev.trim() ? prev : (nextReview.owner_note ?? "")));
    }
    // Thrown exceptions and explicit failures both mean load-failed — never «not linked».
    // Keep prior waLink snapshot and waNote draft untouched on failure.
    try {
      const linkResult = await adminGetWhatsappCompanyLink(company.id);
      if (linkResult.ok) {
        setWaLink(linkResult.data);
        setWaLinkFailed(false);
        setWaNote((prev) => (prev.trim() ? prev : (linkResult.data.adminNote ?? "")));
      } else {
        setWaLinkFailed(true);
      }
    } catch {
      setWaLinkFailed(true);
    }
    const knowledgeResult = await adminListCompanyKnowledge(company.id);
    if (knowledgeResult.ok) {
      setKnowledge(knowledgeResult.data.sources);
      setApprovalFoundation(knowledgeResult.data.approvalFoundation);
      setKnowledgeFailed(false);
    } else {
      setKnowledgeFailed(true);
    }
    // Review-status refresh must not wipe an unsaved company edit form.
    if (!opts?.preserveCompanyForm) {
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
    }
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
        <AppTopBar
          trailing={(
            <Link
              href={`/admin/companies/${company.id}/conversations`}
              className="text-sm text-[#38dc89] underline"
            >
              {copy.admin.viewConversations}
            </Link>
          )}
        />
        <div className="mt-4">
          <Link href="/admin" className="text-sm text-[#38dc89] underline">{copy.admin.backToList}</Link>
        </div>
        <h1 className="mt-4 text-3xl font-bold break-words">{company.display_name}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted-on-dark)]">{copy.admin.detailBody}</p>
        <p className="mt-1 text-xs text-[var(--color-muted-soft)]">
          {copy.admin.registeredAt}: {new Date(company.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}
        </p>
        {emailsDiffer ? (
          <p className="mt-3 rounded-xl border border-[#38dc89]/30 bg-[#38dc89]/10 px-3 py-2 text-xs text-[var(--color-success-fg)]">
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
                  className="min-h-11 w-full rounded-xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] px-3"
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
                  className="min-h-11 w-full rounded-xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] px-3"
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
          <p className="mt-3 text-xs text-[var(--color-muted-soft)]">{copy.admin.whatsappNote}</p>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.whatsappLink}</h2>
          <p className="mt-2 text-xs text-[var(--color-muted-soft)]">{copy.admin.waLinkHonestNote}</p>
          {waLinkFailed ? (
            <div className="mt-3 grid gap-3">
              <Notice tone="error">{copy.admin.waLinkLoadFailed}</Notice>
              <Button
                type="button"
                variant="secondary"
                busy={busy}
                onClick={() => {
                  void run(async () => {
                    setError(null);
                    // Retry is read-only: on fail/throw keep prior link + note draft.
                    try {
                      const linkResult = await adminGetWhatsappCompanyLink(company.id);
                      if (!linkResult.ok) {
                        setWaLinkFailed(true);
                        setError(linkResult.message ?? copy.admin.waLinkLoadFailed);
                        return;
                      }
                      setWaLink(linkResult.data);
                      setWaLinkFailed(false);
                      setWaNote((prev) => (prev.trim() ? prev : (linkResult.data.adminNote ?? "")));
                    } catch {
                      setWaLinkFailed(true);
                      setError(copy.admin.waLinkLoadFailed);
                    }
                  });
                }}
              >
                {copy.admin.waLinkRetryRead}
              </Button>
            </div>
          ) : null}
          {!waLinkFailed && waLink ? (
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-[var(--color-muted-on-dark)]">{copy.app.whatsappStatus}</dt>
                <dd>{copy.app.waLinkStatuses[waLink.status]}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkRequested}</dt>
                <dd dir="ltr">{dash(waLink.requestedDisplayNumber, empty)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkKeepOnPhone}</dt>
                <dd>{waLink.keepOnPhone ? copy.admin.waLinkYes : copy.admin.waLinkNo}</dd>
              </div>
              {waLink.status === "verified" ? (
                <>
                  <div className="flex flex-wrap justify-between gap-3">
                    <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkVerifiedCurrent}</dt>
                    <dd dir="ltr">{dash(waLink.verifiedDisplayNumber, empty)}</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3">
                    <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkProviderId}</dt>
                    <dd dir="ltr" className="break-all">{dash(waLink.providerPhoneNumberId, empty)}</dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3">
                    <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkTestedLabel}</dt>
                    <dd>{waLink.receptionSendTested ? copy.app.waLinkTestedYes : copy.app.waLinkTestedNo}</dd>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkTestedLabel}</dt>
                  <dd>{copy.app.waLinkTestedNo}</dd>
                </div>
              )}
            </dl>
          ) : null}
          {!waLinkFailed && !waLink ? (
            <p className="mt-3 text-sm text-[var(--color-muted-soft)]">{copy.admin.notLinked}</p>
          ) : null}
          {!waLinkFailed && waLink?.priorLinkEvidence ? (
            <div className="mt-4 grid gap-2 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3 text-sm">
              <p className="text-xs font-medium text-[var(--color-muted-soft)]">{copy.admin.waLinkPriorEvidenceTitle}</p>
              <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.admin.waLinkPriorEvidenceNote}</p>
              <dl className="grid gap-2">
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkPriorVerifiedNumber}</dt>
                  <dd dir="ltr">{dash(waLink.verifiedDisplayNumber, empty)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkProviderId}</dt>
                  <dd dir="ltr" className="break-all">{dash(waLink.providerPhoneNumberId, empty)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkPriorInboundTested}</dt>
                  <dd dir="ltr" className="text-xs">{formatStamp(waLink.inboundTestedAt)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.waLinkPriorOutboundTested}</dt>
                  <dd dir="ltr" className="text-xs">{formatStamp(waLink.outboundTestedAt)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          <Field label={copy.admin.waLinkAdminNote}>
            {(p) => (
              <textarea
                {...p}
                value={waNote}
                onChange={(e) => setWaNote(e.target.value)}
                rows={3}
                className="min-h-24 w-full rounded-xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] px-3 py-2 text-sm"
              />
            )}
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              busy={busy}
              onClick={() => {
                void run(async () => {
                  setError(null);
                  setSuccess(null);
                  const result = await adminUpdateWhatsappLinkNote({
                    companyId: company.id,
                    adminNote: waNote,
                  });
                  if (!result.ok) {
                    setError(result.message ?? copy.admin.waLinkNoteFailed);
                    return;
                  }
                  setWaLink(result.data);
                  setWaLinkFailed(false);
                  setWaNote(result.data.adminNote ?? "");
                  setSuccess(copy.saved);
                });
              }}
            >
              {copy.admin.waLinkSaveNote}
            </Button>
            {waLink?.status === "request_saved" && !waLinkFailed ? (
              <Button
                type="button"
                variant="ghost"
                busy={busy}
                onClick={() => {
                  void run(async () => {
                    setError(null);
                    setSuccess(null);
                    const result = await adminMarkWhatsappLinkNeedsExternal(company.id);
                    if (!result.ok) {
                      setError(result.message ?? copy.admin.waLinkFollowupFailed);
                      return;
                    }
                    setWaLink(result.data);
                    setWaLinkFailed(false);
                    setSuccess(copy.admin.waLinkFollowupSaved);
                  });
                }}
              >
                {copy.admin.waLinkMarkNeedsExternal}
              </Button>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted-soft)]">{copy.admin.waLinkNoFakeVerify}</p>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.reviewRequest}</h2>
          {reviewInfo ? <div className="mt-3"><Notice tone="warn">{reviewInfo}</Notice></div> : null}
          {reviewViewRefreshFailed ? (
            <div className="mt-3">
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => {
                  void run(async () => {
                    try {
                      const ok = await refresh({ preserveCompanyForm: true });
                      if (ok) {
                        setReviewViewRefreshFailed(false);
                        setReviewInfo(null);
                      } else {
                        setReviewInfo(copy.admin.reviewRefreshFailed);
                      }
                    } catch {
                      setReviewInfo(copy.admin.reviewRefreshFailed);
                    }
                  });
                }}
              >
                {copy.admin.reviewRetryView}
              </Button>
            </div>
          ) : null}
          {review ? (
            <div className="mt-3 grid gap-3">
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.reviewStatus}</dt>
                  <dd>{review.status}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.reviewRevision}</dt>
                  <dd>{review.revision}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.reviewRequestedAt}</dt>
                  <dd>{new Date(review.requested_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.reviewRequester}</dt>
                  <dd dir="ltr">{dash(review.requested_by_email, review.requested_by)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.reviewOwnership}</dt>
                  <dd>{review.number_ownership === "own" ? copy.setup.ownNumber : copy.setup.newNumber}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.setup.whatsappNumber}</dt>
                  <dd dir="ltr">{dash(review.whatsapp_number, empty)}</dd>
                </div>
                {review.owner_note ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--color-muted-on-dark)]">{copy.admin.reviewOwnerNote}</dt>
                    <dd className="min-w-0 break-words text-end">{review.owner_note}</dd>
                  </div>
                ) : null}
                <p className="text-xs text-[var(--color-muted-soft)]">{copy.admin.reviewNote}</p>
              </dl>
              {review.status === "pending_review" ? (
                <div className="grid gap-3 border-t border-[color:var(--color-border-soft)] pt-3">
                  <Field label={copy.admin.reviewOwnerNote} required>
                    {(p) => (
                      <textarea
                        {...p}
                        value={adminNote}
                        maxLength={2000}
                        rows={3}
                        onChange={(e) => setAdminNote(e.target.value)}
                        className="min-h-[5rem] w-full rounded-xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] px-3 py-2 text-sm"
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      busy={busy}
                      onClick={() => {
                        setError(null);
                        setSuccess(null);
                        setReviewInfo(null);
                        setReviewViewRefreshFailed(false);
                        const note = adminNote.trim();
                        void run(async () => {
                          try {
                            const result = await adminRequestReviewChanges({
                              companyId: company.id,
                              expectedRevision: review.revision,
                              ownerNote: note,
                            });
                            if (!result.ok) {
                              if (result.code === "CONFLICT" && result.data) {
                                setReview(result.data);
                                setReviewInfo(copy.admin.reviewConflict);
                                setError(result.message ?? copy.admin.reviewDecideFailed);
                                return;
                              }
                              setError(result.message ?? copy.admin.reviewDecideFailed);
                              return;
                            }
                            setReview(result.data);
                            setSuccess(copy.saved);
                            try {
                              const ok = await refresh({ preserveCompanyForm: true });
                              if (!ok) {
                                setReviewInfo(copy.admin.reviewRefreshFailed);
                                setReviewViewRefreshFailed(true);
                              }
                            } catch {
                              setReviewInfo(copy.admin.reviewRefreshFailed);
                              setReviewViewRefreshFailed(true);
                            }
                          } catch {
                            setError(copy.admin.reviewDecideFailed);
                          }
                        });
                      }}
                    >
                      {copy.admin.reviewRequestChanges}
                    </Button>
                    <Button
                      variant="secondary"
                      busy={busy}
                      onClick={() => {
                        setError(null);
                        setSuccess(null);
                        setReviewInfo(null);
                        setReviewViewRefreshFailed(false);
                        void run(async () => {
                          try {
                            const result = await adminApproveSetupReview({
                              companyId: company.id,
                              expectedRevision: review.revision,
                              ownerNote: adminNote.trim(),
                            });
                            if (!result.ok) {
                              if (result.code === "CONFLICT" && result.data) {
                                setReview(result.data);
                                setReviewInfo(copy.admin.reviewConflict);
                                setError(result.message ?? copy.admin.reviewDecideFailed);
                                return;
                              }
                              setError(result.message ?? copy.admin.reviewDecideFailed);
                              return;
                            }
                            setReview(result.data);
                            setSuccess(copy.saved);
                            try {
                              const ok = await refresh({ preserveCompanyForm: true });
                              if (!ok) {
                                setReviewInfo(copy.admin.reviewRefreshFailed);
                                setReviewViewRefreshFailed(true);
                              }
                            } catch {
                              setReviewInfo(copy.admin.reviewRefreshFailed);
                              setReviewViewRefreshFailed(true);
                            }
                          } catch {
                            setError(copy.admin.reviewDecideFailed);
                          }
                        });
                      }}
                    >
                      {copy.admin.reviewApprove}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-muted-soft)]">{copy.admin.reviewNone}</p>
          )}
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.ownerSection}</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted-on-dark)]">{copy.admin.ownerName}</dt><dd>{dash(owner?.member_name, empty)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted-on-dark)]">{copy.admin.ownerAccountEmail}</dt><dd dir="ltr">{dash(owner?.email, empty)}</dd></div>
          </dl>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.members}</h2>
          <ul className="mt-3 grid gap-2">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-soft)] px-3 py-2 text-sm">
                <div className="min-w-0">
                  <strong className="break-words">{m.member_name || m.email || m.user_id}</strong>
                  <div className="text-xs text-[var(--color-muted-soft)]" dir="ltr">{m.email || m.phone || m.user_id}</div>
                  <div className="text-xs text-[var(--color-muted-soft)]">
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
                  <span className="text-xs text-[var(--color-muted-soft)]">{copy.admin.ownerProtected}</span>
                )}
              </li>
            ))}
            {!members.length ? <li className="text-sm text-[var(--color-muted-soft)]">{copy.admin.emptyMembers}</li> : null}
          </ul>
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">{copy.admin.knowledgeSection}</h2>
            {!knowledgeFailed ? (
              <p className="text-xs text-[var(--color-muted-soft)]">{fill(copy.admin.knowledgeCount, { n: String(knowledge.length) })}</p>
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
                    setKnowledge(knowledgeResult.data.sources);
                    setApprovalFoundation(knowledgeResult.data.approvalFoundation);
                    setKnowledgeFailed(false);
                    setError(null);
                  });
                }}
              >
                {copy.knowledge.retryLoad}
              </Button>
            </div>
          ) : (
            <>
              {approvalFoundation === "unavailable" ? (
                <div className="mt-3"><Notice tone="warn">{copy.knowledge.approvalFoundationUnavailable}</Notice></div>
              ) : null}
              {!knowledge.length ? (
            <p className="mt-3 text-sm text-[var(--color-muted-soft)]">{copy.admin.knowledgeEmpty}</p>
          ) : (
            <div className="mt-4 grid gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-muted-on-dark)]">{copy.admin.knowledgeTexts}</h3>
                <ul className="mt-2 grid gap-2">
                  {knowledge.filter((k) => k.kind === "text").map((k) => (
                    <li key={k.id} className="rounded-xl border border-[color:var(--color-border-soft)] px-3 py-2 text-sm">
                      <strong>{k.title}</strong>
                      <p className="mt-1 line-clamp-3 text-xs text-[var(--color-muted-on-dark)]">{k.content}</p>
                      <p className="mt-1 text-[11px] text-[var(--color-muted-soft)]">
                        {knowledgeStatusLabel(k.status, copy)} ·{" "}
                        {new Date(k.updated_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}
                      </p>
                    </li>
                  ))}
                  {!knowledge.some((k) => k.kind === "text") ? (
                    <li className="text-xs text-[var(--color-muted-soft)]">{copy.admin.knowledgeEmpty}</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-muted-on-dark)]">{copy.admin.knowledgeFiles}</h3>
                <ul className="mt-2 grid gap-2">
                  {knowledge.filter((k) => k.kind === "file").map((k) => (
                    <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[color:var(--color-border-soft)] px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <strong className="break-words">{k.title}</strong>
                        <p className="mt-1 text-xs text-[var(--color-muted-on-dark)]" dir="ltr">{k.file_name}</p>
                        <p className="mt-1 text-[11px] text-[var(--color-muted-soft)]">
                          {fill(copy.admin.knowledgeFileMeta, {
                            type: k.content_type || "—",
                            size: formatBytes(k.byte_size, copy),
                            status: knowledgeStatusLabel(k.status, copy),
                            date: new Date(k.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB"),
                          })}
                        </p>
                        {k.status === "ready" && k.content ? (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--color-muted-on-dark)]">{k.content}</p>
                        ) : null}
                        {k.failure_code ? (
                          <p className="mt-1 text-xs text-[var(--color-danger-fg)]">
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
                    <li className="text-xs text-[var(--color-muted-soft)]">{copy.admin.knowledgeEmpty}</li>
                  ) : null}
                </ul>
              </div>
            </div>
              )}
            </>
          )}
        </section>

        <section className="mt-4 app-panel rounded-3xl p-4 sm:p-6">
          <h2 className="text-lg font-bold">{copy.admin.auditTitle}</h2>
          <ul className="mt-3 grid gap-2">
            {audits.map((a) => (
              <li key={a.id} className="rounded-xl border border-[color:var(--color-border-soft)] px-3 py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{auditActionLabel(a.action, copy)}</strong>
                  <span className="text-xs text-[var(--color-muted-soft)]">
                    {new Date(a.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted-on-dark)]" dir="ltr">{a.actor_email || a.actor_user_id}</p>
              </li>
            ))}
            {!audits.length ? <li className="text-sm text-[var(--color-muted-soft)]">{copy.admin.auditEmpty}</li> : null}
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
