import {beforeEach, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({gate: vi.fn(), from: vi.fn(), rpc: vi.fn()}));
vi.mock('@/lib/tenancy/access', () => ({requirePlatformOwner: mocks.gate}));
vi.mock('@/lib/supabase/server', () => ({createClient: async () => ({from: mocks.from, rpc: mocks.rpc})}));
import {adminListChannels} from './channels-actions';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ok: true});
  mocks.from.mockImplementation((table: string) => ({select: () => Promise.resolve({
    data: table === 'companies' ? Array.from({length: 9}, (_, i) => ({id: `company-${i}`, display_name: `Company ${i}`})) : [],
    error: null,
  })}));
});

it('bounds Instagram concurrency at four, preserves company order and isolates a failed read', async () => {
  const pending: Array<() => void> = [];
  let active = 0, peak = 0;
  mocks.rpc.mockImplementation((_name: string, args: {p_company_id: string}) => new Promise((resolve, reject) => {
    active++; peak = Math.max(peak, active);
    pending.push(() => {
      active--;
      if (args.p_company_id === 'company-2') reject(new Error('unavailable'));
      else resolve({data: {ok: true, link: {accountId: args.p_company_id}}, error: null});
    });
  }));
  const result = adminListChannels();
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  expect(active).toBe(4);
  pending.splice(0).reverse().forEach(resolve => resolve());
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  pending.splice(0).reverse().forEach(resolve => resolve());
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending.splice(0).forEach(resolve => resolve());
  const loaded = await result;
  expect(peak).toBe(4);
  expect(loaded.ok).toBe(true);
  if (loaded.ok) expect(loaded.data.channels.map(row => row.companyId)).toEqual(
    [0, 1, 3, 4, 5, 6, 7, 8].map(i => `company-${i}`),
  );
});

it('does not fan out any data reads before owner authorization', async () => {
  mocks.gate.mockResolvedValue({ok: false, code: 'FORBIDDEN'});
  expect(await adminListChannels()).toMatchObject({ok: false, code: 'FORBIDDEN'});
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
