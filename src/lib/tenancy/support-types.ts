import type { AdminCompanyListItem, AdminAccountSearchItem } from "./types";

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";

export type TicketPriority = "low" | "medium" | "high" | "urgent";

export type TicketCategory = "onboarding" | "billing" | "technical" | "channel" | "ai" | "other";

export interface TicketNote {
  id: string;
  ticketId: string;
  authorUserId: string;
  authorEmail: string | null;
  noteType: "internal_note" | "status_change" | "assignment" | "customer_response";
  content: string;
  createdAt: string;
}

export interface SupportTicketItem {
  revision?: number;
  id: string;
  ticketNumber: string;
  companyId: string;
  companyName?: string;
  branchId: string | null;
  creatorUserId: string | null;
  assignedToUserId: string | null;
  assignedToEmail?: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  resolutionSummary?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  resolvedAt?: string | null;
  notesCount?: number;
  latestNote?: string | null;
  notes?: TicketNote[];
}

export interface SupportChannelInfo {
  id: string;
  channel: string;
  target: string;
  status: "OPERATIONAL" | "STANDBY" | "UNCONFIGURED";
  description: string;
}

export interface AdminSupportOverviewData {
  ticketsAvailability?: "ready" | "unavailable";
  ticketsError?: string;
  kpis: {
    pendingReviewsCount: number;
    openTicketsCount: number | "UNKNOWN";
    inProgressTicketsCount: number | "UNKNOWN";
    resolvedTicketsCount: number | "UNKNOWN";
    supportSlaHours: number | "UNCONFIGURED";
    reviewGateStatus: "ACTIVE" | "DEGRADED";
    officialSupportChannel: string;
    officialSupportEmail: string;
  };
  pendingReviews: AdminCompanyListItem[];
  tickets: SupportTicketItem[];
  supportChannels: SupportChannelInfo[];
  pagination?: {
    totalCount: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export type { AdminAccountSearchItem, AdminCompanyListItem };
