import {beforeEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({access: vi.fn(), catalog: vi.fn(), list: vi.fn(), capability: vi.fn()}));
vi.mock('next/headers', () => ({cookies: async () => ({get: () => undefined})}));
vi.mock('@/lib/tenancy/access', () => ({getCompanyAccess: mocks.access, pathForAccess: () => '/app'}));
vi.mock('@/lib/billing/catalog-backend/rpc', () => ({readPublicCatalogBackend: mocks.catalog}));
vi.mock('@/lib/knowledge/actions', () => ({listKnowledgeSources: mocks.list}));
vi.mock('@/lib/access/actions', () => ({sessionHasCompanyCapability: mocks.capability}));
vi.mock('@/components/landing/landing-page', () => ({LandingPage: () => null}));
vi.mock('@/components/app/workspace-pages', () => ({KnowledgePage: () => null}));
vi.mock('@/components/app/access-gate', () => ({AccessGate: () => null}));
import HomePage from './page';
import KnowledgePage from './app/knowledge/page';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve}; }
beforeEach(() => vi.resetAllMocks());

it('starts public offers while workspace access remains pending', async () => {
  const access = deferred<{ok: false; code: 'UNAUTHENTICATED'}>();
  mocks.access.mockReturnValue(access.promise);
  mocks.catalog.mockResolvedValue({ok: true, data: []});
  const page = HomePage();
  await vi.waitFor(() => expect(mocks.catalog).toHaveBeenCalledOnce());
  access.resolve({ok: false, code: 'UNAUTHENTICATED'});
  expect((await page).props.authHref).toBe('/signup');
});

it('overlaps knowledge data and independent permissions after read authorization', async () => {
  mocks.access.mockResolvedValue({ok: true, context: {company: {id: 'company-a'}, membership: {role: 'staff'}}});
  const list = deferred<{ok: false}>();
  mocks.list.mockReturnValue(list.promise);
  mocks.capability.mockImplementation(async (_id: string, permission: string) => permission !== 'knowledge.delete' ? true : null);
  const page = KnowledgePage().props.children.type();
  await vi.waitFor(() => expect(mocks.capability).toHaveBeenCalledWith('company-a', 'knowledge.delete'));
  expect(mocks.list).toHaveBeenCalledWith({expectedCompanyId: 'company-a'});
  list.resolve({ok: false});
  const tree = await page;
  expect(tree.props).toMatchObject({canWrite: true, canDelete: false, initialLoadFailed: true});
});

it('does not read knowledge or write permissions when read access is denied', async () => {
  mocks.access.mockResolvedValue({ok: true, context: {company: {id: 'company-a'}, membership: {role: 'staff'}}});
  mocks.capability.mockResolvedValue(false);
  await KnowledgePage().props.children.type();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.capability).toHaveBeenCalledTimes(1);
});
