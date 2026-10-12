import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyInstagramWebhookSignature, verifyAndParseInstagramWebhook } from "./webhook-parse";
import type { ParentWebhookSecret } from "./webhook-contracts";

const secret: ParentWebhookSecret = { source: "parent_webhook_app", value: "synthetic-parent-secret" };
const bytes = new TextEncoder().encode('{ "object":"instagram", "entry":[], "note":"مرحبا 👋" }');
const sign = (body: Uint8Array, key = secret.value) => `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;

describe("Instagram parent-app raw-body SHA256 verification", () => {
  it("accepts one exact signature over original Unicode bytes", () => {
    expect(verifyInstagramWebhookSignature(bytes, [sign(bytes)], secret)).toBe(true);
  });
  it("authenticates only the selected byte view", () => {
    const backing = new Uint8Array([1, ...bytes, 2]); const view = backing.subarray(1, backing.length - 1);
    expect(verifyInstagramWebhookSignature(view, [sign(bytes)], secret)).toBe(true);
    expect(verifyInstagramWebhookSignature(backing, [sign(bytes)], secret)).toBe(false);
  });
  it("rejects parsed/reserialized equivalent JSON", () => {
    const normalized = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(bytes))));
    expect(verifyInstagramWebhookSignature(normalized, [sign(bytes)], secret)).toBe(false);
  });
  it("rejects a changed raw byte", () => {
    const changed = bytes.slice(); changed[0] ^= 1;
    expect(verifyInstagramWebhookSignature(changed, [sign(bytes)], secret)).toBe(false);
  });
  it.each([{ headers: [] }, { headers: [sign(bytes), sign(bytes)] }, { headers: [sign(bytes), "other"] }])("rejects absent or duplicate headers: %j", ({ headers }) => {
    expect(verifyInstagramWebhookSignature(bytes, headers, secret)).toBe(false);
  });
  it.each([` ${sign(bytes)}`, `${sign(bytes)} `, `${sign(bytes)}, ${sign(bytes)}`, sign(bytes).replace("sha256=", "SHA256="), "sha1=" + "a".repeat(40), "sha256=" + "a".repeat(63), "sha256=" + "z".repeat(64), "sha256=" + "a".repeat(65)])("rejects malformed/alternative header: %s", header => {
    expect(verifyInstagramWebhookSignature(bytes, [header], secret)).toBe(false);
  });
  it("does not fall back to a different or OAuth secret", () => {
    expect(verifyInstagramWebhookSignature(bytes, [sign(bytes, "synthetic-oauth-secret")], secret)).toBe(false);
    expect(verifyInstagramWebhookSignature(bytes, [sign(bytes)], { source: "instagram_oauth_app", value: secret.value } as never)).toBe(false);
  });
  it.each(["", " ", " synthetic-parent-secret "])("rejects missing/malformed secret configuration", value => {
    expect(verifyInstagramWebhookSignature(bytes, [sign(bytes)], { ...secret, value })).toBe(false);
  });
  it("fails closed for wrong raw/header types", () => {
    expect(verifyInstagramWebhookSignature("raw text" as never, [sign(bytes)], secret)).toBe(false);
    expect(verifyInstagramWebhookSignature(bytes, sign(bytes) as never, secret)).toBe(false);
  });
  it("does not expose secret-bearing getter errors", () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    try {
      const bad = { source: "parent_webhook_app", get value(): string { throw new Error(secret.value); } } as ParentWebhookSecret;
      expect(verifyInstagramWebhookSignature(bytes, [sign(bytes)], bad)).toBe(false);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { logs.forEach(log => log.mockRestore()); }
  });
});
describe("verified-body decode", () => {
  it("verifies before decoding JSON", () => {
    const invalid = new TextEncoder().encode("not JSON");
    expect(verifyAndParseInstagramWebhook(invalid, [sign(bytes)], secret)).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
    expect(verifyAndParseInstagramWebhook(invalid, [sign(invalid)], secret)).toEqual({ ok: false, code: "INVALID_JSON" });
  });
  it("authenticates actual bytes rather than a custom typed-array iterator", () => {
    const actual = new TextEncoder().encode("unsigned invalid JSON");
    Object.defineProperty(actual, Symbol.iterator, { value: () => bytes[Symbol.iterator]() });
    expect(verifyAndParseInstagramWebhook(actual, [sign(bytes)], secret)).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
    expect(verifyInstagramWebhookSignature(actual, [sign(bytes)], secret)).toBe(false);
  });
  it("rejects authenticated invalid UTF-8 rather than replacing bytes", () => {
    const invalid = new Uint8Array([0xc3, 0x28]);
    expect(verifyAndParseInstagramWebhook(invalid, [sign(invalid)], secret)).toEqual({ ok: false, code: "INVALID_JSON" });
  });
  it("parses a verified supported empty envelope", () => {
    expect(verifyAndParseInstagramWebhook(bytes, [sign(bytes)], secret)).toEqual({ ok: true, events: [], ignored: [] });
  });
});
