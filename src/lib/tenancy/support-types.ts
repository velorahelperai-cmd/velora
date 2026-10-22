import type { AdminCompanyListItem, AdminAccountSearchItem } from "./types";

export interface SupportChannelInfo {
  id: string;
  channel: string;
  target: string;
  status: "OPERATIONAL" | "STANDBY";
  description: string;
}

export interface AdminSupportOverviewData {
  kpis: {
    pendingReviewsCount: number;
    supportSlaHours: number;
    reviewGateStatus: "ACTIVE" | "DEGRADED";
    officialSupportChannel: string;
  };
  pendingReviews: AdminCompanyListItem[];
  supportChannels: SupportChannelInfo[];
}

export type { AdminAccountSearchItem };
