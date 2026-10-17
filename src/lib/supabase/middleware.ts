import { checkAppSession } from "@/lib/auth/session-guard";
import { createBrokerUserClient, listHandleCookies } from "@/lib/auth/broker";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type SessionKind = "authenticated" | "unauthenticated" | "unavailable" | "expired";

export type SessionUpdate = {
  response: NextResponse;
  session: SessionKind;
  /** @deprecated use session — kept briefly for call-site clarity during migrate */
  hasUser: boolean;
};

/**
 * Broker middleware: resolve opaque handles, refresh tokens server-side without
 * writing shared sb-* cookies, ignore legacy auth cookies after cutover.
 */
export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  const response = NextResponse.next({ request });
  const env = getSupabaseEnv();
  if (!env.ok) {
    return { response, session: "unavailable", hasUser: false };
  }

  const reader = {
    getAll: () => request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
  };

  // Presence of only legacy sb-* cookies without broker handles → treat as unauthenticated
  // (explicit reauth; no dual-reader fallback).
  const handles = listHandleCookies(reader);
  if (handles.length === 0) {
    return { response, session: "unauthenticated", hasUser: false };
  }

  try {
    const bound = await createBrokerUserClient(reader);
    if (!bound.ok) {
      if (bound.code === "UNAVAILABLE") {
        return { response, session: "unavailable", hasUser: false };
      }
      return { response, session: "unauthenticated", hasUser: false };
    }

    const { data, error } = await bound.client.auth.getUser();
    if (error) {
      return { response, session: "unavailable", hasUser: false };
    }
    if (!data.user) {
      return { response, session: "unauthenticated", hasUser: false };
    }

    const documentNavigation = request.headers.get("sec-fetch-mode") === "navigate";
    const guard = await checkAppSession(bound.client, documentNavigation);
    if (!guard.ok) {
      return {
        response,
        session: guard.code === "UNAUTHENTICATED" ? "expired" : "unavailable",
        hasUser: false,
      };
    }

    // Refresh may have updated registry tokens; no auth-handle Set-Cookie on refresh.
    void response;
    return { response, session: "authenticated", hasUser: true };
  } catch {
    return { response, session: "unavailable", hasUser: false };
  }
}
