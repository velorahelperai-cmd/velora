"use client";

import { createClient } from "@/lib/supabase/client";

export type OAuthProvider = "google";

function clientCallbackUrl(next = "/setup") {
  const safe = next.startsWith("/") ? next : "/setup";
  const origin = typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000");
  return `${origin}/auth/callback?next=${encodeURIComponent(safe)}`;
}

/** Google OAuth only — Apple/phone are not offered in the UI. */
export async function startOAuth(provider: OAuthProvider = "google", next = "/setup") {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: clientCallbackUrl(next),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
  if (data.url) {
    window.location.assign(data.url);
  }
}
