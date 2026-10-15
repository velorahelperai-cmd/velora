import {describe,it,expect,vi} from 'vitest';
import {readBusinessCreationRecovery,persistBusinessCreationAttempt,settleBusinessCreationAttempt} from './business-creation-recovery';
const userId='00000000-0000-4000-8000-000000000001';
const attempt={id:'00000000-0000-4000-8000-000000000002',fields:{name:'Business',type:'other',country:'OM'}};
const memory=()=>{const rows=new Map<string,string>();return {rows,getItem:(k:string)=>rows.get(k)??null,setItem:vi.fn((k:string,v:string)=>{rows.set(k,v);})};};
describe('creation recovery without field drafts',()=>{
 it('ignores unsubmitted legacy fields without changing or deleting them',()=>{const s=memory(),key=`velora_smart_first_business:${userId}`;const legacy=JSON.stringify({userId,fields:attempt.fields});s.rows.set(key,legacy);expect(readBusinessCreationRecovery(s,userId)).toBeNull();expect(s.rows.get(key)).toBe(legacy);expect(s.setItem).not.toHaveBeenCalled();});
 it('preserves immutable unknown requests and settles them without deleting legacy keys',()=>{const s=memory(),key=`velora_smart_first_business:${userId}`;s.rows.set(key,JSON.stringify({userId,fields:attempt.fields,attempt}));expect(readBusinessCreationRecovery(s,userId)).toEqual(attempt);persistBusinessCreationAttempt(s,userId,attempt);expect(readBusinessCreationRecovery(s,userId)).toEqual(attempt);settleBusinessCreationAttempt(s,userId,attempt.id,'confirmed','company');expect(readBusinessCreationRecovery(s,userId)).toBeNull();expect(s.rows.has(key)).toBe(true);expect(s.setItem.mock.calls.every(([k])=>k.startsWith('velora_business_creation_recovery_v2:'))).toBe(true);});
 it('rejects foreign immutable attempts instead of starting a replacement',()=>{const s=memory();s.rows.set(`velora_smart_first_business:${userId}`,JSON.stringify({userId:'foreign',fields:attempt.fields,attempt}));expect(()=>readBusinessCreationRecovery(s,userId)).toThrow('INVALID_RECOVERY');});
});
