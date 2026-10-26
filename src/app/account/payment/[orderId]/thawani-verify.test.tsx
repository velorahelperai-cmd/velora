// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), refresh: vi.fn() }));
vi.mock("./actions", () => ({ verifyThawaniPayment: mocks.verify }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { ThawaniVerify } from "./thawani-verify";
let root: Root;
let container: HTMLDivElement;
async function renderVerify() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ThawaniVerify orderId="saved-order" />); });
}
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.resetAllMocks(); });
describe("Thawani return verification", () => {
 it("refreshes only after server confirms paid", async () => {
  mocks.verify.mockResolvedValue({ ok: true, paid: true });
  await renderVerify();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.verify).toHaveBeenCalledWith("saved-order");
 });
 it("keeps unpaid result pending and retries the same saved order", async () => {
  mocks.verify.mockResolvedValue({ ok: true, paid: false });
  await renderVerify();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("لم يكتمل");
  await act(async () => { container.querySelector("button")!.click(); });
  expect(mocks.verify).toHaveBeenCalledTimes(2);
  expect(mocks.verify).toHaveBeenLastCalledWith("saved-order");
 });
});
