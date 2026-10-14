import 'server-only';

/** Presentation and owner setup writes only. Never enables Master billing/Auth. */
export function smartOnboardingEnabled(): boolean {
  return process.env.VELORA_SMART_ONBOARDING_ENABLED === 'true';
}
