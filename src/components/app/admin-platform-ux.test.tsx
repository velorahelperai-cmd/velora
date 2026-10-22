import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  slots: [] as Array<{ value?: unknown }>,
  cursor: 0,
  list: vi.fn(),
  overview: vi.fn(),
  truth: vi.fn(),
  reviews: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  return {
    ...actual,
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (v: unknown) => {
          s.value = typeof v === "function" ? (v as (old: unknown) => unknown)(s.value) : v;
        },
      ];
    },
    useRef(initial: unknown) {
      const s = slot();
      return s.value ?? (s.value = { current: initial });
    },
    useMemo(fn: () => unknown) {
      slot();
      return fn();
    },
    useEffect() {},
  };
});

vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "ar" }) }));
vi.mock("@/lib/tenancy/actions", () => ({
  adminListCompaniesPage: state.list,
  adminListPendingReviews: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  adminListPendingReviewsPage: state.reviews,
  adminGetOverviewStats: state.overview,
  adminSearchAccounts: vi.fn(),
}));
vi.mock("@/lib/answers/runtime/admin-truth", () => ({ readAdminTruth: state.truth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));

import { AdminList } from "./admin-list";

it("paginates reviews independently and shows their server total", async () => {
  state.list.mockResolvedValue({ ok: true, data: { rows: [], totalCount: 0, offset: 0, limit: 25, hasMore: false } });
  state.reviews.mockResolvedValue({ ok: true, data: { rows: [], totalCount: 40, offset: 0, limit: 25, hasMore: true } });
  let tree = render();
  const refresh = nodes(tree).find(n => typeof n.props.onClick === "function" && text(n.props.children).includes("تحديث البيانات"))!;
  (refresh.props.onClick as () => void)();
  await flush();
  tree = render();
  const next = nodes(tree).find(n => n.props["data-admin-review-page"] === "next");
  expect(next).toBeDefined();
  expect(text(tree)).toContain("40");
  state.reviews.mockResolvedValue({ ok: true, data: { rows: [], totalCount: 40, offset: 25, limit: 25, hasMore: false } });
  (next!.props.onClick as () => void)();
  await flush();
  expect(state.reviews).toHaveBeenLastCalledWith({ limit: 25, offset: 25 });
  expect(nodes(render()).find(n => n.props["data-admin-review-page"] === "next")!.props.disabled).toBe(true);
});

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== "object" || !("props" in v)) return [];
  const n = v as Node;
  return [n, ...nodes(n.props.children)];
}
function text(v: unknown): string {
  if (Array.isArray(v)) return v.map(text).join(" ");
  if (v && typeof v === "object" && "props" in v) return text((v as Node).props.children);
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}
function render(props: Record<string, unknown> = {}): ReactNode {
  state.cursor = 0;
  return AdminList({ ...props, overviewUnavailable: { code: "FORBIDDEN", message: "synthetic unavailable" } });
}
const flush = async () => {
  await new Promise((r) => setTimeout(r, 20));
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

function toPage(items: unknown[], offset = 0, limit = 25) {
  const off = Math.max(offset ?? 0, 0);
  const rows = items.slice(off, off + limit);
  return {
    ok: true,
    data: {
      rows,
      totalCount: items.length,
      offset: off,
      limit,
      hasMore: off + rows.length < items.length,
    },
  };
}

const compA = { id: "11111111-1111-4111-8111-111111111111", display_name: "Company A", status: "active", created_at: "2026-10-10T00:00:00Z" };
const compB = { id: "22222222-2222-4222-8222-222222222222", display_name: "Company B", status: "active", created_at: "2026-10-11T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  state.slots = [];
  state.cursor = 0;
  state.list.mockImplementation(async (input?: { offset?: number; limit?: number }) => {
    return toPage([compA, compB], input?.offset, input?.limit);
  });
  state.overview.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
  state.truth.mockResolvedValue({ ok: false });
});

