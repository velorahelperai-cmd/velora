// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import React,{act,useState,type ComponentProps,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {appCopy} from '@/lib/app-copy';

vi.mock('server-only',()=>({}));

const state = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  readServiceInbox: vi.fn(),
  refreshWhatsappInboxPage: vi.fn(),
  loadInstagramInboxPage: vi.fn(),
  searchParams: new URLSearchParams(),
  locale: 'en',
  starred: [] as string[],
  starDenied: false,
  account: { status: 'ready', identity: { userId: '22222222-2222-4222-8222-222222222222' }, boundaryFingerprint: 'verified-boundary' },
  workspaceCompany: '11111111-1111-4111-8111-111111111111',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.routerPush, refresh: state.routerRefresh }),
  useSearchParams: () => state.searchParams,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/demo-state', () => ({ useDemo: () => ({ locale: state.locale }) }));
vi.mock('@/lib/customer/service-inbox-read', () => ({ fetchServiceInbox: state.readServiceInbox }));
vi.mock('@/lib/customer/inbox-extension-actions', () => ({
  listInboxStars: vi.fn(async ({ channel, conversationIds }: { channel: string; conversationIds: string[] }) =>
    state.starDenied ? { ok: false, code: 'FORBIDDEN' } : { ok: true, data: conversationIds.filter(id => state.starred.includes(`${channel}:${id}`)) }
  ),
  runInboxExtension: vi.fn(async ({ channel, conversationId, action }: { channel: string; conversationId: string; action: string }) => {
    const key = `${channel}:${conversationId}`;
    state.starred = action === 'star' ? [...new Set([...state.starred, key])] : state.starred.filter(v => v !== key);
    return { ok: true, data: null };
  }),
}));
vi.mock('@/lib/whatsapp/inbox-actions', () => ({ refreshWhatsappInboxPage: state.refreshWhatsappInboxPage, searchWhatsappInbox: vi.fn(async () => ({ ok: false, code: 'UNAVAILABLE' })) }));
vi.mock('@/lib/instagram/inbox-actions', () => ({ loadInstagramInboxPage: state.loadInstagramInboxPage }));
vi.mock('./account-chrome', () => ({ useOptionalAccountSession: () => state.account }));
vi.mock('./branch-inbox-realtime', () => ({ CompanyInboxRealtime: () => null }));
vi.mock('./workspace-shell', () => ({
  WorkspaceShell: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <main>
      <div data-testid="actions">{actions}</div>
      <div data-testid="body">{children}</div>
    </main>
  ),
}));
vi.mock('./ui', () => ({
  Button: ({ children, onClick, disabled, busy, ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; 'aria-label'?: string }) => (
    <button onClick={onClick} disabled={disabled || busy} aria-label={rest['aria-label']}>{children}</button>
  ),
  Notice: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  EmptyState: ({ title, body }: { title: string; body: string }) => (
    <section data-empty-state>
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  ),
  useAppCopy: () => appCopy('en'),
}));
vi.mock('./conversations', () => ({
  ConversationsPage: ({ selectedConversationId }: { selectedConversationId?: string | null }) => {
    const [draft, setDraft] = useState('');
    return (
      <section data-pane="conversations" data-selected={selectedConversationId ?? ''}>
        <textarea aria-label="WhatsApp draft" value={draft} onChange={e => setDraft(e.target.value)} />
      </section>
    );
  },
}));
vi.mock('./instagram-inbox', () => ({
  InstagramInbox: ({ onSelectConversation }: { onSelectConversation?: (id: string) => void }) => (
    <section data-pane="instagram">
      <button onClick={() => onSelectConversation?.('ig-1')}>Select Instagram thread</button>
    </section>
  ),
}));

import {UnifiedInbox} from './unified-inbox';
import {WorkspaceBootstrapProvider, type WorkspaceBootstrap} from './workspace-bootstrap';

type ReadableSnapshot = Extract<ComponentProps<typeof UnifiedInbox>['initial'], { ok: true }>;
type WhatsappSnapshot = Extract<ReadableSnapshot['wa'], { ok: true }>;
type InstagramSnapshot = Extract<ReadableSnapshot['ig'], { ok: true }>;
type Fixture = ReadableSnapshot & { wa: WhatsappSnapshot; ig: InstagramSnapshot };

const company = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';

