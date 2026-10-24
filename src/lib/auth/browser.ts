"use client";
import { clearAuthGestureNonce, ensureBrowserContinuity, takeAuthGestureNonce } from "@/lib/auth/browser-continuity";
import { startOAuthAction } from "@/lib/auth/broker-actions";
export type OAuthProvider = "google";
/** Bound server PKCE/intent remains authoritative; UI scope only cancels stale retry/redirect. */
export async function startOAuth(provider: OAuthProvider = "google", next = "/setup", isCurrent: () => boolean = () => true) {
  const continuity = await ensureBrowserContinuity();
  if (!isCurrent()) return;
  if (!continuity.ok) throw new Error(continuity.code);
  let nonce = continuity.requestNonce;
  let result = await startOAuthAction(provider, next, nonce);
  if (!result.ok && result.code === "OAUTH_NEW_INTENT_REQUIRED") {
    clearAuthGestureNonce(nonce);
    if (!isCurrent()) return;
    nonce = takeAuthGestureNonce("auth", { fresh: true });
    result = await startOAuthAction(provider, next, nonce);
    if (!result.ok && result.code === "OAUTH_NEW_INTENT_REQUIRED") clearAuthGestureNonce(nonce);
  }
  if (!isCurrent()) return;
  if (!result.ok) throw new Error("OAUTH_UNAVAILABLE");
  window.location.assign(result.url);
}
