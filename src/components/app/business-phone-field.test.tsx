// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('./country-combobox',()=>({CountryCombobox:({id,value,onChange,disabled}:{id:string;value:string;onChange:(s:string)=>void;disabled:boolean})=>createElement('select',{id,value,disabled,onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>onChange(e.target.value)},['','OM','EG','SA'].map(code=>createElement('option',{key:code,value:code},code)))}));
import {BusinessPhoneField} from './business-phone-field';
let root:Root,host:HTMLDivElement;const change=vi.fn();
async function render(value='',businessCountry='OM'){await act(async()=>root.render(createElement(BusinessPhoneField,{id:'phone',label:'Phone',value,businessCountry,ar:false,onChange:change})));}
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('uses the saved international number country after late draft hydration',async()=>{
 await render();await render('+201001234567','OM');
 expect(host.querySelector('select')?.value).toBe('EG');
 expect(change).not.toHaveBeenCalled();
});
it('follows a changed business country only until a phone country is selected',async()=>{
 await render();await render('','EG');expect(host.querySelector('select')?.value).toBe('EG');
 await act(async()=>{const select=host.querySelector('select')!;select.value='OM';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await render('','SA');expect(host.querySelector('select')?.value).toBe('OM');expect(change).not.toHaveBeenCalled();
});
it('recognizes pasted international country and commits canonical value on blur',async()=>{
 await render();await act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'+201001234567');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelector('select')?.value).toBe('EG');
 await act(async()=>host.querySelector('input')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
 expect(change).toHaveBeenCalledExactlyOnceWith('+201001234567');
});
