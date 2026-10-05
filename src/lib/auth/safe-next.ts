/**
 * Allow only same-origin relative paths for post-auth return.
 * Rejects schemes, protocol-relative URLs, external destinations, and auth loops.
 * Does not rewrite path meaning via decode (e.g. /app/conversations%3Fx=y stays rejected).
 */

const AUTH_LOOP_BASES = ["/login", "/signup", "/forgot-password", "/auth"];

/** Encoded structural delimiters that would change path/query meaning if decoded. */
const ENCODED_STRUCTURAL = /%(?:00|2f|2F|3f|3F|23|5c|5C)/;

function stripQuery(path: string): string {
  const q = path.indexOf("?");
  const h = path.indexOf("#");
  let end = path.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return path.slice(0, end);
}

/** True when path is exactly base or a child segment under base/ (not a loose prefix). */
export function pathAtOrUnder(pathOnly: string, base: string): boolean {
  return pathOnly === base || pathOnly.startsWith(`${base}/`);
}

function hasAmbiguousPathEncoding(pathOnly: string): boolean {
  if (ENCODED_STRUCTURAL.test(pathOnly)) return true;
  // Reject any %xx that is not a safe unreserved/sub-delim encoding in path segments.
  // Keep the value as-is for inspection — never rewrite the returned path via decode.
  if (/%/.test(pathOnly)) {
    const re = /%[0-9A-Fa-f]{2}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pathOnly))) {
      const code = Number.parseInt(m[0].slice(1), 16);
      if (
        code === 0x00
        || code === 0x2f // /
        || code === 0x3f // ?
        || code === 0x23 // #
        || code === 0x5c // \
        || code < 0x20
        || code === 0x7f
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Reject literal or percent-encoded dot-segment traversal before role checks. */
function hasDotSegmentTraversal(pathOnly: string): boolean {
  const segments = pathOnly.split("/");
  for (const seg of segments) {
    if (!seg) continue;
    if (seg === "." || seg === "..") return true;
    // Inspect encoded segments (e.g. %2e%2e) without rewriting the destination string.
    if (/%/.test(seg)) {
      try {
        const decoded = decodeURIComponent(seg);
        if (decoded === "." || decoded === "..") return true;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

export function safeInternalPath(
  raw: string | null | undefined,
  fallback = "/setup",
): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("://") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(value)) return fallback;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return fallback;

  const pathOnly = stripQuery(value);
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) return fallback;
  if (hasAmbiguousPathEncoding(pathOnly)) return fallback;
  // Encoded traversal must be rejected before any role/prefix allowance.
  if (hasDotSegmentTraversal(pathOnly)) return fallback;

  if (AUTH_LOOP_BASES.some((base) => pathAtOrUnder(pathOnly, base))) {
    return fallback;
  }

  // Idempotent: sanitizing an already-safe value must not change it (query kept as-is).
  return value;
}

export type ReturnRoleGate = {
  isPlatformAdmin: boolean;
  hasCompany: boolean;
  role: "owner" | "staff" | null;
};

/** Role-appropriate internal destinations after gates (profile/provision) pass. */
export function allowedReturnPath(
  raw: string | null | undefined,
  gate: ReturnRoleGate,
  fallback: string,
): string {
  const candidate = safeInternalPath(raw, "");
  if (!candidate) return fallback;
  const pathOnly = stripQuery(candidate);

  if (pathAtOrUnder(pathOnly, "/account")) {
    return candidate;
  }

  if (pathAtOrUnder(pathOnly, "/admin")) {
    return gate.isPlatformAdmin ? candidate : fallback;
  }

  if (gate.isPlatformAdmin) {
    // Documented platform admins land on admin surfaces, not client boards.
    return fallback;
  }

  if (pathAtOrUnder(pathOnly, "/setup")) {
    if (gate.role === "staff") return fallback;
    return candidate;
  }

  if (pathAtOrUnder(pathOnly, "/app")) {
    if (!gate.hasCompany) return fallback;
    if (gate.role === "staff") {
      if (
        pathAtOrUnder(pathOnly, "/app/conversations")
        || pathAtOrUnder(pathOnly, "/app/settings")
      ) {
        return candidate;
      }
      return fallback;
    }
    return candidate;
  }

  return fallback;
}
