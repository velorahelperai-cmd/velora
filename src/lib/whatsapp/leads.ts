/**
 * VEL-LEADS-JOURNEY-01 — pure lead / follow-up helpers (no I/O).
 * Unit of count = conversation row, never distinct person/phone.
 */

export const MANUAL_LEAD_STAGES = [
  "new",
  "exploring",
  "interested",
  "trial_or_quote_requested",
  "follow_up",
  "closed_no_subscribe",
] as const;

export type ManualLeadStage = (typeof MANUAL_LEAD_STAGES)[number];

export const FOLLOW_UP_STATUSES = ["none", "scheduled", "completed", "cancelled"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export type LeadWorklist =
  | "all"
  | "awaiting_staff"
  | "follow_up_today"
  | "overdue"
  | "trial_or_quote";

export const CREDITED_STAFF_DELIVERY = new Set([
  "accepted",
  "sent",
  "delivered",
  "read",
]);

export type LeadMessageStamp = {
  from: "customer" | "assistant" | "staff";
  at: number;
  deliveryState?: string | null;
};

export type LeadConversationFields = {
  id: string;
  status: string;
  leadStage?: ManualLeadStage | string | null;
  followUpStatus?: FollowUpStatus | string | null;
  followUpAt?: string | null;
  messages: LeadMessageStamp[];
};

/** Staff reply credits awaiting-staff exit / last_touch — not assistant, not failed. */
export function isCreditedStaffMessage(message: LeadMessageStamp): boolean {
  if (message.from !== "staff") return false;
  const state = message.deliveryState ?? "";
  return CREDITED_STAFF_DELIVERY.has(state);
}

/**
 * Awaiting staff reply: latest customer inbound is newer than latest credited staff
 * outbound (or no credited staff after that inbound). Assistant never clears this.
 * Do not use last_touch_at alone.
 */
export function isAwaitingStaffReply(conversation: LeadConversationFields): boolean {
  if (conversation.status === "resolved") return false;

  let lastCustomerAt: number | null = null;
  let lastCreditedStaffAt: number | null = null;

  for (const message of conversation.messages) {
    if (message.from === "customer") {
      if (lastCustomerAt == null || message.at >= lastCustomerAt) {
        lastCustomerAt = message.at;
      }
      continue;
    }
    if (isCreditedStaffMessage(message)) {
      if (lastCreditedStaffAt == null || message.at >= lastCreditedStaffAt) {
        lastCreditedStaffAt = message.at;
      }
    }
  }

  if (lastCustomerAt == null) return false;
  if (lastCreditedStaffAt == null) return true;
  return lastCustomerAt > lastCreditedStaffAt;
}

export function isActiveFollowUp(conversation: LeadConversationFields): boolean {
  return conversation.followUpStatus === "scheduled" && Boolean(conversation.followUpAt);
}

/** Resolve IANA zone; empty/invalid → UTC with announcedUtc=true. */
export function resolveCompanyTimezone(timezone: string | null | undefined): {
  zone: string;
  announcedUtc: boolean;
} {
  const raw = (timezone ?? "").trim();
  if (!raw) return { zone: "UTC", announcedUtc: true };
  try {
    // Throws RangeError for unknown zones in modern engines.
    Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return { zone: raw, announcedUtc: false };
  } catch {
    return { zone: "UTC", announcedUtc: true };
  }
}

function calendarDateInZone(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function isFollowUpToday(
  conversation: LeadConversationFields,
  nowMs: number,
  timezone: string | null | undefined,
): boolean {
  if (!isActiveFollowUp(conversation) || !conversation.followUpAt) return false;
  const at = Date.parse(conversation.followUpAt);
  if (!Number.isFinite(at)) return false;
  const { zone } = resolveCompanyTimezone(timezone);
  return calendarDateInZone(at, zone) === calendarDateInZone(nowMs, zone);
}

export function isFollowUpOverdue(
  conversation: LeadConversationFields,
  nowMs: number,
): boolean {
  if (!isActiveFollowUp(conversation) || !conversation.followUpAt) return false;
  const at = Date.parse(conversation.followUpAt);
  return Number.isFinite(at) && at < nowMs;
}

export function matchesLeadWorklist(
  conversation: LeadConversationFields,
  list: LeadWorklist,
  nowMs: number,
  timezone: string | null | undefined,
): boolean {
  switch (list) {
    case "all":
      return true;
    case "awaiting_staff":
      return isAwaitingStaffReply(conversation);
    case "follow_up_today":
      return isFollowUpToday(conversation, nowMs, timezone);
    case "overdue":
      return isFollowUpOverdue(conversation, nowMs);
    case "trial_or_quote":
      return conversation.leadStage === "trial_or_quote_requested";
    default:
      return true;
  }
}

/** Same predicate for list rows and counters — conversation units only. */
export function countLeadWorklist(
  conversations: LeadConversationFields[],
  list: LeadWorklist,
  nowMs: number,
  timezone: string | null | undefined,
): number {
  let n = 0;
  for (const c of conversations) {
    if (matchesLeadWorklist(c, list, nowMs, timezone)) n += 1;
  }
  return n;
}

/** Monotonic last_touch merge (server event time). Never moves backward. */
export function nextLastTouchAt(
  currentIso: string | null | undefined,
  messageEventIso: string,
): string {
  const eventMs = Date.parse(messageEventIso);
  if (!Number.isFinite(eventMs)) return currentIso ?? messageEventIso;
  if (!currentIso) return new Date(eventMs).toISOString();
  const curMs = Date.parse(currentIso);
  if (!Number.isFinite(curMs) || eventMs > curMs) return new Date(eventMs).toISOString();
  return currentIso;
}

export function isManualLeadStage(value: string): value is ManualLeadStage {
  return (MANUAL_LEAD_STAGES as readonly string[]).includes(value);
}
