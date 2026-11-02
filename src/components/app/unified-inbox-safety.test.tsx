import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import React, { type ComponentProps, type ReactNode } from "react";
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const state = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  readServiceInbox: vi.fn(),
  refreshWhatsappInboxPage: vi.fn(),
  loadInstagramInboxPage: vi.fn(),
  searchParams: new URLSearchParams(),
  locale: "en",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  const changed = (a: unknown[] | undefined, b: unknown[]) => !a || a.length !== b.length || b.some((v, i) => !Object.is(a[i], v));
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const s = slot();
    if (changed(s.deps, deps)) {
      s.value = fn();
      s.deps = deps;
    }
    return s.value;
  };
  return {
    ...actual,
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [s.value, (v: unknown) => { s.value = typeof v === "function" ? (v as (x: unknown) => unknown)(s.value) : v; }];
    },
    useRef(value: unknown) {
      const s = slot();
      if (!s.value) s.value = { current: value };
      return s.value;
    },
    useMemo: memo,
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect: () => {},
    useTransition: () => [false, (fn: () => unknown) => fn()],
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.routerPush, refresh: state.routerRefresh }),
  useSearchParams: () => state.searchParams,
}));

vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: state.locale }) }));
vi.mock("@/lib/customer/service-inbox-read", () => ({ fetchServiceInbox: () => state.readServiceInbox() }));
vi.mock("@/lib/whatsapp/inbox-actions", () => ({ refreshWhatsappInboxPage: (args: unknown) => state.refreshWhatsappInboxPage(args) }));
vi.mock("@/lib/instagram/inbox-actions", () => ({ loadInstagramInboxPage: (args: unknown) => state.loadInstagramInboxPage(args) }));
vi.mock("@/components/app/workspace-shell", () => ({
  WorkspaceShell: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => React.createElement("main", null, actions, children),
}));
vi.mock("./conversations", () => ({ ConversationsPage: (props: unknown) => React.createElement("div", { "data-pane": "conversations", ...props as Record<string, unknown> }) }));
vi.mock("./instagram-inbox", () => ({ InstagramInbox: (props: unknown) => React.createElement("div", { "data-pane": "instagram", ...props as Record<string, unknown> }) }));

import { UnifiedInbox } from "./unified-inbox";
import { ConversationsPage } from "./conversations";
import { InstagramInbox } from "./instagram-inbox";
type ReadableSnapshot = Extract<ComponentProps<typeof UnifiedInbox>["initial"], { ok: true }>;
type WhatsappSnapshot = Extract<ReadableSnapshot["wa"], { ok: true }>;
type InstagramSnapshot = Extract<ReadableSnapshot["ig"], { ok: true }>;
type Fixture = ReadableSnapshot & { wa: WhatsappSnapshot; ig: InstagramSnapshot };

function conversation(id: string, customer: string, phone: string, inboxSequence: string, text: string, at: number): WhatsappSnapshot["page"]["conversations"][number] {
  return { id, customer, phone, inboxSequence, unreadCount: 0, assignedTo: null, status: "open", owner: "assistant", assistantPaused: false,
    topic: "WhatsApp", summary: "", intervention: { reasons: [] }, messages: [{ id: `message-${id}`, from: "customer", text, at }] };
}

type Node = { type?: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const n = value as Node;
  return [n, ...nodes(n.props.children), ...nodes(n.props.actions)];
}

const company = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";

function render(props: ComponentProps<typeof UnifiedInbox>) {
  state.cursor = 0;
  return UnifiedInbox(props);
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  for (const s of state.slots) s.cleanup?.();
  state.slots = [];
  state.cursor = 0;
  state.effects = [];
  state.searchParams = new URLSearchParams();
  state.locale = "en";
  vi.clearAllMocks();
});

