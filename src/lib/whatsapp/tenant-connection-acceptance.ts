/**
 * Deferred acceptance for VEL-WA-TENANT-CONNECTION-01.
 * Descriptors only — not executed; do not treat as PASS.
 */

export type TenantConnectionAcceptanceCase = {
  id: string;
  title: string;
  expect: string;
};

export const TENANT_CONNECTION_ACCEPTANCE_CASES: TenantConnectionAcceptanceCase[] = [
  {
    id: "company-isolation-read",
    title: "Company cannot read another company's link",
    expect: "get_whatsapp_company_link / RLS only returns the caller's company row; admin RPC requires platform admin.",
  },
  {
    id: "client-cannot-forge-connected",
    title: "Client cannot forge verified / provider id",
    expect: "No authenticated write grants on provider_phone_number_id or status=verified; upsert_whatsapp_link_request only sets request_saved fields.",
  },
  {
    id: "active-provider-id-unique",
    title: "Active verified provider phone unique",
    expect: "Unique index blocks same provider_phone_number_id on two verified links; ownership transfer deferred.",
  },
  {
    id: "request-not-activation",
    title: "Request does not activate service",
    expect: "Saving request_saved does not enable webhook routing, send, AI, or billing; review approve remains separate.",
  },
  {
    id: "error-not-success",
    title: "Error / disconnected never shown as connected",
    expect: "UI maps status honestly; reception_send_tested requires verified status + both tested timestamps — not inferred from chats.",
  },
  {
    id: "new-request-vs-prior-evidence",
    title: "New request after error/disconnected does not inherit «tested»",
    expect: "upsert keeps prior verified/tested columns as prior_link_evidence; snapshot reception_send_tested is false until status=verified; UI labels prior dates as historical.",
  },
  {
    id: "admin-load-fail-not-unlinked",
    title: "Admin link read failure is not «not linked»",
    expect: "Failed admin_get_whatsapp_company_link surfaces explicit load failure + retry; «غير مربوط» only after a successful read that returns not_connected / empty link.",
  },
  {
    id: "resolver-rejects-unknown",
    title: "Resolver rejects unknown / inactive / suspended",
    expect: "resolve_whatsapp_company_by_provider_phone returns unknown_or_inactive or company_suspended; never picks first company; not wired to webhook yet.",
  },
];

export const TENANT_CONNECTION_ACCEPTANCE_STATUS = "deferred" as const;

/** What remains before live Meta multi-tenant cutover (not implemented here). */
export const TENANT_CONNECTION_CUTOVER_NOTES = [
  "Wire webhook POST to resolveWhatsappCompanyByProviderPhone instead of env companyId (keep env fallback until all companies have verified links).",
  "Unknown external provider phone numbers must not auto-route to the env default company — reject / quarantine instead of silently attributing traffic.",
  "Wire outbound send to verified provider_phone_number_id per company; store tokens server-side only (never in this table).",
  "OAuth / Embedded Signup to set provider_phone_number_id + verified status with evidence.",
  "Explicit ownership-transfer path before moving a verified provider id between companies.",
  "Optional multi-number management beyond one primary row per company.",
] as const;
