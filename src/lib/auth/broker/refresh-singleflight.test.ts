import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ claim: vi.fn(), refresh: vi.fn(), uncertain: vi.fn(), release: vi.fn() }));
vi.mock('./registry', () => ({
  claimRefreshLease: m.claim, markRefreshUncertain: m.uncertain,
  releaseRefreshLease: m.release, casUpdateTokens: vi.fn(),
  findSessionByHandleAnyStatus: vi.fn(), hashHex: vi.fn(), probeBrokerCapability: vi.fn(),
}));
vi.mock('./log', () => ({ brokerLog: vi.fn() }));
vi.mock('@/lib/supabase/env', () => ({ getSupabaseEnv: () => ({ ok: true, url: 'https://example.test', publishableKey: 'fixture' }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { refreshSession: m.refresh } }) }));
import { recoverConcurrentRotation, refreshBrokerTokens } from './resolve';

const resolved = {
  ok: true as const, registryId: 'registry-a', refreshRevision: 1,
  accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: '2020-01-01T00:00:00Z',
  authOrdinal: 1, handleHash: 'fixture-hash',
  boundary: { boundaryFingerprint: 'fixture-fp', userId: 'fixture-user', nativeSessionId: 'fixture-session',
    cookieName: 'fixture-cookie', generation: 'fixture-generation', authOrdinal: 1, contextGeneration: 1 },
};
beforeEach(() => { vi.resetAllMocks(); m.uncertain.mockResolvedValue(true); });

it('coalesces concurrent rotations and fences an unknown provider result', async () => {
  let finish!: (value: unknown) => void;
  m.claim.mockResolvedValue({ ok: true, token: 'fixture-lease' });
  m.refresh.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const a = refreshBrokerTokens(resolved);
  const b = refreshBrokerTokens(resolved);
  await vi.waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
  expect(m.claim).toHaveBeenCalledTimes(1);
  finish({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });
  expect(await Promise.all([a, b])).toEqual([{ ok: false, code: 'UNAVAILABLE' }, { ok: false, code: 'UNAVAILABLE' }]);
  expect(m.uncertain).toHaveBeenCalledTimes(1);
  expect(m.release).not.toHaveBeenCalled();
});

it('does not reuse settled results or call the provider after an uncertain claim', async () => {
  m.claim.mockResolvedValue({ ok: false, reason: 'UNCERTAIN' });
  expect(await refreshBrokerTokens(resolved)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(await refreshBrokerTokens(resolved)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(m.claim).toHaveBeenCalledTimes(2);
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.release).not.toHaveBeenCalled();
});

it('recovers only a freshly verified newer revision with the identical boundary', async () => {
  const current = { ...resolved, refreshRevision: 2, expiresAt: '2999-01-01T00:00:00Z', accessToken: 'new-access', refreshToken: 'new-refresh' };
  expect(await recoverConcurrentRotation(resolved, async () => current)).toEqual(current);
  expect(await recoverConcurrentRotation(resolved, async () => ({ ...current, refreshRevision: 1 }))).toBeNull();
  expect(await recoverConcurrentRotation(resolved, async () => ({ ...current, boundary: { ...current.boundary, userId: 'other' } }))).toBeNull();
  expect(await recoverConcurrentRotation(resolved, async () => ({ ok: false, code: 'UNAVAILABLE' }))).toBeNull();
  expect(await recoverConcurrentRotation(resolved, async () => { throw new Error('offline'); })).toBeNull();
});

it('does not coalesce different resolved boundaries', async () => {
  m.claim.mockResolvedValue({ ok: false, reason: 'CLAIM_FAILED' });
  await Promise.all([refreshBrokerTokens(resolved), refreshBrokerTokens({ ...resolved, boundary: { ...resolved.boundary, nativeSessionId: 'other-session' } })]);
  expect(m.claim).toHaveBeenCalledTimes(2);
  expect(m.refresh).not.toHaveBeenCalled();
});

it('treats a network exception after provider dispatch as unknown and never releases the lease', async () => {
  m.claim.mockResolvedValue({ ok: true, token: 'fixture-lease' });
  m.refresh.mockRejectedValue(new Error('network unavailable'));
  expect(await refreshBrokerTokens(resolved)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(m.uncertain).toHaveBeenCalledTimes(1);
  expect(m.release).not.toHaveBeenCalled();
});

it.each(['ROTATING', 'ROTATING_EXPIRED', 'STATE_READ_FAILED'])('fails closed on %s without invoking the provider', async reason => {
  m.claim.mockResolvedValue({ ok: false, reason });
  expect(await refreshBrokerTokens(resolved)).toEqual({ ok: false, code: 'UNAVAILABLE', ...(reason === 'ROTATING' ? { reason: 'RECHECK' } : {}) });
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.release).not.toHaveBeenCalled();
});
