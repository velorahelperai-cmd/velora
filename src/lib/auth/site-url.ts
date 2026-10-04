export function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

export function authCallbackUrl(next = "/setup") {
  const safe = next.startsWith("/") ? next : "/setup";
  return `${siteUrl()}/auth/callback?next=${encodeURIComponent(safe)}`;
}

/** Normalize to E.164; default Oman +968 when local digits are entered. */
export function toE164Phone(input: string, defaultCountry = "968"): string | null {
  const raw = input.trim().replace(/[\s()-]/g, "");
  if (!raw) return null;
  let digits = raw.startsWith("+") ? `+${raw.slice(1).replace(/\D/g, "")}` : raw.replace(/\D/g, "");
  if (!digits.startsWith("+")) {
    if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
    else if (digits.startsWith(defaultCountry)) digits = `+${digits}`;
    else digits = `+${defaultCountry}${digits.replace(/^0+/, "")}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}
