import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type SessionKind = "authenticated" | "unauthenticated" | "unavailable";

export type SessionUpdate = {
  response: NextResponse;
  session: SessionKind;
  /** @deprecated use session — kept briefly for call-site clarity during migrate */
  hasUser: boolean;
};

export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let supabaseResponse = NextResponse.next({ request });
  const env = getSupabaseEnv();
  if (!env.ok) {
    return { response: supabaseResponse, session: "unavailable", hasUser: false };
  }

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(cacheHeaders).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) {
      // Auth/settings failure is not a confirmed missing session — do not force Login.
      return { response: supabaseResponse, session: "unavailable", hasUser: false };
    }
    if (data?.claims?.sub) {
      return { response: supabaseResponse, session: "authenticated", hasUser: true };
    }
    return { response: supabaseResponse, session: "unauthenticated", hasUser: false };
  } catch {
    return { response: supabaseResponse, session: "unavailable", hasUser: false };
  }
}