describe("UnifiedInbox membership and page safety", () => {
  function makeInitial(membershipFp = "fp-initial"): Fixture {
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
          status: "UNCONFIGURED" as const,
        },
      } as ReadableSnapshot["channelContract"],
      channel_access: { whatsapp: true, instagram: true },
      wa: {
        ok: true as const,
        conversations: [
          conversation("c1", "Customer 1", "+9681", "100", "Msg 1", 1000),
        ],
        page: {
          companyId: company,
          conversationScope: "all_company" as const,
          kind: "partial" as const,
          ordering: "newest_created" as const,
          conversations: [
            conversation("c1", "Customer 1", "+9681", "100", "Msg 1", 1000),
          ],
          hasMore: true,
          nextCursor: "cursor-2",
          total: 10,
          unreadTotal: 0,
          interventionTotal: 0,
          membershipFingerprint: membershipFp,
        },
        meta: {
          companyId: company, conversationScope: "all_company", timezone: null, timezoneAnnouncedUtc: true,
          canReply: false, canAssign: false, assignees: [],
          counts: { all: 0, awaiting_staff: 0, follow_up_today: 0, overdue: 0, trial_or_quote: 0 },
        },
      },
      ig: {
        ok: true as const,
        data: {
          companyId: company,
          actorId: actor,
          conversationScope: "all_company" as const,
          conversations: [],
          total: 0,
          unreadTotal: 0,
          hasMore: false,
          nextCursor: null,
        },
      },
    };
  }

  it("applies the dashboard attention filter and retains it while opening a thread", () => {
    // A pending Server Action can delay Next's search-parameter render.
    // Keep that snapshot stale: local selection must still update immediately.
    const historyPush=vi.fn();
    vi.stubGlobal("window",{history:{pushState:historyPush}});
    const initial=makeInitial();
    const attention={...conversation("needs-human","Needs human","+9682","101","Please help",2000),intervention:{reasons:["send_unknown" as const]}};
    initial.wa.page.conversations.push(attention);
    state.searchParams=new URLSearchParams("channel=whatsapp&filter=staff");
    const tree=render({initial}),allNodes=nodes(tree);
    expect(allNodes.some(n=>n.props.children==="Customer 1")).toBe(false);
    const row=allNodes.find(n=>n.props.type==="button"&&nodes(n.props.children).some(child=>child.props.children==="Needs human"))!;
    expect(row).toBeDefined();
    (row.props.onClick as ()=>void)();
    expect(historyPush).toHaveBeenCalledWith(null,"","/app/conversations?channel=whatsapp&source=whatsapp&c=needs-human&filter=staff");
    expect(state.routerPush).not.toHaveBeenCalled();
    expect(nodes(render({initial})).some(n=>n.type===ConversationsPage&&n.props.selectedConversationId==="needs-human")).toBe(true);
    const clear=allNodes.find(n=>n.props.children==="Clear filter")!;
    (clear.props.onClick as ()=>void)();
    expect(historyPush).toHaveBeenLastCalledWith(null,"","/app/conversations?channel=whatsapp");
    expect(state.readServiceInbox).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not describe an unmatched worklist as an empty inbox", () => {
    state.searchParams=new URLSearchParams("channel=whatsapp&filter=staff");
    const tree=render({initial:makeInitial()});
    expect(nodes(tree).some(n=>n.props.title==="No matches in loaded conversations")).toBe(true);
    expect(nodes(tree).some(n=>n.props.title==="No conversations yet")).toBe(false);
  });

  it("prevents regression of old membership results when refresh detects membership change", async () => {
    const initial = makeInitial("fp-old");
    let tree = render({ initial });

    // Simulate refresh with changed membershipFingerprint
    state.readServiceInbox.mockResolvedValue({
      ...initial,
      wa: {
        ...initial.wa,
        conversations: [
          { id: "c-new-member", customer: "New Member Cust", phone: "+96899", messages: [{ id: "m2", text: "New", at: 2000, fromCustomer: true }], unreadCount: 0, assignedTo: null, inboxSequence: "200" },
        ],
        page: {
          ...initial.wa.page,
          conversations: [
            { id: "c-new-member", customer: "New Member Cust", phone: "+96899", messages: [{ id: "m2", text: "New", at: 2000, fromCustomer: true }], unreadCount: 0, assignedTo: null, inboxSequence: "200" },
          ],
          membershipFingerprint: "fp-new",
        },
      },
    });

    const refreshBtn = nodes(tree).find(n => n.props.children === "Refresh")!;
    (refreshBtn.props.onClick as () => void)();
    await flush();
    tree = render({ initial });

    const allNodes = nodes(tree);
    const rowTexts = allNodes.filter(n => typeof n.props.children === "string").map(n => n.props.children);
    // Old membership conversation "Customer 1" must NOT be retained
    expect(rowTexts).not.toContain("Customer 1");
    // Only new membership conversation "New Member Cust" must be present
    expect(rowTexts).toContain("New Member Cust");
  });

  it("rejects more() pagination if returned membershipFingerprint does not match active membership", async () => {
    const initial = makeInitial("fp-active");
    let tree = render({ initial });

    // more() returns mismatched fingerprint
    state.refreshWhatsappInboxPage.mockResolvedValue({
      ok: true,
      data: {
        ...initial.wa.page,
        companyId: company,
        conversations: [
          { id: "c2-stale", customer: "Stale Member Page", phone: "+9682", messages: [{ id: "m2", text: "Stale", at: 500, fromCustomer: true }], unreadCount: 0, assignedTo: null, inboxSequence: "50" },
        ],
        membershipFingerprint: "fp-stale-different",
      },
    });

    const moreBtn = nodes(tree).find(n => n.props.children === "More WhatsApp")!;
    (moreBtn.props.onClick as () => void)();
    await flush();
    tree = render({ initial });

    const allNodes = nodes(tree);
    const texts = allNodes.map(n => String(n.props.children));
    // Stale row must NOT be merged
    expect(texts.some(t => t.includes("Stale Member Page"))).toBe(false);
    // Error notice must be displayed
    expect(texts.some(t => t.includes("The latest update could not be verified"))).toBe(true);
  });

  it("preserves loaded pages and native panes across re-renders and channel navigation to prevent draft loss", async () => {
    state.searchParams = new URLSearchParams("channel=whatsapp&source=whatsapp&c=c1");
    const initial = makeInitial("fp-1");
    let tree = render({ initial });

    // Load a second page via more()
    state.refreshWhatsappInboxPage.mockResolvedValue({
      ok: true,
      data: {
        ...initial.wa.page,
        companyId: company,
        conversations: [
          { id: "c2", customer: "Customer 2", phone: "+9682", messages: [{ id: "m2", text: "Msg 2", at: 900, fromCustomer: true }], unreadCount: 0, assignedTo: null, inboxSequence: "90" },
        ],
        membershipFingerprint: "fp-1",
        hasMore: false,
      },
    });

    const moreBtn = nodes(tree).find(n => n.props.children === "More WhatsApp")!;
    (moreBtn.props.onClick as () => void)();
    await flush();
    tree = render({ initial });

    // Verify both pages (c1 and c2) are retained
    let allNodes = nodes(tree);
    const names = allNodes.filter(n => typeof n.props.children === "string").map(n => n.props.children);
    expect(names).toContain("Customer 1");
    expect(names).toContain("Customer 2");

    // Switch through the actual pane callback, while Next's route snapshot lags.
    vi.stubGlobal("window",{history:{pushState:vi.fn()}});
    const selectInstagram=allNodes.find(n=>n.type===InstagramInbox)!.props.onSelectConversation as (id:string)=>void;
    selectInstagram("ig-thread-1");
    tree = render({ initial });

    // Verify both panes stay mounted (preserving drafts, not unmounting)
    allNodes = nodes(tree);
    const waPane = allNodes.find(n => n.type === ConversationsPage);
    expect(waPane).toBeDefined();

    // Verify wrapper div keeps waPane mounted with hidden and inert
    const waWrapper = allNodes.find(n => React.isValidElement(n.props.children) && n.props.children.type === ConversationsPage);
    expect(waWrapper).toBeDefined();
    expect(waWrapper!.props.hidden).toBe(true);
    expect(waWrapper!.props.inert).toBe(true);

    // Instagram pane is also mounted
    const igPane = allNodes.find(n => n.type === InstagramInbox);
    expect(igPane).toBeDefined();
    vi.unstubAllGlobals();
  });

  it("calculates search empty state within active channel filter and isolates channel failure", () => {
    // WhatsApp has loaded rows, Instagram failed
    const initial = {
      ...makeInitial("fp-1"),
      ig: { ok: false as const, code: "UNAVAILABLE" as const },
    };
    let tree = render({ initial });

    // Initially WhatsApp rows are shown, and Instagram failure Notice is shown
    let allNodes = nodes(tree);
    expect(allNodes.some(n => String(n.props.children).includes("This channel could not be loaded"))).toBe(true);
    expect(allNodes.some(n => n.props.children === "Customer 1")).toBe(true);

    // Now type a search query that matches nothing
    const searchInput = allNodes.find(n => n.props.type === "search")!;
    (searchInput.props.onChange as (e: unknown) => void)({ target: { value: "nonexistent" } });
    tree = render({ initial });

    // Empty search state must be shown within active filter (channel failure does not prevent search empty state)
    allNodes = nodes(tree);
    expect(allNodes.some(n => n.props.title === "No matches in loaded conversations")).toBe(true);
    expect(allNodes.some(n => n.props.body === "No conversations matched your search in loaded conversations.")).toBe(true);
  });

  it("disables retry button and conversation refresh button during moreLoading", async () => {
    const initial = {
      ...makeInitial("fp-1"),
      ig: { ok: false as const, code: "UNAVAILABLE" as const },
    };
    state.searchParams = new URLSearchParams("channel=whatsapp&source=whatsapp&c=c1");

    // Make more() hang
    let resolveMore: (v: { ok: true; data: WhatsappSnapshot["page"] }) => void;
    state.refreshWhatsappInboxPage.mockImplementation(() => new Promise<{ ok: true; data: WhatsappSnapshot["page"] }>(res => { resolveMore = res; }));

    let tree = render({ initial });
    const moreBtn = nodes(tree).find(n => n.props.children === "More WhatsApp")!;

    // Start more()
    (moreBtn.props.onClick as () => void)();
    await Promise.resolve(); // trigger initial sync step of more
    tree = render({ initial });

    const allNodes = nodes(tree);
    // Retry button in channel error notice must be disabled
    const retryBtn = allNodes.find(n => n.props.type === "button" && n.props.children === "Retry")!;
    expect(retryBtn.props.disabled).toBe(true);

    // Conversation refresh button in thread toolbar must be disabled
    const convRefreshBtn = allNodes.find(n => n.props["aria-label"] === "Refresh conversation")!;
    expect(convRefreshBtn.props.disabled).toBe(true);

    // Resolve more
    resolveMore!({
      ok: true,
      data: { ...initial.wa.page, companyId: company, conversations: [], membershipFingerprint: "fp-1" },
    });
    await flush();
    tree = render({ initial });
  });
});
