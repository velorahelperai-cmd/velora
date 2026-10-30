// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {CacheBootstrap} from './cache-bootstrap';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('updates only this origin worker without registering new workers or reloading drafts',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const own=vi.fn().mockResolvedValue(undefined),other=vi.fn(),register=vi.fn();
 vi.stubGlobal('navigator',{serviceWorker:{register,getRegistrations:vi.fn().mockResolvedValue([
  {active:{scriptURL:`${window.location.origin}/sw.js`},update:own},
  {active:{scriptURL:`${window.location.origin}/other/sw.js`},update:other},
  {active:{scriptURL:'https://other.invalid/sw.js'},update:other},
 ])}});
 const host=document.createElement('div'),root=createRoot(host);
 await act(async()=>{root.render(createElement(CacheBootstrap));});
 await act(async()=>{window.dispatchEvent(new Event('load'));});
 expect(own).toHaveBeenCalledTimes(1);expect(other).not.toHaveBeenCalled();expect(register).not.toHaveBeenCalled();
 await act(async()=>root.unmount());
});
it('does not install a worker for a new visitor and catches unavailable storage',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const register=vi.fn(),remove=vi.fn().mockRejectedValue(new Error('private mode'));
 vi.stubGlobal('navigator',{serviceWorker:{register,getRegistrations:vi.fn().mockResolvedValue([])}});
 vi.stubGlobal('caches',{delete:remove});
 const root=createRoot(document.createElement('div'));
 await act(async()=>root.render(createElement(CacheBootstrap)));
 await act(async()=>window.dispatchEvent(new Event('load')));
 expect(register).not.toHaveBeenCalled();expect(remove).toHaveBeenCalledWith('velora-static-v1');
 await act(async()=>root.unmount());
});
