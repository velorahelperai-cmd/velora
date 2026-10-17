import { afterEach, expect, it, vi } from "vitest";
import { clearCompanyDrafts } from "@/lib/company-draft";
afterEach(() => vi.unstubAllGlobals());
it("blocked browser storage cannot report completed cleanup", () => {
  vi.stubGlobal("window", { get localStorage() { throw new Error("denied"); } });
  expect(clearCompanyDrafts("synthetic-actor")).toBe(false);
});
it("successful remove must read back absent before cleanup is acknowledged", () => {
  const removeItem = vi.fn();
  const getItem = vi.fn().mockReturnValue("still present");
  vi.stubGlobal("window", { localStorage: { removeItem, getItem } });
  expect(clearCompanyDrafts("synthetic-actor")).toBe(false);
  getItem.mockReturnValue(null);
  expect(clearCompanyDrafts("synthetic-actor")).toBe(true);
});
