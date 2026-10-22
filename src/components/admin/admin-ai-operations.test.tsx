import { describe, expect, it, vi } from "vitest";
import type { AdminAIState } from "@/lib/answers/runtime/admin-types";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Driver = { slots: Slot[]; cursor: number; effects: Array<() => void>; mounted: boolean };
const mocked = vi.hoisted(() => ({
  driver: null as Driver | null,
  currentLocale: "ar",
  runTrialMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => {
    const d = mocked.driver!;
    return { d, s: d.slots[d.cursor++] ?? (d.slots[d.cursor - 1] = {}) };
  };
  const changed = (a: unknown[] | undefined, b: unknown[]) =>
    !a || a.length !== b.length || b.some((v, i) => !Object.is(a[i], v));
  return {
    ...actual,
    useState(initial: unknown) {
      const { d, s } = slot();
      if (!("value" in s))
        s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (value: unknown) => {
          if (!d.mounted) return;
          s.value = typeof value === "function" ? (value as (v: unknown) => unknown)(s.value) : value;
        },
      ];
    },
    useRef(value: unknown) {
      const { s } = slot();
      if (!s.value) s.value = { current: value };
      return s.value;
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const { s } = slot();
      if (changed(s.deps, deps)) {
        s.value = fn();
        s.deps = deps;
      }
      return s.value;
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const { d, s } = slot();
      if (changed(s.deps, deps)) {
        d.effects.push(() => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        });
        s.deps = deps;
      }
    },
  };
});

// Mock demo-state for Arabic locale
vi.mock("@/lib/demo-state", () => ({
  useDemo: () => ({ locale: mocked.currentLocale }),
}));

// Mock runtime admin actions
vi.mock("@/lib/answers/runtime/admin-actions", () => ({
  runAdminAITrial: mocked.runTrialMock,
  readAdminAIState: mocked.refreshMock,
}));

vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
  fn();
  return 1;
});
vi.stubGlobal("cancelAnimationFrame", vi.fn());

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const node = value as { props: Record<string, unknown> };
    return text(node.props.children);
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function renderAIOperations(props: Parameters<typeof AdminAIOperations>[0]) {
  const driver: Driver = { slots: [], cursor: 0, effects: [], mounted: true };
  mocked.driver = driver;
  const tree = AdminAIOperations(props);
  mocked.driver = null;
  driver.effects.splice(0).forEach((fn) => fn());
  return tree;
}

// Imports for Stage D Module 05 component
import { AdminAIOperations } from "./admin-ai-operations";

describe("Stage D — Module 05: AdminAIOperations", () => {
  const sampleState: AdminAIState = {
    budget: {
      limit_baisa: 25000, // 25.000 OMR (Must NOT be 100 OMR!)
      spent_baisa: 4500,  // 4.500 OMR
      held_baisa: 500,    // 0.500 OMR
      enabled: true,
    },
    companies: [
      { id: "cmp-001", name: "مطعم المذاق العماني", status: "active" },
      { id: "cmp-002", name: "مقهى السحاب", status: "active" },
      { id: "cmp-003", name: "شركة موقوفة", status: "suspended" },
    ],
    models: [
      { model_id: "gemini-3.8-flash", attempts: 120, succeeded: 118, cost_baisa: 1250 },
      { model_id: "gpt-6-luna", attempts: 45, succeeded: 44, cost_baisa: 2100 },
      { model_id: "gpt-6.1-sol", attempts: 15, succeeded: 14, cost_baisa: 1150 },
    ],
    recent: [
      {
        id: "att-001",
        company_id: "cmp-001",
        model_id: "gemini-3.8-flash",
        status: "success",
        cost_baisa: 12.5,
        cost_usd: 0.032,
        reserved_baisa: 15,
        prompt_tokens: 150,
        completion_tokens: 65,
        cached_tokens: 0,
        reasoning_tokens: 0,
        error_code: null,
        request_id: "req-12345",
        latency_ms: 380,
        created_at: "2026-10-22T06:00:00Z",
      },
      {
        id: "att-002",
        company_id: "cmp-002",
        model_id: "gpt-6-luna",
        status: "incomplete",
        cost_baisa: null,
        cost_usd: null,
        reserved_baisa: 25,
        prompt_tokens: 220,
        completion_tokens: null,
        cached_tokens: 0,
        reasoning_tokens: 0,
        error_code: "PROVIDER_HTTP_429",
        request_id: "req-67890",
        latency_ms: null,
        created_at: "2026-10-22T05:30:00Z",
      },
    ],
  };

  it("renders real database budget limits without elevating to 100 OMR", () => {
    const tree = renderAIOperations({ initial: sampleState });
    const renderedText = text(tree);

    // Real DB budget: 25.000 OMR limit, 4.500 spent, 20.000 remaining
    expect(renderedText).toContain("25.000"); // limit
    expect(renderedText).toContain("4.500");  // spent
    expect(renderedText).toContain("20.000"); // remaining
    expect(renderedText).not.toContain("100.000"); // Must NEVER hardcode 100 OMR
  });

  it("renders operational KPIs derived from real runtime data", () => {
    const tree = renderAIOperations({ initial: sampleState });
    const renderedText = text(tree);

    // Total attempts = 120 + 45 + 15 = 180
    expect(renderedText).toContain("180");
    // Success rate = (118 + 44 + 14) / 180 = 176 / 180 = 97.8%
    expect(renderedText).toContain("97.8%");
    // Default Engine
    expect(renderedText).toContain("Gemini 3.8 Flash");
  });

  it("renders all 3 model cards with real attempts and cost breakdown", () => {
    const tree = renderAIOperations({ initial: sampleState });
    const renderedText = text(tree);

    expect(renderedText).toContain("Gemini 3.8 Flash");
    expect(renderedText).toContain("GPT-6 Luna");
    expect(renderedText).toContain("GPT-6.1 Sol");
    expect(renderedText).toContain("120"); // gemini attempts
    expect(renderedText).toContain("45");  // luna attempts
    expect(renderedText).toContain("15");  // sol attempts
  });

  it("filters out suspended companies from target trial selector", () => {
    const tree = renderAIOperations({ initial: sampleState });
    const renderedText = text(tree);

    expect(renderedText).toContain("مطعم المذاق العماني");
    expect(renderedText).toContain("مقهى السحاب");
    expect(renderedText).not.toContain("شركة موقوفة");
  });

  it("renders recent usage ledger table with status badges and token counts", () => {
    const tree = renderAIOperations({ initial: sampleState });
    const renderedText = text(tree);

    expect(renderedText).toContain("req-12345");
    expect(renderedText).toContain("380ms");
    expect(renderedText).toContain("req-67890");
    expect(renderedText).toContain("PROVIDER_HTTP_429");
  });
});
