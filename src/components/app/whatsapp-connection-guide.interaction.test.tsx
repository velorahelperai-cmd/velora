// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {WhatsappConnectionGuide,type WhatsappConnectionGuideProps} from './whatsapp-connection-guide';
let host:HTMLDivElement,root:Root;
const onConnect=vi.fn();
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);onConnect.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=async(extra:Partial<WhatsappConnectionGuideProps>={})=>{await act(async()=>root.render(createElement(WhatsappConnectionGuide,{locale:'en',route:'coexistence',connectionStatus:'Not connected',connectEnabled:true,onConnect,...extra})));};
async function jump(value:string){await act(async()=>{host.querySelector<HTMLButtonElement>(`[data-guide-step="${value}"]`)!.click();});}
const source=()=>host.querySelector('[data-guide-source]')?.getAttribute('data-guide-source');
async function key(k:string,sel='[aria-label="Guide illustration"],[aria-label="صورة توضيحية للدليل"]'){await act(async()=>{host.querySelector(sel)!.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));});}
it('keeps illustrations visible and never connects or changes status through guide navigation',async()=>{
 await render();expect(host.querySelector('details')).toBeNull();
 expect(host.querySelector('[data-visible-connection-guide] img')).not.toBeNull();
 await jump('5');expect(host.querySelector('[data-guide-source]')?.getAttribute('data-guide-source')).toBe('coexistence/step-7');
 expect(host.querySelector('img')?.getAttribute('src')).toContain('coexistence/step-7.png');expect(host.textContent).toContain('Not connected');expect(onConnect).not.toHaveBeenCalled();
 await jump('7');expect(host.textContent).toContain('does not confirm connection');expect(onConnect).not.toHaveBeenCalled();
});
it('preserves the illustrated position on locale changes but resets for a different number route',async()=>{
 await render();await jump('2');await render({locale:'ar'});
 expect(host.querySelector('[data-guide-source]')?.getAttribute('data-guide-source')).toBe('coexistence/step-3');
 await render({route:'new-number'});expect(host.querySelector('[data-guide-source]')?.getAttribute('data-guide-source')).toBe('17.1');
 expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('Connect a new WhatsApp number');expect(host.textContent).not.toContain('almost there');
});
it('only invokes the actual connection action on its enabled button',async()=>{
 await render({connectEnabled:false});await act(async()=>host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click());expect(onConnect).not.toHaveBeenCalled();
 await render();await act(async()=>host.querySelector<HTMLButtonElement>('[data-connect-action]')!.click());expect(onConnect).toHaveBeenCalledOnce();
});

it('navigates with arrow keys in reading direction, focusable buttons and step dots with aria-current',async()=>{
 await render();const pic=host.querySelector<HTMLElement>('[aria-label="Guide illustration"]')!;
 expect(pic.tabIndex).toBe(0);expect(host.querySelector('select')).toBeNull();
 await key('ArrowRight');expect(source()).toBe('coexistence/step-2');await key('ArrowLeft');expect(source()).toBe('coexistence/step-1');
 await key('ArrowLeft');expect(source()).toBe('coexistence/step-1');await key('End');expect(source()).toBe('coexistence/step-9');await key('ArrowRight');expect(source()).toBe('coexistence/step-9');await key('Home');expect(source()).toBe('coexistence/step-1');
 const next=host.querySelector<HTMLButtonElement>('[aria-label="Next step"]')!;const prev=host.querySelector<HTMLButtonElement>('[aria-label="Previous step"]')!;
 expect(prev.disabled).toBe(true);await act(async()=>next.click());expect(source()).toBe('coexistence/step-2');expect(prev.disabled).toBe(false);
 const dots=[...host.querySelectorAll<HTMLButtonElement>('[data-guide-step]')];expect(dots).toHaveLength(8);
 expect(dots.filter(d=>d.getAttribute('aria-current')==='step').map(d=>d.dataset.guideStep)).toEqual(['1']);
 expect(dots[1].getAttribute('aria-label')).toBe('Step 2: Connect your account to Velora');
 await jump('2');expect(source()).toBe('coexistence/step-3');expect(dots[2].getAttribute('aria-current')).toBe('step');expect(dots[1].hasAttribute('aria-current')).toBe(false);
 expect(host.querySelector('img')!.getAttribute('alt')).toBe('Reference Meta panel: Enter your WhatsApp Business app number');
 await render({locale:'ar'});await key('ArrowLeft');expect(source()).toBe('coexistence/step-5');await key('ArrowRight');expect(source()).toBe('coexistence/step-3');
 expect(onConnect).not.toHaveBeenCalled();expect(host.textContent).toContain('Not connected');
});
