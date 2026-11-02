import React from 'react';
import { PassThrough } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw Error(href); } }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/lib/demo-state', () => ({ useDemo: () => ({ locale: 'ar' }) }));
vi.mock('@/lib/tenancy/access', () => ({ getCompanyAccess: state.access, loginPathForReturn: () => '/login' }));
vi.mock('@/components/app/access-gate', () => ({ AccessGate: () => <p>Denied</p> }));
import SetupLayout from './layout';

it('streams public setup navigation before the access read settles without a waiting announcement', async () => {
  let release!: (value: unknown) => void;
  state.access.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const output = new PassThrough();
  let html = '';
  output.on('data', chunk => { html += chunk.toString(); });
  const first = new Promise<void>(resolve => output.once('data', () => resolve()));
  const complete = new Promise<void>((resolve, reject) => { output.on('end', resolve); output.on('error', reject); });
  const errors: unknown[] = [];
  const stream = renderToPipeableStream(<html><body><SetupLayout><p>PRIVATE_SETUP_CONTENT</p></SetupLayout></body></html>, {
    onShellReady() { stream.pipe(output); }, onError(error) { errors.push(error); },
  });
  try {
    await first;
    expect(html).toContain('جهّز مساعدك');
    expect(html).toContain('href="/account"');
    expect(html).not.toMatch(/role="status"|aria-busy|PRIVATE_SETUP_CONTENT/);
    release({ ok: true, context: { needsProfileName: false, needsCompanyContext: false, isPlatformAdmin: false, company: null, membership: null } });
    await complete;
    expect(errors).toEqual([]);
    expect(html).toContain('PRIVATE_SETUP_CONTENT');
  } finally { stream.abort(); output.destroy(); }
});
