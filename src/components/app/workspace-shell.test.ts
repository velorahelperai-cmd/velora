import { describe, expect, it } from "vitest";
import { appCopy } from "@/lib/app-copy";

describe("workspace company switch copy", () => {
  it("exposes switch failure message in both locales", () => {
    const ar = appCopy("ar");
    const en = appCopy("en");
    expect(ar.app.workspaceSwitchFailed.length).toBeGreaterThan(8);
    expect(en.app.workspaceSwitchFailed.length).toBeGreaterThan(8);
    expect(ar.app.workspaceSwitchFailed).not.toBe(ar.app.workspacePick);
  });
});
