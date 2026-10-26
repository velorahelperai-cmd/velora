// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAccountsDirectory } from "./admin-accounts-directory";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({default: ({children, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>}));
vi.mock("./account-deletion-panel", () => ({AccountDeletionPanel: () => null}));
let host: HTMLDivElement, root: Root;
vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "ar" }) }));
beforeEach(() => { Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true}); push.mockClear(); host=document.createElement("div"); document.body.append(host); root=createRoot(host); });
afterEach(async () => {await act(async () => root.unmount());host.remove();});
describe("account directory search", () => {
  it("allows consecutive searches, including the same query", async () => {
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="owner" accounts={[]} hasMore={false}/>));
    for(let i=0;i<2;i++) await act(async () => {host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith("/admin/accounts?q=owner&offset=0");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
  it("restores search text when navigation delivers a different query", async () => {
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="old" accounts={[]} hasMore={false}/>));
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="new" accounts={[]} hasMore={false}/>));
    const input=host.querySelector<HTMLInputElement>("#admin-account-search")!;
    expect(input.value).toBe("new");
    expect(input.labels?.[0]?.textContent).toBe("البحث عن حساب");
  });
});
