import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SetupLoadingView } from './setup-loading-view';

it('announces setup loading in Arabic without implying completion or exposing fake controls', () => {
  const html = renderToStaticMarkup(createElement(SetupLoadingView, { ar: true }));
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).toContain('جارٍ تحميل بيانات التجهيز');
  expect(html).toContain('جهّز مساعدك');
  expect(html).not.toContain('تجهيز نشاطك');
  expect(html).not.toContain('سيظهر النموذج');
  expect(html).not.toMatch(/<(input|button|select)\b/);
  expect(html).not.toContain('تم الحفظ');
});
it('keeps the English loading view left to right', () => {
  const html = renderToStaticMarkup(createElement(SetupLoadingView, { ar: false }));
  expect(html).toContain('dir="ltr"');
  expect(html).toContain('Loading your setup');
  expect(html).toContain('Set up your assistant');
  expect(html).not.toContain('Prepare your business');
});