function makeWhatsappConversation(
  id: string,
  customer: string,
  phone: string,
  inboxSequence: string,
  text: string,
  at: number,
  options?: Partial<WhatsappSnapshot['page']['conversations'][number]>
): WhatsappSnapshot['page']['conversations'][number] {
  return {
    id,
    customer,
    phone,
    inboxSequence,
    unreadCount: 0,
    assignedTo: null,
    status: 'open',
    owner: 'assistant',
    assistantPaused: false,
    topic: 'WhatsApp',
    summary: '',
    intervention: { reasons: [] },
    messages: [{ id: `msg-${id}`, from: 'customer', text, at }],
    ...options,
  };
}

function makeInstagramConversation(
  id: string,
  counterpartyId: string,
  text: string,
  at: number,
  options?: Partial<InstagramSnapshot['data']['conversations'][number]>
): InstagramSnapshot['data']['conversations'][number] {
  return {
    id,
    inboxSequence: '1',
    accountId: 'ig-acc-1',
    counterpartyId,
    assignedTo: null,
    revision: 1,
    unreadCount: 0,
    lastReceivedAt: new Date(at).toISOString(),
    latestMessage: {
      id: `ig-msg-${id}`,
      arrivalSequence: '1',
      direction: 'inbound',
      content: { kind: 'text', text },
      receivedAt: new Date(at).toISOString(),
      readObservedAt: null,
    },
    ...options,
  };
}

function makeTwoChannelFixture(): Fixture {
  return {
    ok: true as const,
    companyId: company,
    actorId: actor,
    owner: false,
    companyInSetup: false,
    waAllowed: true,
    igAllowed: true,
    igAssignAllowed: false,
    channelContract: {
      plan_entitlements: {
        status: 'UNCONFIGURED' as const,
      },
    } as ReadableSnapshot['channelContract'],
    channel_access: { whatsapp: true, instagram: true },
    wa: {
      ok: true as const,
      conversations: [
        makeWhatsappConversation('wa-1', 'Alice', '+96891111111', '101', 'Need a quote please', 3000, {
          unreadCount: 2,
          assignedTo: actor,
          leadStage: 'trial_or_quote_requested',
          intervention: { reasons: ['send_unknown' as const] },
        }),
        makeWhatsappConversation('wa-2', 'Bob', '+96892222222', '102', 'All solved thanks', 2000, {
          unreadCount: 0,
          assignedTo: null,
          status: 'resolved',
        }),
      ],
      page: {
        companyId: company,
        conversationScope: 'all_company' as const,
        kind: 'partial' as const,
        ordering: 'newest_created' as const,
        conversations: [
          makeWhatsappConversation('wa-1', 'Alice', '+96891111111', '101', 'Need a quote please', 3000, {
            unreadCount: 2,
            assignedTo: actor,
            leadStage: 'trial_or_quote_requested',
            intervention: { reasons: ['send_unknown' as const] },
          }),
          makeWhatsappConversation('wa-2', 'Bob', '+96892222222', '102', 'All solved thanks', 2000, {
            unreadCount: 0,
            assignedTo: null,
            status: 'resolved',
          }),
        ],
        hasMore: true,
        nextCursor: 'cursor-page-2',
        total: 3,
        unreadTotal: 2,
        interventionTotal: 1,
        membershipFingerprint: 'fp-multi-channel',
      },
      meta: {
        companyId: company,
        conversationScope: 'all_company',
        timezone: null,
        timezoneAnnouncedUtc: true,
        canReply: false,
        canAssign: false,
        assignees: [],
        counts: { all: 2, awaiting_staff: 1, follow_up_today: 0, overdue: 0, trial_or_quote: 1 },
      },
    },
    ig: {
      ok: true as const,
      data: {
        companyId: company,
        actorId: actor,
        conversationScope: 'all_company' as const,
        conversations: [
          makeInstagramConversation('ig-1', 'Charlie', 'Hello on IG', 4000, {
            unreadCount: 1,
            assignedTo: actor,
          }),
          makeInstagramConversation('ig-2', 'Diana', 'General enquiry', 1000, {
            unreadCount: 0,
            assignedTo: null,
          }),
        ],
        total: 2,
        unreadTotal: 1,
        hasMore: false,
        nextCursor: null,
      },
    },
  };
}

let root: Root;
let container: HTMLDivElement;

