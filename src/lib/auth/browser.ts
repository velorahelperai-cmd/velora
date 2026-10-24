"use client";

import { clearAuthGestureNonce, ensureBrowserContinuity, takeAuthGestureNonce } from "@/lib/auth/browser-continuity";
import { startOAuthAction } from "@/lib/auth/broker-actions";

export type OAuthProvider = "google";

/** Google OAuth only — Apple/phone are not offered in the UI. Uses server broker PKCE. */
export async function startOAuth(provider: OAuthProvider = "google", next = "/setup") {
  // Only the bound server intent can authorize replacement; URL error text
  // cannot declare an UNKNOWN exchange rejected or clear a different gesture.
  const continuity = await ensureBrowserContinuity();
  if (!continuity.ok) throw new Error(continuity.code);
  let result = await startOAuthAction(provider, next, continuity.requestNonce);
  if (!result.ok && result.code === "OAUTH_NEW_INTENT_REQUIRED") {
    clearAuthGestureNonce(continuity.requestNonce);
    const freshNonce = takeAuthGestureNonce("auth", { fresh: true });
    result = await startOAuthAction(provider, next, freshNonce);
  }
  if (!result.ok) throw new Error("OAUTH_UNAVAILABLE");
  window.location.assign(result.url);
}
