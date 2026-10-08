import {AUTH_RETURN_COOKIE} from "@/lib/auth/auth-journey";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : url.origin;
}

function loginRedirect(origin: string, code: string, detail?: string) {
  const login = new URL("/login", origin);
  login.searchParams.set("error", code);
  if (detail) login.searchParams.set("detail", detail.slice(0, 180));
  return NextResponse.redirect(login);
}

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  let preferred = safeInternalPath(nextParam, "");
  const oauthError = searchParams.get("error_description") || searchParams.get("error");

  if (oauthError && !code) {
    return loginRedirect(origin, "oauth_cancelled", oauthError);
  }
  if (!code) {
    return loginRedirect(origin, "auth_callback", "missing_code");
  }

  const env = getSupabaseEnv();
  if (!env.ok) {
    return loginRedirect(origin, "auth_callback", "supabase_env");
  }

  const cookieStore = await cookies();
  preferred=preferred||safeInternalPath(cookieStore.get(AUTH_RETURN_COOKIE)?.value,"");
  const pendingCookies: Array<{ name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }> = [];

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return loginRedirect(origin, "auth_callback", error.message || error.code || "exchange_failed");
  }

  let destination = "/setup";
  if (preferred === "/reset-password" || nextParam === "/reset-password") {
    destination = "/reset-password";
  } else {
    try {
      const access = await getCompanyAccess();
      destination = pathForAccess(access, preferred || null);
    } catch {
      destination = preferred || "/setup";
    }
  }

  const response = NextResponse.redirect(`${origin}${destination}`);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}