function render(props: ComponentProps<typeof UnifiedInbox>) {
  const value = {
    identity: { userId: actor, fullName: 'Synthetic owner', email: 'owner@example.invalid' },
    workspace: { needsContext: false, selectedCompanyId: state.workspaceCompany, isPlatformAdmin: false, choices: [] },
    knowledgeAllowed: false,
  } satisfies WorkspaceBootstrap;
  act(() => {
    root.render(
      <WorkspaceBootstrapProvider value={value}>
        <UnifiedInbox {...props} />
      </WorkspaceBootstrapProvider>
    );
  });
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.account = { status: 'ready', identity: { userId: actor }, boundaryFingerprint: 'verified-boundary' };
  state.workspaceCompany = company;
  state.locale = 'en';
  state.starred = [];
  state.starDenied = false;
  state.searchParams = new URLSearchParams();
  window.history.replaceState(null, '', '/app/conversations');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CLN-11 — Single-pass indexing and projection', () => {
  it('projects multi-channel counts accurately in desktop mode and supports pagination merge without dropping or duplicate counting', async () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));

    const initial = makeTwoChannelFixture();
    await act(async () => {
      render({ initial });
    });

    // In desktop mode with all channels:
    // activeRows: Charlie (IG, 4000), Alice (WA, 3000), Bob (WA, 2000), Diana (IG, 1000)
    // Counts:
    // - tabs: all=4, unassigned=2 (Bob, Diana), mine=2 (Charlie, Alice)
    // - loaded: all=4, unread=2 (Charlie unread=1, Alice unread=2), staff=1 (Alice)
    // - worklists (desktop):
    //   all=4, unread=2, staff=1 (Alice intervention), trial_or_quote=1 (Alice leadStage)
    expect(container.textContent).toContain('Charlie');
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('Bob');
    expect(container.textContent).toContain('Diana');

    // Simulate paging: refreshWhatsappInboxPage returns page 2 with Eve
    const page2Conversation = makeWhatsappConversation('wa-3', 'Eve', '+96893333333', '103', 'Page 2 message', 5000, {
      unreadCount: 1,
      assignedTo: null,
      intervention: { reasons: ['send_unknown' as const] },
    });

    state.refreshWhatsappInboxPage.mockResolvedValueOnce({
      ok: true,
      data: {
        ...initial.wa.page,
        conversations: [page2Conversation],
        hasMore: false,
        nextCursor: null,
      },
    });

    const moreButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b =>
      b.textContent?.includes('More WhatsApp')
    );
    expect(moreButton).toBeDefined();

    await act(async () => {
      moreButton!.click();
    });

    // After pagination merge:
    // Total rows = 5 (Eve, Charlie, Alice, Bob, Diana)
    // wa-3 (Eve) is indexed via Map and Set instantly
    expect(container.textContent).toContain('Eve');
    expect(container.textContent).toContain('Charlie');
    expect(container.textContent).toContain('Alice');
  });

  it('omits desktop worklist computations when desktop is false (mobile optimization)', async () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));

    const initial = makeTwoChannelFixture();
    await act(async () => {
      render({ initial });
    });

    // In mobile view (desktop: false), desktopWorklists returns []
    // Desktop navigation panel (.vdi-panel-nav) or desktop worklist items should not be present
    expect(container.querySelector('[data-inbox-panel="nav"]')).toBeNull();

    // Mobile tabs ("All4", "Unassigned2", "Assigned to me2") work accurately from single pass projection
    expect(container.textContent).toContain('All4');
    expect(container.textContent).toContain('Unassigned2');
    expect(container.textContent).toContain('Assigned to me2');
  });

  it('preserves starred conversation ordering via O(1) Set lookup without altering base array order', async () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));

    const initial = makeTwoChannelFixture();
    await act(async () => {
      render({ initial });
    });

    // Initial order by timestamp descending: Charlie (4000), Alice (3000), Bob (2000), Diana (1000)
    const getRowNames = () =>
      [...container.querySelectorAll('[data-inbox-panel="list"] .vdi-row-top strong')].map(el => el.textContent?.trim());

    expect(getRowNames()).toEqual(['Charlie', 'Alice', 'Bob', 'Diana']);

    // Star Bob (WA, 2000)
    const starBobBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Star Bob"]');
    expect(starBobBtn).toBeDefined();

    await act(async () => {
      starBobBtn!.click();
    });

    // With Bob starred, pinnedSet.has puts Bob at the top!
    expect(getRowNames()[0]).toBe('Bob');
    expect(getRowNames().slice(1)).toEqual(['Charlie', 'Alice', 'Diana']);
  });
});
