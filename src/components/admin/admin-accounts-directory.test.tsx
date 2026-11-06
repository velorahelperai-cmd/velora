// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAccountsDirectory } from "./admin-accounts-directory";
import type { AdminAccountSearchItem } from "@/lib/tenancy/types";

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
  it("allows returning from an empty later page while retaining the search", async () => {
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="owner" initialOffset={20} initialLimit={20} accounts={[]} hasMore={false}/>));
    const previous = Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("السابق"));
    expect(previous).toBeDefined();
    await act(async () => previous!.click());
    expect(push).toHaveBeenCalledWith("/admin/accounts?q=owner&offset=0");
  });
  it("restores search text when navigation delivers a different query", async () => {
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="old" accounts={[]} hasMore={false}/>));
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="new" accounts={[]} hasMore={false}/>));
    const input=host.querySelector<HTMLInputElement>("#admin-account-search")!;
    expect(input.value).toBe("new");
    expect(input.labels?.[0]?.textContent).toBe("البحث عن حساب");
  });
  it("filters and sorts the loaded page while keeping the same search", async () => {
    const accounts: AdminAccountSearchItem[] = [
      {user_id:"active-user", email:"active@example.com", email_confirmed:true, account_phone:null, full_name:"حساب نشط", support_code:"ACT", companies:[{company_id:"company-1", display_name:"منشأة", role:"owner", status:"active", company_status:"active", business_phone:"+96824000000"}]},
      {user_id:"plain-user", email:"plain@example.com", email_confirmed:false, account_phone:null, full_name:"حساب بلا اشتراك", support_code:null, companies:[]},
    ];
    await act(async () => root.render(<AdminAccountsDirectory initialQuery="owner" accounts={accounts} hasMore={false} statusFilter="active"/>));
    expect(host.textContent).toContain("حساب نشط");
    expect(host.textContent).not.toContain("حساب بلا اشتراك");
    expect(host.textContent).toContain("+96824000000");
    expect(host.textContent).toContain("هاتف المنشأة");
    expect(host.querySelector('a[href="/admin/companies/company-1"]')).not.toBeNull();
    expect(host.querySelector('a[href="/admin/identity-recovery?userId=active-user"]')).not.toBeNull();
    const sort = host.querySelector<HTMLSelectElement>('select[aria-label="ترتيب الحسابات"]')!;
    sort.value = "name_asc";
    await act(async () => { sort.dispatchEvent(new Event("change", {bubbles:true})); });
    expect(push).toHaveBeenLastCalledWith("/admin/accounts?q=owner&offset=0&status=active&sort=name_asc");
  });
});
