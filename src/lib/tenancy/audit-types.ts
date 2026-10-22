export type AuditCategory = "security" | "support" | "billing" | "company" | "channel" | "system";

export interface AdminAuditLogEntry {
  id: string;
  actorUserId: string;
  actorEmail?: string | null;
  companyId: string | null;
  companyName?: string | null;
  action: string;
  category: AuditCategory;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminAuditOverviewData {
  kpis: {
    totalLogsCount: number;
    recent24hCount: number;
    immutabilityGate: "APPEND_ONLY" | "UNKNOWN";
    retentionPolicy: "UNCONFIGURED" | string;
  };
  logs: AdminAuditLogEntry[];
  availableActions: string[];
  pagination: {
    totalCount: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface AdminAuditFilter {
  action?: string;
  category?: string;
  companyId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}
