"use client";

import { createClient } from "@/lib/supabase/client";
import { toE164Phone } from "@/lib/auth/site-url";

export type OAuthProvider = "google" | "apple";

function clientCallbackUrl(next = "/setup") {
  const safe = next.startsWith("/") ? next : "/setup";
  const origin = typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000");
  return `${origin}/auth/callback?next=${encodeURIComponent(safe)}`;
}

export async function startOAuth(provider: OAuthProvider, next = "/setup") {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: clientCallbackUrl(next),
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (error) throw error;
  if (data.url) {
    window.location.assign(data.url);
  }
}

export async function sendPhoneOtp(phoneInput: string) {
  const phone = toE164Phone(phoneInput);
  if (!phone) throw new Error("invalid_phone");
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
  return phone;
}

export async function verifyPhoneOtp(phone: string, token: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({
    phone,
    token: token.trim(),
    type: "sms",
  });
  if (error) throw error;
}
