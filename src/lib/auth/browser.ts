"use client";

import { ensureBrowserContinuity } from "@/lib/auth/browser-continuity";
import { startOAuthAction } from "@/lib/auth/broker-actions";

export type OAuthProvider = "google";

/** Google OAuth only — Apple/phone are not offered in the UI. Uses server broker PKCE. */
export async function startOAuth(provider: OAuthProvider = "google", next = "/setup") {
  const continuity = await ensureBrowserContinuity();
  if (!continuity.ok) throw new Error(continuity.code);
  const result = await startOAuthAction(provider, next, continuity.requestNonce);
  if (!result.ok) throw new Error("OAUTH_UNAVAILABLE");
  window.location.assign(result.url);
}
