import {describe,expect,it} from 'vitest';
import {accountContactEmail} from './business-contact-email';
describe('current-account business contact email suggestion',()=>{
 it('uses only a verified current actor with a valid email',()=>{expect(accountContactEmail('a',{userId:'a',email:'owner@example.test'},true)).toBe('owner@example.test');expect(accountContactEmail('b',{userId:'a',email:'owner@example.test'},true)).toBe('');expect(accountContactEmail('a',{userId:'a',email:'owner@example.test'},false)).toBe('');expect(accountContactEmail('a',{userId:'a',email:'bad'},true)).toBe('');});
 it('preserves a valid mailbox local part instead of lowercasing it',()=>{expect(accountContactEmail('a',{userId:'a',email:' Owner.Name@example.test '},true)).toBe('Owner.Name@example.test');});
});
