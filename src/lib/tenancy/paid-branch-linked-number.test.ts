import { describe, expect, it, vi } from "vitest";
import { maskLinkedNumber, readMaskedLinkedNumber, type LinkedNumberClient } from "./paid-branch-linked-number";

function client(result: { data: unknown; error: unknown } | Error) {
  const calls: unknown[][] = [];
  const maybeSingle = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
  const c = { from: (t: string) => { calls.push(["from", t]); return { select: (cols: string) => { calls.push(["select", cols]); return {
    eq: (a: string, b: string) => { calls.push(["eq", a, b]); return { eq: (x: string, y: string) => { calls.push(["eq", x, y]); return { maybeSingle }; } }; } }; } }; } };
  return { c: c as LinkedNumberClient, calls };
}

describe("linked number", () => {
  it("masks all but country prefix and last four digits", () => {
    expect(maskLinkedNumber("+968 9123 4567")).toBe("+968••••4567");
    expect(maskLinkedNumber("+1 555-010-9999")).toBe("+155••••9999");
  });
  it("rejects malformed values", () => {
    for (const v of [null, 5, "", "12345", "0123456789", "+1234567890123456"]) expect(maskLinkedNumber(v)).toBeNull();
  });
  it("reads only the verified company link and returns the masked number", async () => {
    const { c, calls } = client({ data: { verified_display_number: "+96891234567" }, error: null });
    await expect(readMaskedLinkedNumber(c, "co")).resolves.toBe("+968••••4567");
    expect(calls).toEqual([["from", "whatsapp_company_links"], ["select", "verified_display_number"], ["eq", "company_id", "co"], ["eq", "status", "verified"]]);
  });
  it("fails closed on errors", async () => {
    await expect(readMaskedLinkedNumber(client({ data: null, error: { code: "x" } }).c, "co")).resolves.toBeNull();
    await expect(readMaskedLinkedNumber(client(new Error("down")).c, "co")).resolves.toBeNull();
  });
});
