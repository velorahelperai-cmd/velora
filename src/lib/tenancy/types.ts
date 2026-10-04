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
  created_at: string;
  updated_at: string;
};

export type CompanyContext = {
  userId: string;
  email: string;
  phone: string;
  fullName: string;
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
};
