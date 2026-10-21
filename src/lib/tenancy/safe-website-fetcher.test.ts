import { describe, expect, it, vi } from "vitest";
import {
  isPrivateIpAddress,
  safeFetchWebsite,
  validateSafeUrlWithDns,
  type DnsLookupFn,
} from "./safe-website-fetcher";

describe("isPrivateIpAddress", () => {
  it("detects loopback addresses", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("127.0.0.5")).toBe(true);
    expect(isPrivateIpAddress("::1")).toBe(true);
  });

  it("detects cloud metadata endpoints", () => {
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
    expect(isPrivateIpAddress("169.254.1.1")).toBe(true);
  });

  it("detects private RFC1918 networks", () => {
    expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.255.255.255")).toBe(true);
    expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
    expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
    expect(isPrivateIpAddress("192.168.1.1")).toBe(true);
  });

  it("detects IPv6 unique local and link-local", () => {
    expect(isPrivateIpAddress("fe80::1")).toBe(true);
    expect(isPrivateIpAddress("fc00::1")).toBe(true);
    expect(isPrivateIpAddress("fd12:3456::1")).toBe(true);
  });

  it("detects IPv4-mapped IPv6 loopback and private", () => {
    expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIpAddress("::ffff:192.168.1.1")).toBe(true);
  });

  it("accepts public IP addresses", () => {
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
    expect(isPrivateIpAddress("1.1.1.1")).toBe(false);
    expect(isPrivateIpAddress("93.184.216.34")).toBe(false);
    expect(isPrivateIpAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("validateSafeUrlWithDns", () => {
  it("rejects non-http/https protocols", async () => {
    const res = await validateSafeUrlWithDns("ftp://example.com");
    expect(res.safe).toBe(false);
    expect(res.reason).toBe("INVALID_PROTOCOL");
  });

  it("rejects localhost and local internal hostnames directly", async () => {
    const res1 = await validateSafeUrlWithDns("http://localhost:3000/api");
    expect(res1.safe).toBe(false);
    const res2 = await validateSafeUrlWithDns("http://dev.local/admin");
    expect(res2.safe).toBe(false);
  });

  it("resolves DNS and rejects private destinations", async () => {
    const mockLookup = vi.fn().mockResolvedValue([
      { address: "192.168.1.50", family: 4 },
    ]);
    const res = await validateSafeUrlWithDns("https://internal-portal.com", mockLookup as unknown as DnsLookupFn);
    expect(res.safe).toBe(false);
    expect(res.reason).toBe("SSRF_DISALLOWED_IP");
    expect(mockLookup).toHaveBeenCalled();
  });

  it("resolves DNS and rejects cloud metadata destinations", async () => {
    const mockLookup = vi.fn().mockResolvedValue([
      { address: "169.254.169.254", family: 4 },
    ]);
    const res = await validateSafeUrlWithDns("http://evil-redirector.com", mockLookup as unknown as DnsLookupFn);
    expect(res.safe).toBe(false);
    expect(res.reason).toBe("SSRF_DISALLOWED_IP");
  });

  it("accepts domains resolving to public IPs", async () => {
    const mockLookup = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);
    const res = await validateSafeUrlWithDns("https://example.com/about", mockLookup as unknown as DnsLookupFn);
    expect(res.safe).toBe(true);
    expect(res.resolvedIps).toContain("93.184.216.34");
  });
});

describe("safeFetchWebsite", () => {
  it("fetches, extracts title and strips script/style tags", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Velora Boutique - Muscat</title>
          <style>body { color: red; }</style>
          <script>alert('xss');</script>
        </head>
        <body>
          <header><h1>Welcome to Velora</h1></header>
          <main>
            <p>We provide exclusive abayas and bespoke tailoring in Oman.</p>
            <p>Working hours: 9 AM to 9 PM daily.</p>
          </main>
        </body>
      </html>
    `;
    const mockFetch = vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    const mockLookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    const res = await safeFetchWebsite("https://example.com", {
      fetchFn: mockFetch,
      lookupFn: mockLookup as unknown as DnsLookupFn,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.title).toBe("Velora Boutique - Muscat");
      expect(res.extractedText).toContain("We provide exclusive abayas and bespoke tailoring in Oman.");
      expect(res.extractedText).toContain("Working hours: 9 AM to 9 PM daily.");
      expect(res.extractedText).not.toContain("alert");
      expect(res.extractedText).not.toContain("color: red");
    }
  });

  it("blocks SSRF redirect to internal metadata endpoint", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://safe-domain.com/start") {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const mockLookup = vi.fn().mockImplementation(async (host: string) => {
      if (host === "safe-domain.com") return [{ address: "93.184.216.34", family: 4 }];
      return [{ address: "169.254.169.254", family: 4 }];
    });

    const res = await safeFetchWebsite("https://safe-domain.com/start", {
      fetchFn: mockFetch,
      lookupFn: mockLookup as unknown as DnsLookupFn,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("SSRF_REDIRECT_BLOCKED");
    }
  });

  it("rejects payload exceeding maxBytes size limit", async () => {
    const largeHtml = "x".repeat(2 * 1024 * 1024); // 2MB
    const mockFetch = vi.fn().mockResolvedValue(new Response(largeHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Content-Length": String(largeHtml.length),
      },
    }));
    const mockLookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    const res = await safeFetchWebsite("https://example.com/large", {
      maxBytes: 1024 * 1024,
      fetchFn: mockFetch,
      lookupFn: mockLookup as unknown as DnsLookupFn,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PAYLOAD_TOO_LARGE");
    }
  });
});

it("blocks hexadecimal IPv4 mapped private addresses", () => {
  expect(isPrivateIpAddress("::ffff:7f00:1")).toBe(true);
  expect(isPrivateIpAddress("::ffff:a00:1")).toBe(true);
});

it("keeps the deadline active while reading a stalled body", async () => {
  const body = new ReadableStream<Uint8Array>({ start() {} });
  const result = await safeFetchWebsite("https://example.invalid", {
    timeoutMs: 20,
    lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchFn: async () => new Response(body),
  });
  expect(result).toMatchObject({ ok: false, code: "FETCH_TIMEOUT" });
}, 200);

it("bounds a stalled DNS lookup with the same overall deadline", async () => {
  const result = await safeFetchWebsite("https://example.invalid", {
    timeoutMs: 20,
    lookupFn: () => new Promise(() => {}),
    fetchFn: async () => { throw Error("Must not connect"); },
  });
  expect(result).toMatchObject({ ok: false, code: "FETCH_TIMEOUT" });
});
