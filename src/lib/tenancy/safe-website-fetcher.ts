import dns from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";

// Connect to the validated address, while preserving HTTP Host and TLS SNI.
// No second DNS lookup is allowed between validation and socket creation.
function fetchPinned(url: string, address: string, signal: AbortSignal): Promise<Response> {
  const original = new URL(url);
  const target = new URL(url);
  target.hostname = address.includes(":") ? `[${address}]` : address;
  return new Promise((resolve, reject) => {
    const request = original.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(target, {
      signal, servername: original.hostname.replace(/^\[|\]$/g, ""),
      headers: { Host: original.host, "User-Agent": "VeloraBot/1.0", Accept: "text/html,text/plain" },
    }, res => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode || 502, headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

const PRIVATE_IPV4_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local / Cloud metadata (AWS/GCP/Azure)
  /^0\./, // Current network
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // Shared address space
  /^198\.(18|19)\./, // Benchmarking
  /^(22[4-9]|23[0-9]|24[0-9]|25[0-5])\./, // Multicast/reserved
];

/**
 * Checks if an IP address (IPv4 or IPv6) is private, loopback, link-local,
 * cloud metadata, or otherwise non-routable over the public internet.
 */
export function isPrivateIpAddress(ip: string): boolean {
  if (!ip || typeof ip !== "string") return true;
  let trimmed = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!isIP(trimmed)) return true;
  if (trimmed.includes(":")) {
    trimmed = new URL(`http://[${trimmed}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(trimmed);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return isPrivateIpAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    // Only global unicast 2000::/3 is eligible for outbound knowledge fetches.
    if (!/^[23][0-9a-f]{3}:/.test(trimmed)) return true;
  }

  // IPv4-mapped IPv6 address (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (trimmed.startsWith("::ffff:")) {
    const v4Part = trimmed.slice(7);
    if (v4Part.includes(".")) {
      return isPrivateIpAddress(v4Part);
    }
  }

  // IPv6 checks
  if (trimmed.includes(":")) {
    if (trimmed === "::1" || trimmed === "::") return true;
    // Link-local: fe80::/10
    if (/^fe[89ab][0-9a-f]:/i.test(trimmed) || trimmed.startsWith("fe80:")) return true;
    // Unique local address: fc00::/7 (fc00:: - fdff::)
    if (/^f[cd][0-9a-f]{2}:/i.test(trimmed) || trimmed.startsWith("fc00:") || trimmed.startsWith("fd")) return true;
    return false;
  }

  // IPv4 checks
  for (const range of PRIVATE_IPV4_RANGES) {
    if (range.test(trimmed)) return true;
  }

  return false;
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: boolean }
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Validates that a raw URL is safe to fetch over the public internet.
 * Resolves DNS to check all target IPs against private/metadata ranges.
 */
export async function validateSafeUrlWithDns(
  rawUrl: string,
  lookupFn?: DnsLookupFn
): Promise<{ safe: boolean; reason?: string; resolvedIps?: string[] }> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: "INVALID_PROTOCOL" };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return { safe: false, reason: "SSRF_DISALLOWED_HOSTNAME" };
    }

    // Direct IP as hostname check
    if (isIP(hostname.replace(/^\[|\]$/g, "")) && isPrivateIpAddress(hostname)) {
      return { safe: false, reason: "SSRF_DISALLOWED_IP" };
    }

    const resolver = lookupFn ?? (dns.promises.lookup as unknown as DnsLookupFn);
    let records: Array<{ address: string; family: number }>;
    try {
      records = await resolver(hostname, { all: true });
    } catch {
      return { safe: false, reason: "DNS_RESOLUTION_FAILED" };
    }

    if (!records || records.length === 0) {
      return { safe: false, reason: "DNS_NO_RECORDS" };
    }

    const resolvedIps = records.map((r) => r.address);
    for (const record of records) {
      if (isPrivateIpAddress(record.address)) {
        return { safe: false, reason: "SSRF_DISALLOWED_IP", resolvedIps };
      }
    }

    return { safe: true, resolvedIps };
  } catch {
    return { safe: false, reason: "MALFORMED_URL" };
  }
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchFn?: typeof fetch;
  lookupFn?: DnsLookupFn;
}

export type SafeFetchResult =
  | { ok: true; title: string; extractedText: string; finalUrl: string }
  | { ok: false; code: string; message: string };

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return "";
      }
    });
}

function extractTitleAndText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "").trim()) : "";

  // Strip scripts, styles, svg, and templates
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");

  // Strip all HTML tags
  clean = clean.replace(/<[^>]+>/g, " ");

  // Decode entities
  clean = decodeHtmlEntities(clean);

  // Normalize whitespace
  clean = clean.replace(/\s+/g, " ").trim();

  return { title, text: clean };
}

/**
 * Safely fetches a web page, validates DNS and redirect URLs against SSRF,
 * enforces byte size and timeout boundaries, and extracts plain text and title.
 */
export async function safeFetchWebsite(
  initialUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 7000;
  const maxRedirects = options.maxRedirects ?? 3;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("FETCH_TIMEOUT")), { once: true });
  });
  let currentUrl = initialUrl;
  let activeBody: ReadableStream<Uint8Array> | null = null;
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      const validation = await Promise.race([validateSafeUrlWithDns(currentUrl, options.lookupFn), deadline]);
      if (!validation.safe) return { ok: false, code: redirects ? "SSRF_REDIRECT_BLOCKED" : validation.reason || "SSRF_BLOCKED", message: "Website must resolve to a public address" };
      const res = await Promise.race([
        options.fetchFn
          ? options.fetchFn(currentUrl, { signal: controller.signal, redirect: "manual" })
          : fetchPinned(currentUrl, validation.resolvedIps![0], controller.signal),
        deadline,
      ]);
      activeBody = res.body;
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("Location");
        await res.body?.cancel();
        activeBody = null;
        if (!location) return { ok: false, code: "INVALID_REDIRECT", message: "Redirect location missing" };
        if (redirects === maxRedirects) return { ok: false, code: "TOO_MANY_REDIRECTS", message: "Redirect limit exceeded" };
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
      if (!res.ok) return { ok: false, code: `HTTP_${res.status}`, message: "Website request failed" };
      if (Number(res.headers.get("Content-Length")) > maxBytes) return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Website exceeds byte limit" };
      if (!res.body) return { ok: false, code: "EMPTY_BODY", message: "Website returned no body" };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0, body = "";
      try {
        while (true) {
          const { done, value } = await Promise.race([reader.read(), deadline]);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Website exceeds byte limit" };
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const extracted = extractTitleAndText(body);
      return { ok: true, title: extracted.title || currentUrl, extractedText: extracted.text, finalUrl: currentUrl };
    }
    return { ok: false, code: "TOO_MANY_REDIRECTS", message: "Redirect limit exceeded" };
  } catch {
    return { ok: false, code: controller.signal.aborted ? "FETCH_TIMEOUT" : "FETCH_ERROR", message: "Website transfer failed" };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (activeBody && !activeBody.locked) void activeBody.cancel().catch(() => {});
  }
}
