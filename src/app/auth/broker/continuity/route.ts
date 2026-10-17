import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/auth/site-url";
import {
  bindBrowserContinuityFromAnchor,
  continuityArtifactsPresent,
  readContinuityMirror,
} from "@/lib/auth/broker/continuity";

export const dynamic = "force-dynamic";

/** Process-local enrollment throttle (best-effort; not a substitute for edge rate limits). */
const enrollHits = new Map<string, { n: number; resetAt: number }>();
const ENROLL_WINDOW_MS = 60_000;
const ENROLL_MAX = 30;

function enrollAllowed(key: string): boolean {
  const now = Date.now();
  const cur = enrollHits.get(key);
  if (!cur || cur.resetAt <= now) {
    enrollHits.set(key, { n: 1, resetAt: now + ENROLL_WINDOW_MS });
    return true;
  }
  if (cur.n >= ENROLL_MAX) return false;
  cur.n += 1;
  return true;
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function originMatchesSite(origin: string | null): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(siteUrl()).origin;
  } catch {
    return false;
  }
}

/** GET: read-only metadata; Origin may be omitted on same-origin navigations. */
function getOriginOk(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return originMatchesSite(origin);
  const siteFetch = request.headers.get("sec-fetch-site");
  return siteFetch === "same-origin" || siteFetch === "none" || siteFetch == null;
}

/** POST: strict first-party — Origin required + Sec-Fetch-Site same-origin|none (R4-F03). */
function postOriginOk(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!originMatchesSite(origin)) return false;
  const siteFetch = request.headers.get("sec-fetch-site");
  if (siteFetch && siteFetch !== "same-origin" && siteFetch !== "none") return false;
  return true;
}

/** GET: metadata only — whether identity artifacts exist (no tokens/ids). */
export async function GET(request: Request) {
  if (!getOriginOk(request)) {
    return noStoreJson({ ok: false, code: "ORIGIN" }, 403);
  }
  const cookieStore = await cookies();
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  return noStoreJson({
    ok: true,
    hasArtifacts: continuityArtifactsPresent(reader),
    protocolVersion: 2,
  });
}

/** POST: enroll/bind continuity from client anchor + mirror cookie. Never Set-Cookie vel_bc. */
export async function POST(request: Request) {
  if (!postOriginOk(request)) {
    return noStoreJson({ ok: false, code: "ORIGIN" }, 403);
  }
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!enrollAllowed(fwd)) {
    return noStoreJson({ ok: false, code: "RATE_LIMIT" }, 429);
  }
  let body: { anchor?: unknown; protocolVersion?: unknown };
  try {
    body = (await request.json()) as { anchor?: unknown; protocolVersion?: unknown };
  } catch {
    return noStoreJson({ ok: false, code: "INVALID_BODY" }, 400);
  }
  if (body.protocolVersion !== 2 || typeof body.anchor !== "string") {
    return noStoreJson({ ok: false, code: "INVALID_BODY" }, 400);
  }
  const cookieStore = await cookies();
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  const mirror = readContinuityMirror(reader);
  const bound = await bindBrowserContinuityFromAnchor(body.anchor, mirror);
  if (!bound.ok) {
    return noStoreJson({ ok: false, code: bound.code }, 400);
  }
  void headers;
  return noStoreJson({
    ok: true,
    protocolVersion: 2,
    lineageFingerprint: bound.lineageFingerprint,
  });
}
