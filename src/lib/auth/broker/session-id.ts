import "server-only";

/** Extract native session_id from a JWT access token payload. Never trust client-supplied IDs. */
export function nativeSessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const sid = payload?.session_id;
    if (typeof sid !== "string") return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sid)) {
      return null;
    }
    return sid;
  } catch {
    return null;
  }
}

export function subjectFromAccessToken(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function expiresAtFromSession(expiresAt?: number | null, expiresIn?: number | null): string {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return new Date(expiresAt * 1000).toISOString();
  }
  const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}
