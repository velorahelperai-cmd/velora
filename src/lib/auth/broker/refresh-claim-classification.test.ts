import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({
  rpc: m.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.read }) }) }),
}) }));
import { claimRefreshLease } from './registry';

beforeEach(() => { vi.resetAllMocks(); m.read.mockResolvedValue({ data: { status: 'active', refresh_revision: 1, refresh_state: 'idle' }, error: null }); });
it('returns the acquired lease after checking the stored state', async () => {
  m.rpc.mockResolvedValue({ data: 'a'.repeat(32), error: null });
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: true, token: 'a'.repeat(32) });
  expect(m.read).toHaveBeenCalledTimes(1);
});
it('distinguishes a failed claim from a failed state read', async () => {
  m.rpc.mockResolvedValueOnce({ data: null, error: { code: '503' } });
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: false, reason: 'CLAIM_FAILED' });
  m.read.mockRejectedValueOnce(new Error('offline'));
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: false, reason: 'STATE_READ_FAILED' });
});
it.each([
  ['uncertain', '2020-01-01T00:00:00Z', 'UNCERTAIN'],
  ['rotating', '2999-01-01T00:00:00Z', 'ROTATING'],
  ['rotating', '2020-01-01T00:00:00Z', 'ROTATING_EXPIRED'],
  ['idle', null, 'NOT_CLAIMABLE'],
])('classifies %s without reclaiming a lease', async (refresh_state, refresh_lease_until, reason) => {
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.read.mockResolvedValue({ data: { status: 'active', refresh_revision: 1, refresh_state, refresh_lease_until }, error: null });
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: false, reason });
  expect(m.rpc).toHaveBeenCalledTimes(refresh_state === 'idle' ? 1 : 0);
});
it('does not treat an older revision as a current lock', async () => {
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.read.mockResolvedValue({ data: { status: 'active', refresh_revision: 2, refresh_state: 'uncertain' }, error: null });
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: false, reason: 'NOT_CLAIMABLE' });
});
it('blocks repeated independent requests using stored uncertain state', async () => {
  m.read.mockResolvedValue({ data: { status: 'active', refresh_revision: 1, refresh_state: 'uncertain' }, error: null });
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: false, reason: 'UNCERTAIN' });
  expect(await claimRefreshLease('id', 1)).toEqual({ ok: false, reason: 'UNCERTAIN' });
  expect(m.read).toHaveBeenCalledTimes(2);
  expect(m.rpc).not.toHaveBeenCalled();
});
