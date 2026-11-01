import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WhatsappConnectionGuide, guideSteps, guideIndex } from './whatsapp-connection-guide';

it('keeps both observed routes separate and preserves source order', () => {
  expect(guideSteps.coexistence.map(s => s.source)).toEqual(['coexistence/step-1','coexistence/step-2','coexistence/step-3','coexistence/step-5','coexistence/step-6','coexistence/step-7','coexistence/step-8','coexistence/step-9']);
  expect(guideSteps['new-number'].map(s => s.source)).toEqual(['17.1','17.2','17.3','17.4','17.5','17.6','17.7','17.8','17.9']);
  // Step 7 QR is blurred in the public crop, so the image is shown.
  expect(guideSteps.coexistence.find(s => s.source === 'coexistence/step-7')?.image).toContain('coexistence/step-7.png');
  expect(guideSteps.coexistence.find(s => s.source === 'coexistence/step-2')?.image).toContain('coexistence/step-2.png');
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
  expect(html).toContain('data-guide-source="coexistence/step-1"');
  expect(html).toContain('data-connect-action="true" disabled=""');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('17.1.png');
});
it('provides named native navigation buttons and announces the current guide step',()=>{
 const html=renderToStaticMarkup(createElement(WhatsappConnectionGuide,{route:'new-number',locale:'en'}));
 expect(html).toContain('aria-label="Previous step"');
 expect(html).toContain('aria-label="Next step"');
 expect(html).toContain('aria-label="Guide illustration"');
 expect(html).toContain('aria-live="polite" aria-atomic="true"');
 // previous, next, connect, plus one step button per illustration
 expect(html.match(/type="button"/g)).toHaveLength(3+guideSteps['new-number'].length);
 expect(html.match(/aria-current="step"/g)).toHaveLength(1);
 expect(html).toContain('aria-label="Step 1: Sign in to Facebook"');
 expect(html).toContain('alt="Reference Meta panel: Sign in to Facebook"');
 expect(html).toContain('tabindex="0"');
});
it('does not enable connection without both permission and a real callback',()=>{
 const render=(extra:{connectEnabled?:boolean;connecting?:boolean;onConnect?:()=>void})=>renderToStaticMarkup(createElement(WhatsappConnectionGuide,{route:'new-number',locale:'en',...extra}));
 expect(render({connectEnabled:true})).toContain('data-connect-action="true" disabled=""');
 expect(render({onConnect:()=>{}})).toContain('data-connect-action="true" disabled=""');
 expect(render({connectEnabled:true,connecting:true,onConnect:()=>{}})).toContain('data-connect-action="true" disabled=""');
 expect(render({connectEnabled:true,onConnect:()=>{throw Error("Rendering must not connect");}})).not.toContain('data-connect-action="true" disabled=""');
});
it('keeps the illustrated guide visible before the connection action without claiming readiness',()=>{
 const html=renderToStaticMarkup(createElement(WhatsappConnectionGuide,{route:'new-number',locale:'en'}));
 expect(html.indexOf('data-guide-connect-area')).toBeGreaterThan(html.indexOf('data-guide-source'));
 expect(html.match(/data-connect-action/g)).toHaveLength(1);
 expect(html).toContain('data-visible-connection-guide="true"');
 expect(html).not.toContain('<details');
 expect(html).not.toContain("almost there");
 expect(html).toContain('new WhatsApp number');
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
