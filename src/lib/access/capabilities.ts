/**
 * VEL-ACCESS-MANAGEMENT-01-FIX — grantable = fully enforced only.
 * Excluded from catalog: reports.read, wa.conversations.handoff (no full surface).
 */

export const PLATFORM_CAPABILITIES = [
  "platform.manage_admins",
  "platform.search_accounts",
  "platform.manage_companies",
  "platform.manage_access",
  "platform.view_audit",
] as const;

/** Existing defaults are preserved; adding a channel never silently grants it. */
export const DEFAULT_COMPANY_CAPABILITIES = [
  "wa.conversations.read",
  "wa.conversations.reply",
  "wa.conversations.take_over",
  "wa.conversations.resume",
  "wa.conversations.close",
  "wa.conversations.assign",
  "knowledge.read",
  "knowledge.write",
  "knowledge.delete",
  "company.profile.read",
  "company.profile.write",
  "company.staff.manage",
] as const;

export const INSTAGRAM_CAPABILITIES = ["ig.conversations.read", "ig.conversations.assign", "ig.conversations.reply"] as const;
export const COMPANY_CAPABILITIES = [...DEFAULT_COMPANY_CAPABILITIES, ...INSTAGRAM_CAPABILITIES] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];
export type CompanyCapability = (typeof COMPANY_CAPABILITIES)[number];
export type ConversationScope = "all_company" | "assigned_only";

export type PlatformAccessRole = "owner" | "delegated";

/** Explicit pre-migration compat only. Never used as all_company fallback after migrate. */
export function accessMigrationCompatEnabled(): boolean {
  return process.env.VEL_ACCESS_MIGRATION_COMPAT === "1";
}

export function isCompanyCapability(value: string): value is CompanyCapability {
  return (COMPANY_CAPABILITIES as readonly string[]).includes(value);
}

export function isPlatformCapability(value: string): value is PlatformCapability {
  return (PLATFORM_CAPABILITIES as readonly string[]).includes(value);
}

export function controlActionCapability(
  action: "take_over" | "resume" | "close" | "assign",
): CompanyCapability {
  if (action === "take_over") return "wa.conversations.take_over";
  if (action === "resume") return "wa.conversations.resume";
  if (action === "assign") return "wa.conversations.assign";
  return "wa.conversations.close";
}
