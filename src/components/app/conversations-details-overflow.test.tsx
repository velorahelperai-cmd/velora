// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { appCopy } from '@/lib/app-copy';
import { ConversationsPage } from './conversations';

const api = vi.hoisted(() => ({
  thread: vi.fn(),
  saveNote: vi.fn(),
  send: vi.fn(),
  extension: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/lib/demo-state', () => ({ useDemo: () => ({ locale: 'en' }) }));
vi.mock('./workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('./channel-ai-draft', () => ({ ChannelAIDraft: () => null }));
vi.mock('./channel-review', () => ({ ChannelReviewStatus: () => null }));
vi.mock('@/lib/whatsapp/actions', () => ({
  controlWhatsappConversation: vi.fn(),
  replyWhatsappConversation: api.send,
  upsertConversationLeadState: api.saveNote,
}));
vi.mock('@/lib/customer/inbox-extension-actions', () => ({
  runInboxExtension: api.extension,
  removeUnboundWhatsappFile: vi.fn(),
  listWhatsappMediaMetadata: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock('@/lib/whatsapp/inbox-actions', () => ({
  refreshWhatsappInboxInitialPage: vi.fn(),
  refreshWhatsappInboxPage: vi.fn(),
  refreshWhatsappThreadPage: api.thread,
  refreshWhatsappControlAuditPage: vi.fn(async () => ({
    ok: true,
    data: { events: [], hasMore: false, nextCursor: null },
  })),
  refreshWhatsappConnectionStatus: vi.fn(async () => ({ ok: false, code: 'UNAVAILABLE' })),
  markWhatsappThreadSeen: vi.fn(),
}));

let host: HTMLDivElement, root: Root;

const conv1 = {
  id: 'conv-1',
  inboxSequence: '1',
  unreadCount: 0,
  intervention: { reasons: [] },
  customer: 'Customer One',
  phone: '+96890000001',
  topic: 'WhatsApp',
  summary: '',
  status: 'open' as const,
  owner: 'staff',
  assistantPaused: true,
  automationAllowed: false,
  revision: 1,
  messages: [],
  internalNote: 'Internal note 1',
  leadStage: 'new' as const,
  followUpStatus: 'none' as const,
  followUpAt: null,
  leadRevision: 1,
};

const conv2 = {
  id: 'conv-2',
  inboxSequence: '2',
  unreadCount: 0,
  intervention: { reasons: [] },
  customer: 'Customer Two',
  phone: '+96890000002',
  topic: 'WhatsApp',
  summary: '',
  status: 'open' as const,
  owner: 'staff',
  assistantPaused: true,
  automationAllowed: false,
  revision: 1,
  messages: [],
  internalNote: 'Internal note 2',
  leadStage: 'new' as const,
  followUpStatus: 'none' as const,
  followUpAt: null,
  leadRevision: 1,
};

const meta = {
  companyId: 'company-123',
  conversationScope: 'all_company' as const,
  timezone: null,
  timezoneAnnouncedUtc: true,
  canReply: true,
  canAssign: false,
  canTakeOver: true,
  canResume: true,
  canClose: true,
  assignees: [],
  counts: { all: 2, awaiting_staff: 1, follow_up_today: 0, overdue: 0, trial_or_quote: 0 },
};

const page = {
  kind: 'partial' as const,
  companyId: 'company-123',
  conversationScope: 'all_company' as const,
  ordering: 'newest_created' as const,
  conversations: [conv1, conv2],
  hasMore: false,
  nextCursor: null,
  total: 2,
  unreadTotal: 0,
  interventionTotal: 0,
  membershipFingerprint: 'fp-1',
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.extension.mockResolvedValue({ ok: true, data: [] });
  document.body.style.overflow = '';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);

  api.thread.mockImplementation(async ({ conversationId }: { conversationId: string }) => {
    const c = conversationId === 'conv-2' ? conv2 : conv1;
    return {
      ok: true,
      data: {
        kind: 'partial',
        companyId: 'company-123',
        conversationId,
        conversation: c,
        messages: [],
        displayedInboundMessageId: null,
        unreadCount: 0,
        nextCursor: null,
        hasMore: false,
      },
    };
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
});

describe('CLN-04: Conversation details scroll overflow release and lifecycle', () => {
  it('opens details, locks overflow to hidden, and releases overflow when deselected (selectedConversationId -> null)', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    // Details drawer toggle button
    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.style.overflow).toBe('');

    // Open details
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');
    expect(host.querySelector('#conversation-details')?.getAttribute('data-details-open')).toBe('true');
    expect(host.querySelector('.conversation-details-backdrop')).not.toBeNull();

    // Now simulate user clicking back or deselecting (selectedConversationId becomes null)
    // Pane stays mounted (as in UnifiedInbox), but selectedConversationId is null
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId={null}
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    // Overflow MUST be released immediately
    expect(document.body.style.overflow).toBe('');
    // Backdrop and details drawer MUST NOT be rendered
    expect(host.querySelector('.conversation-details-backdrop')).toBeNull();
    expect(host.querySelector('#conversation-details')).toBeNull();
  });

  it('starts the next conversation with drawer closed when switching directly between conversations', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    // Open details on conv-1
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');
    expect(host.querySelector('#conversation-details')?.getAttribute('data-details-open')).toBe('true');

    // Switch directly to conv-2
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-2"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    // Next conversation MUST start with closed drawer and released overflow
    expect(document.body.style.overflow).toBe('');
    const newDetails = host.querySelector('#conversation-details');
    expect(newDetails?.getAttribute('data-details-open')).toBe('false');
    expect(host.querySelector('.conversation-details-backdrop')).toBeNull();

    // The toggle on conv-2 must be collapsed
    const newToggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    expect(newToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('releases overflow and restores focus when closed via Close button (✕)', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    toggle.focus();
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');

    // Find close button inside drawer header
    const closeBtn = host.querySelector<HTMLButtonElement>('#conversation-details header button, #conversation-details button[aria-label="Close"]')!;
    expect(closeBtn).not.toBeNull();
    act(() => closeBtn.click());

    expect(document.body.style.overflow).toBe('');
    expect(host.querySelector('#conversation-details')?.getAttribute('data-details-open')).toBe('false');
    // Focus restored to toggle button
    expect(document.activeElement).toBe(toggle);
  });

  it('releases overflow and restores focus when closed via Escape key', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    toggle.focus();
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');

    // Press Escape
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.body.style.overflow).toBe('');
    expect(host.querySelector('#conversation-details')?.getAttribute('data-details-open')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('releases overflow when unmounted while details drawer is open', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');

    // Unmount
    act(() => root.unmount());
    expect(document.body.style.overflow).toBe('');
  });

  it('preserves reply drafts when toggling details drawer and switching conversations', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    // Enter draft text in composer
    const textarea = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${appCopy('en').app.reply}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Unsent draft text for conv 1');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea.value).toBe('Unsent draft text for conv 1');

    // Open details drawer
    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');

    // Deselect (e.g. back to list)
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId={null}
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });
    expect(document.body.style.overflow).toBe('');

    // Re-select conv-1: draft MUST be preserved!
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const restoredTextarea = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${appCopy('en').app.reply}"]`)!;
    expect(restoredTextarea.value).toBe('Unsent draft text for conv 1');
  });

  it('preserves pre-existing body overflow lock when details drawer is closed', async () => {
    document.body.style.overflow = 'hidden';
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');

    const closeBtn = host.querySelector<HTMLButtonElement>('#conversation-details header button, #conversation-details button[aria-label="Close"]')!;
    act(() => closeBtn.click());

    expect(document.body.style.overflow).toBe('hidden');
    document.body.style.overflow = '';
  });

  it('restores focus to next valid candidate if opener button is hidden or inert when drawer closes', async () => {
    await act(async () => {
      root.render(
        <ConversationsPage
          embedded
          selectedConversationId="conv-1"
          inbox={[conv1, conv2]}
          meta={meta}
          page={page}
        />
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-details-toggle="true"]')!;
    toggle.focus();
    act(() => toggle.click());
    expect(document.body.style.overflow).toBe('hidden');

    // Simulate opener button becoming hidden while drawer was open
    toggle.setAttribute('hidden', 'true');

    const closeBtn = host.querySelector<HTMLButtonElement>('#conversation-details header button, #conversation-details button[aria-label="Close"]')!;
    act(() => closeBtn.click());

    expect(document.activeElement).not.toBe(closeBtn);
    expect(document.activeElement).not.toBe(toggle);
    expect((document.activeElement as HTMLElement)?.tagName).toBe('BUTTON');
    expect((document.activeElement as HTMLElement)?.closest('[hidden], [inert]')).toBeNull();
  });
});
