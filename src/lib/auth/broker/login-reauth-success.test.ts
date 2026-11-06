import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ signIn: vi.fn(), capture: vi.fn(), admit: vi.fn(), commit: vi.fn(), refresh: vi.fn() }));
vi.mock('./registry', () => ({ probeBrokerCapability: async () => ({ ok: true, boundAdmit: true }), reserveBoundAuthIntent: async () => ({ id: 'intent', browserLineageId: 'lineage' }), claimProviderAttempt: async () => ({ ok: true, claimed: true }), recordProviderSessionCapture: m.capture, admitBoundSessionAtomic: m.admit }));
vi.mock('./lineage-auth', () => ({ prepareBrokerAdmissionLineage: async () => ({ ok: true, bootstrapHash: 'root', browserLineageId: 'lineage' }) }));
vi.mock('./provider', () => ({ createProviderAuthClient: () => ({ client: { auth: { signInWithPassword: m.signIn, refreshSession: m.refresh } } }) }));
vi.mock('./provider-session', () => ({ signOutProviderSessionAfterAdmitFailure: vi.fn(), resumeProviderCleanup: vi.fn() }));
vi.mock('./cookies', () => ({ commitHandleCookie: m.commit, commitIntentCookie: vi.fn(), expireIntentCookie: vi.fn() }));
vi.mock('./session-id', () => ({ nativeSessionIdFromAccessToken: () => 'new-native-session', expiresAtFromSession: () => '2999-01-01T00:00:00Z' }));
vi.mock('./log', () => ({ brokerLog: vi.fn() }));
import { brokerPasswordLogin } from './login';

it('admits a newly authenticated session before committing its handle without refreshing the old token', async () => {
  m.signIn.mockResolvedValue({ data: { session: { user: { id: 'actor' }, access_token: 'new-access', refresh_token: 'new-refresh' } }, error: null });
  m.capture.mockResolvedValue(true);
  m.admit.mockResolvedValue({ cookieName: 'new-cookie', handle: 'new-handle', generation: 'generation', userId: 'actor', boundaryFingerprint: 'fingerprint' });
  const result = await brokerPasswordLogin({ email: 'fixture@example.invalid', password: 'fixture', requestNonce: 'fixture-nonce-long-enough', reader: { getAll: () => [] }, writer: { set: vi.fn() } });
  expect(result).toEqual({ ok: true });
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.capture).toHaveBeenCalledOnce();
  expect(m.admit).toHaveBeenCalledOnce();
  expect(m.commit).toHaveBeenCalledOnce();
  expect(m.admit.mock.invocationCallOrder[0]).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
});
