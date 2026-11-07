import { expect, it } from 'vitest';
import {
  getInboxWorklistLabel,
  inboxRows,
  inboxHref,
  matchesInboxAssignment,
  mobileWorklistStatus,
} from './inbox-presentation';
import type { WhatsappInboxItem } from '@/lib/whatsapp/inbox-contracts';
import type { InstagramConversation } from '@/lib/instagram/inbox-contracts';
it('never merges matching names or conversation IDs between channels; orders actual activity', () => {
  const wa = {
    id: 'same',
    customer: '101',
    phone: '101',
    unreadCount: 1,
    messages: [{ text: 'WA', at: 100 }],
  } as WhatsappInboxItem;
  const ig = {
    id: 'same',
    counterpartyId: '101',
    unreadCount: 2,
    lastReceivedAt: new Date(200).toISOString(),
    assignedTo: null,
    latestMessage: { content: { kind: 'text', text: 'IG' } },
  } as InstagramConversation;
  const rows = inboxRows([wa], [ig], false);
  expect(rows.map((r) => r.key)).toEqual(['instagram:same', 'whatsapp:same']);
  expect(rows.map((r) => r.preview)).toEqual(['IG', 'WA']);
});
it('keeps a channel filter on selection and back, never routes a reply into the other channel', () => {
  expect(inboxHref('instagram', 'id', 'instagram')).toBe(
    '/app/conversations?channel=instagram&source=instagram&thread=id'
  );
  expect(inboxHref(null, null, 'whatsapp')).toBe('/app/conversations?channel=whatsapp');
});
it('filters only the authorized loaded assignment against the verified actor', () => {
  expect(matchesInboxAssignment({ assignedTo: null }, 'unassigned', 'actor')).toBe(true);
  expect(matchesInboxAssignment({ assignedTo: 'actor' }, 'mine', 'actor')).toBe(true);
  expect(matchesInboxAssignment({ assignedTo: 'other' }, 'mine', 'actor')).toBe(false);
  expect(matchesInboxAssignment({ assignedTo: null }, 'mine', null)).toBe(false);
  expect(matchesInboxAssignment({ assignedTo: 'other' }, 'unassigned', 'actor')).toBe(false);
});
it('keeps mobile and desktop worklist wording distinct', () => {
  expect(getInboxWorklistLabel('all', true, 'mobile')).toBe('الكل');
  expect(getInboxWorklistLabel('all', false, 'desktop')).toBe('All states');
  expect(getInboxWorklistLabel('staff', true, 'mobile')).toBe('تحتاج متابعة');
  expect(getInboxWorklistLabel('staff', false, 'desktop')).toBe('Needs human review');
  expect(getInboxWorklistLabel('noura', true, 'mobile')).toBe('الأتمتة');
  expect(getInboxWorklistLabel('noura', false, 'desktop')).toBe('Automation');
  expect(getInboxWorklistLabel('unread', true, 'mobile')).toBe(
    getInboxWorklistLabel('unread', true, 'desktop')
  );
  expect(
    getInboxWorklistLabel('awaiting_staff', true, 'desktop', { awaiting_staff: 'بانتظار الموظف' })
  ).toBe('بانتظار الموظف');
  expect(mobileWorklistStatus('staff', false)).toBe('Needs attention · WhatsApp');
  expect(mobileWorklistStatus('resolved', true)).toBe('محلولة · واتساب');
});
