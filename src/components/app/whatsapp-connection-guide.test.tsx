import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WhatsappConnectionGuide, guideSteps, guideIndex } from './whatsapp-connection-guide';

it('keeps both observed routes separate and preserves source order', () => {
  expect(guideSteps.coexistence.map(s => s.source)).toEqual(['8','9','10','11','12','13','14','15']);
  expect(guideSteps['new-number'].map(s => s.source)).toEqual(['17.1','17.2','17.3','17.4','17.5','17.6','17.7','17.8','17.9']);
  expect(guideSteps.coexistence.find(s => s.source === '13')?.image).toBeUndefined();
  expect(guideSteps.coexistence.find(s => s.source === '9')?.image).toContain('/9.png');
  expect(guideSteps['new-number'].find(s => s.source === '17.2')?.image).toContain('/17.2.png');
});
it('bounds manual navigation without wrapping or advancing provider state', () => {
  expect(guideIndex(0, -1, 8)).toBe(0);
  expect(guideIndex(7, 1, 8)).toBe(7);
  expect(guideIndex(2, 1, 8)).toBe(3);
});
it.each(['ar','en'] as const)('renders safe initial %s guide without an enabled provider action', locale => {
  const html = renderToStaticMarkup(createElement(WhatsappConnectionGuide, { route: 'coexistence', locale }));
  expect(html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
  expect(html).toContain('data-guide-source="8"');
  expect(html).toContain('data-connect-action="true" disabled=""');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('17.1.png');
});
it('provides named native navigation buttons and announces the current guide step',()=>{
 const html=renderToStaticMarkup(createElement(WhatsappConnectionGuide,{route:'new-number',locale:'en'}));
 expect(html).toContain('aria-label="Previous step"');
 expect(html).toContain('aria-label="Next step"');
 expect(html).toContain('aria-label="Step 1" aria-current="step"');
 expect(html).toContain('aria-live="polite" aria-atomic="true"');
 expect(html.match(/type="button"/g)).toHaveLength(12);
});
it('does not enable connection without both permission and a real callback',()=>{
 const render=(extra:{connectEnabled?:boolean;connecting?:boolean;onConnect?:()=>void})=>renderToStaticMarkup(createElement(WhatsappConnectionGuide,{route:'new-number',locale:'en',...extra}));
 expect(render({connectEnabled:true})).toContain('data-connect-action="true" disabled=""');
 expect(render({onConnect:()=>{}})).toContain('data-connect-action="true" disabled=""');
 expect(render({connectEnabled:true,connecting:true,onConnect:()=>{}})).toContain('data-connect-action="true" disabled=""');
 expect(render({connectEnabled:true,onConnect:()=>{throw Error("Rendering must not connect");}})).not.toContain('data-connect-action="true" disabled=""');
});
it('places the real Facebook action below the visual guide as in the approved reference',()=>{
 const html=renderToStaticMarkup(createElement(WhatsappConnectionGuide,{route:'new-number',locale:'en'}));
 expect(html.indexOf('data-guide-connect-area')).toBeGreaterThan(html.indexOf('data-guide-source'));
 expect(html.match(/data-connect-action/g)).toHaveLength(1);
});

it('renders error or status feedback directly within the connect area below the button', () => {
  const html = renderToStaticMarkup(createElement(WhatsappConnectionGuide, {
    route: 'new-number',
    locale: 'en',
    feedback: 'Something went wrong with connection',
  }));
  expect(html).toContain('data-connect-feedback="true"');
  expect(html).toContain('Something went wrong with connection');
  expect(html.indexOf('data-connect-feedback="true"')).toBeGreaterThan(html.indexOf('data-connect-action="true"'));
});
