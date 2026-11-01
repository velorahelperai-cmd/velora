/**
 * F4 linked-number confirmation. The number comes only from the server-verified
 * Meta proof stored in public.whatsapp_company_links.verified_display_number
 * (written from Meta's display_phone_number). The full number never leaves the server.
 */
export type LinkedNumberClient = {
  from(table: string): { select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } };
};

/** Keeps "+", the first three digits and the last four: "+968••••4567". */
export function maskLinkedNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15 || digits[0] === "0") return null;
  return `+${digits.slice(0, 3)}${"•".repeat(digits.length - 7)}${digits.slice(-4)}`;
}

export async function readMaskedLinkedNumber(client: LinkedNumberClient, companyId: string): Promise<string | null> {
  try {
    const result = await client.from("whatsapp_company_links").select("verified_display_number")
      .eq("company_id", companyId).eq("status", "verified").maybeSingle();
    if (result.error || !result.data || typeof result.data !== "object") return null;
    return maskLinkedNumber((result.data as Record<string, unknown>).verified_display_number);
  } catch { return null; }
}
