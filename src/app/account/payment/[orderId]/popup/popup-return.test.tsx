// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {PopupReturn} from './popup-return';
it('closes even when browser storage blocks the optional return hint',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('BroadcastChannel',class{constructor(){throw Error('denied');}});
 const close=vi.spyOn(window,'close').mockImplementation(()=>{});const host=document.createElement('div');const root=createRoot(host);
 try{await act(async()=>root.render(createElement(PopupReturn,{orderId:'11111111-2222-4333-8444-555555555555'})));expect(close).toHaveBeenCalled();expect(host.querySelector('a')!.getAttribute('href')).toBe('/account/payment/11111111-2222-4333-8444-555555555555');}
 finally{await act(async()=>root.unmount());close.mockRestore();vi.unstubAllGlobals();}
});
