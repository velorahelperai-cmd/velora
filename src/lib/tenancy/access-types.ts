export type PlatformRole = "owner" | "support" | "finance" | "operations";
export type PlatformAdminStatus = "active" | "disabled";

export interface PlatformAdminUser {
  userId: string;
  email: string;
  fullName: string;
  supportCode: string;
  role: PlatformRole;
  status: PlatformAdminStatus;
  grantedAt: string;
  grantedBy: string | null;
  note: string;
  allowedCapabilities: string[];
}

export interface PlatformRoleCatalogItem {
  role: PlatformRole;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  badgeStyle: string;
  capabilities: string[];
}

export interface PlatformAccessOverviewData {
  kpis: {
    totalAdminsCount: number;
    activeAdminsCount: number;
    escalationProtection: "LOCKED";
    sessionRevocationPolicy: "IMMEDIATE";
  };
  owner: {
    userId: string;
    email: string;
    fullName: string;
    verified: boolean;
  };
  delegatedAdmins: PlatformAdminUser[];
  roleCatalog: PlatformRoleCatalogItem[];
}

export interface GrantPlatformRoleInput {
  userId: string;
  role: Exclude<PlatformRole, "owner">;
  note?: string;
  capabilities?: string[];
}

export interface UpdatePlatformRoleInput {
  userId: string;
  role: Exclude<PlatformRole, "owner">;
  status: PlatformAdminStatus;
  note?: string;
  capabilities?: string[];
}
