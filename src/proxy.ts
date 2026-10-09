import { type NextRequest, NextResponse } from "next/server";
import { pathAtOrUnder, safeInternalPath } from "@/lib/auth/safe-next";
import { updateSession } from "@/lib/supabase/middleware";

function isProtectedPath(path: string): boolean {
  return (
    pathAtOrUnder(path, "/app")
    || pathAtOrUnder(path, "/setup")
    || pathAtOrUnder(path, "/admin")
    || pathAtOrUnder(path, "/complete-profile")
    || pathAtOrUnder(path, "/account")
  );
}

export async function proxy(request: NextRequest) {
  // Overwrite incoming hints with the actual validated request URL before forwarding.
  request.headers.set("x-velora-return-path", safeInternalPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, ""));
  const { response, session } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  if (!isProtectedPath(path)) return response;

  // Confirmed missing session only → login with safe return. Settings/auth outages → AccessGate.
  if (session === "unavailable") {
    const access = new URL("/access", request.url);
    access.searchParams.set("code", "UNAVAILABLE");
    const redirect = NextResponse.redirect(access);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  if (session === "unauthenticated" || session === "expired") {
    const returnTo = safeInternalPath(
      `${path}${search}`,
      pathAtOrUnder(path, "/admin") ? "/admin" : `${path}${search}` || path,
    );
    const login = new URL("/login", request.url);
    login.searchParams.set("next", returnTo);
    if(session==="expired")login.searchParams.set("reason","session_expired");
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
