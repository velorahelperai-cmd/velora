import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SetupEntry, type SetupEntryProps } from './setup-entry';
import { countryLabel } from './country-options';

const base: SetupEntryProps = { ar: true, fields: { name: '', type: 'other', country: 'OM' }, ready: true, busy: false, pending: false, error: null, onChange: vi.fn(), onSubmit: vi.fn() };
const render = (overrides: Partial<SetupEntryProps> = {}) => renderToStaticMarkup(createElement(SetupEntry, { ...base, ...overrides }));
const submit = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';

describe('first business presentation boundaries', () => {
  it('keeps the create button disabled for a blank or whitespace name', () => {
    expect(submit(render())).toContain('disabled=""');
    expect(submit(render({ fields: { ...base.fields, name: '   ' } }))).toContain('disabled=""');
    expect(submit(render({ fields: { ...base.fields, name: 'متجر الندى' } }))).not.toContain('disabled=""');
  });
  it('locks editable fields while identity is unavailable or a durable attempt is pending', () => {
    for (const state of [{ ready: false }, { pending: true }]) {
      const html = render({ fields: { ...base.fields, name: 'متجر الندى' }, ...state });
      expect(html.match(/<(?:input|select)[^>]*disabled=""/g)).toHaveLength(3);
    }
    expect(submit(render({ ready: false, fields: { ...base.fields, name: 'متجر الندى' } }))).toContain('disabled=""');
  });
  it('keeps receipt recovery available without enabling field edits or creating a fresh request', () => {
    const html = render({ pending: true, fields: { ...base.fields, name: 'متجر الندى' } });
    expect(html).toContain('استعادة نتيجة الإنشاء');
    expect(submit(html)).not.toContain('disabled=""');
  });
  it('announces creation in progress and prevents repeated submit', () => {
    const html = render({ busy: true, pending: true, fields: { ...base.fields, name: 'متجر الندى' } });
    expect(submit(html)).toContain('aria-busy="true"');
    expect(submit(html)).toContain('disabled=""');
    expect(html).toContain('جارٍ إنشاء نشاطك');
  });
  it('keeps real errors visible and never invents an autosave success', () => {
    expect(render({ error: 'لم يتم تأكيد إنشاء النشاط. استعد النتيجة باستخدام نفس الطلب المحفوظ.' })).toMatch(/role="alert"/);
    expect(render()).not.toContain('تم الحفظ');
  });
  it('labels fields and keeps employee playback controls out of the form', () => {
    const html = render();
    expect(html.match(/<label[^>]*for="[^"]+"/g)).toHaveLength(3);
    const video = html.match(/<video[^>]*>/)?.[0] ?? '';
    expect(video).not.toContain('controls=""');
    expect(video).toContain('preload="none"');
    expect(video).not.toContain('autoPlay');
    expect(html).not.toContain('تحريك الشخصية');
    expect(html).not.toContain('إيقاف الحركة');
  });
  it('shows a searchable country name while serializing only the saved country code', () => {
    const html = render();
    expect(html).toContain('role="combobox"');
    expect(html).toMatch(/type="hidden" name="country" value="OM"/);
    expect(html).toContain(countryLabel('OM', true));
  });
  it('puts the three descriptive steps before the form without pretending to be navigation', () => {
    const html = render();
    const start = html.indexOf('<ol');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(html.indexOf('<form'));
    const list = html.slice(start, html.indexOf('</ol>', start));
    expect(list.match(/<li\b/g)).toHaveLength(3);
    expect(list).toContain('aria-current="step"');
    expect(list).not.toMatch(/<(?:a|button)\b/);
  });
});
