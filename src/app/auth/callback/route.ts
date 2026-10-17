import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";
import {
  brokerExchangeOAuthCode,
  commitAuthReturnForGeneration,
  expireIntentCookie,
  readAuthReturnForGeneration,
  readIntentCookie,
} from "@/lib/auth/broker";

function publicOrigin(request: Request) {
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
  let clearReturnGeneration: string | null = null;
  const finish = (response: NextResponse) => {
    // Keep callback redirects on the browser origin when Next uses an internal host.
    // No forwarded Host/Proto header becomes redirect authority.
    const location = response.headers.get("Location");
    if (location) {
      const target = new URL(location, origin);
      if (target.origin === origin) response.headers.set("Location", target.pathname + target.search + target.hash);
    }
    for (const { name, value, options } of pendingCookies) response.cookies.set(name, value, options);
    // Clear only THIS generation's return cookie name (C2-R6).
    if (clearReturnGeneration) {
      response.cookies.set(`velora_ar_${clearReturnGeneration}`, "", { path: "/", maxAge: 0 });
    }
    response.cookies.set("vel_ai", "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const preferredState = searchParams.get("vel_intent");
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
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  const writer = {
    set(name: string, value: string, options?: Record<string, unknown>) {
      try {
        cookieStore.set(name, value, options as never);
      } catch {
        /* ignore */
      }
      pendingCookies.push({ name, value, options: options as never });
    },
  };

  // Require matching per-intent cookie binding — URL alone is insufficient (C3-8).
  // Mismatch/absence: reject without expiring sibling intents.
  const cookieIntent = preferredState ? readIntentCookie(reader, preferredState) : null;
  if (!preferredState || preferredState.length < 16 || cookieIntent !== preferredState) {
    return finish(loginRedirect(origin, "auth_callback", "intent_binding", preferred));
  }
  const stateNonce = preferredState;

  let exchanged: Awaited<ReturnType<typeof brokerExchangeOAuthCode>>;
  try {
    exchanged = await brokerExchangeOAuthCode({ code, stateNonce, writer, reader });
  } catch {
    // Do not expire sibling intents on transport failure.
    return finish(loginRedirect(origin, "auth_callback", "exchange_failed", preferred));
  }

  if (!exchanged.ok) {
    if (exchanged.expireIntent) {
      expireIntentCookie(writer, stateNonce);
    }
    if (exchanged.detail === "verification_browser") {
      return finish(loginRedirect(origin, "verification_browser", undefined, preferred));
    }
    if (exchanged.detail === "continuity_required" || exchanged.detail === "continuity_mismatch") {
      return finish(loginRedirect(origin, "auth_callback", exchanged.detail, preferred));
    }
    return finish(loginRedirect(origin, "auth_callback", exchanged.detail ?? "exchange_failed", preferred));
  }

  const storedReturn = readAuthReturnForGeneration(
    {
      get: (name) => {
        const v = cookieStore.get(name)?.value;
        return v ? { value: v } : undefined;
      },
    },
    exchanged.generation,
  );
  preferred = preferred || safeInternalPath(storedReturn, "");
  if (preferred) {
    commitAuthReturnForGeneration(writer, exchanged.generation, preferred);
  }
  clearReturnGeneration = exchanged.generation;

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
