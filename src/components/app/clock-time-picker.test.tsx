// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ClockTimePicker,formatClockDisplay,parseTypedTime} from './clock-time-picker';

describe('parseTypedTime',()=>{
 it.each([
  ['09:30','09:30'],['9:30','09:30'],['0930','09:30'],['930','09:30'],['9','09:00'],['23:59','23:59'],['00:00','00:00'],
  ['9:30 pm','21:30'],['9:30PM','21:30'],['9:30 p.m.','21:30'],['12:00 am','00:00'],['12:15 AM','00:15'],['12 pm','12:00'],['1 am','01:00'],
  ['٩:٣٠ م','21:30'],['٩:٣٠ ص','09:30'],['10.15 مساء','22:15'],['١٢ ص','00:00'],
 ])('%s → %s',(raw,out)=>expect(parseTypedTime(raw)).toBe(out));
 it.each(['','24:00','12:60','13 pm','0 am','ab','9:3x','99999'])('rejects %s',raw=>expect(parseTypedTime(raw)).toBeNull());
});

describe('formatClockDisplay',()=>{
 it.each([
  ['00:00','ar','12:00 ص'],['00:00','en','12:00 AM'],
  ['09:00','ar','09:00 ص'],['09:00','en','09:00 AM'],
  ['12:00','ar','12:00 م'],['12:00','en','12:00 PM'],
  ['14:00','ar','02:00 م'],['14:00','en','02:00 PM'],
  ['23:45','ar','11:45 م'],['23:45','en','11:45 PM'],
 ])('%s (%s) → %s',(value,locale,out)=>expect(formatClockDisplay(value,locale as 'ar'|'en')).toBe(out));
});

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const changes:string[]=[];
function Harness({locale='en' as 'ar'|'en',initial='09:00'}){const [v,setV]=useState(initial);return createElement(ClockTimePicker,{value:v,locale,label:'Start time',inputLabel:'Quick start time',onChange:(x:string)=>{changes.push(x);setV(x);}});}
const field=()=>host.querySelector<HTMLInputElement>('input[aria-label="Quick start time"]')!;
async function type(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field(),value);field().dispatchEvent(new Event('input',{bubbles:true}));});}
async function blur(){await act(async()=>{field().dispatchEvent(new FocusEvent('blur'));field().dispatchEvent(new FocusEvent('focusout',{bubbles:true}));});}

describe('ClockTimePicker keyboard entry',()=>{
 beforeEach(()=>{changes.length=0;});
 it('shows one locale time field plus an icon-only dial button',async()=>{
  await act(async()=>root.render(createElement(Harness)));
  expect(field()).not.toBeNull();expect(field().type).toBe('text');expect(field().value).toBe('09:00 AM');
  const dial=host.querySelector<HTMLButtonElement>('button[aria-label="Start time"]')!;
  expect(dial).not.toBeNull();expect(dial.textContent?.trim()).toBe('');
  expect(host.querySelectorAll('[data-clock-time-picker] input').length).toBe(1);
 });
 it('shows Arabic 12-hour labels for afternoon values without a second 24h box',async()=>{
  await act(async()=>root.render(createElement(Harness,{locale:'ar',initial:'14:00'})));
  expect(field().value).toBe('02:00 م');
  expect(host.querySelectorAll('[data-clock-time-picker] input').length).toBe(1);
  expect(host.querySelector('button[aria-label="Start time"]')?.textContent?.trim()).toBe('');
 });
 it('commits a typed 24h time and a typed 12h time with PM',async()=>{
  await act(async()=>root.render(createElement(Harness)));
  await type('17:45');expect(changes.at(-1)).toBe('17:45');
  await type('8:15 pm');expect(changes.at(-1)).toBe('20:15');
  await blur();
  expect(field().value).toBe('08:15 PM');
 });
 it('flags invalid input without changing the value',async()=>{
  await act(async()=>root.render(createElement(Harness)));
  await type('25:00');expect(changes).toEqual([]);
  expect(field().getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('09:30');
  await type('07:05');expect(changes).toEqual(['07:05']);expect(field().hasAttribute('aria-invalid')).toBe(false);
  await blur();expect(field().value).toBe('07:05 AM');
 });
 it('switches AM/PM from the dial and reports pressed state',async()=>{
  await act(async()=>root.render(createElement(Harness,{locale:'en'})));
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Start time"]')!.click());
  const am=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='AM')!;
  const pm=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='PM')!;
  expect(am.getAttribute('aria-pressed')).toBe('true');expect(pm.getAttribute('aria-pressed')).toBe('false');
  await act(async()=>pm.click());expect(changes.at(-1)).toBe('21:00');
  expect(pm.getAttribute('aria-pressed')).toBe('true');expect(field().value).toBe('09:00 PM');
  await act(async()=>am.click());expect(changes.at(-1)).toBe('09:00');
  expect(field().value).toBe('09:00 AM');
 });
 it('accepts Arabic digits and the Arabic PM marker',async()=>{
  await act(async()=>root.render(createElement(Harness,{locale:'ar'})));
  await type('٧:٣٠ م');expect(changes.at(-1)).toBe('19:30');
  await blur();expect(field().value).toBe('07:30 م');
 });
});
