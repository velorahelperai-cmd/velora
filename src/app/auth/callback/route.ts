import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess } from "@/lib/tenancy/access";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next = nextParam?.startsWith("/") ? nextParam : null;
  const errorDescription = searchParams.get("error_description") || searchParams.get("error");

  if (errorDescription) {
    const login = new URL("/login", origin);
    login.searchParams.set("error", "oauth_cancelled");
    login.searchParams.set("detail", errorDescription.slice(0, 180));
    return NextResponse.redirect(login);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const login = new URL("/login", origin);
      login.searchParams.set("error", "auth_callback");
      return NextResponse.redirect(login);
    }

    // Recovery session must land on password form.
    if (next === "/reset-password") {
      return NextResponse.redirect(`${origin}/reset-password`);
    }

    // Email confirmation / OAuth: route by verified membership state (setup vs workspace).
    const access = await getCompanyAccess();
    return NextResponse.redirect(`${origin}${pathForAccess(access)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
