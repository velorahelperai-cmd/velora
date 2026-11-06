import type { WhatsappInboxItem } from '@/lib/whatsapp/inbox-contracts';
import type { InstagramConversation } from '@/lib/instagram/inbox-contracts';

export type InboxChannel = 'whatsapp' | 'instagram';
export type InboxRow = {
  key: string;
  id: string;
  channel: InboxChannel;
  name: string;
  preview: string;
  at: number;
  unread: number;
  assignedTo: string | null;
};
export type InboxAssignmentFilter = 'all' | 'unassigned' | 'mine';

/** Presentation-only filter over already authorized, loaded rows. */
export function matchesInboxAssignment(
  row: Pick<InboxRow, 'assignedTo'>,
  filter: InboxAssignmentFilter,
  actorId: string | null | undefined
): boolean {
  if (filter === 'unassigned') return row.assignedTo === null;
  if (filter === 'mine') return Boolean(actorId) && row.assignedTo === actorId;
  return true;
}

/** Channel is part of identity. Names and provider IDs never merge people. */
export function inboxRows(
  wa: readonly WhatsappInboxItem[],
  ig: readonly InstagramConversation[],
  ar: boolean
): InboxRow[] {
  const rows: InboxRow[] = [
    ...wa.map((c) => ({
      key: `whatsapp:${c.id}`,
      id: c.id,
      channel: 'whatsapp' as const,
      name: c.customer || c.phone,
      preview: c.messages.at(-1)?.text ?? '',
      at: c.messages.at(-1)?.at ?? 0,
      unread: c.unreadCount,
      assignedTo: c.assignedTo ?? null,
    })),
    ...ig.map((c) => ({
      key: `instagram:${c.id}`,
      id: c.id,
      channel: 'instagram' as const,
      name: c.counterpartyId,
      preview:
        c.latestMessage?.content.kind === 'text'
          ? c.latestMessage.content.text
          : c.latestMessage
            ? ar
              ? 'رسالة غير نصية'
              : 'Non-text message'
            : '',
      at: Date.parse(c.lastReceivedAt ?? '') || 0,
      unread: c.unreadCount,
      assignedTo: c.assignedTo,
    })),
  ];
  return rows.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}

export function inboxHref(
  channel: InboxChannel | null,
  id: string | null,
  filter: InboxChannel | 'all' = 'all'
) {
  const p = new URLSearchParams();
  if (filter !== 'all') p.set('channel', filter);
  if (channel && id) {
    p.set('source', channel);
    p.set(channel === 'whatsapp' ? 'c' : 'thread', id);
  }
  return '/app/conversations' + (p.size ? '?' + p.toString() : '');
}

export const INBOX_ASSIGNMENT_FILTERS = ['all', 'unassigned', 'mine'] as const;
export const INBOX_MOBILE_WORKLIST_FILTERS = [
  'all',
  'unread',
  'staff',
  'noura',
  'resolved',
] as const;
export const INBOX_DESKTOP_WORKLIST_FILTERS = [
  'all',
  'unread',
  'awaiting_staff',
  'follow_up_today',
  'overdue',
  'trial_or_quote',
  'noura',
  'resolved',
  'staff',
] as const;

export type InboxWorklistSurface = 'mobile' | 'desktop';

const assignmentCopy = {
  all: { ar: 'الكل', en: 'All' },
  unassigned: { ar: 'غير مسند', en: 'Unassigned' },
  mine: { ar: 'مسند لي', en: 'Assigned to me' },
} as const;

const sharedWorklistCopy = {
  unread: { ar: 'غير مقروءة', en: 'Unread' },
  resolved: { ar: 'محلولة', en: 'Resolved' },
} as const;

const surfaceWorklistCopy = {
  mobile: {
    all: { ar: 'الكل', en: 'All' },
    noura: { ar: 'الأتمتة', en: 'Automation' },
    staff: { ar: 'تحتاج متابعة', en: 'Needs attention' },
  },
  desktop: {
    all: { ar: 'كل الحالات', en: 'All states' },
    noura: { ar: 'المساعد الآلي', en: 'Automation' },
    staff: { ar: 'تحتاج مراجعة بشرية', en: 'Needs human review' },
  },
} as const;

function localized(copy: { ar: string; en: string }, ar: boolean): string {
  return ar ? copy.ar : copy.en;
}

/** Assignment labels are the same on mobile and desktop. */
export function getInboxAssignmentLabel(filter: InboxAssignmentFilter, ar: boolean): string {
  return localized(assignmentCopy[filter], ar);
}

/** Worklist labels keep the existing mobile and desktop wording. */
export function getInboxWorklistLabel(
  id: string,
  ar: boolean,
  surface: InboxWorklistSurface,
  leadLabels?: object
): string {
  const surfaceCopy =
    surfaceWorklistCopy[surface][id as keyof (typeof surfaceWorklistCopy)['mobile']];
  const sharedCopy = sharedWorklistCopy[id as keyof typeof sharedWorklistCopy];
  const copy = surfaceCopy ?? sharedCopy;
  if (copy) return localized(copy, ar);
  const recorded =
    leadLabels && Object.prototype.hasOwnProperty.call(leadLabels, id)
      ? (leadLabels as Record<string, unknown>)[id]
      : undefined;
  return typeof recorded === 'string' ? recorded : id;
}

/** Status line shown on the mobile list after a worklist is selected. */
export function mobileWorklistStatus(worklist: string, ar: boolean): string {
  if (worklist === 'staff') return ar ? 'تحتاج متابعة · واتساب' : 'Needs attention · WhatsApp';
  if (worklist === 'noura')
    return ar ? 'الأتمتة مسموحة · واتساب' : 'Automation permitted · WhatsApp';
  if (worklist === 'unread') return ar ? 'غير مقروءة' : 'Unread';
  return ar ? 'محلولة · واتساب' : 'Resolved · WhatsApp';
}