describe("AdminList Race Conditions, Dedup & Rapid Switching", () => {
  it("prevents duplicate search requests when user clicks rapidly while busy (useAction lock)", async () => {
    const pendingCall = deferred<unknown>();
    state.list.mockReturnValueOnce(pendingCall.promise);

    let tree = render();
    let form = nodes(tree).find((n) => n.type === "form")!;

    // 1. Submit search: "FirstQuery"
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    expect(state.list).toHaveBeenCalledTimes(1);

    // 2. Rapid repeat click while action is busy
    tree = render();
    form = nodes(tree).find((n) => n.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });

    // Must still be called exactly once due to useAction lock
    expect(state.list).toHaveBeenCalledTimes(1);

    // 3. Resolve the pending call
    pendingCall.resolve(toPage([compA]));
    await flush();
    tree = render();

    expect(text(tree)).toContain("Company A");
  });

  it("generation counter drops older out-of-order resolution when pagination advances", async () => {
    // Initial load: 30 companies to have pagination
    const thirty = Array.from({ length: 30 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      display_name: `Company ${i + 1}`,
      status: "active",
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));
    state.list.mockImplementation(async (input?: { offset?: number; limit?: number }) => {
      return toPage(thirty, input?.offset, input?.limit);
    });

    let tree = render();
    const form = nodes(tree).find((n) => n.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    await flush();
    tree = render();

    // Verify first page showing Company 1
    expect(text(tree)).toContain("Company 1");

    // Next page button
    const nextBtn = nodes(tree).find((n) => typeof n.props.onClick === "function" && text(n.props.children).includes("التالي"))!;
    expect(nextBtn).toBeDefined();

    // Setup delayed next page load and immediate follow-up
    const page2Call = deferred<unknown>();
    state.list.mockReturnValueOnce(page2Call.promise);

    (nextBtn.props.onClick as () => void)();
    expect(state.list).toHaveBeenCalledTimes(2);

    // Trigger an immediate third reload
    const page3Call = deferred<unknown>();
    state.list.mockReturnValueOnce(page3Call.promise);
    (nextBtn.props.onClick as () => void)();
    expect(state.list).toHaveBeenCalledTimes(3);

    // Resolve call 2 (out of order, now stale) with stale data
    page2Call.resolve(toPage(thirty.map((c, i) => i === 25 ? { ...c, display_name: "Stale Outdated Result" } : c), 25, 25));
    await flush();
    tree = render();

    // Stale result must be discarded by generation counter
    expect(text(tree)).not.toContain("Stale Outdated Result");

    // Resolve call 3 (newest)
    page3Call.resolve(toPage(thirty.map((c, i) => i === 25 ? { ...c, display_name: "Latest Fresh Result" } : c), 25, 25));
    await flush();
    tree = render();

    expect(text(tree)).toContain("Latest Fresh Result");
  });

  it("rapid filter switching does not get corrupted if intermediate request fails and allows honest retry", async () => {
    state.list.mockResolvedValueOnce({ ok: false, message: "NETWORK_UNAVAILABLE" });

    let tree = render();
    let form = nodes(tree).find((n) => n.type === "form")!;
    const select = nodes(form).find((n) => n.type === "select")!;

    // Switch to setup
    (select.props.onChange as (e: unknown) => void)({ target: { value: "setup" } });
    tree = render();
    form = nodes(tree).find((n) => n.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    await flush();
    tree = render();

    // UI shows localized error and allows retry
    expect(text(tree)).toContain("NETWORK_UNAVAILABLE");
    const retryBtn = nodes(tree).find((n) => typeof n.props.onClick === "function" && text(n.props.children).includes("إعادة"))!;
    expect(retryBtn).toBeDefined();

    // Retry successfully with setup company
    const setupComp = { ...compB, status: "setup", display_name: "Company In Setup" };
    state.list.mockResolvedValueOnce(toPage([setupComp]));
    (retryBtn.props.onClick as () => void)();
    await flush();
    tree = render();

    expect(text(tree)).toContain("Company In Setup");
  });

  it("empty state displays honest localized empty message without fabricating companies", async () => {
    state.list.mockResolvedValueOnce(toPage([]));
    let tree = render();
    const form = nodes(tree).find((n) => n.type === "form")!;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    await flush();
    tree = render();

    expect(text(tree)).toContain("لا توجد شركات مطابقة");
    expect(nodes(tree).some((n) => typeof n.props.href === "string" && n.props.href.startsWith("/admin/companies/"))).toBe(false);
  });
});
