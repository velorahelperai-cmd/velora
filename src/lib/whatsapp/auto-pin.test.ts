import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {autoPinAllowed} from './auto-pin';
describe('auto PIN policy',()=>{
 const scope={companyId:'company',branchId:'branch',phoneNumberId:'123'};
 const row={...scope,approvedBy:'admin',evidence:'meta-manager-confirmed'};
 it('fails closed unless explicitly enabled with an exact approved scope',()=>{
  expect(autoPinAllowed(scope,{})).toBe(false);
  expect(autoPinAllowed(scope,{WHATSAPP_AUTO_PIN_ENABLED:'true',WHATSAPP_AUTO_PIN_ALLOWLIST:'invalid'})).toBe(false);
  const env={WHATSAPP_AUTO_PIN_ENABLED:'true',WHATSAPP_AUTO_PIN_ALLOWLIST:JSON.stringify([row])};
  expect(autoPinAllowed(scope,env)).toBe(true);
  expect(autoPinAllowed({...scope,branchId:'other'},env)).toBe(false);
  expect(autoPinAllowed({...scope,phoneNumberId:'999'},env)).toBe(false);
  expect(autoPinAllowed(scope,{...env,WHATSAPP_AUTO_PIN_ALLOWLIST:JSON.stringify([{...row,approvedBy:''}])})).toBe(false);
 });
});
