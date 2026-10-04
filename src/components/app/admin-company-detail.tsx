"use client";

import Link from "next/link";
import type { CompanyStatus } from "@/lib/tenancy/types";
import { LangSwitch, useAppCopy } from "@/components/app/ui";
import { useDemo } from "@/lib/demo-state";

type DetailProps = {
  company: {
    id: string;
    display_name: string;
    status: CompanyStatus;
    business_type: string;
    country: string;
    city: string;
    hours: string;
    contact_phone: string;
    contact_email: string;
    created_at: string;
  };
  owner: {
    member_name: string;
    email: string | null;
  } | null;
};

function dash(value: string | null | undefined, empty: string) {
  const v = (value ?? "").trim();
  return v || empty;
}

export function AdminCompanyDetail({ company, owner }: DetailProps) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const empty = copy.admin.notLinked;
  const contactEmail = dash(company.contact_email, empty);
  const ownerEmail = dash(owner?.email, empty);
  const emailsDiffer =
    Boolean(owner?.email?.trim()) &&
    Boolean(company.contact_email?.trim()) &&
    owner!.email!.trim().toLowerCase() !== company.contact_email.trim().toLowerCase();

  const rows: [string, string, boolean?][] = [
    [copy.setup.businessName, company.display_name],
    [copy.setup.businessType, dash(company.business_type, empty)],
    [copy.admin.registeredAt, new Date(company.created_at).toLocaleString(locale === "ar" ? "ar-OM" : "en-GB")],
    [copy.admin.status, company.status],
    [copy.setup.country, dash(company.country, empty)],
    [copy.setup.city, dash(company.city, empty)],
    [copy.setup.hours, dash(company.hours, empty)],
    [copy.setup.contactPhone, dash(company.contact_phone, empty), true],
    [copy.setup.contactEmail, contactEmail, true],
    [copy.admin.ownerName, dash(owner?.member_name, empty)],
    [copy.admin.ownerAccountEmail, ownerEmail, true],
    [copy.admin.whatsappLink, empty],
  ];

  return (
    <main className="min-h-svh bg-[#07110d] px-4 py-6 text-[#f7fbf8]">
      <div className="mx-auto max-w-[800px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="text-sm text-[#38dc89] underline">{copy.admin.backToList}</Link>
          <LangSwitch />
        </div>
        <h1 className="mt-4 text-3xl font-bold break-words">{company.display_name}</h1>
        <p className="mt-2 text-sm text-[#adbeaf]">{copy.admin.detailBody}</p>
        {emailsDiffer ? (
          <p className="mt-3 rounded-xl border border-[#38dc89]/30 bg-[#38dc89]/10 px-3 py-2 text-xs text-[#9af0c3]">
            {copy.admin.emailDiffer}
          </p>
        ) : null}
        <dl className="mt-6 grid gap-3 rounded-3xl border border-white/10 bg-[#0d1a14] p-4 sm:p-6">
          {rows.map(([label, value, ltr]) => (
            <div key={label} className="flex flex-wrap justify-between gap-3 border-b border-white/10 pb-3 last:border-0 last:pb-0">
              <dt className="text-sm text-[#adbeaf]">{label}</dt>
              <dd className="min-w-0 text-end text-sm break-words" dir={ltr ? "ltr" : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
