export type CompanyRole = "owner" | "staff";
export type CompanyStatus = "setup" | "active" | "suspended";

export type CompanyRecord = {
  id: string;
  /** Authoritative profile revision; absent only before the local master migration. */
  version?: number;
  archived_at?: string | null;
  display_name: string;
  status: CompanyStatus;
  business_type: string;
  reply_language: "ar" | "en" | "both";
  country: string;
  city: string;
  hours: string;
  contact_phone: string;
  contact_email: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Optional IANA timezone; null/absent → UTC announced in product. */
  timezone?: string | null;
};

export type MembershipRecord = {
  company_id: string;
  user_id: string;
  role: CompanyRole;
  status: "active" | "disabled";
  member_name: string;
  created_at: string;
};

export type ProfileRecord = {
  user_id: string;
  full_name: string;
  support_code: string;
  created_at: string;
  updated_at: string;
};

export type CompanyContext = {
  userId: string;
  email: string;
  phone: string;
  fullName: string;
  supportCode: string;
  needsProfileName: boolean;
  emailConfirmed: boolean;
  identityVerified: boolean;
  isPlatformAdmin: boolean;
  company: CompanyRecord | null;
  membership: MembershipRecord | null;
  needsCompanyContext: boolean;
  workspaceChoices: Array<{ companyId: string; displayName: string; role: CompanyRole }>;
  ownedBusinessCount?: number;
  hasBusinessMemberships?: boolean;
};

export type AccessCode =
  | "UNAUTHENTICATED"
  | "UNVERIFIED"
  | "FORBIDDEN"
  | "NO_COMPANY"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "UNAVAILABLE";

export type AdminCompanyListItem = {
  id: string;
  display_name: string;
  status: CompanyStatus;
  business_type: string;
  country: string;
  city: string;
  contact_phone: string;
  contact_email: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  owner_email: string | null;
  owner_name: string | null;
  member_count: number;
  review_requested_at?: string | null;
  review_requested_by?: string | null;
  review_status?: ReviewStatus | null;
  review_revision?: number | null;
};

/** Admin account row — Auth user id is the key; profile fields may be null. */
export type AdminAccountSearchItem = {
  user_id: string;
  /** null when profile missing or support_code not assigned yet. */
  support_code: string | null;
  /** null when profile/name unavailable. */
  full_name: string | null;
  email: string | null;
  account_phone: string | null;
  /**
   * true/false when RPC returns email_confirmed (email_confirmed_at only).
   * null = field absent on payload (legacy RPC) → treat as unknown, not unconfirmed.
   */
  email_confirmed: boolean | null;
  companies: Array<{
    company_id: string;
    display_name: string;
    role: CompanyRole;
    status: "active" | "disabled";
    company_status?: CompanyStatus | null;
    business_phone: string | null;
  }>;
};

export type AdminAccountSearchPage = {
  query: string;
  offset: number;
  limit: number;
  rows: AdminAccountSearchItem[];
  hasMore: boolean;
  /**
   * True when this page is full but the next offset would exceed the browse window.
   * Not used for “requested above max” — the client must not ask past maxOffset.
   */
  atBrowseWindowEnd: boolean;
  maxOffset: number;
};

export type AdminOverviewStats = {
  accountsTotal: number;
  /** Auth users with zero company_members rows. */
  accountsWithoutCompany: number;
  /** Auth users with no active membership (may still have disabled memberships). */
  accountsWithoutActiveCompany: number;
  companiesTotal: number;
  companiesSetup: number;
  companiesActive: number;
  companiesSuspended: number;
};

/** Hard cap aligned with admin_search_accounts offset clamp in 160000. */
export const ADMIN_ACCOUNT_SEARCH_MAX_OFFSET = 100000;

/** Same trim + length contract as adminSearchAccounts / RPC (120). */
export const ADMIN_ACCOUNT_QUERY_MAX_LEN = 120;

export function normalizeAdminAccountQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, ADMIN_ACCOUNT_QUERY_MAX_LEN);
}

/** Setup review only — not company/payment/WhatsApp/AI status. */
export type ReviewStatus = "pending_review" | "changes_requested" | "approved";

/** Owner-submitted setup review request. Not activation, payment, or WhatsApp link. */
export type CompanyReviewRequest = {
  company_id: string;
  requested_by: string;
  requested_by_email?: string | null;
  number_ownership: "own" | "new" | "not_applicable";
  whatsapp_number: string;
  readiness_confirmed: boolean;
  requested_at: string;
  status: ReviewStatus;
  revision: number;
  decided_by?: string | null;
  decided_at?: string | null;
  owner_note: string;
  /** SQL snapshot is current; Storage integrity was observed only at proof_checked_at. */
  proof_current?: boolean;
  proof_checked_at?: string | null;
  submitted_manifest_sha256?: string | null;
};

/** Owner-visible review audit events (RPC): no actor IDs or raw admin payloads. */
export type CompanyReviewEvent = {
  action: string;
  revision: number;
  created_at: string;
  owner_note: string;
};
