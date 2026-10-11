/** Optional business contacts: null means invalid; an empty string means unset. */
export function normalizeBusinessEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "";
  // Preserve case and international characters; never rewrite a mailbox's local part.
  return email.length <= 254 && !/[\u0000-\u001f\u007f-\u009f]/.test(email)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizeBusinessPhone(value: string): string | null {
  if (!value.trim()) return "";
  const phone = value.replace(/[\s-]/g, "");
  // Match the existing international-number contract (7–15 digits after +).
  return /^\+\d{7,15}$/.test(phone) ? phone : null;
}
