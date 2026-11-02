import { authFlowHref } from '@/lib/auth/auth-journey';
import { canUseAccountPrepDraft } from './account-prep-eligibility';
import type { AccessResult } from './access';

/** Presentation decision derived only from native access. It is not a capability:
 * branch readers and every mutation continue to authorize independently. */
export type SetupEntryDecision =
  | { kind: 'deny'; code: 'FORBIDDEN' | 'UNAVAILABLE' }
  | { kind: 'redirect'; target: 'login' | 'verify-email' | 'complete-profile' | 'workspace' | 'admin' | 'conversations' }
  | { kind: 'prepare'; userId: string }
  | { kind: 'company'; userId: string; companyId: string };

export function setupLayoutDecision(access: AccessResult): Extract<SetupEntryDecision, {kind: 'deny' | 'redirect'}> | null {
  if (!access.ok) {
    if (access.code === 'UNVERIFIED') return {kind: 'redirect', target: 'verify-email'};
    if (access.code === 'FORBIDDEN' || access.code === 'UNAVAILABLE') return {kind: 'deny', code: access.code};
    return {kind: 'redirect', target: 'login'};
  }
  const ctx = access.context;
  if (ctx.needsProfileName) return {kind: 'redirect', target: 'complete-profile'};
  if (ctx.needsCompanyContext) return {kind: 'redirect', target: 'workspace'};
  if (ctx.isPlatformAdmin && !ctx.company) return {kind: 'redirect', target: 'admin'};
  if (ctx.membership?.role === 'staff') return {kind: 'redirect', target: 'conversations'};
  return null;
}

export function setupEntryDecision(access: AccessResult): SetupEntryDecision {
  const layout = setupLayoutDecision(access);
  if (layout) return layout;
  if (!access.ok) return {kind: 'deny', code: 'UNAVAILABLE'};
  const ctx = access.context;
  if (ctx.company) return {kind: 'company', userId: ctx.userId, companyId: ctx.company.id};
  return canUseAccountPrepDraft(ctx) ? {kind: 'prepare', userId: ctx.userId} : {kind: 'deny', code: 'FORBIDDEN'};
}

/** returnTo comes from setupReturnContext; no external navigation is admitted. */
export function setupDecisionHref(target: Extract<SetupEntryDecision, {kind: 'redirect'}>['target'], returnTo: string): string {
  switch (target) {
    case 'login': return authFlowHref('/login', returnTo);
    case 'verify-email': return authFlowHref('/verify-email', returnTo);
    case 'complete-profile': return authFlowHref('/complete-profile', returnTo);
    case 'workspace': return `/app?next=${encodeURIComponent(returnTo)}`;
    case 'admin': return '/admin';
    case 'conversations': return '/app/conversations';
  }
}
