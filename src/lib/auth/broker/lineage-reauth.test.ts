import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn() }));
vi.mock('./continuity', () => ({ readBoundBrowserContinuity: async () => ({ state: 'active', browserLineageId: 'lineage', bootstrapHash: 'hash' }) }));
vi.mock('./cookies', () => ({ selectCandidateHandles: () => [{ name: 'fixture', value: 'handle' }] }));
vi.mock('./resolve', () => ({ resolveBrokerSession: m.resolve, refreshBrokerTokens: m.refresh }));
import { prepareBrokerAdmissionLineage } from './lineage-auth';

it('prepares a new authenticated admission without refreshing the old session', async () => {
  m.resolve.mockResolvedValue({ ok: true, handleHash: 'old-handle' });
  const result = await prepareBrokerAdmissionLineage({ getAll: () => [] }, { set: vi.fn() });
  expect(result).toMatchObject({ ok: true, browserLineageId: 'lineage', parentHandleHash: 'old-handle' });
  expect(m.refresh).not.toHaveBeenCalled();
});

it('fails closed when the authoritative capability or lineage cannot be verified', async () => {
  m.resolve.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
  expect(await prepareBrokerAdmissionLineage({ getAll: () => [] }, { set: vi.fn() })).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(m.refresh).not.toHaveBeenCalled();
});
