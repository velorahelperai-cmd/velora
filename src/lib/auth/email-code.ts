/** Keep leading zeroes and accept Arabic keyboard digits without storing the code. */
export function normalizeEmailCode(value: string): string {
  return value.trim().replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit >= "۰" ? 0x06f0 : 0x0660)));
}

export function emailVerificationError(error: { code?: string; status?: number }): string {
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "verification_rate_limited";
  }
  if (error.code === "otp_expired" || error.code === "otp_disabled") return "verification_code_invalid";
  return "verification_unavailable";
}
