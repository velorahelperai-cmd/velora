import {expect,it} from 'vitest';
import {parseSmartStartStorage} from './smart-business-start-storage';
const fields={name:'Shop',type:'retail',country:'OM'},userId='owner',attempt={id:'11111111-1111-4111-8111-111111111111',fields};
it('restores only a matching complete actor-bound attempt',()=>{expect(parseSmartStartStorage({userId,fields,attempt},userId)).toEqual({fields,attempt});expect(parseSmartStartStorage({userId:'previous',fields,attempt},userId)).toBeNull();});
it.each([{},[],{name:'Shop'},null,{...fields,country:3},{...fields,name:'x\n'}, {...fields,type:'x'.repeat(81)}])('rejects malformed persisted fields %j',bad=>{expect(parseSmartStartStorage({userId,fields:bad},userId)).toBeNull();});
it('never regenerates a corrupt or altered unknown attempt',()=>{expect(parseSmartStartStorage({userId,fields,attempt:{id:'bad',fields}},userId)).toBeNull();expect(parseSmartStartStorage({userId,fields,attempt:{...attempt,fields:{...fields,name:''}}},userId)).toBeNull();});
