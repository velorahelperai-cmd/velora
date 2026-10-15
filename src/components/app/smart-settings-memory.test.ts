import {describe,it,expect,vi} from 'vitest';
import {SmartAutosave} from './smart-autosave';
describe('real settings persistence without browser drafts',()=>{
 it('disposes without flushing unsent fields or waiting for a draft write',async()=>{const save=vi.fn();const c=new SmartAutosave({scope:'a:c',value:'server',revision:1,digest:'1',save,id:()=> 'attempt'});c.edit('unconfirmed');expect(c.dispose()).toBeUndefined();await c.flush(true,true);expect(save).not.toHaveBeenCalled();});
 it('never reads, writes or deletes old field drafts and starts from authoritative settings',async()=>{
  const storage={getItem:vi.fn(()=>JSON.stringify({scope:'a:c',value:'old draft',baseline:'server',revision:1,digest:'1'})),setItem:vi.fn(),removeItem:vi.fn()};
  const committed=vi.fn(),save=vi.fn().mockResolvedValue({ok:true,data:{value:'confirmed',revision:2,digest:'2'}});
  const c=new SmartAutosave({scope:'a:c',value:'server',revision:1,digest:'1',storage,save,id:()=> 'attempt',committed});
  expect(c.state.value).toBe('server');c.edit('confirmed');await c.flush(true);
  expect(save).toHaveBeenCalledWith({id:'attempt',value:'confirmed',revision:1,digest:'1'});expect(committed).toHaveBeenCalled();
  expect(storage.getItem).not.toHaveBeenCalled();expect(storage.setItem).not.toHaveBeenCalled();expect(storage.removeItem).not.toHaveBeenCalled();
 });
 it('keeps unknown retries in this page and uses authoritative values on a new page',async()=>{
  const storage={getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn()},save=vi.fn().mockRejectedValue(Error('lost'));
  const options={scope:'a:c',value:'server',revision:1,digest:'1',storage,save,id:()=> 'same-attempt'};
  const c=new SmartAutosave(options);c.edit('edit');await c.flush(true);await c.flush(true,true);
  expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);expect(new SmartAutosave(options).state.value).toBe('server');
 });
});
