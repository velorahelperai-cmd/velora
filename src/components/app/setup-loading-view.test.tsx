import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SetupLoadingView } from './setup-loading-view';

it('shows setup page navigation without a loading announcement or private fields', () => {
  const html = renderToStaticMarkup(createElement(SetupLoadingView, { ar: true }));
  expect(html).toContain('dir="rtl"');
  expect(html).not.toContain('aria-busy');
  expect(html).not.toContain('role="status"');
  expect(html).not.toContain('جارٍ تحميل');
  expect(html).toContain('href="/account"');
  expect(html).toContain('جهّز مساعدك');
  expect(html).not.toContain('تجهيز نشاطك');
  expect(html).not.toContain('سيظهر النموذج');
  expect(html).not.toMatch(/<(input|button|select)\b/);
  expect(html).not.toContain('تم الحفظ');
});
it('keeps the English loading view left to right', () => {
  const html = renderToStaticMarkup(createElement(SetupLoadingView, { ar: false }));
  expect(html).toContain('dir="ltr"');
  expect(html).not.toContain('Loading your setup');
  expect(html).toContain('My account');
  expect(html).toContain('Set up your assistant');
  expect(html).not.toContain('Prepare your business');
});
