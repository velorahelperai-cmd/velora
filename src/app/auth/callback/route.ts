import {AUTH_RETURN_COOKIE} from "@/lib/auth/auth-journey";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

function publicOrigin(request: Request) {
  // The hosting layer owns request.url; raw forwarded headers are caller-controlled.
  return new URL(request.url).origin;
}

function loginRedirect(origin: string, code: string, detail?: string, next?: string) {
  const login = new URL("/login", origin);
  login.searchParams.set("error", code);
  if (detail) login.searchParams.set("detail", detail.slice(0, 180));
  const preferred = safeInternalPath(next, "");
  if (preferred) login.searchParams.set("next", preferred);
  return NextResponse.redirect(login);
}

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const pendingCookies: Array<{ name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }> = [];
  const finish = (response: NextResponse) => {
    for (const {name, value, options} of pendingCookies) response.cookies.set(name, value, options);
    response.cookies.set(AUTH_RETURN_COOKIE, "", {path:"/", maxAge:0});
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  let preferred = safeInternalPath(nextParam, "");
  const oauthError = searchParams.get("error_description") || searchParams.get("error");

  if (oauthError && !code) {
    return finish(loginRedirect(origin, "oauth_cancelled"));
  }
  if (!code) {
    return finish(loginRedirect(origin, "auth_callback", "missing_code"));
  }

  const env = getSupabaseEnv();
  if (!env.ok) {
    return finish(loginRedirect(origin, "auth_callback", "supabase_env"));
  }

  const cookieStore = await cookies();
  preferred=preferred||safeInternalPath(cookieStore.get(AUTH_RETURN_COOKIE)?.value,"");

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, options);
          } catch {
            /* ignore if read-only in edge cases */
          }
          pendingCookies.push({ name, value, options });
        });
      },
    },
  });

  let error: {code?: string} | null;
  try {
    ({error} = await supabase.auth.exchangeCodeForSession(code));
  } catch {
    return finish(loginRedirect(origin, "auth_callback", "exchange_failed", preferred));
  }
  if (error) {
    if (error.code === "pkce_code_verifier_not_found") {
      return finish(loginRedirect(origin, "verification_browser", undefined, preferred));
    }
    return finish(loginRedirect(origin, "auth_callback", "exchange_failed", preferred));
  }

  let destination = "/setup";
  if (preferred === "/reset-password" || nextParam === "/reset-password") {
    destination = "/reset-password";
  } else {
    try {
      const access = await getCompanyAccess();
      destination = pathForAccess(access, preferred || null);
    } catch {
      destination = "/access?code=UNAVAILABLE";
    }
  }

  return finish(NextResponse.redirect(new URL(destination, origin)));
}
