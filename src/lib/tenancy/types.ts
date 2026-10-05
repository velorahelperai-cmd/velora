export type CompanyRole = "owner" | "staff";
export type CompanyStatus = "setup" | "active" | "suspended";

export type CompanyRecord = {
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
  created_by: string;
  created_at: string;
  updated_at: string;
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

/** Admin account search row — emails from auth.users inside RPC only. */
export type AdminAccountSearchItem = {
  user_id: string;
  support_code: string;
  full_name: string;
  email: string | null;
  account_phone: string | null;
  companies: Array<{
    company_id: string;
    display_name: string;
    role: CompanyRole;
    status: "active" | "disabled";
    business_phone: string | null;
  }>;
};

/** Setup review only — not company/payment/WhatsApp/AI status. */
export type ReviewStatus = "pending_review" | "changes_requested" | "approved";

/** Owner-submitted setup review request. Not activation, payment, or WhatsApp link. */
export type CompanyReviewRequest = {
  company_id: string;
  requested_by: string;
  requested_by_email?: string | null;
  number_ownership: "own" | "new";
  whatsapp_number: string;
  readiness_confirmed: boolean;
  requested_at: string;
  status: ReviewStatus;
  revision: number;
  decided_by?: string | null;
  decided_at?: string | null;
  owner_note: string;
};

/** Owner-visible review audit events (RPC): no actor IDs or raw admin payloads. */
export type CompanyReviewEvent = {
  action: string;
  revision: number;
  created_at: string;
  owner_note: string;
};
