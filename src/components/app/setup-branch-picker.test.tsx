// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SetupBranchPicker} from './setup-branch-picker';
let host:HTMLDivElement,root:Root;
const select=vi.fn(()=>true),props={locale:'ar' as const,branches:[{id:'one',label:'TAG CITY'},{id:'two',label:'الفرع الثاني'}],selectedId:'one',status:'غير مربوط',ready:false,isCurrent:()=>true,onSelect:select};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);select.mockReset().mockReturnValue(true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(patch:Partial<typeof props>={}){await act(async()=>root.render(createElement(SetupBranchPicker,{...props,...patch})));}
async function open(){await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());}
it('opens from the status area and marks the actual selected branch',async()=>{await render();await act(async()=>host.querySelector<HTMLElement>('[data-ready]')!.click());expect(host.querySelector('[role=listbox]')).not.toBeNull();expect(host.querySelector('[aria-selected=true]')?.textContent).toContain('TAG CITY');expect(document.activeElement).toBe(host.querySelector('[aria-selected=true]'));expect(select).not.toHaveBeenCalled();});
it('supports arrow navigation, selection and returning focus to the trigger',async()=>{await render();await open();await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));expect(document.activeElement?.textContent).toContain('الفرع الثاني');await act(async()=>(document.activeElement as HTMLButtonElement).click());expect(select).toHaveBeenCalledWith('two',expect.any(Element));expect(host.querySelector('[role=listbox]')).toBeNull();expect(document.activeElement).toBe(host.querySelector('button'));});
it('keeps the selected branch and menu when unsaved-change confirmation refuses navigation',async()=>{select.mockReturnValue(false);await render();await open();await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role=option]')[1].click());expect(host.querySelector('[role=listbox]')).not.toBeNull();expect(host.querySelector('[aria-selected=true]')?.textContent).toContain('TAG CITY');});
it('closes with Escape and outside pointer without changing branches',async()=>{await render();await open();await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('[role=listbox]')).toBeNull();await open();await act(async()=>document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})));expect(host.querySelector('[role=listbox]')).toBeNull();expect(select).not.toHaveBeenCalled();});
it('does not open after identity revocation',async()=>{await render({isCurrent:()=>false});await open();expect(host.querySelector('[role=listbox]')).toBeNull();expect(select).not.toHaveBeenCalled();});
it('refuses selection after identity changes while the list is open',async()=>{let current=true;await render({isCurrent:()=>current});await open();current=false;await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role=option]')[1].click());expect(select).not.toHaveBeenCalled();});
