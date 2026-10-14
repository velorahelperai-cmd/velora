import "server-only";
/** Code publication does not authorize customer rollout or SQL application. */
export function enterpriseLifecycleEnabled(): boolean {
  return process.env.VELORA_ENTERPRISE_LIFECYCLE_ENABLED === "true";
}
