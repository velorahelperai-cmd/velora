import {describe,it,expect,vi} from 'vitest';
import {SmartAutosave,type AutosaveResult} from './smart-autosave';
import {validSmartProfileDraft} from './smart-settings-validation';
const memory=()=>{const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v);},removeItem:(k:string)=>{rows.delete(k);}};};
describe('settings autosave without field drafts',()=>{
 it('ignores edits, dispatch and receipts after the live account changes',async()=>{
  let current=true,finish!:(v:AutosaveResult<string>)=>void;const committed=vi.fn(),save=vi.fn(()=>new Promise<AutosaveResult<string>>(r=>{finish=r;}));
  const c=new SmartAutosave<string>({scope:'actor:company',value:'old',revision:0,digest:'0',storage:memory(),save,id:()=> 'attempt',current:()=>current,committed});
  c.edit('pending');const write=c.flush(true);current=false;c.edit('foreign');finish({ok:true,data:{value:'pending',revision:1,digest:'1'}});await write;await c.flush(true,true);expect(c.state.value).toBe('pending');expect(c.state.revision).toBe(0);expect(committed).not.toHaveBeenCalled();expect(save).toHaveBeenCalledTimes(1);
 });
 it('does not restore partially typed contacts on a new page',()=>{
  const storage=memory(),profile={name:'Business',type:'store' as const,country:'OM',city:'',hours:'',contactPhone:'',contactEmail:'',replyLanguage:'ar' as const};
  const options={scope:'actor:company',value:profile,revision:0,digest:'digest',storage,save:vi.fn(),id:()=> 'attempt',validate:validSmartProfileDraft};
  const c=new SmartAutosave(options);c.edit({...profile,contactEmail:'unfinished@'});expect(new SmartAutosave(options).state.value.contactEmail).toBe('');
 });
 it('keeps edits in memory and coalesces edits during a write',async()=>{
  const storage=memory();let finish!:(v:unknown)=>void;
  const save=vi.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue({ok:true,data:{value:'latest',revision:3,digest:'3'}});
  const c=new SmartAutosave({scope:'actor:company:branch',value:'old',revision:1,digest:'1',storage,save,id:()=> 'attempt'});
  c.edit('first');expect(storage.getItem(c.key)).toBeNull();const pending=c.flush(true);c.edit('latest');await c.flush(true);expect(save).toHaveBeenCalledTimes(1);
  finish({ok:true,data:{value:'first',revision:2,digest:'2'}});await pending;expect(c.state.value).toBe('latest');expect(c.state.status).toBe('changed');await c.flush(true);expect(c.state.status).toBe('saved');
 });
 it('keeps the exact unknown attempt in this page for deliberate replay',async()=>{
  const storage=memory(),save=vi.fn().mockRejectedValue(new Error('lost'));
  const options={scope:'a:c',value:'old',revision:1,digest:'1',storage,save,id:()=> 'same-attempt'};
  const c=new SmartAutosave(options);c.edit('sent');await c.flush(false);expect(save).not.toHaveBeenCalled();await c.flush(true);c.edit('newer');await c.flush(true);expect(save).toHaveBeenCalledTimes(1);
  const restored=new SmartAutosave(options);expect(restored.state.value).toBe('old');await c.flush(true,true);expect(save.mock.calls[1][0]).toMatchObject({id:'same-attempt',value:'sent',revision:1});
 });
 it('blocks conflicts until explicit reload and fences disposed receipts',async()=>{
  let finish!:(v:AutosaveResult<string>)=>void;const c=new SmartAutosave<string>({scope:'a:c',value:'old',revision:1,digest:'1',storage:memory(),save:()=>new Promise(r=>{finish=r;}),id:()=> 'attempt'});
  c.edit('edit');const pending=c.flush(true);finish({ok:false,code:'CONFLICT'});await pending;await c.flush(true,true);expect(c.state.status).toBe('conflict');c.reload('new server',4,'4');expect(c.state.value).toBe('new server');
  c.edit('pending');const next=c.flush(true);c.dispose();finish({ok:true,data:{value:'pending',revision:5,digest:'5'}});await next;expect(c.state.revision).toBe(4);
 });
});
