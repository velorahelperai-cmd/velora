import { beforeEach, describe, expect, it, vi } from "vitest";
import { appCopy } from "@/lib/app-copy";
const mocks = vi.hoisted(() => ({ ask: vi.fn(), refs: [] as Array<{ current: unknown }> }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => { const ref = { current: initial }; mocks.refs.push(ref); return ref; },
  useEffect: vi.fn(), useLayoutEffect: vi.fn(),
}));
vi.mock("@/lib/answers/ask", () => ({ askCompanyAnswer: mocks.ask }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("@/lib/customer/dashboard-billing-actions", () => ({ readDashboardBilling: vi.fn() }));
vi.mock("@/components/app/account-chrome", () => ({ useOptionalAccountSession: () => ({ status: "ready", identity: { userId: "user", companyId: "company" } }) }));
vi.mock("@/components/app/ui", () => ({ useAppCopy: () => appCopy("en"), Button: "button", LinkButton: "a", Notice: "aside" }));
import { AssistantTester } from "./assistant-tester";

type Element = { type: unknown; props: { children?: unknown; onClick?: () => Promise<void> | void } };
function clickSuggestion(element: Element): (() => Promise<void> | void) | undefined {
  if (element.type === "button" && element.props.children === "What are your working hours?") return element.props.onClick;
  for (const child of [element.props.children].flat()) {
    if (child && typeof child === "object" && "props" in child) {
      const found = clickSuggestion(child as Element);
      if (found) return found;
    }
  }
}
beforeEach(() => { vi.clearAllMocks(); mocks.refs.length = 0; });
describe("assistant request submission", () => {
  it("admits only one provider-bound action before React commits the busy state", async () => {
    let release!: (value: { ok: false; code: "UNAVAILABLE" }) => void;
    mocks.ask.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const submit = clickSuggestion(AssistantTester({}) as Element)!;
    expect(submit).toBeTypeOf("function");
    submit();
    submit();
    const calls = mocks.ask.mock.calls.length;
    release({ ok: false, code: "UNAVAILABLE" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    submit();
    expect(mocks.ask).toHaveBeenCalledTimes(2);
    release({ ok: false, code: "UNAVAILABLE" });
  });
});
