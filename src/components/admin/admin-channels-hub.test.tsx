// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminChannelsHub, type AdminChannelItem } from "./admin-channels-hub";

vi.mock("@/lib/demo-state", () => ({ useDemo: () => ({ locale: "en" }) }));
vi.mock("next/link", () => ({default: ({children, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>}));
const channels: AdminChannelItem[] = [
  {id: "wa", companyId: "a", companyName: "First", channelType: "whatsapp", status: "verified", identifier: "123", coexistence: true},
  {id: "ig", companyId: "b", companyName: "Second", channelType: "instagram", status: "bound", identifier: "account"},
];
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });
it("filters loaded channel records while preserving the completeness warning", async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(<AdminChannelsHub channels={channels} stats={{totalChannels: 2, totalWhatsapp: 1, totalInstagram: 1, activeConnected: 2, needsAction: 0, coexistenceCount: 1}}/>));
  const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent?.includes("Instagram"))!;
  await act(async () => button.click());
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Second");
  expect(host.textContent).not.toContain("First");
  expect(host.textContent).toContain("list may be incomplete");
  expect(host.querySelector('select')?.getAttribute('aria-label')).toBe("Filter channel status");
});
